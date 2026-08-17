/**
 * Sending a NIP-17 message.
 *
 * Deliberately NOT applesauce's `SendWrappedMessage` action. That action pushes
 * every copy through one `publish`, which makes it impossible to route the
 * peer's wrap over the unauthenticated pool and the self-copy over the
 * authenticated one — and that routing is the whole anonymity story
 * (`src/services/dm-publish-pool.ts`). Three other things fall out of doing it
 * here instead: the action's one-second relay-resolution race is replaced by an
 * explicit resolve, a peer copy that reached nothing is reported rather than
 * swallowed by `allSettled`, and local echo costs no decryption because the
 * plaintext rumor is already in hand.
 */

import {
  GiftWrapFactory,
  WrappedMessageFactory,
} from "applesauce-common/factories";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { EventSigner } from "applesauce-core";
import { getEventHash } from "nostr-tools";
import { publishEventToRelays } from "@/services/hub";
import { markWrapsSeen, writeDmRumors } from "@/services/dm-store";
import {
  DM_LIST_SCOPE,
  conversationScope,
  emitDmScopes,
} from "@/services/dm-bus";
import { ownDmReadRelays, resolveDmRelays } from "./relays";
import { publishGiftWrap, type GiftWrapDelivery } from "./publish";

export interface SendDmParams {
  viewer: string;
  signer: EventSigner;
  /** The other side. One pubkey — group compose is not in this version. */
  peer: string;
  content: string;
  /** The rumor being replied to, if any. */
  replyTo?: Rumor;
}

export interface SendDmResult {
  /** The message as stored locally. Its id is the one the timeline shows. */
  rumor: Rumor;
  /** What each of the peer's relays did with their copy. */
  peer: GiftWrapDelivery[];
  /** Relays the self-copy reached, so the message survives a reload. */
  self: string[];
}

/**
 * A peer with no DM inbox and no NIP-65 inbox cannot be written to.
 *
 * Thrown rather than best-efforted: the alternative is publishing private mail
 * to relays the recipient never nominated, on the hope that they read them.
 */
export class NoDmInboxError extends Error {
  constructor(public readonly peer: string) {
    super("This person has not published anywhere to receive direct messages.");
    this.name = "NoDmInboxError";
  }
}

/** Every copy of a message failed to reach a relay. */
export class DmUndeliverableError extends Error {
  constructor(public readonly deliveries: GiftWrapDelivery[]) {
    const authRequired = deliveries.some((d) => d.authRequired);
    super(
      authRequired
        ? "No relay would take this message without identifying you as the sender."
        : "No relay accepted this message.",
    );
    this.name = "DmUndeliverableError";
  }
}

export async function sendDirectMessage({
  viewer,
  signer,
  peer,
  content,
  replyTo,
}: SendDmParams): Promise<SendDmResult> {
  const { relays: peerRelays, source } = await resolveDmRelays(peer);
  if (source === "none") throw new NoDmInboxError(peer);

  const stamped = await (
    replyTo
      ? WrappedMessageFactory.reply(replyTo, peer, content)
      : WrappedMessageFactory.create([peer], content)
  )
    .as(signer)
    .stamp();

  // `stamp()` fills in pubkey and created_at but NOT the id — a rumor is an
  // unsigned event and applesauce leaves hashing to whoever needs it. Compute
  // it here, before wrapping, so the id the recipient receives is the id we
  // stored and the id a reply will point at.
  const rumor: Rumor = { ...stamped, id: getEventHash(stamped) };

  // Echo first. The rumor is plaintext in hand, so the sender sees their own
  // message immediately and it survives a reload even if every publish below
  // fails — which is the honest state of affairs: they wrote it.
  const { touched } = await writeDmRumors(viewer, [rumor]);
  if (touched.length > 0)
    emitDmScopes([DM_LIST_SCOPE, ...touched.map(conversationScope)]);

  // Sequentially, not in parallel: NIP-07 extensions reject a second
  // `signEvent` while one is outstanding, and each wrap needs one.
  const peerWrap = await GiftWrapFactory.create(signer, peer, rumor);
  const selfWrap =
    peer === viewer
      ? undefined
      : await GiftWrapFactory.create(signer, viewer, rumor);

  // The peer's copy goes out anonymously. Never on the singleton pool.
  const peerDelivery = await publishGiftWrap(peerWrap, peerRelays);

  // The self-copy goes to our own relays, where authenticating is expected and
  // often required to write at all. It is marked seen so the inbox does not
  // spend two decrypt calls re-reading a message we composed.
  const selfRelays = selfWrap ? await ownDmReadRelays(viewer) : [];
  if (selfWrap && selfRelays.length > 0) {
    await markWrapsSeen(viewer, [
      { id: selfWrap.id, created_at: selfWrap.created_at, opened: true },
    ]);
    // Best effort: losing the self-copy costs this device nothing (the rumor is
    // already stored) and costs another device its history. Worth reporting,
    // not worth failing the send over.
    await publishEventToRelays(selfWrap, selfRelays).catch(() => {});
  }

  if (!peerDelivery.some((d) => d.ok))
    throw new DmUndeliverableError(peerDelivery);

  return { rumor, peer: peerDelivery, self: selfRelays };
}
