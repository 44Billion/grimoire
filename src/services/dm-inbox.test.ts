import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PrivateKeySigner } from "applesauce-signers";
import {
  GiftWrapFactory,
  WrappedMessageFactory,
} from "applesauce-common/factories";
import { finalizeEvent, generateSecretKey, kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import db from "./db";
import { listDmConversations, queryConversation } from "./dm-store";
import {
  DECRYPT_WAVE,
  grantDecryptConsent,
  hasDecryptConsent,
  inboxFilter,
  syncDmInbox,
  unlockWraps,
  WRAP_BACKDATE_SECS,
} from "./dm-inbox";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";

/**
 * Ingest is where the cost of NIP-17 lives: two `nip44.decrypt` calls per
 * message, against a signer that may be a browser prompt or a remote bunker.
 * Every test here is about not paying that twice, or paying it for mail that
 * was never ours.
 */

const alice = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000001",
);
const bob = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000002",
);

let ALICE = "";
let BOB = "";

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

/** A real NIP-17 wrap: rumor from `from`, sealed and wrapped to `to`. */
async function wrapMessage(
  from: PrivateKeySigner,
  to: string,
  content: string,
): Promise<NostrEvent> {
  const rumor = await WrappedMessageFactory.create([to], content)
    .as(from)
    .stamp();
  return GiftWrapFactory.create(from, to, rumor);
}

beforeEach(async () => {
  ALICE = await alice.getPublicKey();
  BOB = await bob.getPublicKey();
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
});

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("the consent gate", () => {
  it("starts closed and stays open once asked", async () => {
    expect(await hasDecryptConsent(ALICE)).toBe(false);
    await grantDecryptConsent(ALICE);
    expect(await hasDecryptConsent(ALICE)).toBe(true);
  });

  it("is per account", async () => {
    await grantDecryptConsent(ALICE);
    expect(await hasDecryptConsent(BOB)).toBe(false);
  });
});

describe("inboxFilter", () => {
  it("backdates `since` past the window a wrap may be randomised into", () => {
    const since = 1_000_000;
    const filter = inboxFilter(ALICE, since);
    // A wrap written now can carry a timestamp two days old. A cursor-exact
    // `since` would filter out nearly every genuinely new message — the classic
    // "DMs only arrive after a full resync" bug.
    expect(filter.since).toBeLessThanOrEqual(since - WRAP_BACKDATE_SECS);
  });

  it("omits `since` entirely when there is no cursor", () => {
    expect(inboxFilter(ALICE)).not.toHaveProperty("since");
  });
});

describe("unlockWraps", () => {
  it("opens a wrap and stores the message inside it", async () => {
    const wrap = await wrapMessage(bob, ALICE, "hello alice");

    const outcome = await unlockWraps(ALICE, alice, [wrap]);

    expect(outcome).toMatchObject({ written: 1, failed: 0 });
    const [conversation] = await listDmConversations(ALICE);
    const rows = await queryConversation(ALICE, conversation.conversationId, {
      limit: 10,
    });
    expect(rows[0].content).toBe("hello alice");
    expect(rows[0].pubkey).toBe(BOB);
  });

  it("never asks the signer twice for the same wrap", async () => {
    const wrap = await wrapMessage(bob, ALICE, "once");
    await unlockWraps(ALICE, alice, [wrap]);

    // The seen memo is what makes a cold reload free. Without it every session
    // re-opens the whole inbox, which on a bunker is a prompt per message.
    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    const outcome = await unlockWraps(ALICE, alice, [wrap]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ written: 0, failed: 0 });
    decrypt.mockRestore();
  });

  it("never asks the signer about a wrap addressed to someone else", async () => {
    const notMine = await wrapMessage(alice, BOB, "for bob");

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    const outcome = await unlockWraps(ALICE, alice, [notMine]);

    expect(decrypt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ written: 0, failed: 0 });
    decrypt.mockRestore();
  });

  it("remembers a wrap that would not open, so it is tried once only", async () => {
    // A p tag is public, so anyone can address a wrap to us that our key cannot
    // open. Each attempt is a signer round trip for a message that does not
    // exist, and there will be another one next session unless it is recorded.
    const garbage = finalizeEvent(
      {
        kind: kinds.GiftWrap,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", ALICE]],
        content: "not ciphertext anyone can read",
      },
      generateSecretKey(),
    );

    const first = await unlockWraps(ALICE, alice, [garbage]);
    expect(first).toMatchObject({ written: 0, failed: 1 });

    const decrypt = vi.spyOn(alice.nip44, "decrypt");
    await unlockWraps(ALICE, alice, [garbage]);
    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRestore();
  });

  it("keeps a rumor about other people out of our store", async () => {
    // Someone can wrap a conversation between two strangers and address the
    // OUTER wrap to us. It opens; it is still not our mail, and it would show
    // up as a conversation we cannot answer.
    const rumor = await WrappedMessageFactory.create([BOB], "between us")
      .as(bob)
      .stamp();
    const misdirected = await GiftWrapFactory.create(bob, ALICE, rumor);

    const outcome = await unlockWraps(ALICE, alice, [misdirected]);

    expect(outcome.written).toBe(0);
    expect(await listDmConversations(ALICE)).toEqual([]);
  });

  it("yields between waves instead of blocking on a whole page", async () => {
    const wraps = await Promise.all(
      Array.from({ length: DECRYPT_WAVE * 2 + 1 }, (_, i) =>
        wrapMessage(bob, ALICE, `m${i}`),
      ),
    );

    let concurrent = 0;
    let peak = 0;
    const decrypt = vi
      .spyOn(alice.nip44, "decrypt")
      .mockImplementation(async (...args) => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        try {
          return await PrivateKeySigner.prototype.nip44.decrypt.apply(
            alice,
            args,
          );
        } finally {
          concurrent -= 1;
        }
      });

    await unlockWraps(ALICE, alice, wraps);

    // Two decrypts per wrap (wrap then seal), but the seal's only starts after
    // its wrap's resolves, so a wave is at most DECRYPT_WAVE in flight.
    expect(peak).toBeLessThanOrEqual(DECRYPT_WAVE);
    decrypt.mockRestore();
  });
});

describe("syncDmInbox", () => {
  it("fetches from the relay and stores what it opens", async () => {
    const wrap = await wrapMessage(bob, ALICE, "over the wire");
    const r = await relay({ kind: "normal", events: [wrap] });

    const result = await syncDmInbox(ALICE, alice, { relays: [r.url] });

    expect(result).toMatchObject({ fetched: 1, written: 1 });
    expect(await listDmConversations(ALICE)).toHaveLength(1);
  });

  it("does nothing when the account has nowhere to read from", async () => {
    const result = await syncDmInbox(ALICE, alice, { relays: [] });
    expect(result).toMatchObject({ fetched: 0, written: 0 });
  });

  it("records how far back it has walked, and only ever further", async () => {
    const wrap = await wrapMessage(bob, ALICE, "old");
    const r = await relay({ kind: "normal", events: [wrap] });

    await syncDmInbox(ALICE, alice, { relays: [r.url] });
    const first = await db.dmKv.get(`${ALICE}:cursor`);

    await syncDmInbox(ALICE, alice, { relays: [r.url] });
    const second = await db.dmKv.get(`${ALICE}:cursor`);

    expect(second?.value).toBe(first?.value);
  });
});
