/**
 * Pins — CORD-04 §7, READ HALF ONLY.
 *
 * A Pin lifts a message onto the Control Plane, where compaction re-wraps it
 * across every rotation — so a pin reaches members who hold none of the chat
 * history it came from. It does not QUOTE the message, it PROVES it: the entry
 * carries the original kind-20013 seal plus that one message's 76-byte NIP-44
 * key expansion, and a reader re-derives the message from them.
 *
 * The disclosure is narrow by construction. NIP-44 v2 derives per-message keys
 * as `hkdf-expand(conversation_key, nonce)`, one-way, so the 76 bytes open this
 * message and nothing else — not the conversation key, not the epoch, not the
 * author's other traffic.
 *
 * Grimoire never publishes a Pin List, so none of §7's curator duties are here
 * (no republish, no re-heal, no deletion-omission edition). What is here is the
 * verification a reader owes the entry, and it is exhaustive: an entry that
 * fails any step is DROPPED, never rendered as "probably fine".
 */

import { chacha20 } from "@noble/ciphers/chacha.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getEventHash } from "nostr-tools/pure";
import { nip44 } from "nostr-tools";

import { hexToBytes } from "@/lib/concord/derive";
import {
  KIND_COMMENT,
  KIND_EDIT,
  KIND_MESSAGE,
  KIND_SEAL_ENCRYPTED,
} from "@/lib/concord/kinds";
import type { NostrRumor } from "@/lib/concord/rumor";
import { verifyEventOnce } from "@/lib/concord/verify-cache";
import type { NostrEvent } from "nostr-tools/pure";

/** §7's two caps. A list breaching either reads as EMPTY, never as refused. */
export const PIN_MAX_ENTRIES = 25;
export const PIN_MAX_CONTENT_BYTES = 32_768;

/** The kinds a pin may name. An Edit rides the `edit` bundle instead. */
const PINNABLE_KINDS = new Set([KIND_MESSAGE, KIND_COMMENT]);

/** One entry as it rides the wire: a proof, not a quotation. */
export interface PinProof {
  /** The original kind-20013 seal, its content string unaltered. */
  seal: NostrEvent;
  /** 76 bytes hex: chacha_key[32] ‖ chacha_nonce[12] ‖ hmac_key[32]. */
  keys: string;
  /** Unverifiable locator hint for jump-to-context. Never trusted. */
  wrap?: string;
  /** The newest provable Edit of the same message, same proof shape. */
  edit?: { seal: NostrEvent; keys: string };
}

/** A pin that passed every check, ready to render. */
export interface VerifiedPin {
  /** Recomputed from the decrypted bytes — an embedded `id` is never trusted. */
  rumorId: string;
  /** The seal's pubkey, which the rumor had to match: the proven author. */
  authorHex: string;
  kind: number;
  content: string;
  /** The author's own signed timestamp, in seconds. */
  createdAt: number;
  tags: string[][];
  /** The proven Edit, when the entry carries one that verifies. */
  edited?: { content: string; createdAt: number; rumorId: string };
  /** Untrusted locator hint (§7): detected by mismatch, never relied on. */
  wrapHint?: string;
}

/** base64 → bytes; the payload is attacker-supplied, so it may throw. */
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Open one NIP-44 v2 payload with a DISCLOSED key expansion rather than a
 * conversation key — the whole point of the proof bundle.
 *
 * The MAC is checked before the decrypt, exactly as `nip44.decrypt` does: it is
 * what binds the ciphertext to the disclosed keys, and a forgery must defeat
 * both a ChaCha20 keystream preimage and a second HMAC-SHA256 key matching the
 * signed MAC.
 */
export function openWithDisclosedKeys(
  payload: string,
  keys76: Uint8Array,
): string | undefined {
  if (keys76.length !== 76) return undefined;
  const chachaKey = keys76.subarray(0, 32);
  const chachaNonce = keys76.subarray(32, 44);
  const hmacKey = keys76.subarray(44, 76);
  try {
    const data = b64ToBytes(payload);
    if (data.length < 99 || data[0] !== 2) return undefined;
    const nonce = data.subarray(1, 33);
    const ciphertext = data.subarray(33, -32);
    const mac = data.subarray(-32);
    const combined = new Uint8Array(nonce.length + ciphertext.length);
    combined.set(nonce);
    combined.set(ciphertext, nonce.length);
    if (!equalBytes(hmac(sha256, hmacKey, combined), mac)) return undefined;
    return nip44.v2.utils.unpad(chacha20(chachaKey, chachaNonce, ciphertext));
  } catch {
    return undefined;
  }
}

/** A tag's single value, or undefined. */
function tagValue(tags: string[][], name: string): string | undefined {
  const tag = tags.find((t) => Array.isArray(t) && t[0] === name);
  return typeof tag?.[1] === "string" ? tag[1] : undefined;
}

/**
 * The five steps of §7, run over one seal + key disclosure.
 *
 * `kinds` is the substitution the Edit bundle needs — everything else, above
 * all the `channel` binding, is identical for both paths. Without that binding
 * a private Channel's keyholder could pin its messages into a PUBLIC list and
 * disclose them community-wide with proof.
 */
function openProof(
  seal: NostrEvent | undefined,
  keysHex: string | undefined,
  channelIdHex: string,
  kinds: ReadonlySet<number>,
): NostrRumor | undefined {
  if (!seal || typeof keysHex !== "string" || keysHex.length !== 152) {
    return undefined;
  }
  // 1. The seal must be an ENCRYPTED chat-plane seal, and genuinely signed.
  if (seal.kind !== KIND_SEAL_ENCRYPTED) return undefined;
  if (!verifyEventOnce(seal)) return undefined;

  let keys76: Uint8Array;
  try {
    keys76 = hexToBytes(keysHex);
  } catch {
    return undefined;
  }
  // 2 & 3. MAC, then decrypt.
  const json = openWithDisclosedKeys(seal.content, keys76);
  if (json === undefined) return undefined;

  let rumor: NostrRumor;
  try {
    rumor = JSON.parse(json) as NostrRumor;
  } catch {
    return undefined;
  }
  // 4. NIP-59's impersonation check, the kind, and the Channel binding —
  // absence of the binding fails, it is never assumed.
  if (
    typeof rumor?.pubkey !== "string" ||
    rumor.pubkey.toLowerCase() !== seal.pubkey.toLowerCase() ||
    typeof rumor.kind !== "number" ||
    !kinds.has(rumor.kind) ||
    !Array.isArray(rumor.tags) ||
    typeof rumor.content !== "string" ||
    typeof rumor.created_at !== "number"
  ) {
    return undefined;
  }
  if (tagValue(rumor.tags, "channel")?.toLowerCase() !== channelIdHex) {
    return undefined;
  }
  return rumor;
}

/** Recompute a rumor's id from its own bytes; an embedded `id` is never used. */
function recomputeId(rumor: NostrRumor): string {
  return getEventHash({
    pubkey: rumor.pubkey,
    created_at: rumor.created_at,
    kind: rumor.kind,
    tags: rumor.tags,
    content: rumor.content,
  });
}

/**
 * Verify one entry, returning what it proves — or undefined, meaning drop it.
 *
 * `channelIdHex` is the Pin List's OWN channel, taken from the coordinate the
 * list folded at, never from the entry.
 */
export function verifyPinEntry(
  entry: unknown,
  channelIdHex: string,
): VerifiedPin | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const proof = entry as PinProof;
  const rumor = openProof(proof.seal, proof.keys, channelIdHex, PINNABLE_KINDS);
  if (!rumor) return undefined;
  const rumorId = recomputeId(rumor);

  const verified: VerifiedPin = {
    rumorId,
    authorHex: rumor.pubkey.toLowerCase(),
    kind: rumor.kind,
    content: rumor.content,
    createdAt: rumor.created_at,
    tags: rumor.tags,
    ...(typeof proof.wrap === "string" ? { wrapHint: proof.wrap } : {}),
  };

  // The Edit bundle: the same five steps, kind 3302 in place of 9/1111, plus
  // the two rules that are the fold's own — only the original author may revise
  // their words, and the Edit must name the original rumor.
  const edit = proof.edit;
  if (edit) {
    const editRumor = openProof(
      edit.seal,
      edit.keys,
      channelIdHex,
      new Set([KIND_EDIT]),
    );
    if (
      editRumor &&
      editRumor.pubkey.toLowerCase() === verified.authorHex &&
      tagValue(editRumor.tags, "e") === rumorId
    ) {
      verified.edited = {
        content: editRumor.content,
        createdAt: editRumor.created_at,
        rumorId: recomputeId(editRumor),
      };
    }
  }
  return verified;
}

/**
 * A Pin List's content in whichever of its two self-describing forms it
 * arrived. A reader accepts either regardless of the channel's folded type.
 */
export type PinListContent =
  | { form: "public"; entries: unknown[] }
  | { form: "sealed"; epoch: bigint; sealed: string }
  /** Present but unreadable — shown as unavailable, never as an empty list. */
  | { form: "unreadable" };

/**
 * Parse an edition's `content`, applying §7's caps.
 *
 * A violating edition is NOT refused from the fold — refusing would fork the
 * version chain between implementations — so it folds and chains like any
 * other, and every reader treats its content as an EMPTY list. The byte cap is
 * judged on the exact carried bytes, by every reader, member of the Channel or
 * not.
 */
export function parsePinListContent(content: string): PinListContent {
  if (new TextEncoder().encode(content).length > PIN_MAX_CONTENT_BYTES) {
    return { form: "public", entries: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { form: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object") return { form: "unreadable" };
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.sealed === "string" && typeof obj.epoch === "string") {
    let epoch: bigint;
    try {
      epoch = BigInt(obj.epoch);
    } catch {
      return { form: "unreadable" };
    }
    return { form: "sealed", epoch, sealed: obj.sealed };
  }
  if (Array.isArray(obj.entries)) {
    return {
      form: "public",
      entries:
        obj.entries.length > PIN_MAX_ENTRIES ? [] : (obj.entries as unknown[]),
    };
  }
  return { form: "unreadable" };
}

/**
 * Open a sealed list with the Channel's conversation key at the named epoch.
 *
 * A member who never held that epoch cannot open it — correctly. That is
 * "unavailable", which a client must render as such rather than as no pins.
 */
export function openSealedPinList(
  sealed: string,
  convKey: Uint8Array,
): unknown[] | undefined {
  try {
    const json = nip44.decrypt(sealed, convKey);
    const parsed = JSON.parse(json) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return undefined;
    return parsed.entries.length > PIN_MAX_ENTRIES ? [] : parsed.entries;
  } catch {
    return undefined;
  }
}

/**
 * Verify a list's entries, dropping every one that fails and deduplicating by
 * proven rumor id (the entry's identity, §7 step 5).
 */
export function verifyPinEntries(
  entries: unknown[],
  channelIdHex: string,
): VerifiedPin[] {
  const seen = new Map<string, VerifiedPin>();
  for (const entry of entries.slice(0, PIN_MAX_ENTRIES)) {
    const verified = verifyPinEntry(entry, channelIdHex);
    if (verified && !seen.has(verified.rumorId)) {
      seen.set(verified.rumorId, verified);
    }
  }
  return [...seen.values()];
}
