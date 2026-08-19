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
import { KIND_MESSAGE, KIND_ZAP } from "@/lib/concord/kinds";
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
