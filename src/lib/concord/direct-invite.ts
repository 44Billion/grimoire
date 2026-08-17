/**
 * Direct Invites — CORD-05 §6, RECEIVE HALF ONLY.
 *
 * When the invitee is a known npub the link machinery drops away: the §1 bundle
 * giftwraps straight to them as a STANDARD NIP-59 giftwrap — ephemeral wrap
 * author, the recipient in the `p` tag, a kind-13 seal signed by the inviter's
 * real key — not the reversed stream wrap of CORD-01.
 *
 *   wrap(1059, ephemeral author, ["p", recipient], ["k", "3313"])
 *     └ seal(13, signed by the inviter)
 *         └ rumor(3313, content = the CommunityInvite bundle as JSON)
 *
 * The outer `k` tag is what makes invites INDEXED — `{"kinds":[1059],
 * "#p":[me], "#k":["3313"]}` finds exactly the invites, instead of decrypting
 * everything ever p-tagged at this key. It is a hint and never authority: an
 * invite is whatever unwraps to a kind-3313 rumor, so an untagged one is
 * honored all the same and a wrap whose tag lies wastes only its own
 * indexability.
 *
 * Ported from armada `efcef385` (`src/concord-v2/lib/directInvite.ts`), sending
 * left out — grimoire never invites.
 */

import type { NostrEvent } from "nostr-tools/pure";

import { KIND_DIRECT_INVITE, KIND_WRAP } from "@/lib/concord/kinds";
import { validateBundle, type InviteBundle } from "@/lib/concord/invite";

/** The standard NIP-59 seal kind — a classic giftwrap, not a CORD-01 seal. */
export const KIND_NIP59_SEAL = 13;

/** The signer surface receiving needs: NIP-44 decrypt, nothing more. */
export interface InviteDecryptor {
  nip44?: { decrypt(pubkey: string, ciphertext: string): Promise<string> };
}

/** The unsigned kind-3313 rumor: the bundle whole, claimed by the inviter. */
export interface DirectInviteRumor {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey: string;
}

/** An unwrapped giftwrap: the inner rumor plus its seal-verified sender. */
export interface UnwrappedInvite {
  rumor: DirectInviteRumor;
  /** The seal's author — the proven inviter. */
  sender: string;
}

/**
 * Peel a giftwrap addressed to this key. Never throws: a foreign or malformed
 * wrap yields undefined, so a scan can skip it.
 *
 * The layers are peeled with the signer's own `nip44.decrypt` rather than
 * nostr-tools' nip59 helpers, which need a raw secret key that NIP-07 and
 * NIP-46 signers never expose. The rumor's claimed author must equal the seal's
 * — NIP-59's anti-spoofing check, and the only thing that makes `sender`
 * mean anything.
 */
export async function unwrapDirectInvite(
  giftWrap: NostrEvent,
  signer: InviteDecryptor,
): Promise<UnwrappedInvite | undefined> {
  if (giftWrap.kind !== KIND_WRAP || !signer.nip44) return undefined;
  try {
    const seal = JSON.parse(
      await signer.nip44.decrypt(giftWrap.pubkey, giftWrap.content),
    ) as NostrEvent;
    if (seal.kind !== KIND_NIP59_SEAL) return undefined;
    const rumor = JSON.parse(
      await signer.nip44.decrypt(seal.pubkey, seal.content),
    ) as DirectInviteRumor;
    if (rumor.pubkey !== seal.pubkey) return undefined;
    return { rumor, sender: seal.pubkey };
  } catch {
    return undefined;
  }
}

/**
 * Parse an unwrapped rumor as an invite bundle. The rumor's kind is the
 * authority (the outer `k` tag was only ever a hint), and the bundle validates
 * exactly as a fetched one — bounds, and the self-certifying owner.
 *
 * Expiry is NOT enforced here: a parked invite still renders past `expires_at`,
 * and only joining refuses.
 */
export function parseDirectInviteRumor(
  kind: number,
  content: string,
): InviteBundle | undefined {
  if (kind !== KIND_DIRECT_INVITE) return undefined;
  try {
    const bundle = JSON.parse(content) as InviteBundle;
    if (
      typeof bundle.community_id !== "string" ||
      typeof bundle.name !== "string"
    ) {
      return undefined;
    }
    return validateBundle(bundle);
  } catch {
    return undefined;
  }
}
