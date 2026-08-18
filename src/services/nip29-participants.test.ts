/**
 * The AV roster over a real socket.
 *
 * The pure fold is tested in `src/lib/nip29/livekit.test.ts`; what needs a wire
 * is everything this module adds around it — that one REQ covers a whole set of
 * groups, that a late watcher sees the room immediately, that an event for a
 * group nobody asked about is ignored, and that an older republish never
 * overwrites a newer one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools";

import {
  _clearGroupParticipantsForTests,
  groupParticipantsOf,
  watchGroupParticipants,
} from "@/services/nip29-participants";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

const relaySk = generateSecretKey();
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

/**
 * A relay-signed `kind:39004` for one group.
 *
 * Every test names its own groups. Two tests publishing the same members to the
 * same id within the same second build a byte-identical event — same id — and
 * the pool dedupes ids for the whole session, so the second never arrives.
 */
function roster(
  groupId: string,
  participants: string[],
  createdAt = Math.floor(Date.now() / 1000),
): NostrEvent {
  return finalizeEvent(
    {
      kind: 39004,
      content: "",
      created_at: createdAt,
      tags: [["d", groupId], ...participants.map((p) => ["participant", p])],
    },
    relaySk,
  );
}

/** Wait until `check` holds, or fail — a roster has no completion signal. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting for the roster");
}

/** An event pushed before the relay registered the REQ is lost outright. */
async function live(seen = 1): Promise<void> {
  await until(() => relay.reqCount() >= seen);
  await new Promise((r) => setTimeout(r, 50));
}

let relay: MockRelay;

beforeEach(async () => {
  // The remembered rosters are module-level and outlive a test, exactly as they
  // outlive a component — so each test starts from nothing known.
  _clearGroupParticipantsForTests();
  relay = await startMockRelay({ kind: "normal" });
});

afterEach(async () => {
  await relay.close();
});

describe("watchGroupParticipants", () => {
  it("reports who a relay says is in a group's room", async () => {
    const seen: string[][] = [];
    const stop = watchGroupParticipants(relay.url, ["pizza"], (_id, list) =>
      seen.push(list),
    );
    await live();

    relay.push(roster("pizza", [ALICE, BOB]));
    await until(() => seen.length > 0);

    expect(seen[seen.length - 1]).toEqual([ALICE, BOB]);
    stop();
  });

  // One filter for the whole set: a sidebar of twenty groups on one relay is
  // one REQ, not twenty.
  it("covers a whole set of groups with a single REQ", async () => {
    const seen = new Map<string, string[]>();
    const stop = watchGroupParticipants(
      relay.url,
      ["margherita", "pasta"],
      (id, list) => seen.set(id, list),
    );
    await live();

    relay.push(roster("margherita", [ALICE]));
    relay.push(roster("pasta", [BOB]));
    await until(() => seen.size === 2);

    expect(seen.get("margherita")).toEqual([ALICE]);
    expect(seen.get("pasta")).toEqual([BOB]);
    expect(relay.reqCount()).toBe(1);
    stop();
  });

  // The relay is free to answer with more than was asked for; a roster for a
  // group this watcher does not care about is not its business.
  it("ignores a group it did not ask for", async () => {
    const seen: string[] = [];
    const stop = watchGroupParticipants(relay.url, ["calzone"], (id) =>
      seen.push(id),
    );
    await live();

    relay.push(roster("gnocchi", [ALICE]));
    relay.push(roster("calzone", [BOB]));
    await until(() => seen.length > 0);

    expect(seen).toEqual(["calzone"]);
    stop();
  });

  // The call window mounts over a sidebar that has been subscribed since the
  // app started. Waiting for the relay to republish could mean waiting forever.
  it("hands a late watcher what is already known, before any frame", async () => {
    const stop = watchGroupParticipants(relay.url, ["focaccia"], () => {});
    await live();
    relay.push(roster("focaccia", [ALICE]));
    await until(() => groupParticipantsOf(relay.url, "focaccia").length === 1);

    const immediate: string[][] = [];
    const stopLate = watchGroupParticipants(
      relay.url,
      ["focaccia"],
      (_id, list) => immediate.push(list),
    );
    expect(immediate[0]).toEqual([ALICE]);

    stop();
    stopLate();
  });

  // Several relay copies of one addressable event arrive in no particular
  // order. The group id is this test's own: an identical event pushed in an
  // earlier test has an identical id, and the pool dedupes ids for the session.
  it("never lets an older republish overwrite a newer one", async () => {
    const now = Math.floor(Date.now() / 1000);
    const stop = watchGroupParticipants(relay.url, ["risotto"], () => {});
    await live();

    relay.push(roster("risotto", [ALICE, BOB], now));
    await until(() => groupParticipantsOf(relay.url, "risotto").length === 2);
    relay.push(roster("risotto", [ALICE], now - 60));
    await new Promise((r) => setTimeout(r, 100));

    expect(groupParticipantsOf(relay.url, "risotto")).toEqual([ALICE, BOB]);
    stop();
  });

  // The relay is normalized into the key and the group id is not: `#d` is
  // case-sensitive and relay-assigned.
  it("keys on the normalized relay and the verbatim group id", async () => {
    const stop = watchGroupParticipants(relay.url, ["Pizza"], () => {});
    await live();
    relay.push(roster("Pizza", [ALICE]));
    await until(() => groupParticipantsOf(relay.url, "Pizza").length === 1);

    expect(groupParticipantsOf(`${relay.url}/`, "Pizza")).toEqual([ALICE]);
    expect(groupParticipantsOf(relay.url, "pizza")).toEqual([]);
    stop();
  });

  it("costs nothing when there is nothing to watch", () => {
    const stop = watchGroupParticipants(relay.url, [], () => {});
    stop();
    expect(relay.reqCount()).toBe(0);
  });
});
