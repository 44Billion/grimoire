/**
 * Who is in a call, and saying that we are (CORD-07 §4).
 *
 * Presence is announced over the Channel itself — an ephemeral kind-23313 rumor,
 * sealed encrypted, in a 21059 wrap at the Channel's own stream address — so
 * relays and brokers learn nothing about who is talking to whom. It is
 * subscription-only: nothing here is ever written to Dexie or to the rumor
 * store, because a stored heartbeat would outlive the call it described and the
 * plane invariants those stores enforce are all about durable events.
 *
 * The per-channel `author → latest` memory is MODULE-LEVEL and shared. Presence
 * has no history, so a freshly mounted subscriber starts blind and would wait a
 * full 30s heartbeat to learn who is in the room. Inside a call that is not a
 * cosmetic delay: an unverified identity gets a junk media key (§7), so every
 * remote tile would render silent for the opening seconds. Sharing what another
 * subscriber already learned removes the wait entirely.
 */

import type { NostrEvent } from "nostr-tools";

import { openWrap, checkChannelBinding } from "@/lib/concord/stream";
import { buildRumor, sealRumor, wrapSeal } from "@/lib/concord/stream";
import type { StreamSigner } from "@/lib/concord/stream";
import { KIND_SEAL_ENCRYPTED, KIND_VOICE_PRESENCE } from "@/lib/concord/kinds";
import { channelBindingTags } from "@/lib/concord/stream";
import type { Channel } from "@/lib/concord/types";
import {
  EMPTY_VOICE_FOLD,
  foldVoicePresence,
  newerPresence,
  parsePresence,
  parseReaction,
  presenceTags,
  reactionTag,
  VOICE_STALE_MS,
  type VoicePresenceEntry,
  type VoicePresenceFold,
  type VoiceReactionEntry,
} from "@/lib/concord/voice";
import { subscribeEphemeral } from "@/services/concord-ephemeral";
import { publishWrap } from "@/services/concord-publish";

/** How often the fold is recomputed so stale members age out on their own. */
const DECAY_MS = VOICE_STALE_MS / 6;

/**
 * How far ahead of our clock a presence stamp may be. A forged future stamp
 * would otherwise squat "latest" for its author forever, freezing them in the
 * roster; a minute of tolerance covers ordinary clock skew.
 */
const MAX_SKEW_MS = 60_000;

/** How long a reaction floats before it is aged out, and the dedup bound. */
const REACTION_TTL_MS = 4_000;
const REACTION_SEEN_MAX = 512;

interface ChannelPresence {
  /** author → their latest presence, shared across every subscriber. */
  latest: Map<string, VoicePresenceEntry>;
  fold: VoicePresenceFold;
  foldWatchers: Set<(fold: VoicePresenceFold) => void>;
  reactionWatchers: Set<(reaction: VoiceReactionEntry) => void>;
  /** Reaction nonces already fired, so a replay never floats twice. */
  seen: Set<string>;
  subscribers: number;
  release?: () => void;
  decay?: ReturnType<typeof setInterval>;
}

/** Keyed by the channel's CURRENT stream address: the epoch is part of it. */
const channels = new Map<string, ChannelPresence>();

function stateFor(streamPk: string): ChannelPresence {
  let state = channels.get(streamPk);
  if (!state) {
    state = {
      latest: new Map(),
      fold: EMPTY_VOICE_FOLD,
      foldWatchers: new Set(),
      reactionWatchers: new Set(),
      seen: new Set(),
      subscribers: 0,
    };
    channels.set(streamPk, state);
  }
  return state;
}

function sameFold(a: VoicePresenceFold, b: VoicePresenceFold): boolean {
  if (a.present.length !== b.present.length) return false;
  return a.present.every((p, i) => {
    const q = b.present[i];
    return (
      p.author === q.author &&
      p.identity === q.identity &&
      p.broker === q.broker &&
      p.hand === q.hand
    );
  });
}

function recompute(state: ChannelPresence): void {
  const now = Date.now();
  // Prune long-stale entries so the shared map stays bounded by live-ish
  // members. Anything a pruned entry could out-rank is even older, so dropping
  // it can never let an older presence re-assert.
  for (const [author, entry] of state.latest) {
    if (now - entry.ms > VOICE_STALE_MS) state.latest.delete(author);
  }
  const next = foldVoicePresence([...state.latest.values()], now);
  if (sameFold(state.fold, next)) return;
  state.fold = next;
  for (const watcher of [...state.foldWatchers]) watcher(next);
}

/** The presence known for a channel right now, without subscribing. */
export function voicePresenceOf(streamPk: string): VoicePresenceFold {
  return channels.get(streamPk)?.fold ?? EMPTY_VOICE_FOLD;
}

export interface VoiceWatchers {
  onFold?: (fold: VoicePresenceFold) => void;
  onReaction?: (reaction: VoiceReactionEntry) => void;
}

/**
 * Watch one channel's call.
 *
 * Refcounted per channel address: several watchers (a sidebar count, an open
 * call) share one decode pass and one ephemeral subscription. The fold is
 * delivered immediately from the shared memory, then on every change.
 */
export function watchChannelVoice(
  relays: readonly string[],
  channel: Channel,
  watchers: VoiceWatchers,
): () => void {
  const streamPk = channel.current.group.pk;
  const state = stateFor(streamPk);
  if (watchers.onFold) state.foldWatchers.add(watchers.onFold);
  if (watchers.onReaction) state.reactionWatchers.add(watchers.onReaction);
  state.subscribers += 1;

  if (state.subscribers === 1) {
    state.release = subscribeEphemeral(relays, [streamPk], (event) =>
      ingest(state, channel, event),
    );
    state.decay = setInterval(() => recompute(state), DECAY_MS);
  }
  // Re-fold against the clock BEFORE seeding. The kept memory can be older than
  // the staleness window — a community reopened an hour later — and the decay
  // interval's first tick is 15 seconds away, so emitting the stored fold
  // verbatim shows a call that ended long ago, in the sidebar and in the roster
  // both.
  recompute(state);
  // Then publish at once rather than waiting for a live event to reveal what
  // the shared memory already knows.
  watchers.onFold?.(state.fold);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (watchers.onFold) state.foldWatchers.delete(watchers.onFold);
    if (watchers.onReaction) state.reactionWatchers.delete(watchers.onReaction);
    state.subscribers -= 1;
    if (state.subscribers > 0) return;
    state.release?.();
    state.release = undefined;
    clearInterval(state.decay);
    state.decay = undefined;
    // The `latest` map is deliberately KEPT: it is what lets the next
    // subscriber start warm instead of blind for 30 seconds. It is bounded by
    // the staleness prune, and cleared outright on sign-out.
  };
}

function ingest(
  state: ChannelPresence,
  channel: Channel,
  event: NostrEvent,
): void {
  let opened;
  try {
    opened = openWrap(event, channel.current.group);
  } catch {
    return; // not ours, or malformed
  }
  if (opened.kind !== KIND_VOICE_PRESENCE) return;
  try {
    // Same binding every Chat rumor commits: no keyholder can splice one
    // author's presence into a channel or epoch they never claimed.
    checkChannelBinding(opened, channel.idHex, channel.current.epoch);
  } catch {
    return;
  }

  const entry = parsePresence(opened);
  if (!entry) return;
  if (entry.ms > Date.now() + MAX_SKEW_MS) return;

  const prev = state.latest.get(entry.author);
  if (!prev || newerPresence(entry, prev)) {
    state.latest.set(entry.author, entry);
    recompute(state);
  }

  if (state.reactionWatchers.size === 0) return;
  const reaction = parseReaction(opened);
  if (!reaction) return;
  if (state.seen.has(reaction.nonce)) return;
  if (Date.now() - reaction.ms > REACTION_TTL_MS) return;
  state.seen.add(reaction.nonce);
  if (state.seen.size > REACTION_SEEN_MAX) {
    state.seen = new Set([...state.seen].slice(-REACTION_SEEN_MAX / 2));
  }
  for (const watcher of [...state.reactionWatchers]) watcher(reaction);
}

/**
 * Announce our own presence (§4).
 *
 * One signer round-trip per call — the seal — exactly like a chat message. The
 * wrap is ephemeral, so relays broadcast it to whoever is listening and store
 * nothing; a `left` that never lands heals by staleness rather than needing a
 * retry.
 */
export async function publishPresence(opts: {
  relays: string[];
  channel: Channel;
  pubkey: string;
  signer: StreamSigner;
  status: "joined" | "left";
  identity?: string;
  broker?: string;
  hand?: boolean;
  reaction?: { emoji: string; nonce: string };
  /** NIP-30 declarations for any custom emoji the reaction names. */
  emojiTags?: string[][];
}): Promise<void> {
  const { channel } = opts;
  const rumor = buildRumor({
    kind: KIND_VOICE_PRESENCE,
    content: opts.status,
    tags: [
      ...channelBindingTags(channel.idHex, channel.current.epoch),
      ...presenceTags(opts.status, opts.identity, opts.broker, {
        hand: opts.hand ?? false,
      }),
      ...(opts.reaction
        ? [reactionTag(opts.reaction.emoji, opts.reaction.nonce)]
        : []),
      ...(opts.emojiTags ?? []),
    ],
    pubkey: opts.pubkey,
    ms: Date.now(),
  });
  const seal = await sealRumor(
    rumor,
    KIND_SEAL_ENCRYPTED,
    channel.current.group,
    opts.signer,
  );
  const wrap = wrapSeal(seal, channel.current.group, { ephemeral: true });
  await publishWrap(opts.relays, wrap);
}

/**
 * Drop every remembered presence. Called on sign-out: the memory is keyed by
 * derived stream addresses and names the members of private channels.
 */
export function clearVoicePresence(): void {
  for (const [pk, state] of channels) {
    state.release?.();
    clearInterval(state.decay);
    channels.delete(pk);
  }
}
