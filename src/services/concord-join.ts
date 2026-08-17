/**
 * Accepting an invite — the one place grimoire writes a membership.
 *
 * Everything else about Concord here is a read. This is not, and the order of
 * the two publishes is the whole design (see `lib/concord/join.ts`): the
 * Community List first, because it is the member's only copy of their own
 * keys; the Guestbook Join second and best-effort, because it is off-consensus
 * and nothing depends on it.
 *
 * Which generation of the List gets written is decided by what the member
 * already has, never by which one the spec prefers: a member whose other
 * clients read the retired single-event List must not have their join land
 * somewhere those clients never look. A member with no List at all gets the
 * retired kind for exactly the same reason — it is what the ecosystem reads
 * today. When the writers migrate, this follows them without a decision here.
 */

import { hex32 } from "@/lib/concord/derive";
import { guestbookGroupKey } from "@/lib/concord/derive";
import { mergeCommunityLists } from "@/lib/concord/community-list";
import type { CommunityList } from "@/lib/concord/community-list";
import { inviteExpired, type InviteBundle } from "@/lib/concord/invite";
import {
  entryFromBundle,
  joinTags,
  JOIN_RUMOR,
  LIST_MAX_BYTES,
  serializeCommunityList,
} from "@/lib/concord/join";
import {
  KIND_COMMUNITY_LIST,
  KIND_COMMUNITY_LIST_LEGACY,
  KIND_SEAL_ENCRYPTED,
} from "@/lib/concord/kinds";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { StreamSigner } from "@/lib/concord/stream";
import { capRelays } from "@/lib/concord/types";
import {
  mirroredMembershipCount,
  readListSlotsForWrite,
  syncCommunities,
} from "@/services/concord-communities";
import { publishWrap } from "@/services/concord-publish";
import { publishEvent } from "@/services/hub";

/** The signer surface a join needs: sign, and NIP-44 both ways. */
export interface JoinSigner extends StreamSigner {
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export interface JoinOutcome {
  communityId: string;
  /** Which generation of the List the membership was written into. */
  listKind: number;
  /** The Guestbook is off-consensus: a failure here costs visibility only. */
  guestbook: "published" | "failed";
  guestbookError?: string;
}

export class JoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JoinError";
  }
}

/**
 * Accept an invite: write the membership, then announce it.
 *
 * Refuses an expired bundle — the preview still renders past `expires_at`, but
 * joining is exactly what that field bounds.
 */
export async function joinFromInvite(
  bundle: InviteBundle,
  pubkey: string,
  signer: JoinSigner,
): Promise<JoinOutcome> {
  if (!signer.nip44) {
    throw new JoinError(
      "This signer cannot join: the Community List is encrypted to yourself, which needs NIP-44.",
    );
  }
  if (inviteExpired(bundle)) {
    throw new JoinError("This invite has expired.");
  }

  const communityId = bundle.community_id.toLowerCase();
  const entry = entryFromBundle(bundle);

  // §8's read-modify-write: fetched fresh, never built from the local mirror,
  // or a join silently drops whatever another device published since the last
  // sync — including that device's own channel keys.
  const { slots, unreadable } = await readListSlotsForWrite(pubkey, signer);
  if (unreadable > 0) {
    // A slot this client cannot open is a slot it must not rewrite: the write
    // REPLACES the coordinate, so publishing over an unreadable fragment
    // destroys every membership in it — and what a membership holds is the
    // member's only copy of their channel keys.
    throw new JoinError(
      "Part of your Community List would not decrypt just now, so nothing was written. Check the signer holding your key and try again.",
    );
  }
  if (slots.length === 0 && (await mirroredMembershipCount(pubkey)) > 0) {
    // The vault says memberships exist but no relay served the document that
    // holds them. Writing a fresh List here would replace it with this one
    // membership alone, wiping the rest.
    throw new JoinError(
      "Your Community List could not be read from any relay just now, so nothing was written — joining would have replaced the memberships it holds.",
    );
  }
  const holding = slots.find((slot) =>
    slot.list.entries.some(
      (e) => e.community_id?.toLowerCase() === communityId,
    ),
  );
  const legacy = slots.find((slot) => slot.kind === KIND_COMMUNITY_LIST_LEGACY);
  // Re-joining rewrites the fragment that already holds the membership;
  // otherwise the generation the member's other clients actually read.
  const target = holding ?? legacy ?? slots[0];
  const kind = target?.kind ?? KIND_COMMUNITY_LIST_LEGACY;
  const d = target?.d ?? "";

  const merged = mergeCommunityLists([
    { list: target?.list },
    { list: { entries: [entry], tombstones: [] } as CommunityList },
  ]);
  const json = serializeCommunityList(
    merged,
    kind === KIND_COMMUNITY_LIST ? "base64url" : "hex",
  );

  const content = await signer.nip44.encrypt(pubkey, json);
  const signed = await signer.signEvent({
    kind,
    content,
    // The fragmented kind is addressable and keyed by its index; the retired
    // one is replaceable and carries no identifier at all.
    tags: kind === KIND_COMMUNITY_LIST ? [["d", d]] : [],
    // Relays resolve a replacement on `created_at` alone and break ties on the
    // LOWEST id, so a write sharing a second with the copy it replaces can be
    // silently discarded (CORD-02 §8).
    created_at: Math.max(
      Math.floor(Date.now() / 1000),
      (target?.createdAt ?? 0) + 1,
    ),
  });

  // Measured on the FULLY ENCODED event, after encryption and signing: the
  // NIP-44 plaintext understates it by roughly a third, so a List that passes a
  // plaintext check can still be refused by every relay — freezing the member's
  // memberships at their last accepted state with no error raised anywhere.
  if (JSON.stringify(signed).length > LIST_MAX_BYTES) {
    throw new JoinError(
      "Your Community List is too large for one event, and splitting it across fragments is not something this client does. Join in Armada, which can repack it.",
    );
  }

  await publishEvent(signed).catch((error: unknown) => {
    throw new JoinError(
      `Your membership could not be saved: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  // The vault is what the rest of the client reads, and it is also what proves
  // the write round-trips: re-reading now means the community appears with the
  // keys as they came back off the wire, not as we hoped they went out.
  await syncCommunities(pubkey, signer).catch(() => undefined);

  const outcome: JoinOutcome = {
    communityId,
    listKind: kind,
    guestbook: "published",
  };
  try {
    await publishGuestbookJoin(bundle, pubkey, signer);
  } catch (error) {
    outcome.guestbook = "failed";
    outcome.guestbookError =
      error instanceof Error ? error.message : String(error);
  }
  return outcome;
}

/**
 * Publish the member's own word that they are here (CORD-02 §5).
 *
 * Self-signed inside the seal, wrapped at the Guestbook's address under the
 * community root every member holds — necessarily member-writable, unlike the
 * Control Plane, because a Join is nobody else's statement to make.
 */
async function publishGuestbookJoin(
  bundle: InviteBundle,
  pubkey: string,
  signer: JoinSigner,
): Promise<void> {
  const group = guestbookGroupKey(
    hex32(bundle.community_root),
    hex32(bundle.community_id),
    BigInt(bundle.root_epoch),
  );
  const rumor = buildRumor({
    kind: JOIN_RUMOR.kind,
    content: JOIN_RUMOR.content,
    tags: joinTags(bundle),
    pubkey,
    ms: Date.now(),
  });
  const seal = await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, signer);
  const wrap = wrapSeal(seal, group);
  const relays = capRelays(Array.isArray(bundle.relays) ? bundle.relays : []);
  await publishWrap(relays, wrap);
}
