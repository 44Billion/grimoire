/**
 * The NIP-29 adapter's read-state pair, over the real `chatReads` table and the
 * real EventStore.
 *
 * Thin methods guarding two things that each cost a defect:
 *
 * 1. **One row for two spellings of a relay.** The pane resolves its
 *    conversation through `parseIdentifier`, which does not add a trailing
 *    slash; the sidebar's row came from `new URL().toString()`, which does.
 * 2. **The stamp never passes the newest countable message.** It is also a
 *    `since` on a `kinds:[9]` REQ, so a stamp set from a join event or from a
 *    future-dated one silently empties the window it bounds.
 *
 * Group ids are unique per test: the EventStore singleton has no reset, so
 * sharing one would let a seeded message answer a later case.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Inline rather than a constant: `vi.mock` is hoisted above every declaration in
// the file, so a factory closing over one throws before the suite loads.
vi.mock("@/services/accounts", () => ({
  default: { active$: { value: { pubkey: "aa".repeat(32) } } },
}));

import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import { Nip29Adapter } from "./nip-29-adapter";
import db from "@/services/db";
import eventStore from "@/services/event-store";
import { readGroupLastRead } from "@/services/nip29-reads";
import type { Conversation } from "@/types/chat";

const ME = "aa".repeat(32);
const SK = generateSecretKey();
const RELAY = "wss://relay.example.com";
const now = Math.floor(Date.now() / 1000);

/** What `resolveConversation` builds, with the relay spelled as the pane has it. */
function pane(groupId: string, relayUrl = RELAY): Conversation {
  return {
    id: `nip-29:${relayUrl}'${groupId}`,
    type: "group",
    protocol: "nip-29",
    title: groupId,
    participants: [],
    metadata: { groupId, relayUrl },
    unreadCount: 0,
  } as Conversation;
}

/** Seed the store the way the open pane's subscription would have. */
function seed(kind: number, groupId: string, created_at: number) {
  eventStore.add(
    finalizeEvent(
      { kind, created_at, content: "hi", tags: [["h", groupId]] } as never,
      SK,
    ) as never,
  );
}

beforeEach(async () => {
  await db.chatReads.clear();
});

describe("Nip29Adapter read state", () => {
  const adapter = new Nip29Adapter();

  it("reads 0 for a group nobody has opened", async () => {
    expect(await adapter.getLastRead(pane("unopened"))).toBe(0);
  });

  it("stamps under the same row the sidebar reads", async () => {
    seed(9, "spelling", now - 10);
    // The pane's spelling in, the sidebar's spelling out.
    await adapter.markRead(pane("spelling"), now - 10);
    expect(
      await readGroupLastRead(ME, "wss://relay.example.com/", "spelling"),
    ).toBe(now - 10);
    expect(await db.chatReads.count()).toBe(1);
  });

  it("round-trips through its own getLastRead", async () => {
    seed(9, "roundtrip", now - 10);
    const conversation = pane("roundtrip");
    await adapter.markRead(conversation, now - 10);
    expect(await adapter.getLastRead(conversation)).toBe(now - 10);
  });

  it("refuses a stamp of zero — nothing loaded is not everything read", async () => {
    seed(9, "zero", now - 10);
    const conversation = pane("zero");
    await adapter.markRead(conversation, now - 10);
    await adapter.markRead(conversation, 0);
    expect(await adapter.getLastRead(conversation)).toBe(now - 10);
  });

  it("does nothing for a conversation missing its group or relay", async () => {
    const bare = { ...pane("bare"), metadata: {} } as Conversation;
    await adapter.markRead(bare, now);
    expect(await db.chatReads.count()).toBe(0);
    expect(await adapter.getLastRead(bare)).toBe(0);
  });

  // The regression the reviewer found: `useReadMarker` hands over the newest of
  // EVERYTHING the pane rendered, and this timeline renders 9000/9001/9321
  // beside kind 9.
  it("caps the stamp at the newest kind 9, not the newest rendered event", async () => {
    seed(9, "joined", now - 600);
    seed(9000, "joined", now - 10); // the reader's own join, newest on screen
    const conversation = pane("joined");

    await adapter.markRead(conversation, now - 10);

    // Stamped at the message, not the join — so `since` still returns it and the
    // group keeps its last message and its place in the recency sort.
    expect(await adapter.getLastRead(conversation)).toBe(now - 600);
  });

  it("leaves a group holding only a join event unstamped", async () => {
    seed(9000, "onlyjoin", now - 10);
    const conversation = pane("onlyjoin");
    await adapter.markRead(conversation, now - 10);
    // Nothing countable, so nothing to mark: a stamp here would bound the REQ
    // above every message posted next.
    expect(await adapter.getLastRead(conversation)).toBe(0);
  });

  it("never stamps a future-dated message", async () => {
    seed(9, "future", now - 600);
    seed(9, "future", now + 86_400);
    const conversation = pane("future");

    await adapter.markRead(conversation, now + 86_400);

    // The future message badges until the clock reaches it; the stamp stays on
    // the newest one that has actually happened.
    expect(await adapter.getLastRead(conversation)).toBe(now - 600);
  });
});
