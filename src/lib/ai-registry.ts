import {
  draftEvent,
  listSpellsTool,
  lookupSpec,
  proposeCommandTool,
  queryNostr,
  resolveTool,
} from "./ai-tools";
import { MAX_QUERY_LIMIT } from "./ai-filter";
import { READABLE_COMMANDS } from "./ai-commands";

import type { InferenceTool } from "@/types/inference";

/**
 * The tool registry: every capability Hex has, named `<namespace>.<action>`.
 *
 * One list, not five call sites. A tool is defined once — id, description,
 * schema, executor — and the wire schema, the executor table, the system
 * prompt's tool paragraph and the transcript's renderers all read from here.
 * Before this, a tool's name existed in four places and the prompt drifted from
 * the schema.
 *
 * The namespace says whose capability it is: `grimoire.*` acts on the
 * application (its docs, its commands, its windows), `nostr.*` on the network
 * (reading it, resolving its identifiers, drafting for it). An agent definition
 * published to Nostr will name tools by these ids, so they are a contract:
 * rename one and every stored conversation and shared agent points at nothing.
 *
 * None of them sign, publish, spend, or follow. `nostr.publish` drafts an event
 * and stops — the signature happens when the user presses the button on the
 * card. Tool arguments are shaped by whatever the model read, including note
 * text, which is untrusted.
 */

export type ToolNamespace = "grimoire" | "nostr";

export type ToolExecutor = (args: unknown) => Promise<unknown>;

export interface ToolDefinition {
  /** Canonical id, `<namespace>.<action>`. What the UI and storage use. */
  id: string;
  namespace: ToolNamespace;
  description: string;
  /** JSON Schema for the arguments, as the provider will see it. */
  parameters: Record<string, unknown>;
  /** Page-side executor. Absent when the host must supply one — see `hostId`. */
  execute?: ToolExecutor;
  /**
   * Set when the executor needs React state (window management), so the viewer
   * passes it in rather than the lib reaching for a hook.
   */
  host?: boolean;
  /** One line for the system prompt, telling the model when to reach for it. */
  prompt: string;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    id: "grimoire.help",
    namespace: "grimoire",
    description:
      "Look up a NIP's text, an event kind's definition, or a grimoire " +
      "command's manual page, from grimoire's own registry and cache. Use " +
      "this instead of recalling spec details or guessing at a command's " +
      "flags.",
    parameters: {
      type: "object",
      properties: {
        nip: { type: "string", description: 'NIP id, e.g. "01" or "65".' },
        kind: { type: "number", description: "Event kind number." },
        command: {
          type: "string",
          // Enumerated, because the whole set is two dozen names: a model that
          // has to guess spends a round finding out it guessed wrong, and a
          // provider that enforces schemas will not let it guess. Same
          // exclusions as the prompt's catalogue — a command Hex is not told
          // about is not one it should be able to read up on.
          enum: READABLE_COMMANDS,
          description:
            'A grimoire command name, e.g. "req" — returns its synopsis, ' +
            "flags with descriptions, examples, and related commands.",
        },
      },
    },
    execute: lookupSpec,
    prompt:
      "`grimoire.help` returns a NIP's text, a kind's definition, or a" +
      " command's manual page with its flags described.",
  },
  {
    id: "grimoire.spells",
    namespace: "grimoire",
    description:
      "The user's saved spells: each one's alias, name and the `req` command " +
      "it runs. Read-only — nothing here saves, publishes or deletes a spell.",
    parameters: {
      type: "object",
      properties: {
        alias: {
          type: "string",
          description: "One spell by alias or name. Omit for all of them.",
        },
      },
    },
    execute: listSpellsTool,
    prompt:
      "`grimoire.spells` returns the user's saved spells, each with the `req`" +
      " it runs — open one with `grimoire.window` or run the same filter" +
      " yourself with `nostr.req`. Never guess at what a spell runs, and never" +
      " invent an alias the list did not contain.",
  },
  {
    id: "grimoire.command",
    namespace: "grimoire",
    description:
      "Offer grimoire commands for the user to run, as buttons in the reply. " +
      "Nothing opens until they press one. Use this whenever the answer is " +
      "'run this' rather than a window you were asked to open.",
    parameters: {
      type: "object",
      properties: {
        commands: {
          type: "array",
          items: { type: "string" },
          description:
            'Command lines as they should run, e.g. "req -k 1 -a $contacts". ' +
            "Use `$me` and `$contacts` rather than placeholder pubkeys, and " +
            "name no relay unless the user did.",
        },
        reason: {
          type: "string",
          description: "One sentence on what these show.",
        },
      },
      required: ["commands"],
    },
    execute: proposeCommandTool,
    prompt:
      "`grimoire.command` offers commands as buttons the user presses — the" +
      " way to hand over a command you were not asked to run.",
  },
  {
    id: "grimoire.window",
    namespace: "grimoire",
    description:
      "Open a grimoire window by running one of its commands. Read-only " +
      "commands only: post, zap, and wallet are refused and must be offered " +
      "with grimoire.command instead.",
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
    host: true,
    prompt:
      "`grimoire.window` opens a read-only command. Open a window yourself" +
      " only when the user asked for one.",
  },
  {
    id: "nostr.req",
    namespace: "nostr",
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
          description: "NIP-50 full-text query. Only some relays implement it.",
        },
        tags: {
          type: "object",
          description:
            'Single-letter tag filters: {"t": ["nostr"]} for a hashtag, ' +
            '{"e": ["<hex>"]} for replies to an event, {"p": ["$me"]} for ' +
            "events tagging the active account.",
          additionalProperties: { type: "array", items: { type: "string" } },
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
    execute: queryNostr,
    prompt:
      "`nostr.req` takes a whole NIP-01 filter — ids, authors, kinds, since," +
      " until, search, and single-letter tags — so narrow the query instead of" +
      " fetching kind 1 and sorting it in your head. `$me` and `$contacts`" +
      " work in `authors` and in the `p` tag. Answer from what came back," +
      " quoting it.",
  },
  {
    id: "nostr.resolve",
    namespace: "nostr",
    description:
      "Turn a bech32 entity into what it names: a person's profile for an " +
      "npub or nprofile, the event itself for a note, nevent or naddr. " +
      "Bech32 cannot be read by inspection, so resolve one before answering " +
      "a question about it.",
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "An npub, nprofile, note, nevent or naddr, with or without the " +
            "`nostr:` prefix.",
        },
      },
      required: ["entity"],
    },
    execute: resolveTool,
    prompt:
      "`nostr.resolve` turns a bech32 entity into the person or event it" +
      " names.",
  },
  {
    id: "nostr.publish",
    namespace: "nostr",
    description:
      "Draft a Nostr event for the user to sign and publish. This does not " +
      "publish: it shows the event in the reply with a button, and the user's " +
      "signer is only asked when they press it. Kinds that overwrite the " +
      "user's own state — metadata, contacts, relay lists — are refused.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "number", description: "Event kind." },
        content: { type: "string", description: "Event content." },
        tags: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: 'Tags, e.g. [["t","nostr"],["e","<hex>"]].',
        },
        reason: {
          type: "string",
          description: "One sentence on why this event, shown on the card.",
        },
      },
      required: ["kind", "content"],
    },
    execute: draftEvent,
    prompt:
      "`nostr.publish` drafts an event for the user to sign; it publishes" +
      " nothing by itself, so say what the draft is for and let them press the" +
      " button. Never claim to have published anything.",
  },
];

/**
 * The name a provider sees.
 *
 * A dot is not portable: OpenAI-shaped function names are
 * `^[a-zA-Z0-9_-]{1,64}$`, and IPA relays to whichever provider the user's
 * extension holds a key for. So the namespace travels as an underscore and the
 * canonical id — the thing stored, rendered, and named by a published agent —
 * keeps its dot.
 */
export function wireName(id: string): string {
  return id.replace(".", "_");
}

/**
 * Names that used to mean one of these tools, before the registry.
 *
 * Conversations are persisted, so a transcript from last week still says
 * `query_nostr`; its renderer would otherwise fall back to a JSON dump.
 */
const LEGACY_NAMES: Record<string, string> = {
  lookup_spec: "grimoire.help",
  list_spells: "grimoire.spells",
  open_window: "grimoire.window",
  query_nostr: "nostr.req",
  resolve: "nostr.resolve",
};

const BY_WIRE = new Map(TOOL_REGISTRY.map((tool) => [wireName(tool.id), tool]));

/**
 * The canonical id for whatever a run is stamped with — a wire name, a legacy
 * name, or an id already. Unknown names come back unchanged, so a tool the
 * model invented still renders as itself.
 */
export function canonicalId(name: string): string {
  return BY_WIRE.get(name)?.id ?? LEGACY_NAMES[name] ?? name;
}

/** The registry as an IPA `tools` array. */
export const AI_TOOLS: InferenceTool[] = TOOL_REGISTRY.map((tool) => ({
  type: "function",
  function: {
    name: wireName(tool.id),
    description: tool.description,
    parameters: tool.parameters,
  },
}));

/**
 * Executors keyed by wire name, which is what the loop looks up.
 *
 * `hosts` supplies the ones needing React state, keyed by canonical id; a
 * registry entry marked `host` with nothing supplied is simply absent, and the
 * loop reports it as no such tool rather than crashing the turn.
 */
export function createToolExecutors(
  hosts: Record<string, ToolExecutor> = {},
): Record<string, ToolExecutor> {
  const executors: Record<string, ToolExecutor> = {};
  for (const tool of TOOL_REGISTRY) {
    const executor = tool.host ? hosts[tool.id] : tool.execute;
    if (!executor) continue;
    executors[wireName(tool.id)] = executor;
    // Also under the canonical id: the prompt names tools with the dot, and a
    // model that copies what it was told should not lose a round to "no such
    // tool" over punctuation.
    executors[tool.id] = executor;
  }
  return executors;
}

/** The tool paragraph of the system prompt, so prose cannot drift from schema. */
export function describeTools(): string {
  return TOOL_REGISTRY.map((tool) => tool.prompt).join(" ");
}
