import { nip19 } from "nostr-tools";

import { PROPOSAL_DENIED, proposeCommand } from "./ai-commands";
import { MAX_QUERY_LIMIT, resolveAliases, sanitizeFilter } from "./ai-filter";
import { requestEvents } from "./relay-subscription";

import { getKindInfo } from "@/constants/kinds";
import { manPages } from "@/types/man";
import { getNipText } from "@/services/nip-text";
import type { InferenceTool } from "@/types/inference";

/**
 * Function tools for the `ai` window.
 *
 * Deliberately three. IPA's permission UI must list every function name and
 * re-prompts whenever the set widens, so a large surface costs the user a
 * dialog full of names and a fresh prompt every time it grows.
 *
 * None of them sign, publish, spend, or follow. Tool arguments are shaped by
 * whatever the model read — including note text, which is untrusted — so the
 * only writes available are windows the user then drives themselves.
 */

/** Cap on returned content, so one long article cannot eat the window. */
const MAX_CONTENT_CHARS = 2_000;

/** Commands whose manual page Hex may read: the ones it may also propose. */
const READABLE_COMMANDS = Object.keys(manPages)
  .filter((name) => !PROPOSAL_DENIED.has(manPages[name].appId))
  .sort();

export const AI_TOOLS: InferenceTool[] = [
  {
    type: "function",
    function: {
      name: "lookup_spec",
      description:
        "Look up a NIP's text, an event kind's definition, or a grimoire " +
        "command's manual page, from grimoire's own registry and cache. Use " +
        "this instead of recalling spec details or guessing at a command's " +
        "flags.",
      parameters: {
        type: "object",
        properties: {
          nip: {
            type: "string",
            description: 'NIP id, e.g. "01" or "65".',
          },
          kind: {
            type: "number",
            description: "Event kind number.",
          },
          command: {
            type: "string",
            // Enumerated, because the whole set is two dozen names: a model
            // that has to guess spends a round finding out it guessed wrong,
            // and a provider that enforces schemas will not let it guess.
            // Same exclusions as the prompt's catalogue — a command Hex is not
            // told about is not one it should be able to read up on.
            enum: READABLE_COMMANDS,
            description:
              'A grimoire command name, e.g. "req" — returns its synopsis, ' +
              "flags with descriptions, examples, and related commands.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_nostr",
      description:
        "Run a REQ against relays and read what comes back. Read-only. " +
        "Takes a full NIP-01 filter; returns at most " +
        `${MAX_QUERY_LIMIT} events with content truncated.`,
      parameters: {
        type: "object",
        properties: {
          kinds: {
            type: "array",
            items: { type: "number" },
            description: "Event kinds to request.",
          },
          authors: {
            type: "array",
            items: { type: "string" },
            description:
              'Hex pubkeys, not npubs. "$me" and "$contacts" resolve to the ' +
              "active account and the people it follows.",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Hex event ids, not note1 or nevent.",
          },
          since: {
            type: "number",
            description: "Unix seconds; only events at or after this time.",
          },
          until: {
            type: "number",
            description: "Unix seconds; only events at or before this time.",
          },
          search: {
            type: "string",
            description:
              "NIP-50 full-text query. Only some relays implement it.",
          },
          tags: {
            type: "object",
            description:
              'Single-letter tag filters: {"t": ["nostr"]} for a hashtag, ' +
              '{"e": ["<hex>"]} for replies to an event, {"p": ["$me"]} for ' +
              "events tagging the active account.",
            additionalProperties: {
              type: "array",
              items: { type: "string" },
            },
          },
          limit: {
            type: "number",
            description: `Maximum events, capped at ${MAX_QUERY_LIMIT}.`,
          },
          relays: {
            type: "array",
            items: { type: "string" },
            description: "Relay URLs. Omit to use grimoire's defaults.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_window",
      description:
        "Open a grimoire window by running one of its commands. Read-only " +
        "commands only: post, zap, and wallet are refused and must be " +
        "proposed to the user instead.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: 'A grimoire command line, e.g. "nip 65".',
          },
        },
        required: ["command"],
      },
    },
  },
];

export type ToolExecutor = (args: unknown) => Promise<unknown>;

/**
 * Executors for the read-only tools. `open_window` needs React state, so the
 * viewer supplies it — see `openWindow`.
 */
export function createToolExecutors(openWindow: ToolExecutor) {
  return {
    lookup_spec: lookupSpec,
    query_nostr: queryNostr,
    open_window: openWindow,
  } satisfies Record<string, ToolExecutor>;
}

async function lookupSpec(args: unknown): Promise<unknown> {
  const { nip, kind, command } = (args ?? {}) as {
    nip?: unknown;
    kind?: unknown;
    command?: unknown;
  };
  const result: Record<string, unknown> = {};

  if (typeof command === "string" && command.trim()) {
    result.command = manPage(command);
  }

  if (typeof kind === "number" && Number.isFinite(kind)) {
    const info = getKindInfo(kind);
    result.kind = info
      ? { kind, name: info.name, nip: info.nip, description: info.description }
      : { kind, known: false };
  }

  const nipId =
    typeof nip === "string"
      ? nip
          .replace(/^nip-?/i, "")
          .toUpperCase()
          .padStart(2, "0")
      : typeof result.kind === "object" &&
          result.kind != null &&
          "nip" in result.kind &&
          typeof result.kind.nip === "string"
        ? result.kind.nip.replace(/^nip-?/i, "").toUpperCase()
        : undefined;

  if (nipId) {
    const text = await getNipText(nipId);
    result.nip = text
      ? { id: nipId, text }
      : { id: nipId, error: "Could not load this NIP's text." };
  }

  if (Object.keys(result).length === 0) {
    return { error: "Pass a nip id, a kind number, or a command name." };
  }
  return result;
}

/**
 * A command's manual page, verbatim from the registry the palette reads.
 *
 * The system prompt lists every command's synopsis and flag names, which is
 * enough to pick one and not enough to write it — flag descriptions and
 * examples live here so the prompt stays a catalogue rather than a manual.
 */
function manPage(name: string): unknown {
  const key = name.trim().split(/\s+/)[0].toLowerCase();
  const page = READABLE_COMMANDS.includes(key) ? manPages[key] : undefined;
  // The schema enumerates the names, so this only fires for a provider that
  // does not enforce enums — still answered as data, never thrown.
  if (!page) {
    return {
      name: key,
      error: `No such command. Known commands: ${READABLE_COMMANDS.join(", ")}.`,
    };
  }
  return {
    name: page.name,
    synopsis: page.synopsis,
    description: page.description,
    ...(page.options?.length ? { options: page.options } : {}),
    ...(page.examples?.length ? { examples: page.examples } : {}),
    ...(page.seeAlso?.length ? { seeAlso: page.seeAlso } : {}),
  };
}

async function queryNostr(args: unknown): Promise<unknown> {
  const sanitized = sanitizeFilter(args);
  if ("error" in sanitized) return sanitized;

  const resolved = await resolveAliases(sanitized.filter);
  if ("error" in resolved) return resolved;

  const events = await requestEvents(sanitized.relays, [resolved.filter]);
  const limit = resolved.filter.limit ?? events.length;

  return {
    // The filter as sent, aliases expanded: the model can see why a query came
    // back empty, and the window shows the same REQ the relays saw.
    filter: resolved.filter,
    relays: sanitized.relays,
    count: events.length,
    events: events.slice(0, limit).map((event) => ({
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      // The bech32 to quote. A model handed only hex writes an npub with a bad
      // checksum, and grimoire renders an undecodable reference as dead text —
      // so the encoding it must copy is supplied rather than left to it.
      npub: nip19.npubEncode(event.pubkey),
      nevent: nip19.neventEncode({
        id: event.id,
        kind: event.kind,
        author: event.pubkey,
      }),
      created_at: event.created_at,
      tags: event.tags,
      content:
        event.content.length > MAX_CONTENT_CHARS
          ? `${event.content.slice(0, MAX_CONTENT_CHARS)}…[truncated]`
          : event.content,
    })),
  };
}

/** Shared refusal so the tool and the chips agree on what may not run. */
export function refuseIfNeeded(command: string): string | undefined {
  const proposed = proposeCommand(command);
  if (!proposed) return `Not a grimoire command: ${command}`;
  return proposed.refusal;
}
