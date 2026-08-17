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
    });
  } catch (error) {
    console.warn("[dm] could not stamp the conversation as read:", error);
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
