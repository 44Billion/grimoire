/**
 * Invites — CORD-05, READ HALF ONLY.
 *
 * An invite hands over the keys that make somebody a member. It arrives two
 * ways, and grimoire reads both:
 *
 * - a **link**, `$BASE/invite/<naddr>#<fragment>` — a public locator in the
 *   path naming the addressable bundle `(33301, link_signer, d="")`, and an
 *   off-network secret in the fragment. A fragment is never sent to a server,
 *   so the base domain and the relays see where a bundle sits and can never
 *   open one;
 * - a **Direct Invite** (`direct-invite.ts`), the same bundle giftwrapped
 *   straight to an npub, with no coordinate and nothing to fetch.
 *
 * Trust does not rest on the inviter. The `community_id` is a commitment to the
 * owner's key, so a bundle whose `owner`/`owner_salt` fail to reproduce it is
 * refused — a compromised creator cannot smuggle a false owner or a fake key
 * for a real community. And a bundle is attacker-crafted input reached by
 * following a link, so it is BOUNDED before anything allocates.
 *
 * Ported from armada `efcef385` (`src/concord-v2/lib/invite.ts`), minting,
 * refreshing and revoking left out — grimoire never creates a link.
 */

import { nip19 } from "nostr-tools";
import { nip44 } from "nostr-tools";
import { verifyEvent } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

import { inviteBundleKey, verifyCommunityId } from "@/lib/concord/derive";
import {
  KIND_INVITE_BUNDLE,
  VSK_INVITE_LIVE,
  VSK_INVITE_REVOKED,
} from "@/lib/concord/kinds";
import { capRelays, type ImagePointer } from "@/lib/concord/types";

/** The link's unlock token: 16 random bytes (CORD-05 §2). */
export const TOKEN_BYTES = 16;
/** The fragment carries at most 3 bootstrap relays (CORD-05 §3). */
export const MAX_BOOTSTRAP_RELAYS = 3;
/** The fragment format byte, which also selects the dictionary generation. */
export const FRAGMENT_VERSION = 4;
/** A hostile link must not become an unbounded allocation (CORD-05 §1). */
export const MAX_BUNDLE_CHANNELS = 256;

/** The keys an invite delivers (CORD-05 §1). */
export interface InviteBundle {
  community_id: string;
  owner: string;
  owner_salt: string;
  community_root: string;
  root_epoch: number;
  /**
   * The Control Plane's signer pubkey at that epoch — subscribe, verify, read;
   * never write. Absent = a legacy, pre-split community (CORD-06 §3).
   */
  control_pk?: string;
  /** The granted PRIVATE channels (public ones derive from the root). */
  channels: Array<{ id: string; key: string; epoch: number; name: string }>;
  relays: string[];
  /** Preview, so a parked invite can render; the Control fold is the authority. */
  name: string;
  icon?: ImagePointer;
  banner?: ImagePointer;
  /** Optional, unix ms: past it the preview still renders, joining refuses. */
  expires_at?: number;
  /** Optional attribution, echoed in the joiner's Guestbook Join. */
  creator_npub?: string;
  label?: string;
  [k: string]: unknown;
}

export class InviteError extends Error {
  constructor(
    public code:
      | "bad-link"
      | "bad-fragment"
      | "bad-bundle"
      | "owner-mismatch"
      | "revoked"
      | "expired"
      | "bounds",
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

/** Bound attacker-crafted input before allocating (CORD-05 §1). */
function boundBundle(bundle: InviteBundle): InviteBundle {
  if (!Array.isArray(bundle.channels)) bundle.channels = [];
  if (bundle.channels.length > MAX_BUNDLE_CHANNELS) {
    throw new InviteError(
      "bounds",
      `bundle carries ${bundle.channels.length} channels (cap ${MAX_BUNDLE_CHANNELS})`,
    );
  }
  bundle.relays = capRelays(Array.isArray(bundle.relays) ? bundle.relays : []);
  return bundle;
}

/**
 * Validate a decrypted bundle however it arrived: the §1 bounds, and the
 * self-certifying `community_id` reproducing from (owner, salt).
 *
 * Expiry is deliberately the caller's concern — a parked invite still renders
 * past `expires_at`, and only joining refuses.
 */
export function validateBundle(bundle: InviteBundle): InviteBundle {
  boundBundle(bundle);
  if (
    !verifyCommunityId(bundle.community_id, bundle.owner, bundle.owner_salt)
  ) {
    throw new InviteError(
      "owner-mismatch",
      "this invite's owner does not reproduce its community_id",
    );
  }
  return bundle;
}

/** Whether a bundle's shelf life has run out (`expires_at` is unix ms). */
export function inviteExpired(bundle: InviteBundle, nowMs = Date.now()) {
  return typeof bundle.expires_at === "number" && nowMs > bundle.expires_at;
}

/**
 * Verify and decrypt a fetched bundle event.
 *
 * The coordinate is the anti-squat guard — a different author is a different
 * coordinate — but the signature and author are re-checked anyway, so a relay
 * handing back garbage is refused rather than parsed.
 */
export function parseBundleEvent(
  event: NostrEvent,
  expectedSigner: string,
  token: Uint8Array,
): InviteBundle {
  if (
    event.kind !== KIND_INVITE_BUNDLE ||
    event.pubkey !== expectedSigner ||
    !verifyEvent(event)
  ) {
    throw new InviteError("bad-bundle", "not a valid invite bundle event");
  }
  const vsk = event.tags.find((t) => t[0] === "vsk")?.[1];
  if (vsk === VSK_INVITE_REVOKED) {
    throw new InviteError("revoked", "this invite link has been revoked");
  }
  if (vsk !== VSK_INVITE_LIVE) {
    throw new InviteError("bad-bundle", `unknown bundle marker: ${vsk}`);
  }
  let bundle: InviteBundle;
  try {
    bundle = JSON.parse(
      nip44.decrypt(event.content, inviteBundleKey(token)),
    ) as InviteBundle;
  } catch (error) {
    throw new InviteError(
      "bad-bundle",
      `bundle would not decrypt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateBundle(bundle);
}

// ── The fragment codec (CORD-05 §3) ─────────────────────────────────────────

/**
 * The stock relay dictionary, generation 4.
 *
 * **The one place relay URLs are spelled out in this codebase, and it is not a
 * relay choice.** A link minted with the stock flag carries ZERO relay bytes —
 * the four primaries are implied by a single bit — so a client without this
 * table cannot decode where the bundle lives. It is protocol data, versioned by
 * the fragment's own format byte, shipped identically by Vector and Soapbox.
 * grimoire connects to these only while fetching that one bundle; nothing else
 * here ever reads them.
 */
export const RELAY_DICTIONARY: Record<number, string> = {
  1: "wss://jskitty.com/nostr",
  2: "wss://asia.vectorapp.io/nostr",
  3: "wss://relay.ditto.pub",
  4: "wss://relay.dreamith.to",
};

/** The stock set the flags bit selects (dictionary ids 1–4, in order). */
export const STOCK_RELAYS: string[] = [1, 2, 3, 4].map(
  (i) => RELAY_DICTIONARY[i],
);

/** flags bit 0: the stock set is in use, zero relay bytes follow. */
const FLAG_STOCK_SET = 0x01;

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode an invite fragment into its token and bootstrap relays. */
export function decodeFragment(fragment: string): {
  token: Uint8Array;
  relays: string[];
} {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(fragment.trim());
  } catch {
    throw new InviteError("bad-fragment", "fragment is not base64url");
  }
  let o = 0;
  const need = (n: number) => {
    if (o + n > bytes.length) {
      throw new InviteError("bad-fragment", "fragment truncated");
    }
  };
  need(2);
  const version = bytes[o++];
  if (version < FRAGMENT_VERSION) {
    // A client MAY refuse a lower version rather than decode it against the
    // wrong dictionary generation (CORD-05 §3).
    throw new InviteError(
      "bad-fragment",
      `this invite uses an older link format (version ${version})`,
    );
  }
  if (version > FRAGMENT_VERSION) {
    throw new InviteError(
      "bad-fragment",
      `this invite uses link format ${version}, newer than this client reads`,
    );
  }
  const flags = bytes[o++];

  const relays: string[] = [];
  if (flags & FLAG_STOCK_SET) {
    relays.push(...STOCK_RELAYS);
  } else {
    need(1);
    const count = bytes[o++];
    if (count > MAX_BOOTSTRAP_RELAYS) {
      throw new InviteError("bad-fragment", "too many bootstrap relays");
    }
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
      need(1);
      const lead = bytes[o++];
      if (lead >= 1 && lead <= 254) {
        const url = RELAY_DICTIONARY[lead];
        // An unknown dictionary id is SKIPPED rather than fatal: the dictionary
        // grows, and a link naming one relay this build has not heard of still
        // resolves through the others.
        if (url) relays.push(url);
        continue;
      }
      need(1);
      const len = bytes[o++];
      need(len);
      const text = decoder.decode(bytes.slice(o, o + len));
      o += len;
      relays.push(lead === 255 ? text : `wss://${text}`);
    }
  }

  need(TOKEN_BYTES);
  const token = bytes.slice(o, o + TOKEN_BYTES);
  o += TOKEN_BYTES;
  if (o !== bytes.length) {
    throw new InviteError("bad-fragment", "trailing bytes in fragment");
  }
  return { token, relays };
}

// ── The link (CORD-05 §2) ───────────────────────────────────────────────────

export const INVITE_PATH_PREFIX = "/invite/";

/** A parsed invite link: the bundle's coordinate plus the fragment's secrets. */
export interface ParsedInviteLink {
  /** The link signer's pubkey (hex) — the bundle's coordinate author. */
  linkSigner: string;
  token: Uint8Array;
  bootstrapRelays: string[];
  naddr: string;
}

/** The bare naddr of a link signer's bundle coordinate (empty `d`). */
export function bundleNaddr(linkSignerPk: string): string {
  return nip19.naddrEncode({
    kind: KIND_INVITE_BUNDLE,
    pubkey: linkSignerPk,
    identifier: "",
  });
}

/** The link-signer pubkey an naddr names, or undefined if it names no bundle. */
function naddrToSigner(naddr: string): string | undefined {
  try {
    const decoded = nip19.decode(naddr);
    if (decoded.type !== "naddr") return undefined;
    const data = decoded.data;
    if (data.kind !== KIND_INVITE_BUNDLE || data.identifier !== "") {
      return undefined;
    }
    return data.pubkey;
  } catch {
    return undefined;
  }
}

/**
 * Parse an invite from a full URL (`…/invite/<naddr>#<fragment>`) or the
 * domain-agnostic bare form (`<naddr>#<fragment>`).
 *
 * The base is cosmetic: only the naddr and the fragment are protocol, so the
 * same link opens on any deeplink domain. Returns undefined for anything that
 * is not recognizably an invite, so a caller can fall through to other parsers.
 */
export function parseInviteLink(input: string): ParsedInviteLink | undefined {
  const trimmed = input.trim();
  let naddr: string | undefined;
  let fragment: string | undefined;

  if (/^naddr1[a-z0-9]+#.+$/i.test(trimmed)) {
    const [head, ...rest] = trimmed.split("#");
    naddr = head;
    fragment = rest.join("#");
  } else {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (!url.pathname.startsWith(INVITE_PATH_PREFIX)) return undefined;
    naddr = decodeURIComponent(
      url.pathname.slice(INVITE_PATH_PREFIX.length),
    ).replace(/\/$/, "");
    fragment = url.hash.replace(/^#/, "");
  }

  if (!naddr || !fragment) return undefined;
  const linkSigner = naddrToSigner(naddr);
  if (!linkSigner) return undefined;
  const { token, relays } = decodeFragment(fragment);
  return { linkSigner, token, bootstrapRelays: relays, naddr };
}

// ── What an invite is worth, given what the member already holds ────────────

/**
 * An invite's standing against the vault:
 *
 * - `new` — a community the member does not hold. The only kind that is an
 *   invitation in the ordinary sense.
 * - `catch-up` — one they DO hold, whose bundle carries something they lack: a
 *   fresher root epoch (an admin healing a stranded member), or a private
 *   channel key they were granted since, or one at a newer channel epoch.
 *   Still worth acting on, and worth counting.
 * - `held` — everything the bundle carries is already in hand. Nothing to do,
 *   so it should not be counted or dressed up as something waiting.
 *
 * A LOWER root epoch is never a catch-up whatever channels it names: it is a
 * stale bundle, and accepting could only move the membership backwards.
 */
export type InviteStanding = "new" | "catch-up" | "held";

export function inviteStanding(
  bundle: InviteBundle,
  held:
    | {
        rootEpoch: bigint;
        privateChannels: ReadonlyArray<{ id: Uint8Array; epoch: bigint }>;
      }
    | undefined,
  toHex: (bytes: Uint8Array) => string,
): InviteStanding {
  if (!held) return "new";
  let bundleEpoch: bigint;
  try {
    bundleEpoch = BigInt(bundle.root_epoch);
  } catch {
    return "held";
  }
  if (bundleEpoch > held.rootEpoch) return "catch-up";
  if (bundleEpoch < held.rootEpoch) return "held";

  const heldChannels = new Map(
    held.privateChannels.map((ch) => [toHex(ch.id).toLowerCase(), ch.epoch]),
  );
  for (const channel of Array.isArray(bundle.channels) ? bundle.channels : []) {
    if (!channel || typeof channel.id !== "string") continue;
    const mine = heldChannels.get(channel.id.toLowerCase());
    let offered: bigint;
    try {
      offered = BigInt(channel.epoch);
    } catch {
      continue;
    }
    if (mine === undefined || offered > mine) return "catch-up";
  }
  return "held";
}
