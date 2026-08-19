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
  DecodedTurn,
  DeltaKind,
  SessionStatus,
  StreamDescriptor,
  Transport,
  TurnRole,
  UnsignedRumor,
  Usage,
} from "./types";

const ROLES: readonly string[] = ["user", "assistant", "tool"];
const SESSION_STATUSES: readonly string[] = [
  "active",
  "idle",
  "awaiting-input",
  "payment-required",
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
const TRANSPORTS: readonly string[] = ["nip17", "nip29", "concord"];

function tag(rumor: UnsignedRumor, name: string): string[] | undefined {
  return rumor.tags.find((t) => t[0] === name && t[1] !== undefined);
}

function value(rumor: UnsignedRumor, name: string): string | undefined {
  return tag(rumor, name)?.[1];
}

/**
 * The largest counter this NIP will believe.
 *
 * `seq`, `turn` and `part` are attacker-supplied decimal strings, and one of
 * them feeds a loop that walks every sequence number a stream should hold. An
 * unbounded `last-seq` therefore buys a remote out-of-memory with one event, so
 * a counter past this is not a large session, it is a lie.
 */
export const MAX_COUNTER = 1_000_000;

function integer(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  // A timestamp is ten digits and a token count is seven; anything longer is
  // not a large number, it is a number chosen to break whoever parses it.
  if (raw.length > 12) return undefined;
  return Number(raw);
}

/** A sequence, turn or part: bounded, because one of them drives a loop. */
function counter(raw: string | undefined): number | undefined {
  const parsed = integer(raw);
  return parsed !== undefined && parsed <= MAX_COUNTER ? parsed : undefined;
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
  const addresses = rumor.tags.filter((t) => t[0] === "a" && t[1]);
  // Relays index every `a` tag, so an event carrying two addresses is returned
  // by a REQ for either one. Checking only the first would let an event that is
  // honest about its own session be filed inside somebody else's transcript.
  if (addresses.length !== 1) return null;
  const t = addresses[0]!;
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
  const seq = counter(value(rumor, "seq"));
  const turn = counter(value(rumor, "turn"));
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

function parseDelta(
  rumor: UnsignedRumor & { id: string },
  options: ParseOptions,
): DecodedDelta | null {
  const session = sessionOf(rumor);
  const turn = counter(value(rumor, "turn"));
  const part = counter(value(rumor, "part"));
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
    });
  }

  return {
    type: "head",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session: { agent: rumor.pubkey, session: sessionId },
    transport: options.transport,
    alt: value(rumor, "alt"),
    title: value(rumor, "title") ?? "",
    status: status as SessionStatus,
    operator,
    observers: rumor.tags
      .filter((t) => t[0] === "p" && t[3] === "observer")
      .map((t) => personOf(t))
      .filter((p): p is { pubkey: string; relay?: string } => !!p),
    streams,
    lastSeq: counter(value(rumor, "last-seq")) ?? 0,
    head: value(rumor, "head"),
    turns: counter(value(rumor, "turns")) ?? 0,
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
