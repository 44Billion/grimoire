import { describe, it, expect, beforeEach, vi } from "vitest";

import db from "./db";
import {
  clearGroupReads,
  groupReadKey,
  markAllGroupsRead,
  markGroupRead,
  readAllGroupLastReads,
  readGroupLastRead,
  readRelayLastReads,
} from "./nip29-reads";
import { clearReads } from "./concord-reads";

const ME = "a".repeat(64);
const THEM = "b".repeat(64);
const RELAY = "wss://relay.example.com/";
const GROUP = "bitcoin";

beforeEach(async () => {
  await db.chatReads.clear();
});

describe("markGroupRead", () => {
  it("stamps and reads back", async () => {
    await markGroupRead(ME, RELAY, GROUP, 1000);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(1000);
  });

  it("never moves a group backwards", async () => {
    await markGroupRead(ME, RELAY, GROUP, 5000);
    await markGroupRead(ME, RELAY, GROUP, 1000);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(5000);
  });

  it("never stamps into the future, because the stamp is also a REQ bound", async () => {
    // An hour-ahead stamp would put `since` an hour ahead: every message
    // genuinely sent in that hour falls below it, unrequested and unread. So
    // unlike Concord and NIP-17 the clamp here is `now`, not `now + ceiling`.
    const nowSecs = Math.floor(Date.now() / 1000);
    await markGroupRead(ME, RELAY, GROUP, nowSecs + 86_400);
    const stamped = await readGroupLastRead(ME, RELAY, GROUP);
    expect(stamped).toBeGreaterThan(0);
    expect(stamped).toBeLessThanOrEqual(nowSecs + 1);
  });

  it("ignores a stamp of zero — nothing loaded is not everything read", async () => {
    await markGroupRead(ME, RELAY, GROUP, 5000);
    await markGroupRead(ME, RELAY, GROUP, 0);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(5000);
  });

  it("keeps two readers apart", async () => {
    await markGroupRead(ME, RELAY, GROUP, 1000);
    expect(await readGroupLastRead(THEM, RELAY, GROUP)).toBe(0);
  });
});

describe("markAllGroupsRead", () => {
  it("stamps each group at ITS OWN newest message, not at the clock", async () => {
    // A stamp is a position in a group, not a moment in time. Stamping `now`
    // would also swallow a message arriving a second later with an older
    // `created_at` — routine when members' clocks disagree.
    await markAllGroupsRead(ME, [
      { relayUrl: RELAY, groupId: "one", latest: 1000 },
      { relayUrl: RELAY, groupId: "two", latest: 2000 },
    ]);
    expect(await readGroupLastRead(ME, RELAY, "one")).toBe(1000);
    expect(await readGroupLastRead(ME, RELAY, "two")).toBe(2000);
  });

  it("never moves a group backwards", async () => {
    await markGroupRead(ME, RELAY, GROUP, 5000);
    await markAllGroupsRead(ME, [
      { relayUrl: RELAY, groupId: GROUP, latest: 1000 },
    ]);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(5000);
  });

  it("leaves alone a group with nothing stampable", async () => {
    // What a group whose every counted message is still ahead of the clock
    // produces. Stamping it would swallow whatever arrives next below it.
    await markAllGroupsRead(ME, [
      { relayUrl: RELAY, groupId: GROUP, latest: 0 },
    ]);
    expect(await db.chatReads.count()).toBe(0);
  });

  it("does not stamp into the future, group by group", async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    await markAllGroupsRead(ME, [
      { relayUrl: RELAY, groupId: GROUP, latest: nowSecs + 86_400 },
    ]);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBeLessThanOrEqual(
      nowSecs + 1,
    );
  });

  it("normalizes each relay, so one clear reaches rows the pane wrote", async () => {
    await markGroupRead(ME, "wss://Relay.example.com", GROUP, 1000);
    await markAllGroupsRead(ME, [
      { relayUrl: "relay.example.com", groupId: GROUP, latest: 2000 },
    ]);
    expect(await db.chatReads.count()).toBe(1);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(2000);
  });

  it("writes once, so the sidebar repaints once", async () => {
    // Dexie fires observers per transaction, and `useNip29Unread` watches this
    // table: a loop over `markGroupRead` would repaint per group.
    const transaction = vi.spyOn(db, "transaction");
    // No try/finally: `markAllGroupsRead` swallows its own failures, so there is
    // no throw for one to catch.
    await markAllGroupsRead(ME, [
      { relayUrl: RELAY, groupId: "one", latest: 1000 },
      { relayUrl: RELAY, groupId: "two", latest: 2000 },
      { relayUrl: RELAY, groupId: "three", latest: 3000 },
    ]);
    // Read before restoring: `mockRestore` drops the call history with it.
    const opened = transaction.mock.calls.length;
    transaction.mockRestore();

    expect(await db.chatReads.count()).toBe(3);
    expect(opened).toBe(1);
  });

  it("ignores an empty list and an absent reader", async () => {
    await markAllGroupsRead(ME, []);
    await markAllGroupsRead("", [
      { relayUrl: RELAY, groupId: GROUP, latest: 1000 },
    ]);
    expect(await db.chatReads.count()).toBe(0);
  });
});

describe("relay canonicalization", () => {
  // The badge that never clears. The sidebar builds its URL with
  // `new URL().toString()` (trailing slash); the adapter's `parseIdentifier`
  // only prefixes `wss://`. Both must land on one row.
  it("reads back a stamp written under a differently spelled relay", async () => {
    await markGroupRead(ME, "wss://Relay.example.com", GROUP, 1000);
    expect(await readGroupLastRead(ME, "wss://relay.example.com/", GROUP)).toBe(
      1000,
    );
    expect(await db.chatReads.count()).toBe(1);
  });

  it("normalizes a bare host too", async () => {
    await markGroupRead(ME, "relay.example.com", GROUP, 1000);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(1000);
  });

  it("gives the join the SAME key the rows are stored under", async () => {
    await markGroupRead(ME, "wss://Relay.example.com", GROUP, 1000);
    const stamps = await readAllGroupLastReads(ME);
    // The sidebar's raw spelling, through the shared normalizer.
    const key = groupReadKey("wss://relay.example.com/", GROUP);
    expect(key).toBeDefined();
    expect(stamps.get(key!)).toBe(1000);
  });

  it("yields no row for a relay URL that cannot be normalized", async () => {
    await markGroupRead(ME, "   ", GROUP, 1000);
    expect(await db.chatReads.count()).toBe(0);
    expect(groupReadKey("   ", GROUP)).toBeUndefined();
  });

  it("keeps two case-different group ids on one relay apart", async () => {
    // A group id is relay-assigned and `#h` is case-sensitive: these are two
    // rooms, and folding their stamps would clear the wrong one.
    await markGroupRead(ME, RELAY, "Bitcoin", 1000);
    await markGroupRead(ME, RELAY, "bitcoin", 2000);
    expect(await readGroupLastRead(ME, RELAY, "Bitcoin")).toBe(1000);
    expect(await readGroupLastRead(ME, RELAY, "bitcoin")).toBe(2000);
  });

  it("keeps the same group id on two relays apart", async () => {
    await markGroupRead(ME, "wss://one.example.com", GROUP, 1000);
    await markGroupRead(ME, "wss://two.example.com", GROUP, 2000);
    expect(await readGroupLastRead(ME, "wss://one.example.com", GROUP)).toBe(
      1000,
    );
    expect(await readGroupLastRead(ME, "wss://two.example.com", GROUP)).toBe(
      2000,
    );
  });
});

describe("bulk reads", () => {
  it("returns every stamp on one relay, by group id", async () => {
    await markGroupRead(ME, RELAY, "one", 1000);
    await markGroupRead(ME, RELAY, "two", 2000);
    await markGroupRead(ME, "wss://other.example.com", "three", 3000);
    const stamps = await readRelayLastReads(ME, RELAY);
    expect(stamps.get("one")).toBe(1000);
    expect(stamps.get("two")).toBe(2000);
    expect(stamps.has("three")).toBe(false);
  });

  it("reads only this protocol's rows", async () => {
    await markGroupRead(ME, RELAY, GROUP, 1000);
    await db.chatReads.put({
      pubkey: ME,
      protocol: "nip-17",
      containerId: "dm",
      channelId: "someone",
      lastRead: 9000,
      updatedAt: Date.now(),
    });
    expect([...(await readAllGroupLastReads(ME)).values()]).toEqual([1000]);
  });
});

describe("the logout wipe", () => {
  it("takes NIP-29 rows with it — it is keyed on the reader, not the protocol", async () => {
    await markGroupRead(ME, RELAY, GROUP, 1000);
    await markGroupRead(THEM, RELAY, GROUP, 1000);
    await clearReads(ME);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(0);
    expect(await readGroupLastRead(THEM, RELAY, GROUP)).toBe(1000);
  });

  it("clears this protocol's rows alone when asked directly", async () => {
    await markGroupRead(ME, RELAY, GROUP, 1000);
    await db.chatReads.put({
      pubkey: ME,
      protocol: "concord",
      containerId: "community",
      channelId: "channel",
      lastRead: 9000,
      updatedAt: Date.now(),
    });
    await clearGroupReads(ME);
    expect(await readGroupLastRead(ME, RELAY, GROUP)).toBe(0);
    expect(await db.chatReads.count()).toBe(1);
  });
});
