import { describe, it, expect, beforeEach, vi } from "vitest";
import { nip19 } from "nostr-tools";
import { PrivateKeySigner } from "applesauce-signers";
import {
  GiftWrapFactory,
  WrappedMessageFactory,
} from "applesauce-common/factories";
import db from "@/services/db";
import { sendDirectReaction } from "@/lib/dm/send";
import { Nip17Adapter } from "./nip-17-adapter";
import type { Conversation } from "@/types/chat";

/**
 * The adapter is the seam where private mail meets a protocol-agnostic UI, and
 * the ways it can leak are all about that seam: a REQ naming a private id, a
 * relay list in a header, a reaction sent in the clear.
 */

const alice = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000001",
);
const bob = PrivateKeySigner.fromKey(
  "0000000000000000000000000000000000000000000000000000000000000002",
);

let ALICE = "";
let BOB = "";

// `vi.mock` factories are hoisted above every declaration in this file, so
// anything they close over has to live in `vi.hoisted`.
const mocks = vi.hoisted(() => ({
  account: undefined as { pubkey: string; signer: unknown } | undefined,
  publishGiftWrap: vi.fn(),
}));

vi.mock("@/services/accounts", () => ({
  default: {
    get active() {
      return mocks.account;
    },
  },
}));
vi.mock("@/lib/dm/publish", () => ({
  publishGiftWrap: mocks.publishGiftWrap,
}));
vi.mock("@/lib/dm/relays", () => ({
  warmDmRelays: () => ({ unsubscribe() {} }),
  resolveDmRelays: async () => ({
    relays: ["wss://peer.example.com/"],
    source: "dm-relays" as const,
  }),
  ownDmReadRelays: async () => ["wss://mine.example.com/"],
}));

/**
 * A DM's message ids are private, so the tests below assert on what the UI is
 * ALLOWED to do with them as much as on what it shows.
 */
vi.mock("@/services/hub", () => ({ publishEventToRelays: async () => {} }));
vi.mock("@/services/dm-inbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/dm-inbox")>()),
  // The adapter syncs on open; the tests seed the store directly instead of
  // standing up relays for it.
  syncDmInbox: async () => ({ written: 0, failed: 0, fetched: 0 }),
}));

const publishGiftWrap = mocks.publishGiftWrap;

beforeEach(async () => {
  ALICE = await alice.getPublicKey();
  BOB = await bob.getPublicKey();
  mocks.account = { pubkey: ALICE, signer: alice };
  vi.clearAllMocks();
  publishGiftWrap.mockImplementation(async (_wrap, relays: string[]) =>
    relays.map((relay) => ({ relay, ok: true, authRequired: false })),
  );
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
  await db.chatReads.clear();
});

/** Put a real message from bob into alice's store and return the adapter. */
async function seed(content = "hello") {
  const rumor = await WrappedMessageFactory.create([ALICE], content)
    .as(bob)
    .stamp();
  const wrap = await GiftWrapFactory.create(bob, ALICE, rumor);
  const { unlockWraps: real } = await vi.importActual<
    typeof import("@/services/dm-inbox")
  >("@/services/dm-inbox");
  await real(ALICE, alice, [wrap]);
}

async function conversation(adapter: Nip17Adapter): Promise<Conversation> {
  return adapter.resolveConversation({ type: "chat-partner", value: BOB });
}

describe("parseIdentifier", () => {
  const adapter = new Nip17Adapter();

  it("claims npub and nprofile", () => {
    const npub = nip19.npubEncode("b".repeat(64));
    expect(adapter.parseIdentifier(npub)).toEqual({
      type: "chat-partner",
      value: "b".repeat(64),
    });
    const nprofile = nip19.nprofileEncode({
      pubkey: "b".repeat(64),
      relays: ["wss://hint.example.com"],
    });
    expect(adapter.parseIdentifier(nprofile)).toMatchObject({
      value: "b".repeat(64),
      relays: ["wss://hint.example.com"],
    });
  });

  it("claims nothing else", () => {
    expect(adapter.parseIdentifier("relay.example.com'group")).toBeNull();
    expect(adapter.parseIdentifier("note1abc")).toBeNull();
    expect(adapter.parseIdentifier("#bitcoin")).toBeNull();
  });

  it("refuses bare hex, which is as plausibly an event id", () => {
    // `chat-parser` is the only caller and hands over whatever was typed, so
    // claiming hex means pasting an event id opens a private conversation with
    // a stranger.
    expect(adapter.parseIdentifier("3".repeat(64))).toBeNull();
  });
});

describe("resolveConversation", () => {
  it("gives both sides the same conversation id", async () => {
    const fromAlice = await new Nip17Adapter().resolveConversation({
      type: "chat-partner",
      value: BOB,
    });
    mocks.account = { pubkey: BOB, signer: bob };
    const fromBob = await new Nip17Adapter().resolveConversation({
      type: "chat-partner",
      value: ALICE,
    });
    expect(fromAlice.id).toBe(fromBob.id);
  });

  it("carries both inboxes, so the header can say where mail goes", async () => {
    // Theirs is where your message goes and yours is where their reply lands;
    // a reader wondering whether a message will arrive needs both. This is the
    // reader's own view of their own conversation — the privacy rule is about
    // never naming these relays in a REQ, not about hiding them from the
    // person whose mail it is.
    const c = await conversation(new Nip17Adapter());
    expect(c.metadata?.relays).toContain("wss://peer.example.com/");
    expect(c.metadata).toMatchObject({ encrypted: true, giftWrapped: true });
  });
});

describe("loadMessages", () => {
  it("paints from the local mirror", async () => {
    await seed("from the store");
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    const messages = await new Promise<unknown[]>((resolve) => {
      const sub = adapter.loadMessages(c).subscribe((next) => {
        if (next.length > 0) {
          sub.unsubscribe();
          resolve(next);
        }
      });
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ content: "from the store" });
  });

  it("always carries a reactions array, so nothing REQs a private id", async () => {
    await seed();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    const messages = await new Promise<Array<{ metadata?: unknown }>>(
      (resolve) => {
        const sub = adapter.loadMessages(c).subscribe((next) => {
          if (next.length > 0) {
            sub.unsubscribe();
            resolve(next);
          }
        });
      },
    );

    // `MessageReactions` opens `{kinds:[7],"#e":[id]}` unless this is PRESENT.
    // A rumor id exists on no relay; asking about it announces the conversation.
    expect(messages[0].metadata).toHaveProperty("reactions");
  });
});

describe("reactions", () => {
  it("sends a kind 7 wrapped, never in the clear", async () => {
    await seed();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);
    const [row] = await db.dmRumors.toArray();

    await adapter.sendReaction(c, row.id, "🔥");

    expect(publishGiftWrap).toHaveBeenCalled();
    const [wrap] = publishGiftWrap.mock.calls[0];
    // Kind 1059 on the wire; the 7 is inside, where the relay cannot read it.
    expect(wrap.kind).toBe(1059);
  });

  it("shows a reaction on the message it is about", async () => {
    await seed();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);
    const [target] = await db.dmRumors.toArray();

    await sendDirectReaction({
      viewer: ALICE,
      signer: alice,
      peers: [BOB],
      targetId: target.id,
      emoji: "🔥",
    });

    const messages = await new Promise<
      Array<{ id: string; metadata?: { reactions?: unknown[] } }>
    >((resolve) => {
      const sub = adapter.loadMessages(c).subscribe((next) => {
        if (next.some((m) => (m.metadata?.reactions?.length ?? 0) > 0)) {
          sub.unsubscribe();
          resolve(next);
        }
      });
    });

    const message = messages.find((m) => m.id === target.id);
    expect(message?.metadata?.reactions).toHaveLength(1);
  });

  it("does not let a reaction delete the message it is about", async () => {
    // Both kind 5 and kind 7 are side rows carrying an `e` tag. Folding them
    // alike would make liking a message erase it.
    await seed("still here");
    const [target] = await db.dmRumors.toArray();

    await sendDirectReaction({
      viewer: ALICE,
      signer: alice,
      peers: [BOB],
      targetId: target.id,
      emoji: "👍",
    });

    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);
    const messages = await new Promise<Array<{ content: string }>>(
      (resolve) => {
        const sub = adapter.loadMessages(c).subscribe((next) => {
          if (next.length > 0) {
            sub.unsubscribe();
            resolve(next);
          }
        });
      },
    );

    expect(messages.map((m) => m.content)).toContain("still here");
  });
});

describe("read state", () => {
  it("stamps and reads back, and never moves backwards", async () => {
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    expect(await adapter.getLastRead(c)).toBe(0);
    await adapter.markRead(c, 1000);
    expect(await adapter.getLastRead(c)).toBe(1000);
    await adapter.markRead(c, 500);
    expect(await adapter.getLastRead(c)).toBe(1000);
  });
});

describe("loadReplyMessage", () => {
  it("resolves from the mirror and never asks a relay", async () => {
    await seed("the parent");
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);
    const [row] = await db.dmRumors.toArray();

    const event = await adapter.loadReplyMessage(c, { id: row.id });

    expect(event?.content).toBe("the parent");
    // A rumor has no signature by construction, and inventing one would claim
    // a proof that does not exist.
    expect(event?.sig).toBe("");
  });

  it("returns null for an id it does not hold", async () => {
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);
    expect(
      await adapter.loadReplyMessage(c, { id: "f".repeat(64) }),
    ).toBeNull();
  });
});

describe("what the UI is allowed to do with a message id", () => {
  it("declares message ids private, so nothing offers to publish one", () => {
    // A rumor id exists on no relay. "Open Event" would REQ `{ids:[…]}` and
    // "Copy ID" would hand out an `nevent` any client resolves — either one
    // tells a relay the conversation happened, which is what the gift wrap
    // around it was for. `ChatMessageContextMenu` reads this flag.
    expect(new Nip17Adapter().getCapabilities().messageIdsArePrivate).toBe(
      true,
    );
  });
});

describe("legacy messages", () => {
  /** A stored legacy row, as the import would have written it. */
  async function seedLegacy(content = "from the old days") {
    const { writeDmRows } = await import("@/services/dm-store");
    const conversationId = [ALICE, BOB].sort().join(":");
    await writeDmRows(ALICE, [
      {
        id: "d".repeat(64),
        viewer: ALICE,
        conversationId,
        kind: 4,
        created_at: Math.floor(Date.now() / 1000) - 100,
        pubkey: BOB,
        content,
        tags: [["p", ALICE]],
        legacy: true as const,
      },
    ]);
    return conversationId;
  }

  it("carries the legacy mark to the UI", async () => {
    await seedLegacy();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    const messages = await new Promise<Array<{ metadata?: unknown }>>(
      (resolve) => {
        const sub = adapter.loadMessages(c).subscribe((next) => {
          if (next.length > 0) {
            sub.unsubscribe();
            resolve(next);
          }
        });
      },
    );

    // Without this the row renders under gift-wrap chrome, claiming a
    // guarantee a public kind-4 event never had.
    expect(messages[0].metadata).toMatchObject({ legacy: true });
  });

  it("refuses to react to one", async () => {
    // The reaction would be a gift-wrapped kind 7 whose `e` tag names a PUBLIC
    // kind-4 id: the wrap hides who reacted while the tag inside says which
    // public DM they were reading.
    await seedLegacy();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    await expect(adapter.sendReaction(c, "d".repeat(64), "🔥")).rejects.toThrow(
      /cannot be reacted to privately/,
    );
    expect(publishGiftWrap).not.toHaveBeenCalled();
  });

  it("sends a reply to one without threading it", async () => {
    // The message goes; it just carries no `e` tag, because threading it would
    // put a public id inside a private message.
    await seedLegacy();
    const adapter = new Nip17Adapter();
    const c = await conversation(adapter);

    await adapter.sendMessage(c, "about that", { replyTo: "d".repeat(64) });

    expect(publishGiftWrap).toHaveBeenCalled();
    const sent = (await db.dmRumors.toArray()).filter((r) => r.kind === 14);
    expect(sent).toHaveLength(1);
    expect(sent[0].tags.some((t) => t[0] === "e")).toBe(false);
  });
});
