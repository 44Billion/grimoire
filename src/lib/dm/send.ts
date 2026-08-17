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

/**
 * Store a rumor locally, then wrap and publish a copy to each side.
 *
 * Everything a DM can be — a message, a file, a reaction, a delete — is a rumor
 * in a gift wrap, so this is the one delivery path and each caller only decides
 * what rumor to build.
 */
async function deliverRumor(
  viewer: string,
  signer: EventSigner,
  peer: string,
  stamped: Omit<Rumor, "id">,
  peerRelays: string[],
): Promise<SendDmResult> {
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

  return deliverRumor(
    viewer,
    signer,
    peer,
    withRecipients(stamped, [peer]),
    peerRelays,
  );
}

/**
 * Force a rumor's `p` tags to exactly the conversation's participants.
 *
 * `WrappedMessageFactory` runs the ordinary short-text content pipeline, which
 * turns a bare `npub1…` in the body into a `nostr:` mention AND adds a `p` tag
 * for it. In a public note that is correct. In a NIP-17 message the `p` tags
 * ARE the recipient list and the conversation's identity, so mentioning someone
 * silently rewrote which conversation the message belonged to: the local echo
 * vanished from the thread, the peer's copy filed the same way on their side,
 * and a phantom three-way conversation appeared in the sidebar.
 *
 * The mention survives in the body as a `nostr:` reference, which is what a
 * mention should have been in the first place.
 */
function withRecipients<T extends { tags: string[][] }>(
  rumor: T,
  recipients: string[],
): T {
  return {
    ...rumor,
    tags: [
      ...recipients.map((pubkey) => ["p", pubkey]),
      ...rumor.tags.filter((tag) => tag[0] !== "p"),
    ],
  };
}

export interface SendDmReactionParams {
  viewer: string;
  signer: EventSigner;
  peer: string;
  /** The rumor id being reacted to. */
  targetId: string;
  /** Unicode emoji, or `:shortcode:` when `customEmoji` is given. */
  emoji: string;
  /** NIP-30 custom emoji: the bare shortcode and its image URL. */
  customEmoji?: { shortcode: string; url: string };
}

/**
 * React to a private message.
 *
 * A kind-7 rumor in a gift wrap, delivered exactly like a kind-14 — the
 * reaction is as private as the message it is about, which is the only way it
 * could be. A public kind 7 pointing at a rumor id would announce both that the
 * conversation happened and how someone felt about it.
 */
export async function sendDirectReaction({
  viewer,
  signer,
  peer,
  targetId,
  emoji,
  customEmoji,
}: SendDmReactionParams): Promise<SendDmResult> {
  const { relays: peerRelays, source } = await resolveDmRelays(peer);
  if (source === "none") throw new NoDmInboxError(peer);

  // Built by hand rather than through a factory: applesauce's reaction
  // blueprint targets a signed event, and the thing being reacted to here is an
  // unsigned rumor that exists on no relay.
  const stamped = {
    kind: 7,
    pubkey: await signer.getPublicKey(),
    created_at: Math.floor(Date.now() / 1000),
    content: customEmoji ? `:${customEmoji.shortcode}:` : emoji,
    tags: [
      ["e", targetId],
      // The p tag is what files this rumor into the right conversation on the
      // recipient's side — without it the store cannot tell whose it is.
      ["p", peer],
      ...(customEmoji
        ? [["emoji", customEmoji.shortcode, customEmoji.url]]
        : []),
    ],
  };

  return deliverRumor(viewer, signer, peer, stamped, peerRelays);
}
