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
  ContentPart,
  Cost,
  DecodedDefinition,
  DecodedDelta,
  DecodedHead,
  DecodedTurn,
  DeltaKind,
  SessionStatus,
  TurnRole,
  UnsignedRumor,
  Usage,
} from "./types";

/**
 * What a run can be ABOUT, in NIP-22's own scope vocabulary.
 *
 * An event (`e`), an addressable one (`a`), a person (`p`), a page on the web
 * (`r`), or something outside Nostr entirely (`i`, NIP-73). Reusing the set a
 * comment already uses means a client that can say "about this" has nothing
 * new to learn.
 */
const SUBJECT_TAGS = new Set(["a", "e", "p", "r", "i"]);

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
  "reasoning",
  "tool",
  "heartbeat",
];

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
  return t?.[1] && t[2]
    ? { amount: t[1], currency: t[2], estimated: t[3] === "estimated" }
    : undefined;
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

/** A tag element that is meant to be JSON. Malformed is absent, never a throw. */
function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function partsOf(rumor: UnsignedRumor): ContentPart[] | null {
  try {
    const parsed: unknown = JSON.parse(rumor.content);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (part): part is ContentPart =>
        !!part &&
        typeof part === "object" &&
        typeof (part as ContentPart).type === "string",
    );
  } catch {
    return null;
  }
}

/**
 * Decode one rumor. Returns null for anything that is not a well-formed event of
 * this NIP authored by the agent it names — a caller may render `alt` for a turn
 * whose parts failed to parse, but never an event that failed this check.
 */
export function parseAgentEvent(
  rumor: UnsignedRumor & { id: string },
): AgentSessionEvent | null {
  switch (rumor.kind) {
    case KIND_TURN:
      return parseTurn(rumor);
    case KIND_DELTA:
      return parseDelta(rumor);
    case KIND_SESSION_HEAD:
      return parseHead(rumor);
    case KIND_AGENT_DEFINITION:
      return parseDefinition(rumor);
    default:
      return null;
  }
}

function parseTurn(rumor: UnsignedRumor & { id: string }): DecodedTurn | null {
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
    alt: value(rumor, "alt"),
    seq,
    prev,
    turn,
    role: role as TurnRole,
    parts: partsOf(rumor) ?? [],
    stop: value(rumor, "stop") as DecodedTurn["stop"],
    model: modelOf(rumor),
    usage: usageOf(rumor),
    cost: costOf(rumor),
    /**
     * `["subagent", callId, sessionId, name?]`.
     *
     * A tag with no session id is kept, because "a subagent ran and we do not
     * know where" is a truer thing to render than nothing at all.
     */
    subagents: rumor.tags
      .filter((t) => t[0] === "subagent" && t[1])
      .map((t) => ({
        callId: t[1]!,
        session: t[2] ?? "",
        name: t[3] || undefined,
      })),
  };
}

function parseDelta(
  rumor: UnsignedRumor & { id: string },
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
    turn,
    part,
    delta: delta as DeltaKind,
    text: rumor.content,
    toolId,
  };
}

function parseHead(rumor: UnsignedRumor & { id: string }): DecodedHead | null {
  const sessionId = value(rumor, "d");
  const status = value(rumor, "status");
  const operator = operatorOf(rumor);
  const started = integer(value(rumor, "started"));
  if (!sessionId || !operator || started === undefined) return null;
  if (!SESSION_STATUSES.includes(status ?? "")) return null;

  return {
    type: "head",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    session: { agent: rumor.pubkey, session: sessionId },
    alt: value(rumor, "alt"),
    title: value(rumor, "title") ?? "",
    status: status as SessionStatus,
    operator,
    trigger: (() => {
      const t = rumor.tags.find((tag) => tag[0] === "e" && tag[1]);
      return t?.[1] ? { id: t[1], relay: t[2] || undefined } : undefined;
    })(),
    observers: rumor.tags
      .filter((t) => t[0] === "p" && t[3] === "observer")
      .map((t) => personOf(t))
      .filter((p): p is { pubkey: string; relay?: string } => !!p),
    lastSeq: counter(value(rumor, "last-seq")) ?? 0,
    /**
     * Exchanges, when the agent counted them.
     *
     * Absent on a head published before this tag existed, and the caller falls
     * back to `last-seq` — which overcounts, but overcounting is what those
     * heads have always shown and inventing a smaller number for them would be
     * worse.
     */
    turns: counter(value(rumor, "turns")),
    started,
    ended: integer(value(rumor, "ended")),
    model: modelOf(rumor),
    usage: usageOf(rumor),
    cost: costOf(rumor),
    pending: rumor.tags
      .filter((t) => t[0] === "input" && t[1])
      .map((t) => t[1]!),
    /**
     * What the run is about, in NIP-22's own scope vocabulary.
     *
     * Not only events: a person (`p`), a page (`r`), and something outside
     * Nostr entirely (`i`, NIP-73) are all things a run can be pointed at.
     *
     * A MARKER is what disqualifies one, rather than a list of letters. The
     * same letters mean something else elsewhere on this event — a `p` marked
     * `operator` or `observer` says who the run is for, and the `e` marked
     * `trigger` points at the message that started it — and all of them say so
     * in the fourth position. A pointer with nothing there is a subject.
     */
    subjects: rumor.tags.filter(
      (t) => SUBJECT_TAGS.has(t[0] ?? "") && !!t[1] && !t[3],
    ),
    channel: (() => {
      const transport = value(rumor, "transport");
      // The protocol is what makes the room meaningful, so a `channel` with no
      // `transport` beside it is dropped rather than shown as a bare string.
      return transport ? { transport, id: value(rumor, "channel") } : undefined;
    })(),
    definition: value(rumor, "agent"),
  };
}

function parseDefinition(
  rumor: UnsignedRumor & { id: string },
): DecodedDefinition | null {
  const slug = value(rumor, "d");
  const name = value(rumor, "name");
  if (!slug || !name) return null;

  return {
    type: "definition",
    id: rumor.id,
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    slug,
    version: counter(value(rumor, "v")) ?? 1,
    name,
    picture: value(rumor, "picture"),
    about: value(rumor, "about"),
    // The content is the system prompt itself, verbatim and unwrapped.
    instructions: rumor.content || undefined,
    model: (() => {
      const tag = rumor.tags.find((t) => t[0] === "model" && t[1]);
      if (!tag?.[1]) return undefined;
      const window = Number(tag[2]);
      return {
        id: tag[1],
        contextWindow:
          Number.isFinite(window) && window > 0 ? window : undefined,
      };
    })(),
    tools: rumor.tags
      .filter((t) => t[0] === "tool" && t[1])
      .map((t) => ({
        name: t[1]!,
        description: t[2] || undefined,
        parameters: parseJson(t[3]),
      })),
    repositories: rumor.tags
      .filter((t) => t[0] === "repo" && t[1])
      .map((t) => ({
        name: t[1]!,
        // Positional, with empty strings for what is absent — so a missing url
        // never shifts the path into its place.
        url: t[2] || undefined,
        path: t[3] || undefined,
        description: t[4] || undefined,
      })),
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
