import { describe, it, expect, beforeEach } from "vitest";
import { getEventHash } from "nostr-tools";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import db from "./db";
import {
  DM_MAX_FUTURE_SECS,
  DM_UNREAD_CAP,
  clearDirectMessages,
  countUnreadDms,
  dmUnreadSummary,
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

describe("a group conversation", () => {
  it("files its rows under every participant, not under one of them", async () => {
    // Exactly what shipped: an inbound message p-tagging the viewer AND
    // someone else. The sidebar row showed one name and an unread count, and
    // opening it asked for the 1:1 with that name — a conversation with no
    // rows in it, whose read stamp could never clear the badge.
    const group = rumor({
      pubkey: PEER,
      tags: [
        ["p", ME],
        ["p", STRANGER],
      ],
    });
    await writeDmRumors(ME, [group]);

    const [conversation] = await listDmConversations(ME);
    expect(conversation.participants).toHaveLength(3);
    expect(await countUnreadDms(ME, conversation.conversationId, 0)).toBe(1);

    const opened = await queryConversation(ME, conversation.conversationId, {
      limit: 50,
    });
    expect(opened).toHaveLength(1);

    // The id a row that collapsed the group to its first peer would open.
    const collapsed = [ME, PEER].sort().join(":");
    expect(collapsed).not.toBe(conversation.conversationId);
    expect(await queryConversation(ME, collapsed, { limit: 50 })).toEqual([]);
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

describe("side rows that carry no p tag", () => {
  it("applies a delete that names only the message it removes", async () => {
    // NIP-09 asks for an `e` tag and nothing else, so a delete's participant
    // list is just its author. Requiring the viewer in it dropped every
    // inbound delete on the floor and the message rendered forever.
    const target = rumor({ content: "regretted" });
    await writeDmRumors(ME, [target]);
    const [conversation] = await listDmConversations(ME);

    const bare = rumor({
      kind: 5,
      pubkey: PEER,
      tags: [["e", target.id]],
    });
    await writeDmRumors(ME, [bare]);

    const rows = await queryConversation(ME, conversation.conversationId, {
      limit: 50,
    });
    expect(foldDmMessages(rows)).toEqual([]);
  });

  it("finds a tombstone filed under a different conversation", async () => {
    // In a group DM a bare delete is filed under a two-person conversation
    // that does not exist. Scoping the side-row lookup to the open
    // conversation is how it goes missing.
    const group = rumor({
      pubkey: PEER,
      tags: [
        ["p", ME],
        ["p", STRANGER],
      ],
      content: "in the group",
    });
    await writeDmRumors(ME, [group]);
    await writeDmRumors(ME, [
      rumor({ kind: 5, pubkey: PEER, tags: [["e", group.id]] }),
    ]);

    const [conversation] = await listDmConversations(ME);
    const rows = await queryConversation(ME, conversation.conversationId, {
      limit: 50,
    });
    expect(foldDmMessages(rows)).toEqual([]);
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

  it("does not leave a sidebar row pointing at nothing", async () => {
    const deadline = nowSecs() + 60;
    await writeDmRumors(ME, [
      rumor({
        content: "everything here expires",
        tags: [
          ["p", ME],
          ["expiration", String(deadline)],
        ],
      }),
    ]);
    expect(await listDmConversations(ME)).toHaveLength(1);

    await sweepExpiredDms(ME, deadline + 1);

    expect(await listDmConversations(ME)).toEqual([]);
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

describe("countUnreadDms", () => {
  async function conversationId() {
    const [conversation] = await listDmConversations(ME);
    return conversation.conversationId;
  }

  it("counts messages, not conversations", async () => {
    // The bug this replaces: the badge counted rows in the sidebar, so four
    // messages across two conversations read as "2".
    await writeDmRumors(ME, [
      rumor({ created_at: nowSecs() - 30, content: "one" }),
      rumor({ created_at: nowSecs() - 20, content: "two" }),
      rumor({ created_at: nowSecs() - 10, content: "three" }),
    ]);

    expect(await countUnreadDms(ME, await conversationId(), 0)).toBe(3);
  });

  it("counts only what arrived after the stamp", async () => {
    const cutoff = nowSecs() - 25;
    await writeDmRumors(ME, [
      rumor({ created_at: cutoff - 10, content: "read" }),
      rumor({ created_at: cutoff, content: "the boundary itself" }),
      rumor({ created_at: cutoff + 10, content: "unread" }),
    ]);

    // Exclusive at the bound: the message the stamp was taken FROM has been
    // read, so counting it would leave a badge no visit can clear.
    expect(await countUnreadDms(ME, await conversationId(), cutoff)).toBe(1);
  });

  it("never counts the viewer's own messages", async () => {
    // Sending is reading.
    await writeDmRumors(ME, [
      rumor({ pubkey: ME, tags: [["p", PEER]], content: "mine" }),
      rumor({ pubkey: PEER, tags: [["p", ME]], content: "theirs" }),
    ]);

    expect(await countUnreadDms(ME, await conversationId(), 0)).toBe(1);
  });

  it("does not count a reaction as a message waiting", async () => {
    const target = rumor({ content: "the message" });
    await writeDmRumors(ME, [target]);
    const id = await conversationId();
    await writeDmRumors(ME, [
      rumor({
        kind: 7,
        pubkey: PEER,
        content: "🔥",
        tags: [
          ["p", ME],
          ["e", target.id],
        ],
      }),
    ]);

    // A reaction to something already read is not a message waiting.
    expect(await countUnreadDms(ME, id, 0)).toBe(1);
  });

  it("does not count a message its author deleted", async () => {
    const target = rumor({ content: "regretted" });
    await writeDmRumors(ME, [target]);
    const id = await conversationId();
    await writeDmRumors(ME, [
      rumor({ kind: 5, pubkey: PEER, tags: [["e", target.id]] }),
    ]);

    // Nothing to read: the fold removes it from the timeline, so a badge
    // pointing at it sends the reader to an empty conversation. The count
    // skips side rows, and the target is the only row-kind left.
    expect(await countUnreadDms(ME, id, 0)).toBe(1);
  });

  it("does not count a message past its deadline", async () => {
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
    const id = await conversationId();

    expect(await countUnreadDms(ME, id, 0, deadline - 1)).toBe(1);
    expect(await countUnreadDms(ME, id, 0, deadline + 1)).toBe(0);
  });

  it("stops counting at the cap", async () => {
    const base = nowSecs() - 5000;
    await writeDmRumors(
      ME,
      Array.from({ length: DM_UNREAD_CAP + 20 }, (_, i) =>
        rumor({ created_at: base + i, content: `m${i}` }),
      ),
    );

    // A conversation nobody has opened in a year should cost a bounded read.
    expect(await countUnreadDms(ME, await conversationId(), 0)).toBe(
      DM_UNREAD_CAP,
    );
  });
});

describe("dmUnreadSummary", () => {
  async function conversationId() {
    const [conversation] = await listDmConversations(ME);
    return conversation.conversationId;
  }

  it("reports a stamp that can clear a badge the fold hides", async () => {
    // The case the whole shape exists for. The count is a raw scan and the
    // timeline is a fold, so a message its author deleted can be NEWER than
    // anything on screen — and a reader who stamps what they saw stamps below
    // it and can never clear the badge by any action.
    const visible = rumor({ created_at: nowSecs() - 100, content: "seen" });
    await writeDmRumors(ME, [visible]);
    const id = await conversationId();

    const removed = rumor({ created_at: nowSecs() - 10, content: "gone" });
    await writeDmRumors(ME, [
      removed,
      rumor({
        kind: 5,
        pubkey: PEER,
        created_at: nowSecs() - 5,
        tags: [["e", removed.id]],
      }),
    ]);

    const summary = await dmUnreadSummary(ME, id, { after: 0 });
    // `latest` reaches the hidden row even though the timeline stops short.
    expect(summary.latest).toBe(removed.created_at);
    expect(summary.latest).toBeGreaterThan(visible.created_at);

    // Stamping there clears it; stamping what was shown would not.
    expect(
      (await dmUnreadSummary(ME, id, { after: summary.latest })).count,
    ).toBe(0);
    expect(
      (await dmUnreadSummary(ME, id, { after: visible.created_at })).count,
    ).toBeGreaterThan(0);
  });

  it("walks newest-first, so the cap cannot strand the stamp", async () => {
    // Ascending, a capped scan reports the newest of the OLDEST hundred rows
    // as `latest`, the stamp never reaches past the cap, and the stuck badge
    // returns for exactly the >99-unread case.
    const base = nowSecs() - 5000;
    await writeDmRumors(
      ME,
      Array.from({ length: DM_UNREAD_CAP + 20 }, (_, i) =>
        rumor({ created_at: base + i, content: `m${i}` }),
      ),
    );

    const summary = await dmUnreadSummary(ME, await conversationId(), {
      after: 0,
    });

    expect(summary.capped).toBe(true);
    expect(summary.count).toBe(DM_UNREAD_CAP);
    // The NEWEST row, not the newest of the first page.
    expect(summary.latest).toBe(base + DM_UNREAD_CAP + 19);
  });

  it("ignores a message dated absurdly far in the future", async () => {
    // `created_at` is author-chosen, so without a ceiling one message pins the
    // badge forever. Bounded here and at the stamp by the same allowance.
    await writeDmRumors(ME, [rumor({ content: "now" })]);
    const id = await conversationId();

    const summary = await dmUnreadSummary(ME, id, { after: 0 });
    expect(summary.count).toBe(1);
    expect(summary.latest).toBeLessThanOrEqual(nowSecs() + DM_MAX_FUTURE_SECS);
  });

  it("counts nothing once the stamp is at or past the newest row", async () => {
    const newest = rumor({ created_at: nowSecs() - 10 });
    await writeDmRumors(ME, [newest]);

    // Exclusive at the bound: the message the stamp came FROM has been read.
    expect(
      (
        await dmUnreadSummary(ME, await conversationId(), {
          after: newest.created_at,
        })
      ).count,
    ).toBe(0);
  });
});
