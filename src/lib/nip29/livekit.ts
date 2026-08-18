/**
 * NIP-29 live AV spaces — the wire, and nothing that performs I/O.
 *
 * A group advertises a media room by carrying a `livekit` tag in its
 * `kind:39000`. Clients that want in call the relay's own token endpoint at
 * `/.well-known/nip29/livekit/<group-id>` with a NIP-98 header, get back a
 * LiveKit JWT and the SFU's URL, and connect. The relay decides who may have a
 * token, which is the whole access-control story: unlike Concord, there is no
 * blind broker to keep in the dark and no E2EE, because the party enforcing the
 * group's rules and the party issuing the credential are the same one.
 *
 * That also makes identity trivial. The spec requires the JWT's `sub` to start
 * with the member's lowercase hex pubkey, with a random suffix so one person can
 * join twice. So an SFU identity IS a claim the relay made, and a NIP-29 roster
 * never has the contested claims CORD-07 §4 has to arbitrate.
 */

import type { CallRoster, RosterEntry } from "@/lib/call/roster";
import type { NostrEvent } from "@/types/nostr";

/** The relay-published events an AV space needs. */
export const KIND_GROUP_METADATA = 39000;
export const KIND_LIVEKIT_PARTICIPANTS = 39004;

/** A pubkey as it appears in an identity or a `participant` tag. */
const PUBKEY_RE = /^[0-9a-f]{64}$/;

/**
 * The https origin of a relay's own web endpoints.
 *
 * Origin only: any path the relay's websocket lives under is dropped, because
 * the spec spells the endpoint `https://relay.tld/.well-known/…` and a
 * well-known URI is defined relative to an origin, not to a path. Refuses
 * anything that is not `wss://` — the header this URL carries is a bearer
 * credential naming the user, and there is no reason to hand one to plaintext.
 */
export function livekitOrigin(relayUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(relayUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "wss:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const port = url.port && url.port !== "443" ? `:${url.port}` : "";
  return `https://${host}${port}`;
}

/** Where the relay says whether it does AV at all: a `204` means yes. */
export function livekitCapabilityUrl(relayUrl: string): string | null {
  const origin = livekitOrigin(relayUrl);
  return origin && `${origin}/.well-known/nip29/livekit`;
}

/**
 * Where a group's token is minted.
 *
 * The group id is percent-encoded. Relay-assigned ids are usually a short slug,
 * but nothing in the spec says so, and an id with a `/` in it would otherwise
 * silently address a different endpoint.
 */
export function livekitTokenUrl(
  relayUrl: string,
  groupId: string,
): string | null {
  const origin = livekitOrigin(relayUrl);
  return (
    origin &&
    `${origin}/.well-known/nip29/livekit/${encodeURIComponent(groupId)}`
  );
}

/** Whether a group's metadata advertises a media room. */
export function groupSupportsAv(metadata: NostrEvent | undefined): boolean {
  if (!metadata || metadata.kind !== KIND_GROUP_METADATA) return false;
  return metadata.tags.some((t) => t[0] === "livekit");
}

/**
 * The kinds a group accepts, or undefined when it has not said.
 *
 * The distinction between absent and empty is the point of the tag: no
 * `supported_kinds` means every kind is fine, while a `supported_kinds` tag with
 * nothing after it means NO kind is — an AV-only space, which should not be
 * offering anyone a message box.
 */
export function groupSupportedKinds(
  metadata: NostrEvent | undefined,
): number[] | undefined {
  if (!metadata || metadata.kind !== KIND_GROUP_METADATA) return undefined;
  const tag = metadata.tags.find((t) => t[0] === "supported_kinds");
  if (!tag) return undefined;
  const kinds: number[] = [];
  for (const raw of tag.slice(1)) {
    const kind = Number(raw);
    if (Number.isInteger(kind) && kind >= 0) kinds.push(kind);
  }
  return kinds;
}

/** Whether a group takes text messages: kind 9, unless it says otherwise. */
export function groupAcceptsChat(metadata: NostrEvent | undefined): boolean {
  const kinds = groupSupportedKinds(metadata);
  return kinds === undefined || kinds.includes(9);
}

/**
 * The member behind an SFU identity: its first 64 characters, which the relay
 * MUST set to their lowercase hex pubkey. Anything else is not an identity this
 * relay minted, and vouches for nobody.
 */
export function authorOfIdentity(identity: string): string | undefined {
  const prefix = identity.slice(0, 64);
  return PUBKEY_RE.test(prefix) ? prefix : undefined;
}

/**
 * The pubkeys a `kind:39004` names as being in the room.
 *
 * Validated and deduped, order preserved. The relay is the author and the only
 * party who can know this, so there is nothing to cross-check it against — but a
 * malformed tag is still dropped rather than rendered as a member.
 */
export function parseParticipants(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== KIND_LIVEKIT_PARTICIPANTS) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "participant") continue;
    const pubkey = tag[1];
    if (typeof pubkey !== "string" || !PUBKEY_RE.test(pubkey)) continue;
    if (seen.has(pubkey)) continue;
    seen.add(pubkey);
    out.push(pubkey);
  }
  return out;
}

/**
 * Fold the relay's participant list and the SFU's identities into one roster.
 *
 * The two disagree constantly and neither is wrong: the relay knows a member has
 * a token before their WebRTC session is up, and the room knows about a
 * participant the relay has not re-announced yet. Both are shown. A member with
 * no identity yet is a tile with no media, which is what joining looks like from
 * the outside; an identity naming a pubkey the relay did not list is still a
 * real participant of the room we are in, and hiding it would leave someone
 * audible and invisible.
 *
 * `ms` orders the roster and is passed in rather than read from a clock, so the
 * fold is pure and the order is stable: the relay's own ordering first, then any
 * extra identities, alphabetically.
 */
export function foldGroupRoster(
  participants: readonly string[],
  identities: readonly string[],
): CallRoster {
  const byAuthor = new Map<string, string>();
  const extra: string[] = [];
  for (const identity of identities) {
    const author = authorOfIdentity(identity);
    if (!author) continue;
    // One member can hold several tokens (the spec allows it), and a tile per
    // browser tab is noise: the first identity seen for a member is the one
    // their tile binds to, and it is the one the relay's ordering reaches first.
    if (byAuthor.has(author)) continue;
    byAuthor.set(author, identity);
    if (!participants.includes(author)) extra.push(author);
  }
  extra.sort();

  const present: RosterEntry[] = [];
  const claims = new Map<string, string[]>();
  let ms = 0;
  for (const author of [...participants, ...extra]) {
    const identity = byAuthor.get(author) ?? "";
    present.push({ author, identity, hand: false, ms: ms++ });
    // Single by construction: the relay binds the pubkey into the identity it
    // mints, so nothing here can be contested the way a Concord claim can.
    if (identity) claims.set(identity, [author]);
  }
  return { present, claims };
}

/** A minted LiveKit session: the JWT, the SFU URL, and who it says we are. */
export interface GroupAvToken {
  token: string;
  url: string;
  identity: string;
}

/**
 * The `sub` claim of a JWT, without verifying it.
 *
 * Nothing client-side can verify this signature and nothing needs to — the SFU
 * is what enforces the token. We read `sub` because the spec puts our own
 * identity there and nowhere else, and our identity is what matches us to a
 * tile.
 */
export function jwtSubject(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims: unknown = JSON.parse(json);
    if (typeof claims !== "object" || claims === null) return undefined;
    const sub = (claims as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.length > 0 ? sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a token endpoint's answer.
 *
 * The spec names what the endpoint returns — a JWT and the LiveKit server's URL
 * — but not under which keys, so both the plain names and LiveKit's own
 * `ConnectionDetails` names are accepted. The identity comes from the token's
 * `sub` rather than from a field beside it: `sub` is what the spec mandates and
 * what the SFU will actually present us as, so a response that disagreed with
 * itself would leave us matching our own tile against the wrong string.
 *
 * `https://` is as acceptable as `wss://` — livekit-client takes either and real
 * deployments hand out both. Only plaintext is refused.
 */
export function parseTokenResponse(data: unknown): GroupAvToken {
  const body = (data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return "";
  };
  const token = pick("token", "participantToken", "jwt");
  const url = pick("url", "serverUrl", "wsUrl", "livekit_url");
  if (!token) throw new Error("the relay returned no LiveKit token");
  if (!url) throw new Error("the relay named no LiveKit server");
  if (!/^(wss|https):\/\//i.test(url)) {
    throw new Error("the relay named a LiveKit server over plaintext");
  }
  const identity = jwtSubject(token);
  if (!identity) {
    throw new Error("the relay's LiveKit token carries no identity");
  }
  return { token, url, identity };
}
