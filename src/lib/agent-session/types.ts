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

export type RedactionProfile = "full" | "summary" | "public";

export type Transport = "nip17" | "nip29" | "concord";

export type Visibility = "private" | "public";

export type TurnRole = "user" | "assistant" | "tool";

export type StopReason =
  "end_turn" | "max_tokens" | "tool_use" | "content_filter" | "error";

/** NIP-90 kind-7000 vocabulary, verbatim, plus one this NIP needs. */
export type MilestoneStatus =
  | "processing"
  | "partial"
  | "success"
  | "error"
  | "payment-required"
  | "awaiting-input";

export type DeltaKind = "text" | "thinking" | "tool" | "heartbeat";

export type SessionStatus = "active" | "idle" | "done" | "error" | "aborted";

export const TERMINAL_STATUSES: readonly SessionStatus[] = [
  "done",
  "error",
  "aborted",
];

// ── Content blocks (the JSON inside a turn) ──────────────────────────────────

export interface TextBlock {
  type: "text";
  text: string;
  truncated?: Truncation;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  truncated?: Truncation;
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  /** `null` under the `public` profile; `arguments_digest` still proves which call it was. */
  arguments: Record<string, unknown> | null;
  arguments_digest?: string;
}

export interface ToolResultBlock {
  type: "tool_result";
  id: string;
  name: string;
  ok: boolean;
  /** `null` when the output was too large to inline; see `ref`. */
  output: string | null;
  ref?: BlobRef;
  truncated?: Truncation;
}

export interface ImageBlock {
  type: "image";
  url: string;
  mime: string;
  sha256?: string;
}

export type ContentBlock =
  TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock | ImageBlock;

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
  /** Present when the blob was encrypted before upload (private streams). */
  encryption?: { algorithm: "aes-gcm"; key: string; nonce: string; ox: string };
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
}

// ── Session addressing ───────────────────────────────────────────────────────

/** The `a` tag of every event in a session: `31777:<agent>:<session>`. */
export interface SessionRef {
  agent: string;
  session: string;
  relay?: string;
}

export interface StreamDescriptor {
  transport: Transport;
  /** Pubkey for nip17, `relay'group` for nip29, `<plane>/<channel>` for concord. */
  address: string;
  visibility: Visibility;
  redaction: RedactionProfile;
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
  blocks: ContentBlock[];
  turn: number;
  stop?: StopReason;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  /** Plain-text rendering for clients that cannot parse the blocks. */
  alt?: string;
  createdAt?: number;
  /** Sub-second ordering, 0-999, reusing Concord's `ms` grammar. */
  ms?: number;
}

export interface MilestoneInput {
  status: MilestoneStatus;
  text: string;
  turn?: number;
  step?: { n: number; total: number | "?" };
  tool?: { name: string; callId?: string };
  /** The turn event this milestone describes, when it exists. */
  turnEventId?: string;
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
  streams: StreamDescriptor[];
  /** Highest `seq` emitted on this stream. A reader with fewer knows it has a gap. */
  lastSeq: number;
  /** Id of the most recent turn on this stream. */
  head?: string;
  turns: number;
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

export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface AgentDefinitionInput {
  slug: string;
  name: string;
  picture?: string;
  about?: string;
  /** The system prompt, verbatim. Omitted entirely rather than redacted. */
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
  transport?: Transport;
  redaction: RedactionProfile;
  alt?: string;
}

export interface DecodedTurn extends DecodedBase {
  type: "turn";
  seq: number;
  prev?: string;
  turn: number;
  role: TurnRole;
  blocks: ContentBlock[];
  stop?: StopReason;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  ms?: number;
}

export interface DecodedMilestone extends DecodedBase {
  type: "milestone";
  seq: number;
  prev?: string;
  status: MilestoneStatus;
  text: string;
  turn?: number;
  step?: { n: number; total: number | "?" };
  tool?: { name: string; callId?: string };
  turnEventId?: string;
  ms?: number;
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
  seq: number;
  title: string;
  status: SessionStatus;
  operator: { pubkey: string; relay?: string };
  observers: { pubkey: string; relay?: string }[];
  streams: StreamDescriptor[];
  lastSeq: number;
  head?: string;
  turns: number;
  started: number;
  ended?: number;
  model?: { id: string; provider?: string };
  usage?: Usage;
  cost?: Cost;
  definition?: string;
}

export interface DecodedDefinition {
  type: "definition";
  id: string;
  pubkey: string;
  created_at: number;
  slug: string;
  name: string;
  picture?: string;
  about?: string;
  instructions?: string;
  tools: AgentToolSpec[];
  suggestions: string[];
  alt?: string;
}

export type AgentSessionEvent =
  | DecodedTurn
  | DecodedMilestone
  | DecodedDelta
  | DecodedHead
  | DecodedDefinition;
