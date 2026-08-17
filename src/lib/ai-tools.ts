import { proposeCommand } from "./ai-commands";
import { requestEvents } from "./relay-subscription";

import { getKindInfo } from "@/constants/kinds";
import { AGGREGATOR_RELAYS } from "@/services/loaders";
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

/** Cap on one query. A model will happily ask for the whole network. */
const MAX_QUERY_LIMIT = 20;
/** Cap on returned content, so one long article cannot eat the window. */
const MAX_CONTENT_CHARS = 2_000;

export const AI_TOOLS: InferenceTool[] = [
  {
    type: "function",
    function: {
      name: "lookup_spec",
      description:
        "Look up a NIP's text or an event kind's definition from grimoire's " +
        "own registry and cache. Use this instead of recalling spec details.",
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
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_nostr",
      description:
        "Fetch stored events from relays. Read-only. Returns at most " +
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
            description: "Hex pubkeys, not npubs.",
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
        required: ["kinds"],
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
  const { nip, kind } = (args ?? {}) as { nip?: unknown; kind?: unknown };
  const result: Record<string, unknown> = {};

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
    return { error: "Pass a nip id, a kind number, or both." };
  }
  return result;
}

async function queryNostr(args: unknown): Promise<unknown> {
  const { kinds, authors, limit, relays } = (args ?? {}) as {
    kinds?: unknown;
    authors?: unknown;
    limit?: unknown;
    relays?: unknown;
  };

  const kindList = Array.isArray(kinds)
    ? kinds.filter((k): k is number => typeof k === "number")
    : [];
  if (kindList.length === 0) {
    return { error: "kinds must be a non-empty array of numbers." };
  }

  const authorList = Array.isArray(authors)
    ? authors.filter(
        (a): a is string => typeof a === "string" && /^[0-9a-f]{64}$/i.test(a),
      )
    : undefined;

  const relayList =
    Array.isArray(relays) &&
    relays.every((r): r is string => typeof r === "string")
      ? relays
      : AGGREGATOR_RELAYS;

  const capped = Math.min(
    typeof limit === "number" && limit > 0 ? limit : 5,
    MAX_QUERY_LIMIT,
  );

  const events = await requestEvents(relayList, [
    {
      kinds: kindList,
      ...(authorList?.length ? { authors: authorList } : {}),
      limit: capped,
    },
  ]);

  return {
    count: events.length,
    events: events.slice(0, capped).map((event) => ({
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
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
