import { describe, it, expect, beforeEach } from "vitest";
import { getEventHash } from "nostr-tools";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import db from "./db";
import {
  DM_MAX_FUTURE_SECS,
  clearDirectMessages,
  foldDmMessages,
  listDmConversations,
  queryConversation,
  sweepExpiredDms,
  toDmRow,
  writeDmRumors,
} from "./dm-store";

/**
 * The rules in this store are the boundary between "a message someone sent me"
 * and "a message someone claims someone else sent me". A gift wrap proves only
 * that whoever built it knew the recipient's pubkey — everything else has to be
 * checked here, once, before the plaintext is believed.
 */

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
const STRANGER = "c".repeat(64);

const nowSecs = () => Math.floor(Date.now() / 1000);

/** A rumor with a correctly computed id, unless `id` is overridden. */
function rumor(overrides: Partial<Rumor> = {}): Rumor {
  const base = {
    kind: 14,
    pubkey: PEER,
    created_at: nowSecs() - 10,
    content: "hello",
    tags: [["p", ME]] as string[][],
    ...overrides,
  };
  return { ...base, id: overrides.id ?? getEventHash(base) } as Rumor;
}

beforeEach(async () => {
  await db.dmRumors.clear();
  await db.dmConversations.clear();
  await db.dmSeenWraps.clear();
  await db.dmKv.clear();
});

describe("toDmRow", () => {
  it("refuses a rumor whose id does not hash its own contents", () => {
    // Otherwise the id — which everything downstream keys, dedupes and replies
    // by — is whatever the sender felt like writing.
    const result = toDmRow(ME, rumor({ id: "f".repeat(64) }));
    expect(result).toEqual({ rejected: "rumor id does not match" });
  });

  it("refuses a conversation the viewer is not in", () => {
    const result = toDmRow(
      ME,
      rumor({ pubkey: PEER, tags: [["p", STRANGER]] }),
    );
    expect(result).toEqual({ rejected: "viewer is not a participant" });
  });

  it("refuses a timestamp far in the future", () => {
    const result = toDmRow(
      ME,
      rumor({ created_at: nowSecs() + DM_MAX_FUTURE_SECS + 60 }),
    );
    expect(result).toEqual({
      rejected: "rumor is dated too far in the future",
    });
  });

  it("refuses kinds that are not direct messages", () => {
    // A gift wrap can carry anything. Only what a DM timeline can render gets
    // written; the rest is not our mail.
    expect(toDmRow(ME, rumor({ kind: 1 }))).toMatchObject({
      rejected: expect.stringContaining("not a direct message"),
    });
  });

  it("refuses a rumor that already expired", () => {
    const result = toDmRow(
      ME,
      rumor({
        tags: [
          ["p", ME],
          ["expiration", String(nowSecs() - 1)],
        ],
      }),
    );
    expect(result).toEqual({ rejected: "rumor has expired" });
  });

  it("accepts one that expires later, and remembers when", () => {
    const deadline = nowSecs() + 3600;
    const result = toDmRow(
      ME,
      rumor({
        tags: [
          ["p", ME],
          ["expiration", String(deadline)],
        ],
      }),
    );
    // Dropping it outright would silently lose mail from any client with
    // disappearing messages switched on.
    expect(result).toMatchObject({ expiration: deadline });
  });

  it("gives both sides of a conversation the same id", () => {
    const inbound = toDmRow(ME, rumor({ pubkey: PEER, tags: [["p", ME]] }));
    const outbound = toDmRow(ME, rumor({ pubkey: ME, tags: [["p", PEER]] }));
    expect("rejected" in inbound).toBe(false);
    expect("rejected" in outbound).toBe(false);
    expect((inbound as { conversationId: string }).conversationId).toBe(
      (outbound as { conversationId: string }).conversationId,
    );
  });
});

describe("writeDmRumors", () => {
  it("summarises a conversation for the sidebar", async () => {
    const older = rumor({ created_at: nowSecs() - 100, content: "first" });
    const newer = rumor({ created_at: nowSecs() - 10, content: "second" });

    await writeDmRumors(ME, [older, newer]);
    const conversations = await listDmConversations(ME);

    expect(conversations).toHaveLength(1);
    expect(conversations[0].lastAt).toBe(newer.created_at);
    expect(new Set(conversations[0].participants)).toEqual(new Set([ME, PEER]));
  });

  it("does not walk a conversation backwards when a backfill lands", async () => {
    const newest = rumor({ created_at: nowSecs() - 10, content: "recent" });
    await writeDmRumors(ME, [newest]);

    // A backfill page is old mail arriving late. Taking the batch's newest
    // would age the conversation and re-sort the whole sidebar.
    await writeDmRumors(ME, [
      rumor({ created_at: nowSecs() - 5000, content: "ancient" }),
    ]);

    const [conversation] = await listDmConversations(ME);
    expect(conversation.lastAt).toBe(newest.created_at);
  });

  it("keeps a lone tombstone out of the sidebar", async () => {
    // A delete can outrun the message it removes over an unordered relay set.
    await writeDmRumors(ME, [
      rumor({
        kind: 5,
        pubkey: PEER,
        tags: [
          ["p", ME],
          ["e", "d".repeat(64)],
        ],
      }),
    ]);

    expect(await listDmConversations(ME)).toEqual([]);
  });

  it("writes nothing for another account", async () => {
    await writeDmRumors(ME, [rumor()]);
    expect(await listDmConversations(PEER)).toEqual([]);
  });
});

describe("queryConversation and foldDmMessages", () => {
  async function conversationId() {
    const [conversation] = await listDmConversations(ME);
    return conversation.conversationId;
  }

  it("applies a delete that arrived before its target", async () => {
    const target = rumor({ created_at: nowSecs() - 50, content: "regretted" });
    const tombstone = rumor({
      kind: 5,
      created_at: nowSecs() - 60,
      tags: [
        ["p", ME],
        ["e", target.id],
      ],
    });

    await writeDmRumors(ME, [tombstone]);
    await writeDmRumors(ME, [target]);

    const rows = await queryConversation(ME, await conversationId(), {
      limit: 50,
    });
    expect(foldDmMessages(rows)).toEqual([]);
  });

  it("ignores a delete signed by someone other than the author", async () => {
    // A kind 5 naming a rumor you did not write is a stranger editing your
    // mailbox. Both are in the same conversation, so nothing else stops it.
    const target = rumor({ pubkey: PEER, content: "stays" });
    const forged = rumor({
      kind: 5,
      pubkey: ME,
      tags: [
        ["p", PEER],
        ["e", target.id],
      ],
    });

    await writeDmRumors(ME, [target, forged]);

    const rows = await queryConversation(ME, await conversationId(), {
      limit: 50,
    });
    expect(foldDmMessages(rows).map((r) => r.content)).toEqual(["stays"]);
  });

  it("hides a message once its deadline passes", async () => {
    const deadline = nowSecs() + 60;
    await writeDmRumors(ME, [
      rumor({
        content: "fleeting",
        tags: [
          ["p", ME],
          ["expiration", String(deadline)],
        ],
      }),
    ]);

    const rows = await queryConversation(ME, await conversationId(), {
      limit: 50,
    });
    expect(foldDmMessages(rows, deadline - 1)).toHaveLength(1);
    expect(foldDmMessages(rows, deadline + 1)).toEqual([]);
  });

  it("pages backwards without splitting a second across two pages", async () => {
    const at = nowSecs() - 500;
    const messages = Array.from({ length: 5 }, (_, i) =>
      rumor({ created_at: at + i, content: `m${i}` }),
    );
    await writeDmRumors(ME, messages);
    const id = await conversationId();

    const page = foldDmMessages(await queryConversation(ME, id, { limit: 2 }));
    expect(page.map((r) => r.content)).toEqual(["m3", "m4"]);

    const older = foldDmMessages(
      await queryConversation(ME, id, { limit: 2, until: page[0].created_at }),
    );
    expect(older.map((r) => r.content)).toEqual(["m2", "m3"]);
  });
});

describe("sweepExpiredDms", () => {
  it("removes expired rows from disk rather than only hiding them", async () => {
    const deadline = nowSecs() + 60;
    await writeDmRumors(ME, [
      rumor({
        content: "fleeting",
        tags: [
          ["p", ME],
          ["expiration", String(deadline)],
        ],
      }),
      rumor({ content: "permanent", created_at: nowSecs() - 20 }),
    ]);

    expect(await sweepExpiredDms(ME, deadline + 1)).toBe(1);
    expect(await db.dmRumors.count()).toBe(1);
  });
});

describe("clearDirectMessages", () => {
  it("leaves nothing behind for the account that logged out", async () => {
    await writeDmRumors(ME, [rumor()]);
    await db.dmSeenWraps.put({
      viewer: ME,
      wrapId: "w",
      wrapAt: nowSecs(),
      opened: true,
    });
    await db.dmKv.put({ key: `${ME}:cursor`, value: 1 });

    await clearDirectMessages(ME);

    expect(await db.dmRumors.count()).toBe(0);
    expect(await db.dmConversations.count()).toBe(0);
    expect(await db.dmSeenWraps.count()).toBe(0);
    expect(await db.dmKv.count()).toBe(0);
  });

  it("leaves the other account's mail alone", async () => {
    await writeDmRumors(ME, [rumor()]);
    await writeDmRumors(PEER, [rumor({ pubkey: ME, tags: [["p", PEER]] })]);

    await clearDirectMessages(ME);

    expect(await listDmConversations(PEER)).toHaveLength(1);
  });
});
