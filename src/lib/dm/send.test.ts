import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrivateKeySigner } from "applesauce-signers";
import type { NostrEvent } from "nostr-tools";
import db from "@/services/db";
import { listDmConversations, queryConversation } from "@/services/dm-store";

/**
 * Sending is where the anonymity guarantee is either kept or thrown away. The
 * peer's copy must leave over the unauthenticated pool and the self-copy must
 * not, and the only way to be sure of that is to watch which function each one
 * was handed to.
 */

import type { DmRelayResolution } from "./relays";

const resolveDmRelays = vi.fn(async (): Promise<DmRelayResolution> => ({
  relays: ["wss://peer-inbox.example.com/"],
  source: "dm-relays",
}));
const ownDmReadRelays = vi.fn(async () => ["wss://my-inbox.example.com/"]);
vi.mock("./relays", () => ({ resolveDmRelays, ownDmReadRelays }));

const publishGiftWrap = vi.fn(async (_wrap: NostrEvent, relays: string[]) =>
  relays.map((relay) => ({ relay, ok: true, authRequired: false })),
);
vi.mock("./publish", () => ({ publishGiftWrap }));

const publishEventToRelays = vi.fn(async () => {});
vi.mock("@/services/hub", () => ({ publishEventToRelays }));

const alice = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000001",
);
const bob = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000002",
);

let ALICE = "";
let BOB = "";

beforeEach(async () => {
  ALICE = await alice.getPublicKey();
  BOB = await bob.getPublicKey();
  vi.clearAllMocks();
  resolveDmRelays.mockResolvedValue({
    relays: ["wss://peer-inbox.example.com/"],
    source: "dm-relays",
  });
  publishGiftWrap.mockImplementation(async (_wrap, relays) =>
    relays.map((relay) => ({ relay, ok: true, authRequired: false })),
  );
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
});

async function send(content = "hi bob") {
  const { sendDirectMessage } = await import("./send");
  return sendDirectMessage({
    viewer: ALICE,
    signer: alice,
    peer: BOB,
    content,
  });
}

describe("sendDirectMessage", () => {
  it("routes the peer's copy to the anonymous publisher and ours to the hub", async () => {
    await send();

    expect(publishGiftWrap).toHaveBeenCalledTimes(1);
    const [peerWrap, peerRelays] = publishGiftWrap.mock.calls[0];
    expect(peerWrap.tags).toContainEqual(["p", BOB]);
    expect(peerRelays).toEqual(["wss://peer-inbox.example.com/"]);

    expect(publishEventToRelays).toHaveBeenCalledTimes(1);
    const [selfWrap, selfRelays] = publishEventToRelays.mock
      .calls[0] as unknown as [NostrEvent, string[]];
    expect(selfWrap.tags).toContainEqual(["p", ALICE]);
    expect(selfRelays).toEqual(["wss://my-inbox.example.com/"]);
  });

  it("wraps each copy under a different throwaway key", async () => {
    await send();

    const peerWrap = publishGiftWrap.mock.calls[0][0];
    const [selfWrap] = publishEventToRelays.mock.calls[0] as unknown as [
      NostrEvent,
    ];
    // Sharing one ephemeral key across both copies would let the recipient's
    // relay and ours link the two, which is most of what the wrap hides.
    expect(peerWrap.pubkey).not.toBe(selfWrap.pubkey);
  });

  it("shows the message locally before any relay has taken it", async () => {
    // The rumor is plaintext in hand, so echo costs nothing and does not depend
    // on the send succeeding — the sender did write it.
    publishGiftWrap.mockImplementation(async (_wrap, relays) =>
      relays.map((relay) => ({
        relay,
        ok: false,
        authRequired: false,
        error: "down",
      })),
    );

    await expect(send("into the void")).rejects.toThrow(/No relay accepted/);

    const [conversation] = await listDmConversations(ALICE);
    const rows = await queryConversation(ALICE, conversation.conversationId, {
      limit: 10,
    });
    expect(rows[0].content).toBe("into the void");
  });

  it("says so when the relay would only take it from an identified sender", async () => {
    publishGiftWrap.mockImplementation(async (_wrap, relays) =>
      relays.map((relay) => ({ relay, ok: false, authRequired: true })),
    );

    await expect(send()).rejects.toThrow(/identifying you as the sender/);
  });

  it("refuses to send to someone with nowhere to receive it", async () => {
    // Better than spraying private mail across relays the recipient never
    // nominated on the hope that they read them.
    resolveDmRelays.mockResolvedValue({ relays: [], source: "none" });

    await expect(send()).rejects.toThrow(/has not published anywhere/);
    expect(publishGiftWrap).not.toHaveBeenCalled();
  });

  it("marks its own self-copy seen, so it is never decrypted on the way back", async () => {
    await send();

    const [selfWrap] = publishEventToRelays.mock.calls[0] as unknown as [
      NostrEvent,
    ];
    expect(await db.dmSeenWraps.get([ALICE, selfWrap.id])).toMatchObject({
      opened: true,
    });
  });

  it("does not build a self-copy of a note to oneself", async () => {
    const { sendDirectMessage } = await import("./send");
    await sendDirectMessage({
      viewer: ALICE,
      signer: alice,
      peer: ALICE,
      content: "reminder",
    });

    expect(publishEventToRelays).not.toHaveBeenCalled();
    expect(publishGiftWrap).toHaveBeenCalledTimes(1);
  });
});
