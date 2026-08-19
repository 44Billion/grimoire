/**
 * Handles for zapping a message in a sealed conversation.
 *
 * A private zap names the message it pays for, and in a sealed protocol that
 * name is a RUMOR id — an id that exists on no relay, whose whole point is that
 * nobody outside the channel learns the message happened. Window props cannot
 * hold it: `createSpellbook` copies whole window instances into the kind-30777
 * event it publishes (`spellbook-manager.ts`), so a shared spellbook would carry
 * that id to every relay it reaches.
 *
 * So the window gets a handle instead, and this module keeps what it stands for
 * in memory. A published spellbook carries an opaque string that resolves to
 * nothing; a window restored after a reload finds nothing either, and says so.
 * That is the correct behaviour for a payment surface anyway — an invoice from
 * a previous session is not one anybody should be re-offered.
 */

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";

/** What a handle stands for: everything sealing the zap needs. */
export interface ZapTarget {
  conversation: Conversation;
  adapter: ChatProtocolAdapter;
  /** The rumor id being zapped. Never leaves this module. */
  messageId: string;
  /** The message's author — who receives the sats. */
  recipientPubkey: string;
}

/**
 * How many targets stay claimable at once. A bound rather than a policy: each
 * entry is one message a reader chose to zap, and only the most recent handful
 * can still have a window open on them.
 */
const CAP = 16;

const targets = new Map<string, ZapTarget>();

/** Register a target and return the handle a window can carry. */
export function claimZapTarget(target: ZapTarget): string {
  if (targets.size >= CAP) {
    targets.delete(targets.keys().next().value as string);
  }
  const handle = crypto.randomUUID();
  targets.set(handle, target);
  return handle;
}

/**
 * What a handle stands for, or undefined once it no longer stands for anything
 * — a reload, a restored spellbook, or an eviction.
 */
export function readZapTarget(
  handle: string | undefined,
): ZapTarget | undefined {
  return handle ? targets.get(handle) : undefined;
}

/** Drop a handle. Called when its window is done with it. */
export function releaseZapTarget(handle: string | undefined): void {
  if (handle) targets.delete(handle);
}

/** Test seam: forget every claimed target. */
export function _resetZapTargetsForTests(): void {
  targets.clear();
}
