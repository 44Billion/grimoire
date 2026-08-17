/**
 * How far into a conversation this account has read.
 *
 * The `chatReads` table is protocol-generic by design (see
 * `docs/chat-system.md`), so this is the NIP-17 half of it: same shape as
 * Concord's, keyed `protocol: "nip-17"` with a constant container, because a
 * DM has no container above the conversation itself.
 *
 * Never published. No NIP defines a read marker, and one that was published
 * would tell a relay when you read your mail.
 */

import db from "./db";
import type { ChatReadRow } from "./db";
import { DM_LIST_SCOPE, emitDmScopes } from "./dm-bus";

/** A DM has no container above the conversation, so the slot is a constant. */
const CONTAINER = "dm";

/**
 * How far a message's timestamp may run ahead of us and still be counted.
 *
 * Both the scan and the stamp stop here. Clamping one and not the other either
 * pins a badge forever or marks a conversation read for years — the rule
 * `docs/chat-system.md` spells out.
 */
export const DM_READ_MAX_FUTURE_SECS = 3600;

const key = (pubkey: string, conversationId: string) =>
  [pubkey, "nip-17", CONTAINER, conversationId] as const;

/** Unix seconds. 0 means never read, which is not the same as all read. */
export async function readDmLastRead(
  pubkey: string,
  conversationId: string,
): Promise<number> {
  if (!pubkey || !conversationId) return 0;
  try {
    const row = await db.chatReads.get(key(pubkey, conversationId));
    return row?.lastRead ?? 0;
  } catch (error) {
    console.warn("[dm] could not read the last-read stamp:", error);
    return 0;
  }
}

/** Monotonic: a conversation never moves backwards. */
export async function markDmRead(
  pubkey: string,
  conversationId: string,
  timestampSecs: number,
): Promise<void> {
  if (!pubkey || !conversationId) return;
  if (!Number.isFinite(timestampSecs) || timestampSecs <= 0) return;
  const clamped = Math.min(
    timestampSecs,
    Math.floor(Date.now() / 1000) + DM_READ_MAX_FUTURE_SECS,
  );
  const id = key(pubkey, conversationId);
  try {
    let moved = false;
    await db.transaction("rw", db.chatReads, async () => {
      const existing = await db.chatReads.get(id);
      if (existing && existing.lastRead >= clamped) return;
      const row: ChatReadRow = {
        pubkey: id[0],
        protocol: id[1],
        containerId: id[2],
        channelId: id[3],
        lastRead: clamped,
        updatedAt: Date.now(),
      };
      await db.chatReads.put(row);
      moved = true;
    });

    // The badge is computed against this stamp, so moving it silently leaves
    // the sidebar showing unread messages the reader is looking at. Only on an
    // actual move — the stamp is written on every emission of the timeline,
    // and ringing for a no-op would re-read the whole list per message.
    if (moved) emitDmScopes([DM_LIST_SCOPE]);
  } catch (error) {
    console.warn("[dm] could not stamp the conversation as read:", error);
  }
}

/**
 * Stamp a whole list of conversations read, in one write and one doorbell.
 *
 * Not a loop over {@link markDmRead}: that rings the bus on every move, so
 * clearing thirty conversations would re-read the whole list thirty times and
 * repaint the sidebar under the cursor.
 *
 * Each conversation is stamped at ITS OWN newest message rather than at "now".
 * A stamp is a position in a conversation, not a moment in time — stamping the
 * clock would also swallow a message that arrives a second later with an older
 * `created_at`, which for gift wraps is routine.
 */
export async function markAllDmsRead(
  pubkey: string,
  conversations: Array<{ conversationId: string; lastAt: number }>,
): Promise<void> {
  if (!pubkey || conversations.length === 0) return;
  const ceiling = Math.floor(Date.now() / 1000) + DM_READ_MAX_FUTURE_SECS;
  try {
    let moved = false;
    await db.transaction("rw", db.chatReads, async () => {
      for (const { conversationId, lastAt } of conversations) {
        if (!conversationId) continue;
        if (!Number.isFinite(lastAt) || lastAt <= 0) continue;
        const clamped = Math.min(lastAt, ceiling);
        const id = key(pubkey, conversationId);
        const existing = await db.chatReads.get(id);
        if (existing && existing.lastRead >= clamped) continue;
        await db.chatReads.put({
          pubkey: id[0],
          protocol: id[1],
          containerId: id[2],
          channelId: id[3],
          lastRead: clamped,
          updatedAt: Date.now(),
        });
        moved = true;
      }
    });
    if (moved) emitDmScopes([DM_LIST_SCOPE]);
  } catch (error) {
    console.warn("[dm] could not stamp the conversations as read:", error);
  }
}

/** Forget every DM stamp this account holds. Called on logout. */
export async function clearDmReads(pubkey: string): Promise<void> {
  try {
    await db.chatReads
      .filter((row) => row.pubkey === pubkey && row.protocol === "nip-17")
      .delete();
  } catch (error) {
    console.warn("[dm] could not clear read stamps:", error);
  }
}
