/**
 * Concord voice — CORD-07. Wire format and pure decisions; no I/O state.
 *
 * Ported from armada `src/concord-v2/lib/voice.ts`. Every Channel is callable:
 * two sub-keys derive from the Channel's own secret and epoch (see `derive.ts`)
 * — `voice_key`, whose pk IS the SFU room name and whose sk signs token grants,
 * and `voice_media_key`, the root every publisher's frame key comes from.
 * Anyone holding the Channel's key can mint a token from a BLIND broker and
 * connect; media is end-to-end encrypted under keys only members derive, so the
 * broker and the SFU forward ciphertext and nothing else.
 *
 * Who is in a call is announced over the Channel itself (§4): ephemeral
 * kind-23313 rumors in 21059 wraps at the Channel's own address, sealed like
 * every Chat rumor, so relays and brokers stay blind. The `broker` tag on live
 * presence is the rendezvous hint (§5).
 *
 * Two shapes here are ARMADA CLIENT EXTENSIONS rather than CORD-07: the `hand`
 * and `react` tags. Both ride additively on the presence rumor (CORD-02 §6), so
 * they spend no frozen kind and a client that does not know them ignores them.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { finalizeEvent } from "nostr-tools/pure";

import type { GroupKey } from "@/lib/concord/derive";
import { bytesToHex, hexToBytes, random32 } from "@/lib/concord/derive";
import { KIND_VOICE_PRESENCE } from "@/lib/concord/kinds";
import type { OpenedEvent } from "@/lib/concord/stream";

// ── Protocol constants (CORD-07) ─────────────────────────────────────────────

/** NIP-98-style HTTP-auth event kind — the token grant's carrier (§2). */
export const KIND_HTTP_AUTH = 27235;
/** Publish a `joined` on join and every 30 seconds thereafter (§4). */
export const VOICE_HEARTBEAT_MS = 30_000;
/** A `joined` older than 90s (three missed heartbeats) counts as absent (§4). */
export const VOICE_STALE_MS = 90_000;
/** Bound the broker candidates taken from (untrusted) presence hints (§5). */
export const MAX_VOICE_BROKERS = 3;

/**
 * The delay until the next heartbeat: 80–100% of §4's 30s.
 *
 * Jittered so members who joined together — everyone in a channel remounting
 * after a rekey — don't stay phase-locked and beat the relays in synchronized
 * bursts. DOWNWARD only, and that direction is the point: at or under 30s three
 * missed heartbeats still fit inside the 90s staleness window, so the margin
 * only widens. Jittering above 30s would shrink it to two missed heartbeats and
 * make members flicker out of rosters.
 */
export function heartbeatDelayMs(random: () => number = Math.random): number {
  return VOICE_HEARTBEAT_MS * (0.8 + random() * 0.2);
}

const ASCII = new TextEncoder();

// ── Origins (§5) ─────────────────────────────────────────────────────────────

/**
 * The RFC 6454 ASCII serialization of an https origin: lowercase scheme and
 * host, default port omitted, no path and no trailing slash — one canonical
 * byte-form, or two clients hash different strings for one broker and the §5
 * tie-break never settles. Returns null for anything that is not a clean https
 * origin; a broker endpoint carries a bearer credential, so plaintext http is
 * refused outright.
 */
export function canonicalOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const port = url.port && url.port !== "443" ? `:${url.port}` : "";
  return `https://${host}${port}`;
}

/**
 * The §5 tie-break rank of a broker origin for a room:
 * `sha256(voice_room[32] || utf8(origin))`, compared as hex — smallest wins.
 * Grindable by design; that buys an attacker nothing the (already untrusted)
 * hint does not already grant.
 */
export function brokerRank(roomHex: string, origin: string): string {
  const originBytes = ASCII.encode(origin);
  const pre = new Uint8Array(32 + originBytes.length);
  pre.set(hexToBytes(roomHex), 0);
  pre.set(originBytes, 32);
  return bytesToHex(sha256(pre));
}

/** Order candidate origins by the §5 tie-break (canonicalized, deduped). */
export function orderBrokers(roomHex: string, origins: string[]): string[] {
  const canonical = [
    ...new Set(
      origins.map(canonicalOrigin).filter((o): o is string => Boolean(o)),
    ),
  ];
  return canonical.sort((a, b) =>
    brokerRank(roomHex, a) < brokerRank(roomHex, b) ? -1 : 1,
  );
}

// ── The broker (§2) ──────────────────────────────────────────────────────────

/** The broker's capability probe: `GET <origin>/.well-known/concord/av` → 204. */
export function avCapabilityUrl(origin: string): string {
  return `${origin}/.well-known/concord/av`;
}

/** The broker's token endpoint for a room. */
export function avTokenUrl(origin: string, roomHex: string): string {
  return `${origin}/.well-known/concord/av/${roomHex}`;
}

/** A minted SFU token: the JWT, the SFU ws url, and the assigned identity. */
export interface AvToken {
  token: string;
  url: string;
  /** The broker-assigned random SFU identity — announced in presence (§4). */
  identity: string;
  /**
   * The broker origin that actually minted this token. Not always the one the
   * rendezvous picked: when that broker is unreachable we fall through to the
   * next candidate, and it is THIS origin that must ride presence as the §5
   * hint — announcing the one we failed to reach would send everyone else to a
   * broker that is not hosting the call.
   */
  origin: string;
}

/**
 * Sign the token grant (§2): a kind-27235 event self-signed with `voice_key.sk`,
 * so `event.pubkey` equals the room name. The grant lives only in the
 * Authorization header; it never touches a relay.
 *
 * The `nonce` tag carries 32 fresh random bytes. Every member of a Channel
 * derives and signs with the SAME `voice_key.sk`, so without it two members
 * joining one room in the same second build byte-identical events — same id —
 * and the broker's anti-replay set (which keys on the id) rejects whichever
 * arrives second. NIP-98, whose shape this borrows, never needs one: each
 * request there is signed by its own user's key.
 */
export function signAvGrant(voice: GroupKey, url: string): string {
  const event = finalizeEvent(
    {
      kind: KIND_HTTP_AUTH,
      content: "",
      tags: [
        ["u", url],
        ["method", "GET"],
        ["nonce", bytesToHex(random32())],
      ],
      created_at: Math.floor(Date.now() / 1000),
    },
    voice.sk,
  );
  return btoa(JSON.stringify(event));
}

/** How long to wait on a capability probe / a token mint. */
const PROBE_TIMEOUT_MS = 5_000;
const MINT_TIMEOUT_MS = 8_000;

/** Probe a broker's capability endpoint. */
export async function probeAvBroker(
  origin: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(avCapabilityUrl(origin), {
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ]),
    });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch an SFU token from a blind broker (§2). The response shape is validated
 * and the SFU url must be `wss://` — the broker is untrusted rendezvous input,
 * and while E2EE bounds a hostile one to metadata there is no reason to accept
 * a plaintext signaling downgrade.
 */
export async function fetchAvToken(
  origin: string,
  voice: GroupKey,
): Promise<AvToken> {
  const url = avTokenUrl(origin, voice.pk);
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Concord ${signAvGrant(voice, url)}` },
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`voice token request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const token = typeof data.token === "string" ? data.token : "";
  const sfuUrl = typeof data.url === "string" ? data.url : "";
  const identity = typeof data.identity === "string" ? data.identity : "";
  if (!token || !sfuUrl || !identity) {
    throw new Error("voice token response missing token, url, or identity");
  }
  if (!/^wss:\/\//i.test(sfuUrl)) {
    throw new Error("broker returned a non-wss SFU url");
  }
  return { token, url: sfuUrl, identity, origin };
}

/**
 * Mint from the first candidate that answers, in §5 rendezvous order.
 *
 * The capability probe only says a broker was reachable a moment ago; it can
 * still fail to mint — restarting, at capacity, or its SFU gone. Without a
 * fall-through that is a dead end, since a client resolves one broker per join
 * and has nothing to retry against. It is also what lets a broker shed load
 * honestly: refusing a room it does not host now moves the caller on instead of
 * stranding them.
 *
 * Rejections are not sorted by kind — a grant this room's key cannot satisfy
 * fails everywhere, so trying the rest costs a few requests once, while
 * treating a 503 as fatal would cost the call.
 */
export async function fetchAvTokenFromAny(
  origins: string[],
  voice: GroupKey,
): Promise<AvToken> {
  const candidates = [...new Set(origins.filter(Boolean))];
  if (candidates.length === 0) {
    throw new Error("no voice server to request a token from");
  }
  let lastError: unknown;
  for (const origin of candidates) {
    try {
      return await fetchAvToken(origin, voice);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("no reachable voice server");
}

// ── Presence (§4) ────────────────────────────────────────────────────────────

/** One member's latest presence, as opened from the Channel's stream. */
export interface VoicePresenceEntry {
  author: string;
  status: "joined" | "left";
  /** The broker-assigned SFU identity (joined only). */
  identity?: string;
  /** The broker origin hint, canonicalized (joined only). */
  broker?: string;
  /**
   * Whether this member has their hand raised (joined only) — an ARMADA CLIENT
   * EXTENSION, not CORD-07. Sticky state: carried on every heartbeat and healed
   * by the same staleness window, so its absence means lowered.
   */
  hand?: boolean;
  /** Millisecond ordering basis (CORD-02 §4). */
  ms: number;
  /** The rumor id — the equal-ms tiebreak. */
  rumorId: string;
}

/**
 * The presence tags a rumor carries beyond the channel/epoch binding. `hand` is
 * the Armada extension; it is emitted only while joined and only when raised.
 */
export function presenceTags(
  status: "joined" | "left",
  identity?: string,
  broker?: string,
  opts?: { hand?: boolean },
): string[][] {
  const tags: string[][] = [];
  if (status === "joined" && identity) tags.push(["identity", identity]);
  if (status === "joined" && broker) tags.push(["broker", broker]);
  if (status === "joined" && opts?.hand) tags.push(["hand", "1"]);
  return tags;
}

/**
 * The max byte length of a reaction's emoji payload, and of an SFU identity /
 * broker hint. All three are untrusted member input on an unstored event, so
 * each is bounded — generously enough for any single emoji (ZWJ sequences
 * included) or a short shortcode.
 */
const MAX_REACTION_LEN = 64;
const MAX_NONCE_LEN = 128;
const MAX_IDENTITY_LEN = 128;
const MAX_BROKER_LEN = 512;

/** A transient in-call emoji reaction, as opened from the Channel's stream. */
export interface VoiceReactionEntry {
  /** The verified real author (the presence rumor's seal signer). */
  author: string;
  /** The emoji, or a `:shortcode:` resolved by {@link custom}. */
  emoji: string;
  /** The sender-chosen nonce — the fire-once/dedup key. */
  nonce: string;
  /** Millisecond stamp (CORD-02 §4) — the decay basis. */
  ms: number;
  /**
   * The NIP-30 image behind a `:shortcode:`, when the reaction named one.
   *
   * Carried as an ordinary `emoji` tag on the same rumor rather than stuffed
   * into the `react` tag: NIP-30 is how every other Concord rumor spells a
   * custom emoji, so a renderer that already understands chat understands this,
   * and a client that does not simply shows the shortcode as written.
   */
  custom?: { shortcode: string; url: string };
}

/**
 * The tag an in-call emoji rides — an ARMADA CLIENT EXTENSION. A reaction is
 * fire-and-forget, so it travels as an additive `["react", emoji, nonce]` tag on
 * an off-cycle `joined` (which doubles as a heartbeat). Receivers fire it once
 * per unseen nonce and never fold it into state.
 */
export function reactionTag(emoji: string, nonce: string): string[] {
  return ["react", emoji, nonce];
}

/**
 * The NIP-30 declaration for a custom emoji used in a reaction.
 *
 * `shortcode` is bare — no colons — exactly as NIP-30 spells it; the `react`
 * tag carries the `:shortcode:` form that appears in the text.
 */
export function reactionEmojiTag(shortcode: string, url: string): string[] {
  return ["emoji", shortcode, url];
}

/** How long a custom emoji's URL may be. Untrusted, unstored member input. */
const MAX_EMOJI_URL_LEN = 512;
const MAX_SHORTCODE_LEN = 64;

/**
 * The image a `:shortcode:` reaction names, if the rumor declared one.
 *
 * Only https is accepted: this is a URL a fellow member chose, and it is about
 * to be loaded by every client in the call — an http one would be a mixed-content
 * failure at best and a plaintext beacon at worst.
 */
function reactionCustomEmoji(
  emoji: string,
  tags: string[][],
): { shortcode: string; url: string } | undefined {
  const match = /^:([^\s:]{1,64}):$/.exec(emoji);
  if (!match) return undefined;
  const shortcode = match[1];
  for (const tag of tags) {
    if (tag[0] !== "emoji") continue;
    if (tag[1] !== shortcode) continue;
    const url = tag[2];
    if (typeof url !== "string" || url.length > MAX_EMOJI_URL_LEN) continue;
    if (!/^https:\/\//i.test(url)) continue;
    if (shortcode.length > MAX_SHORTCODE_LEN) continue;
    return { shortcode, url };
  }
  return undefined;
}

/**
 * Parse an opened kind-23313 rumor's reaction tag, or null when it carries none
 * (a plain heartbeat) or a malformed one. The channel/epoch binding is checked
 * by the caller, like every Chat rumor.
 */
export function parseReaction(opened: OpenedEvent): VoiceReactionEntry | null {
  if (opened.kind !== KIND_VOICE_PRESENCE) return null;
  const tag = opened.tags.find((t) => t[0] === "react");
  if (!tag) return null;
  const emoji = tag[1];
  const nonce = tag[2];
  if (typeof emoji !== "string" || emoji.length === 0) return null;
  // Bound the payload — REJECT rather than truncate, so two clients never
  // disagree on what floated.
  if (ASCII.encode(emoji).length > MAX_REACTION_LEN) return null;
  if (
    typeof nonce !== "string" ||
    nonce.length === 0 ||
    nonce.length > MAX_NONCE_LEN
  ) {
    return null;
  }
  const custom = reactionCustomEmoji(emoji, opened.tags);
  return {
    author: opened.author,
    emoji,
    nonce,
    ms: opened.ms,
    ...(custom ? { custom } : {}),
  };
}

/**
 * Parse an opened kind-23313 rumor into a presence entry, or null when it is
 * malformed. The channel/epoch binding is the caller's job.
 */
export function parsePresence(opened: OpenedEvent): VoicePresenceEntry | null {
  if (opened.kind !== KIND_VOICE_PRESENCE) return null;
  if (opened.content !== "joined" && opened.content !== "left") return null;
  const status = opened.content;
  const rawIdentity = opened.tags.find((t) => t[0] === "identity")?.[1];
  const rawBroker = opened.tags.find((t) => t[0] === "broker")?.[1];
  const identity =
    status === "joined" &&
    typeof rawIdentity === "string" &&
    rawIdentity.length > 0 &&
    rawIdentity.length <= MAX_IDENTITY_LEN
      ? rawIdentity
      : undefined;
  // A `joined` naming no identity claims nothing an SFU participant can be
  // matched against, so it is not a presence at all.
  if (status === "joined" && !identity) return null;
  const broker =
    status === "joined" &&
    typeof rawBroker === "string" &&
    rawBroker.length <= MAX_BROKER_LEN
      ? (canonicalOrigin(rawBroker) ?? undefined)
      : undefined;
  const hand =
    status === "joined" &&
    opened.tags.some((t) => t[0] === "hand" && t[1] === "1");
  return {
    author: opened.author,
    status,
    identity,
    broker,
    hand,
    ms: opened.ms,
    rumorId: opened.rumorId,
  };
}

/** A verified-present participant: one fresh `joined` per author. */
export interface VoicePresent {
  author: string;
  identity: string;
  broker?: string;
  /** Whether this member's latest presence has their hand raised (client ext). */
  hand: boolean;
  ms: number;
}

/** The folded presence view of one channel's call. */
export interface VoicePresenceFold {
  /** Fresh `joined` authors (per author, the latest presence won). */
  present: VoicePresent[];
  /**
   * SFU identity → the authors whose fresh presence claims it. A participant
   * renders as a member only when exactly ONE author claims its identity (§4);
   * contested or unclaimed identities render as unverified.
   */
  claims: Map<string, string[]>;
}

/** The stable empty fold, so idle callers keep constant props. */
export const EMPTY_VOICE_FOLD: VoicePresenceFold = {
  present: [],
  claims: new Map(),
};

/**
 * Fold raw presence entries: per author the latest wins (ms basis, rumor-id
 * tiebreak), then a `joined` older than the staleness window counts as absent.
 */
export function foldVoicePresence(
  entries: VoicePresenceEntry[],
  nowMs: number,
): VoicePresenceFold {
  const latest = new Map<string, VoicePresenceEntry>();
  for (const e of entries) {
    const prev = latest.get(e.author);
    if (!prev || newerPresence(e, prev)) latest.set(e.author, e);
  }
  const present: VoicePresent[] = [];
  const claims = new Map<string, string[]>();
  for (const e of latest.values()) {
    if (e.status !== "joined" || !e.identity) continue;
    if (nowMs - e.ms > VOICE_STALE_MS) continue;
    present.push({
      author: e.author,
      identity: e.identity,
      ...(e.broker !== undefined ? { broker: e.broker } : {}),
      hand: e.hand ?? false,
      ms: e.ms,
    });
    const list = claims.get(e.identity);
    if (list) list.push(e.author);
    else claims.set(e.identity, [e.author]);
  }
  present.sort((a, b) => a.ms - b.ms || (a.author < b.author ? -1 : 1));
  return { present, claims };
}

/**
 * Whether `next` supersedes `prev` for one author: later ms wins, and an equal
 * ms is broken by the lower rumor id — a total order both clients compute the
 * same way, so a heartbeat and its echo never flip-flop.
 */
export function newerPresence(
  next: VoicePresenceEntry,
  prev: VoicePresenceEntry,
): boolean {
  return (
    next.ms > prev.ms || (next.ms === prev.ms && next.rumorId < prev.rumorId)
  );
}

/**
 * The author verifiably behind an SFU identity, or undefined when the identity
 * is unclaimed or CONTESTED. Identities are member-visible, so a malicious
 * member can copy a victim's into their own `joined`; a contested claim proves
 * nothing about either author, so all claimants render as unverified until the
 * stale claims age out (§4).
 */
export function verifiedAuthorOf(
  fold: VoicePresenceFold,
  identity: string,
): string | undefined {
  const claimants = fold.claims.get(identity);
  return claimants && claimants.length === 1 ? claimants[0] : undefined;
}

/**
 * The §5 rendezvous decision: if anyone is present, their brokers (ordered by
 * the tie-break) are the candidates; an empty room falls back to the client's
 * own defaults, in their stated order. Presence hints are untrusted input from
 * fellow members, so they are canonicalized and capped.
 */
export function rendezvousCandidates(
  roomHex: string,
  fold: VoicePresenceFold,
  defaults: string[],
): string[] {
  const occupied = orderBrokers(
    roomHex,
    fold.present.map((p) => p.broker).filter((b): b is string => Boolean(b)),
  ).slice(0, MAX_VOICE_BROKERS);
  const own = defaults
    .map(canonicalOrigin)
    .filter((o): o is string => Boolean(o));
  // Occupied origins first (join the call where it is), own defaults as the
  // fallback when the room is empty or those brokers are unreachable.
  return [...new Set([...occupied, ...own])];
}

/**
 * Whether a call we are connected to on `connected` should migrate to a broker
 * presence shows as occupied (§5 split healing). Two subsets of one call on two
 * brokers — simultaneous joins into an empty room — heal by the same tie-break:
 * whoever is on the losing origin moves.
 *
 * `exclude` is the caller's memory of origins that did NOT work for this call —
 * every origin already tried and abandoned, including the ones a mint fell
 * through. Without it this is a rejoin loop rather than a heal: a broker can
 * probe healthy, appear in a fellow member's hint, and still refuse to mint for
 * us, so we fall back to where we were, see the same winner on the next fold,
 * and drop the call again. It is also the bound on a ground hint — an origin
 * mined to win the tie-break steers an already-connected client exactly once,
 * and never again for this call.
 */
export function migrationTarget(
  roomHex: string,
  fold: VoicePresenceFold,
  connected: string,
  exclude: Iterable<string> = [],
): string | undefined {
  const ours = canonicalOrigin(connected);
  if (!ours) return undefined;
  const barred = new Set(
    [...exclude, connected]
      .map(canonicalOrigin)
      .filter((o): o is string => Boolean(o)),
  );
  const occupied = orderBrokers(
    roomHex,
    fold.present.map((p) => p.broker).filter((b): b is string => Boolean(b)),
  );
  const winner = occupied[0];
  if (!winner || barred.has(winner)) return undefined;
  return brokerRank(roomHex, winner) < brokerRank(roomHex, ours)
    ? winner
    : undefined;
}
