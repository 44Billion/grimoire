/**
 * The fold's private-zap pass (CORD.md §4).
 *
 * Two rules here are wire contract, not preference: a zap whose proof fails
 * never enters a total, and one settled payment counts exactly once per channel
 * with a winner both clients pick the same way. Get either wrong and grimoire
 * and armada disagree about what a channel contains.
 *
 * Split from `chat.test.ts` because these cases mock the invoice decoder.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetChatDecodeForTests,
  foldTimeline,
  type ChatModeration,
  type OpenedChat,
} from "@/lib/concord/chat";
import { KIND_MESSAGE, KIND_ONCHAIN_ZAP, KIND_ZAP } from "@/lib/concord/kinds";
import { MOCK_PREIMAGE, mockInvoice, paymentHashOf } from "@/test/bolt11-mock";

vi.mock("applesauce-common/helpers/bolt11", async (importOriginal) => {
  const { mockParseBolt11 } = await import("@/test/bolt11-mock");
  return mockParseBolt11(
    await importOriginal<typeof import("applesauce-common/helpers/bolt11")>(),
  );
});

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);
const BANNED = "d".repeat(64);
const CHANNEL = "e".repeat(64);

let seq = 0;
function opened(over: Partial<OpenedChat> & { author: string }): OpenedChat {
  seq += 1;
  const createdAt = over.createdAt ?? 1_000 + seq;
  return {
    rumorId: `${seq}`.padStart(64, "0"),
    kind: KIND_MESSAGE,
    content: "",
    tags: [],
    createdAt,
    ms: createdAt * 1000,
    channelIdHex: CHANNEL,
    epoch: 0n,
    ...over,
  };
}

/** A zap of `sats` on `targetId`, proven unless the hash is overridden. */
function zapOf(
  author: string,
  targetId: string,
  sats: number,
  over: {
    preimage?: string;
    paymentHash?: string;
    comment?: string;
    at?: number;
  } = {},
): OpenedChat {
  const preimage = over.preimage ?? MOCK_PREIMAGE;
  return opened({
    author,
    kind: KIND_ZAP,
    content: over.comment ?? "",
    tags: [
      ["e", targetId],
      ["p", ALICE],
      ["k", String(KIND_MESSAGE)],
      ["amount", String(sats * 1000)],
      [
        "bolt11",
        mockInvoice(sats * 1000, {
          paymentHash: over.paymentHash ?? paymentHashOf(preimage),
        }),
      ],
      ["preimage", preimage],
    ],
    ...(over.at !== undefined ? { createdAt: over.at } : {}),
  });
}

const moderation = (banned: string[] = []): ChatModeration => ({
  banned: new Set(banned),
  canDelete: () => false,
});

beforeEach(() => {
  _resetChatDecodeForTests();
  seq = 0;
});

describe("foldTimeline — private zaps", () => {
  it("folds a verified zap under its target", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      zapOf(BOB, msg.rumorId, 21, { comment: "nice" }),
    ]);
    expect(timeline.zaps.get(msg.rumorId)).toEqual([
      {
        id: expect.any(String),
        pubkey: BOB,
        recipient: ALICE,
        sats: 21,
        comment: "nice",
        emojiTags: [],
        createdAt: expect.any(Number),
      },
    ]);
  });

  it("never renders a zap as a timeline message", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([msg, zapOf(BOB, msg.rumorId, 21)]);
    expect(timeline.messages.map((m) => m.rumorId)).toEqual([msg.rumorId]);
  });

  it("drops a zap whose payment proof does not check out", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      // A preimage that settles some OTHER invoice.
      zapOf(BOB, msg.rumorId, 21, {
        paymentHash: paymentHashOf("cd".repeat(32)),
      }),
    ]);
    expect(timeline.zaps.size).toBe(0);
  });

  it("counts one payment once, no matter who replays the proof", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const other = opened({ author: ALICE, content: "elsewhere" });
    const paid = zapOf(BOB, msg.rumorId, 21, { at: 100 });
    // The same preimage, announced again by someone else on another message.
    const replay = zapOf(CAROL, other.rumorId, 21, { at: 200 });
    const timeline = foldTimeline([msg, other, replay, paid]);
    expect(timeline.zaps.get(msg.rumorId)?.map((z) => z.pubkey)).toEqual([BOB]);
    expect(timeline.zaps.get(other.rumorId)).toBeUndefined();
  });

  it("resolves a tie on rumor id, so every member folds the same winner", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const a = zapOf(BOB, msg.rumorId, 21, { at: 100 });
    const b = zapOf(CAROL, msg.rumorId, 21, { at: 100 });
    const winner = a.rumorId < b.rumorId ? BOB : CAROL;
    expect(
      foldTimeline([msg, a, b])
        .zaps.get(msg.rumorId)
        ?.map((z) => z.pubkey),
    ).toEqual([winner]);
    _resetChatDecodeForTests();
    expect(
      foldTimeline([msg, b, a])
        .zaps.get(msg.rumorId)
        ?.map((z) => z.pubkey),
    ).toEqual([winner]);
  });

  it("keeps two distinct payments on the same message", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      zapOf(BOB, msg.rumorId, 21, { at: 100 }),
      zapOf(CAROL, msg.rumorId, 100, {
        preimage: "cd".repeat(32),
        at: 200,
      }),
    ]);
    expect(timeline.zaps.get(msg.rumorId)?.map((z) => z.sats)).toEqual([
      21, 100,
    ]);
  });

  it("drops a zap from a banned author", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline(
      [msg, zapOf(BANNED, msg.rumorId, 21)],
      moderation([BANNED]),
    );
    expect(timeline.zaps.size).toBe(0);
  });

  it("keeps the comment's NIP-30 emoji tags", () => {
    // Without them the comment renders as a bare `:shortcode:` — the tag is
    // the only thing that says what image the shortcode stands for.
    const msg = opened({ author: ALICE, content: "hi" });
    const zap = zapOf(BOB, msg.rumorId, 21, { comment: ":pepe:" });
    zap.tags.push(["emoji", "pepe", "https://example.com/pepe.png"]);
    const timeline = foldTimeline([msg, zap]);
    expect(timeline.zaps.get(msg.rumorId)?.[0].emojiTags).toEqual([
      ["emoji", "pepe", "https://example.com/pepe.png"],
    ]);
  });

  it("holds a zap whose target has not arrived yet", () => {
    const unseen = "f".repeat(64);
    const timeline = foldTimeline([zapOf(BOB, unseen, 21)]);
    expect(timeline.zaps.get(unseen)?.map((z) => z.sats)).toEqual([21]);
  });
});

const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

/** An on-chain zap rumor claiming `sats` on `targetId`. */
function onchainZapOf(
  author: string,
  targetId: string,
  sats: number,
  over: {
    txid?: string;
    recipients?: string[];
    comment?: string;
    at?: number;
    tags?: string[][];
  } = {},
): OpenedChat {
  return opened({
    author,
    kind: KIND_ONCHAIN_ZAP,
    content: over.comment ?? "",
    tags: over.tags ?? [
      ["i", `bitcoin:tx:${over.txid ?? TXID}`],
      ["e", targetId],
      ...(over.recipients ?? [ALICE]).map((pk) => ["p", pk]),
      ["amount", String(sats)],
      ["alt", `Onchain zap: ${sats} sats`],
    ],
    ...(over.at !== undefined ? { createdAt: over.at } : {}),
  });
}

/**
 * The fold's on-chain-zap pass (kind 8333, Ditto's `NIP.md`).
 *
 * The invariant these guard is the one that keeps the fold honest while the
 * proof lives elsewhere: an on-chain claim goes into `onchainZaps` and NEVER
 * into `zaps`, because `ZapEntry.sats` means "verified" and nothing here has
 * been. The last case in this block is the regression test for a future
 * refactor that "helpfully" copies the claimed figure into a displayable slot.
 */
describe("foldTimeline — on-chain zaps", () => {
  it("folds a well-formed claim under its target", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      onchainZapOf(BOB, msg.rumorId, 25000, { comment: "nice" }),
    ]);

    expect(timeline.onchainZaps.get(msg.rumorId)).toEqual([
      expect.objectContaining({
        txid: TXID,
        senderPubkey: BOB,
        recipientPubkeys: [ALICE],
        claimedSats: 25000,
        comment: "nice",
      }),
    ]);
  });

  it("never puts an on-chain claim in `zaps`", () => {
    // `zaps` is the VERIFIED collection. A claim landing there would be a
    // number the fold could not check, presented as one it had.
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([msg, onchainZapOf(BOB, msg.rumorId, 25000)]);

    expect(timeline.zaps.size).toBe(0);
  });

  it("carries no displayable amount field at all", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([msg, onchainZapOf(BOB, msg.rumorId, 25000)]);
    const claim = timeline.onchainZaps.get(msg.rumorId)?.[0];

    // The only amount on the object is named for what it is. If a refactor
    // ever adds `sats`, this fails — which is the point.
    expect(claim).not.toHaveProperty("sats");
    expect(claim).not.toHaveProperty("amountSats");
    expect(claim?.claimedSats).toBe(25000);
  });

  it("never renders an on-chain zap as a timeline message", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([msg, onchainZapOf(BOB, msg.rumorId, 25000)]);

    expect(timeline.messages.map((m) => m.rumorId)).toEqual([msg.rumorId]);
  });

  it("drops a self-zap", () => {
    // Free to fabricate: the sender already controls the destination key.
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      onchainZapOf(BOB, msg.rumorId, 25000, { recipients: [ALICE, BOB] }),
    ]);

    expect(timeline.onchainZaps.size).toBe(0);
  });

  it("drops a malformed claim", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      // No `i` tag at all.
      onchainZapOf(BOB, msg.rumorId, 25000, {
        tags: [
          ["e", msg.rumorId],
          ["p", ALICE],
          ["amount", "25000"],
        ],
      }),
      // Uppercase txid, which the spec pins to lowercase.
      onchainZapOf(CAROL, msg.rumorId, 25000, { txid: TXID.toUpperCase() }),
    ]);

    expect(timeline.onchainZaps.size).toBe(0);
  });

  it("counts one transaction once per target, earliest claim winning", () => {
    // A transaction is public, so anyone can publish an 8333 pointing at
    // someone else's. Without the dedupe one payment becomes many rows.
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      onchainZapOf(CAROL, msg.rumorId, 25000, { at: 2_000 }),
      onchainZapOf(BOB, msg.rumorId, 25000, { at: 1_000 }),
    ]);

    const claims = timeline.onchainZaps.get(msg.rumorId);
    expect(claims).toHaveLength(1);
    expect(claims?.[0].senderPubkey).toBe(BOB);
  });

  it("keeps two different transactions on one target", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline([
      msg,
      onchainZapOf(BOB, msg.rumorId, 25000),
      onchainZapOf(CAROL, msg.rumorId, 5000, { txid: "b".repeat(64) }),
    ]);

    expect(timeline.onchainZaps.get(msg.rumorId)).toHaveLength(2);
  });

  it("drops a claim from a banned author", () => {
    const msg = opened({ author: ALICE, content: "hi" });
    const timeline = foldTimeline(
      [msg, onchainZapOf(BANNED, msg.rumorId, 25000)],
      moderation([BANNED]),
    );

    expect(timeline.onchainZaps.size).toBe(0);
  });

  it("holds a claim whose target has not arrived yet", () => {
    const unseen = "f".repeat(64);
    const timeline = foldTimeline([onchainZapOf(BOB, unseen, 25000)]);

    expect(timeline.onchainZaps.get(unseen)).toHaveLength(1);
  });
});
