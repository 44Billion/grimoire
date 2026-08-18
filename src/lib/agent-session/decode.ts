/**
 * Reading agent-session events back (NIP-xx: Agent Sessions).
 *
 * This is the security boundary. Anyone may publish a kind-1777 carrying any
 * `a` tag — relays index tags, they do not police them — so nothing may reach a
 * renderer without passing `parseAgentEvent`, which drops any event whose author
 * is not the agent named in its own session address.
 */

import {
  KIND_AGENT_DEFINITION,
  KIND_DELTA,
  KIND_MILESTONE,
  KIND_SESSION_HEAD,
  KIND_TURN,
} from "./kinds";
import { parseSessionAddress } from "./encode";
import type {
  AgentSessionEvent,
  AgentToolSpec,
  ContentBlock,
  Cost,
  DecodedDefinition,
  DecodedDelta,
  DecodedHead,
  DecodedMilestone,
  DecodedTurn,
  DeltaKind,
  MilestoneStatus,
  RedactionProfile,
  SessionStatus,
  StreamDescriptor,
  Transport,
  TurnRole,
  UnsignedRumor,
  Usage,
} from "./types";

const ROLES: readonly string[] = ["user", "assistant", "tool"];
const STATUSES: readonly string[] = [
  "processing",
  "partial",
  "success",
  "error",
  "payment-required",
  "awaiting-input",
];
const SESSION_STATUSES: readonly string[] = [
  "active",
  "idle",
  "done",
  "error",
  "aborted",
];
const DELTA_KINDS: readonly string[] = [
  "text",
  "thinking",
  "tool",
  "heartbeat",
];
const PROFILES: readonly string[] = ["full", "summary", "public"];
const TRANSPORTS: readonly string[] = ["nip17", "nip29", "concord"];

function tag(rumor: UnsignedRumor, name: string): string[] | undefined {
  return rumor.tags.find((t) => t[0] === name && t[1] !== undefined);
}

function value(rumor: UnsignedRumor, name: string): string | undefined {
  return tag(rumor, name)?.[1];
}

function integer(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function profileOf(rumor: UnsignedRumor): RedactionProfile {
  const raw = value(rumor, "redaction");
  return PROFILES.includes(raw ?? "") ? (raw as RedactionProfile) : "full";
}

function personOf(
  t: string[] | undefined,
): { pubkey: string; relay?: string } | undefined {
  if (!t?.[1] || !/^[0-9a-f]{64}$/.test(t[1])) return undefined;
  return { pubkey: t[1], relay: t[2] || undefined };
}

function operatorOf(rumor: UnsignedRumor) {
  const explicit = rumor.tags.find((t) => t[0] === "p" && t[3] === "operator");
  return personOf(explicit ?? rumor.tags.find((t) => t[0] === "p"));
}

function modelOf(rumor: UnsignedRumor) {
  const t = tag(rumor, "model");
  return t?.[1] ? { id: t[1], provider: t[2] || undefined } : undefined;
}

function usageOf(rumor: UnsignedRumor): Usage | undefined {
  const t = tag(rumor, "usage");
  if (!t) return undefined;
  const [, input, output, cacheRead, cacheWrite] = t;
  const parsed = [input, output, cacheRead, cacheWrite].map(integer);
  if (parsed.some((n) => n === undefined)) return undefined;
  return {
    input: parsed[0]!,
    output: parsed[1]!,
    cacheRead: parsed[2]!,
    cacheWrite: parsed[3]!,
  };
}

function costOf(rumor: UnsignedRumor): Cost | undefined {
  const t = tag(rumor, "cost");
  return t?.[1] && t[2] ? { amount: t[1], currency: t[2] } : undefined;
}

function msOf(rumor: UnsignedRumor): number | undefined {
  const raw = value(rumor, "ms");
  if (raw === undefined) return undefined;
  // Concord's grammar: strict decimal, 0-999, no padding games.
  if (!/^(0|[1-9]\d{0,2})$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * The session an event claims, and the author check that makes the claim worth
 * anything: the agent's pubkey is inside the address, so an event signed by
 * anyone else is a forgery and is dropped here rather than rendered.
 */
function sessionOf(rumor: UnsignedRumor) {
  const t = tag(rumor, "a");
  if (!t?.[1]) return null;
  const parsed = parseSessionAddress(t[1]);
  if (!parsed || parsed.kind !== KIND_SESSION_HEAD) return null;
  if (parsed.agent !== rumor.pubkey) return null;
  return {
    agent: parsed.agent,
    session: parsed.session,
    relay: t[2] || undefined,
  };
}

function blocksOf(rumor: UnsignedRumor): ContentBlock[] | null {
  try {
    const parsed: unknown = JSON.parse(rumor.content);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (block): block is ContentBlock =>
        !!block &&
        typeof block === "object" &&
        typeof (block as ContentBlock).type === "string",
    );
  } catch {
    return null;
  }
}

export interface ParseOptions {
  /** Which transport this arrived on. Streams are never merged across transports. */
  transport?: Transport;
}

/**
 * Decode one rumor. Returns null for anything that is not a well-formed event of
 * this NIP authored by the agent it names — a caller may render `alt` for a turn
 * whose blocks failed to parse, but never an event that failed this check.
 */
export function parseAgentEvent(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions = {},
): AgentSessionEvent | null {
  switch (rumor.kind) {
    case KIND_TURN:
      return parseTurn(rumor, options);
    case KIND_MILESTONE:
      return parseMilestone(rumor, options);
    case KIND_DELTA:
      return parseDelta(rumor, options);
    case KIND_SESSION_HEAD:
      return parseHead(rumor, options);
    case KIND_AGENT_DEFINITION:
      return parseDefinition(rumor);
    default:
      return null;
  }
}

function parseTurn(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions,
): DecodedTurn | null {
  const session = sessionOf(rumor);
  const seq = integer(value(rumor, "seq"));
  const turn = integer(value(rumor, "turn"));
  const role = value(rumor, "role");
  const operator = operatorOf(rumor);
  if (!session || seq === undefined || turn === undefined || !operator)
    return null;
  if (!ROLES.includes(role ?? "")) return null;

  const prev = value(rumor, "prev");
  if (seq > 1 && !prev) return null;

  return {
    type: "turn",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session,
    transport: options.transport,
    redaction: profileOf(rumor),
    alt: value(rumor, "alt"),
    seq,
    prev,
    turn,
    role: role as TurnRole,
    blocks: blocksOf(rumor) ?? [],
    stop: value(rumor, "stop") as DecodedTurn["stop"],
    model: modelOf(rumor),
    usage: usageOf(rumor),
    cost: costOf(rumor),
    ms: msOf(rumor),
  };
}

function parseMilestone(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions,
): DecodedMilestone | null {
  const session = sessionOf(rumor);
  const seq = integer(value(rumor, "seq"));
  const status = value(rumor, "status");
  const operator = operatorOf(rumor);
  if (!session || seq === undefined || !operator) return null;
  if (!STATUSES.includes(status ?? "")) return null;

  const prev = value(rumor, "prev");
  if (seq > 1 && !prev) return null;

  const stepTag = tag(rumor, "step");
  const step = stepTag?.[1]
    ? {
        n: integer(stepTag[1]) ?? 0,
        total: stepTag[2] === "?" ? ("?" as const) : (integer(stepTag[2]) ?? 0),
      }
    : undefined;
  const toolTag = tag(rumor, "tool");

  return {
    type: "milestone",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session,
    transport: options.transport,
    redaction: profileOf(rumor),
    alt: value(rumor, "alt"),
    seq,
    prev,
    status: status as MilestoneStatus,
    text: rumor.content,
    turn: integer(value(rumor, "turn")),
    step,
    tool: toolTag?.[1]
      ? { name: toolTag[1], callId: toolTag[2] || undefined }
      : undefined,
    turnEventId: rumor.tags.find((t) => t[0] === "e" && t[3] === "turn")?.[1],
    ms: msOf(rumor),
  };
}

function parseDelta(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions,
): DecodedDelta | null {
  const session = sessionOf(rumor);
  const turn = integer(value(rumor, "turn"));
  const part = integer(value(rumor, "part"));
  const delta = value(rumor, "delta");
  if (!session || turn === undefined || part === undefined) return null;
  if (!DELTA_KINDS.includes(delta ?? "")) return null;

  const toolId = value(rumor, "tool-id");
  if (delta === "tool" && !toolId) return null;

  return {
    type: "delta",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session,
    transport: options.transport,
    redaction: profileOf(rumor),
    turn,
    part,
    delta: delta as DeltaKind,
    text: rumor.content,
    toolId,
  };
}

function parseHead(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions,
): DecodedHead | null {
  const sessionId = value(rumor, "d");
  const status = value(rumor, "status");
  const operator = operatorOf(rumor);
  const started = integer(value(rumor, "started"));
  if (!sessionId || !operator || started === undefined) return null;
  if (!SESSION_STATUSES.includes(status ?? "")) return null;

  const streams: StreamDescriptor[] = [];
  for (const t of rumor.tags) {
    if (t[0] !== "stream" || !t[1] || !t[2]) continue;
    if (!TRANSPORTS.includes(t[1])) continue;
    streams.push({
      transport: t[1] as Transport,
      address: t[2],
      visibility: t[3] === "public" ? "public" : "private",
      redaction: PROFILES.includes(t[4] ?? "")
        ? (t[4] as RedactionProfile)
        : "full",
    });
  }

  return {
    type: "head",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session: { agent: rumor.pubkey, session: sessionId },
    transport: options.transport,
    redaction: profileOf(rumor),
    alt: value(rumor, "alt"),
    seq: integer(value(rumor, "seq")) ?? 0,
    title: value(rumor, "title") ?? "",
    status: status as SessionStatus,
    operator,
    observers: rumor.tags
      .filter((t) => t[0] === "p" && t[3] === "observer")
      .map((t) => personOf(t))
      .filter((p): p is { pubkey: string; relay?: string } => !!p),
    streams,
    lastSeq: integer(value(rumor, "last-seq")) ?? 0,
    head: value(rumor, "head"),
    turns: integer(value(rumor, "turns")) ?? 0,
    started,
    ended: integer(value(rumor, "ended")),
    model: modelOf(rumor),
    usage: usageOf(rumor),
    cost: costOf(rumor),
    definition: value(rumor, "agent"),
  };
}

function parseDefinition(
  rumor: UnsignedRumor & { id: string },
): DecodedDefinition | null {
  const slug = value(rumor, "d");
  const name = value(rumor, "name");
  if (!slug || !name) return null;

  let instructions: string | undefined;
  let tools: AgentToolSpec[] = [];
  try {
    const parsed: unknown = JSON.parse(rumor.content || "{}");
    if (parsed && typeof parsed === "object") {
      const body = parsed as { instructions?: unknown; tools?: unknown };
      if (typeof body.instructions === "string")
        instructions = body.instructions;
      if (Array.isArray(body.tools))
        tools = body.tools.filter(
          (tool): tool is AgentToolSpec =>
            !!tool &&
            typeof tool === "object" &&
            typeof (tool as AgentToolSpec).name === "string",
        );
    }
  } catch {
    // A definition with unparseable content is still a definition: name, about
    // and the tool tags survive, and that is enough to render its card.
  }

  return {
    type: "definition",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    slug,
    name,
    picture: value(rumor, "picture"),
    about: value(rumor, "about"),
    instructions,
    tools,
    suggestions: rumor.tags
      .filter((t) => t[0] === "try" && t[1])
      .map((t) => t[1]!),
    alt: value(rumor, "alt"),
  };
}

/**
 * The other half of the author check, for wrapped copies: the wrap is signed by
 * a throwaway key and proves nothing, so the seal's signature is the authorship
 * proof. A seal whose author is not the rumor's author is someone forwarding
 * another agent's words as their own.
 */
export function sealMatchesRumor(
  seal: { pubkey: string },
  rumor: { pubkey: string },
): boolean {
  return seal.pubkey === rumor.pubkey;
}
