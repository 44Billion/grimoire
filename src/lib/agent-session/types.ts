/**
 * Agent-session types (NIP-xx: Agent Sessions).
 *
 * Deliberately free of repo imports: `packages/hex` may not import from `src/`,
 * so this file and its siblings are copied there verbatim and kept honest by
 * shared golden vectors. Nothing here may reach for `@/types/ai` — the shapes
 * are structurally compatible with it, and that is the whole contract.
 */

// ── Wire primitives ──────────────────────────────────────────────────────────

/** An event before it is signed. On a private stream it stays this way. */
export interface UnsignedRumor {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}

/** A rumor with its id filled in (NIP-59 leaves rumors unsigned but hashed). */
export interface Rumor extends UnsignedRumor {
  id: string;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

export type TurnRole = "user" | "assistant" | "tool";

export type StopReason =
  "end_turn" | "max_tokens" | "tool_use" | "content_filter" | "error";

export type DeltaKind = "text" | "reasoning" | "tool" | "heartbeat";

/**
 * `awaiting-input` and `payment-required` are NIP-90's kind-7000 vocabulary,
 * verbatim. They live here rather than on a progress event of their own, which
 * costs the HISTORY of a blocked state — the head is replaceable, so asking
 * twice and being ignored twice looks the same as asking once.
 */
export type SessionStatus =
  | "active"
  | "idle"
  | "awaiting-input"
  | "payment-required"
  | "done"
  | "error"
  | "aborted";

export const TERMINAL_STATUSES: readonly SessionStatus[] = [
  "done",
  "error",
  "aborted",
];

// ── Content parts (the JSON inside a turn) ──────────────────────────────────

export interface TextPart {
  type: "text";
  text: string;
  truncated?: Truncation;
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
  truncated?: Truncation;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  /** `null` when the call was too large to carry; the digest still names it. */
  arguments: Record<string, unknown> | null;
  arguments_digest?: string;
}

export interface ToolResultPart {
  type: "tool_result";
  id: string;
  name: string;
  ok: boolean;
  /** `null` when the output was too large to inline; see `ref`. */
  output: string | null;
  ref?: BlobRef;
  truncated?: Truncation;
}

/**
 * A question the run is blocked on, in the transcript that asked it.
 *
 * Carried in full — prompt, options and the tool it acts on — because a reader
 * that cannot see the options cannot answer, and one that cannot answer watches
 * the session stay stuck.
 */
export interface InputRequestPart {
  type: "input_request";
  requestId: string;
  prompt: string;
  /** `tool-approval` | `question` | `session-limit`, per the runtime. */
  requestKind?: string;
  /** `confirmation` | `select` | `text` — how the asker meant it to look. */
  display?: string;
  allowFreeform?: boolean;
  options?: {
    id: string;
    label: string;
    description?: string;
    style?: string;
  }[];
  tool?: { name: string; callId?: string };
}

/** What became of it, so a transcript read later is not left hanging. */
export interface InputResolvedPart {
  type: "input_resolved";
  requestId: string;
  outcome: string;
  response?: { optionId?: string; text?: string };
}

export interface ImagePart {
  type: "image";
  url: string;
  mime: string;
  sha256?: string;
}

/** The part types this revision defines. */
export type ContentPart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart
  | InputRequestPart
  | InputResolvedPart
  | ImagePart;

/** A part whose `type` this build does not know. */
export interface UnknownPart {
  type: string;
  [key: string]: unknown;
}

/**
 * What a turn actually carries.
 *
 * The list is open on purpose: a turn holding a part from a later revision must
 * still render the parts around it, so an unrecognised one is kept and skipped
 * rather than making the whole turn unreadable.
 */
export type TurnPart = ContentPart | UnknownPart;

const KNOWN_PART_TYPES: ReadonlySet<string> = new Set([
  "text",
  "reasoning",
  "tool_call",
  "tool_result",
  "input_request",
  "input_resolved",
  "image",
]);

export function isKnownPart(part: TurnPart): part is ContentPart {
  return KNOWN_PART_TYPES.has(part.type);
}

export interface Truncation {
  /** Length of the original, in bytes. */
  bytes: number;
  /** Digest of the original, so a fuller copy can be proven to match. */
  sha256: string;
}

export interface BlobRef {
  sha256: string;
  url: string;
  size: number;
  mime: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Cost {
  amount: string;
  currency: string;
  /**
   * Worked out from token counts and a price list, not billed by the provider.
   *
   * Rendered with a `~`, because a figure presented as a bill when it is
   * arithmetic is worse than no figure.
   */
  estimated?: boolean;
}

// ── Session addressing ───────────────────────────────────────────────────────

/** The `a` tag of every event in a session: `31777:<agent>:<session>`. */
export interface SessionRef {
  agent: string;
  session: string;
  relay?: string;
}

/** Where a stream's counter currently stands. Encoders take it, never keep it. */
export interface StreamCursor {
  seq: number;
  /** Id of the event at `seq - 1`. Absent only when `seq` is 1. */
  prev?: string;
}

// ── Inputs (what a publisher hands the encoder) ──────────────────────────────

export interface AgentTurnInput {
  role: TurnRole;
  parts: TurnPart[];
  turn: number;
  stop?: StopReason;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  /** Plain-text rendering for clients that cannot parse the parts. */
  alt?: string;
  createdAt?: number;
}

export interface DeltaInput {
  turn: number;
  /** Counter local to the turn, reset at turn start. Deltas never take `seq`. */
  part: number;
  delta: DeltaKind;
  text: string;
  toolId?: string;
  createdAt?: number;
}

export interface SessionHeadInput {
  title: string;
  status: SessionStatus;
  operator: { pubkey: string; relay?: string };
  observers?: { pubkey: string; relay?: string }[];
  /** The message that started this run, when one did. */
  trigger?: { id: string; relay?: string };
  /**
   * The highest turn `seq` so far, which is also the turn count. The head
   * itself takes no sequence number.
   */
  lastSeq: number;
  started: number;
  ended?: number;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  /** `31779:<agent>:<slug>` — what this agent is, as opposed to what it is doing. */
  definition?: string;
  alt?: string;
  createdAt?: number;
}

/**
 * A repository an agent has on hand.
 *
 * The `path` is the load-bearing field. A client offering "start a run on
 * grimoire" has to name a directory the AGENT will recognise, and one it
 * guessed at produces a prompt the agent quietly ignores.
 */
export interface DecodedRepository {
  name: string;
  url?: string;
  path?: string;
  description?: string;
}

export interface AgentToolSpec {
  name: string;
  description?: string;
  /**
   * The tool's parameter schema, usually JSON Schema.
   *
   * Carried as a JSON string in the tag's fourth element. That is not pretty,
   * but the event's content is the system prompt, so a document cannot hold it —
   * and without it a definition can say a tool exists and not how to call it.
   */
  parameters?: unknown;
}

export interface AgentDefinitionInput {
  slug: string;
  name: string;
  picture?: string;
  about?: string;
  /** The system prompt, verbatim — it becomes the event's `content`. */
  instructions?: string;
  tools?: AgentToolSpec[];
  /** Starter prompts a client offers before the first message. */
  suggestions?: string[];
  alt?: string;
  createdAt?: number;
}

// ── Decoded events (what a reader gets back) ─────────────────────────────────

export interface DecodedBase {
  id: string;
  pubkey: string;
  created_at: number;
  session: SessionRef;
  alt?: string;
}

/**
 * A child session this turn set running.
 *
 * A subagent's work is a SEPARATE session — its own head, its own chain — so a
 * turn can only name it. The id is the runtime's, not a Nostr address, because
 * the address depends on somebody having followed the child, and usually nobody
 * has.
 */
export interface DecodedSubagent {
  /** The tool call that spawned it, which is also the row it belongs to. */
  callId: string;
  /** The runtime's session id for the child. */
  session: string;
  name?: string;
}

export interface DecodedTurn extends DecodedBase {
  type: "turn";
  seq: number;
  prev?: string;
  turn: number;
  role: TurnRole;
  parts: TurnPart[];
  stop?: StopReason;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  /** Child sessions this turn started, one per `subagent` tag. */
  subagents: DecodedSubagent[];
}

export interface DecodedDelta extends DecodedBase {
  type: "delta";
  turn: number;
  part: number;
  delta: DeltaKind;
  text: string;
  toolId?: string;
}

export interface DecodedHead extends DecodedBase {
  type: "head";
  /**
   * What this run is ABOUT, as the pointers its opening message carried.
   *
   * `["a", "30617:…"]` for a repository, `["e", "<id>"]` for an event. Carried
   * onto the head so every run about a thing is findable by asking for the
   * pointer, rather than by matching titles and hoping one of them is right.
   */
  subjects: string[][];
  title: string;
  status: SessionStatus;
  operator: { pubkey: string; relay?: string };
  observers: { pubkey: string; relay?: string }[];
  trigger?: { id: string; relay?: string };
  lastSeq: number;
  started: number;
  ended?: number;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  /**
   * Where this session's ephemeral deltas are published, as the head declares.
   *
   * Not guessable, and not the reader's own inbox: kind 21059 is exactly what a
   * DM inbox relay is entitled to refuse, and real ones do. A reader that only
   * listens where its mail arrives watches a status that never moves while the
   * run goes perfectly.
   */
  deltaRelays: string[];
  /**
   * Where the run is happening: the protocol, and the room inside it.
   *
   * A transcript is read away from the conversation that produced it, so this
   * is the only thing that answers "where did this happen". The channel is
   * written in its own protocol's notation — a pubkey for NIP-17,
   * `<relay-host>'<group-id>` for NIP-29 — so a client can act on it rather
   * than reformat it.
   */
  channel?: { transport: string; id?: string };
  /**
   * Requests the run is blocked on, by id.
   *
   * The one thing that separates a session waiting on its operator from one that
   * finished: the runtime's own boundary events are identical for both.
   */
  pending: string[];
  definition?: string;
}

export interface DecodedDefinition {
  type: "definition";
  id: string;
  pubkey: string;
  created_at: number;
  slug: string;
  /** The `v` tag: which revision of this shape the agent wrote. */
  version: number;
  name: string;
  picture?: string;
  about?: string;
  instructions?: string;
  tools: AgentToolSpec[];
  suggestions: string[];
  /** Checkouts the agent has, and where they sit inside its sandbox. */
  repositories: DecodedRepository[];
  alt?: string;
}

export type AgentSessionEvent =
  DecodedTurn | DecodedDelta | DecodedHead | DecodedDefinition;
