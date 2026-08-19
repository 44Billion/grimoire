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
  /** Everyone on the other side. One for a 1:1, more for a group. */
  peers: string[];
  content: string;
  /** The rumor being replied to, if any. */
  replyTo?: Rumor;
}

export interface SendDmResult {
  /** The message as stored locally. Its id is the one the timeline shows. */
  rumor: Rumor;
  /** What each recipient's relays did with their copy, by pubkey. */
  peers: Map<string, GiftWrapDelivery[]>;
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

/**
 * Nobody's copy reached a relay.
 *
 * Thrown only when EVERY recipient failed. In a group, one unreachable member
 * is a fact worth surfacing but not a reason to tell the sender their message
 * did not go — it went to everyone else, and it is already in their history.
 */
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
export async function deliverRumor(
  viewer: string,
  signer: EventSigner,
  peerRelays: Map<string, string[]>,
  stamped: Omit<Rumor, "id">,
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

  // One wrap per recipient, each under its own throwaway key — sharing one
  // would let two relays link the copies, which is most of what the wrap
  // hides. Sequentially, not in parallel: NIP-07 extensions reject a second
  // `signEvent` while one is outstanding, and each wrap needs one.
  const peers = new Map<string, GiftWrapDelivery[]>();
  for (const [peer, relays] of peerRelays) {
    if (peer === viewer) continue;
    const wrap = await GiftWrapFactory.create(signer, peer, rumor);
    peers.set(peer, await publishGiftWrap(wrap, relays));
  }

  // The self-copy goes to our own relays, where authenticating is expected and
  // often required to write at all. It is marked seen so the inbox does not
  // spend two decrypt calls re-reading a message we composed.
  const selfWrap = await GiftWrapFactory.create(signer, viewer, rumor);
  const selfRelays = await ownDmReadRelays(viewer);
  if (selfRelays.length > 0) {
    await markWrapsSeen(viewer, [
      { id: selfWrap.id, created_at: selfWrap.created_at, opened: true },
    ]);
    // Best effort: losing the self-copy costs this device nothing (the rumor is
    // already stored) and costs another device its history. Worth reporting,
    // not worth failing the send over.
    await publishEventToRelays(selfWrap, selfRelays).catch(() => {});
  }

  // Only when NOBODY got it. In a group, one unreachable member is worth
  // surfacing but is not a failed send — everyone else has the message.
  const everyDelivery = [...peers.values()].flat();
  if (everyDelivery.length > 0 && !everyDelivery.some((d) => d.ok))
    throw new DmUndeliverableError(everyDelivery);

  return { rumor, peers, self: selfRelays };
}

/**
 * Where each recipient's copy should go.
 *
 * Resolved in parallel and reported per person: in a group, one member with no
 * published inbox must not stop the message reaching the rest.
 */
async function resolvePeerRelays(
  peers: string[],
): Promise<{ reachable: Map<string, string[]>; unreachable: string[] }> {
  const resolved = await Promise.all(
    peers.map(async (peer) => ({ peer, ...(await resolveDmRelays(peer)) })),
  );

  const reachable = new Map<string, string[]>();
  const unreachable: string[] = [];
  for (const { peer, relays, source } of resolved) {
    if (source === "none") unreachable.push(peer);
    else reachable.set(peer, relays);
  }
  return { reachable, unreachable };
}

export async function sendDirectMessage({
  viewer,
  signer,
  peers,
  content,
  replyTo,
}: SendDmParams): Promise<SendDmResult> {
  const others = peers.filter((p) => p !== viewer);

  // A note to yourself: no recipient to resolve, and the self-copy IS the
  // message. Threaded the same way as any other — a reply in Saved messages is
  // still a reply.
  if (others.length === 0) {
    const stamped = withRecipients(
      await WrappedMessageFactory.create([viewer], content).as(signer).stamp(),
      [viewer],
    );
    if (replyTo) stamped.tags.push(["e", replyTo.id]);
    return deliverRumor(viewer, signer, new Map(), stamped);
  }

  const { reachable, unreachable } = await resolvePeerRelays(others);
  // Only when NOBODY can be written to. In a group, a member with no published
  // inbox is a fact to surface, not a reason to refuse the whole message.
  if (reachable.size === 0) throw new NoDmInboxError(unreachable[0]);

  // NOT `WrappedMessageFactory.reply`. It p-tags exactly ONE recipient, so a
  // reply in a group would carry a different participant set than the messages
  // around it — a different conversation, by the only definition NIP-17 has.
  // And it throws outright on a kind-15 parent, so replying to a file message
  // fails rather than sends. `withRecipients` fixes the first; the `e` tag is
  // added here rather than through `.replyTo()` for the second.
  const stamped = withRecipients(
    await WrappedMessageFactory.create(others, content).as(signer).stamp(),
    others,
  );
  if (replyTo) stamped.tags.push(["e", replyTo.id]);

  // Every participant, including the unreachable ones: the p tags are the
  // conversation's identity, so dropping someone would file the message under
  // a different conversation than the one the sender is looking at.
  return deliverRumor(viewer, signer, reachable, stamped);
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
  /** Everyone in the conversation the reaction belongs to. */
  peers: string[];
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
  peers,
  targetId,
  emoji,
  customEmoji,
}: SendDmReactionParams): Promise<SendDmResult> {
  const others = peers.filter((p) => p !== viewer);
  const { reachable } = await resolvePeerRelays(others);
  if (others.length > 0 && reachable.size === 0)
    throw new NoDmInboxError(others[0]);

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
      // The p tags are what file this rumor into the right conversation on
      // each recipient's side — without them the store cannot tell whose it is.
      ...others.map((peer) => ["p", peer]),
      ...(customEmoji
        ? [["emoji", customEmoji.shortcode, customEmoji.url]]
        : []),
    ],
  };

  return deliverRumor(viewer, signer, reachable, stamped);
}
