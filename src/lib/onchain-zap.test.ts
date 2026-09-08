import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import {
  dedupeOnchainZaps,
  extractOnchainZapClaimedAmount,
  extractOnchainZapRecipients,
  extractOnchainZapTxid,
  parseOnchainZap,
  verifyAgainstOutputs,
  type OnchainZapClaim,
} from "./onchain-zap";

const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
const SENDER = "a".repeat(64);
const ALICE = "b".repeat(64);
const BOB = "c".repeat(64);
const CAROL = "d".repeat(64);
const TARGET = "e".repeat(64);

function event(
  tags: string[][],
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: SENDER,
    created_at: 1_700_000_000,
    kind: 8333,
    tags,
    content: "Great post!",
    sig: "0".repeat(128),
    ...overrides,
  };
}

const validTags = () => [
  ["i", `bitcoin:tx:${TXID}`],
  ["p", ALICE],
  ["amount", "25000"],
  ["e", TARGET, "wss://relay.example"],
  ["alt", "Onchain zap: 25000 sats"],
];

describe("extractOnchainZapTxid", () => {
  it("reads the txid out of the i tag", () => {
    expect(extractOnchainZapTxid([["i", `bitcoin:tx:${TXID}`]])).toBe(TXID);
  });

  it("rejects a mixed-case txid, which the spec pins to lowercase", () => {
    // Normalising here would be worse than rejecting: the dedupe key is the
    // txid, so two casings of one transaction would become two rows.
    expect(
      extractOnchainZapTxid([["i", `bitcoin:tx:${TXID.toUpperCase()}`]]),
    ).toBeNull();
  });

  it("rejects a wrong length, another chain, and a bare address", () => {
    expect(
      extractOnchainZapTxid([["i", `bitcoin:tx:${TXID.slice(0, 63)}`]]),
    ).toBeNull();
    expect(extractOnchainZapTxid([["i", `bitcoin:tx:${TXID}ff`]])).toBeNull();
    expect(extractOnchainZapTxid([["i", `ethereum:tx:${TXID}`]])).toBeNull();
    expect(extractOnchainZapTxid([["i", "bitcoin:address:bc1p…"]])).toBeNull();
    expect(extractOnchainZapTxid([])).toBeNull();
  });

  it("takes the first well-formed i tag when several are present", () => {
    expect(
      extractOnchainZapTxid([
        ["i", "bitcoin:tx:garbage"],
        ["i", `bitcoin:tx:${TXID}`],
      ]),
    ).toBe(TXID);
  });
});

describe("extractOnchainZapClaimedAmount", () => {
  it("reads a plain decimal integer", () => {
    expect(extractOnchainZapClaimedAmount([["amount", "25000"]])).toBe(25000);
  });

  it("rejects what parseInt would silently mangle", () => {
    // parseInt("1.5") is 1 and parseInt("1e3") is 1 — a malformed tag would
    // become a plausible number, which is exactly the failure to avoid.
    for (const bad of [
      "0",
      "-5",
      "1.5",
      "1e3",
      "1_000",
      " 25000",
      "25000 ",
      "",
    ]) {
      expect(extractOnchainZapClaimedAmount([["amount", bad]])).toBeNull();
    }
  });

  it("rejects a value beyond safe integer range", () => {
    expect(
      extractOnchainZapClaimedAmount([["amount", "9".repeat(20)]]),
    ).toBeNull();
  });

  it("returns null when there is no amount tag", () => {
    expect(extractOnchainZapClaimedAmount([["p", ALICE]])).toBeNull();
  });
});

describe("extractOnchainZapRecipients", () => {
  it("keeps event order and drops duplicates", () => {
    expect(
      extractOnchainZapRecipients([
        ["p", ALICE],
        ["p", BOB],
        ["p", ALICE],
      ]),
    ).toEqual([ALICE, BOB]);
  });

  it("normalises case and drops malformed keys", () => {
    expect(
      extractOnchainZapRecipients([
        ["p", ALICE.toUpperCase()],
        ["p", "not-a-key"],
        ["p", ""],
      ]),
    ).toEqual([ALICE]);
  });
});

describe("parseOnchainZap", () => {
  it("parses a single-recipient event", () => {
    const claim = parseOnchainZap(event(validTags()));

    expect(claim).toMatchObject({
      txid: TXID,
      senderPubkey: SENDER,
      recipientPubkeys: [ALICE],
      claimedSats: 25000,
      comment: "Great post!",
      targetId: TARGET,
    });
  });

  it("parses a multi-recipient batch zap", () => {
    const claim = parseOnchainZap(
      event([
        ["i", `bitcoin:tx:${TXID}`],
        ["p", ALICE],
        ["p", BOB],
        ["p", CAROL],
        ["amount", "75000"],
        ["a", `30000:${ALICE}:my-list`],
      ]),
    );

    expect(claim?.recipientPubkeys).toEqual([ALICE, BOB, CAROL]);
    expect(claim?.targetAddress).toBe(`30000:${ALICE}:my-list`);
    expect(claim?.targetId).toBeUndefined();
  });

  it("treats an event with neither e nor a as a profile tip", () => {
    const claim = parseOnchainZap(
      event([
        ["i", `bitcoin:tx:${TXID}`],
        ["p", ALICE],
        ["amount", "1000"],
      ]),
    );

    expect(claim?.targetId).toBeUndefined();
    expect(claim?.targetAddress).toBeUndefined();
  });

  it("reads the k tag when it is a number and ignores it otherwise", () => {
    expect(
      parseOnchainZap(event([...validTags(), ["k", "1"]]))?.targetKind,
    ).toBe(1);
    expect(
      parseOnchainZap(event([...validTags(), ["k", "note"]]))?.targetKind,
    ).toBeUndefined();
  });

  it("rejects a missing or malformed i tag", () => {
    expect(
      parseOnchainZap(
        event([
          ["p", ALICE],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
    expect(
      parseOnchainZap(
        event([
          ["i", `ethereum:tx:${TXID}`],
          ["p", ALICE],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
  });

  it("rejects an event with no usable recipient", () => {
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", "nope"],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
  });

  it("rejects a missing or unusable amount", () => {
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", ALICE],
        ]),
      ),
    ).toBeNull();
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", ALICE],
          ["amount", "0"],
        ]),
      ),
    ).toBeNull();
  });

  it("rejects a self-zap in the first p tag", () => {
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", SENDER],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
  });

  it("rejects a self-zap hidden in the second of three p tags", () => {
    // The case a check on `p[0]` alone would wave through: pad a real batch
    // zap with yourself and the total inflates for free.
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", ALICE],
          ["p", SENDER],
          ["p", BOB],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
  });

  it("catches a self-zap written in the other case", () => {
    expect(
      parseOnchainZap(
        event([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", SENDER.toUpperCase()],
          ["amount", "1000"],
        ]),
      ),
    ).toBeNull();
  });
});

describe("dedupeOnchainZaps", () => {
  const claim = (
    over: Partial<OnchainZapClaim> & Pick<OnchainZapClaim, "eventId">,
  ): OnchainZapClaim => ({
    txid: TXID,
    senderPubkey: SENDER,
    recipientPubkeys: [ALICE],
    claimedSats: 1000,
    comment: "",
    createdAt: 100,
    targetId: TARGET,
    ...over,
  });

  it("keeps the earliest claim on one transaction and target", () => {
    const early = claim({ eventId: "early", createdAt: 100 });
    const late = claim({ eventId: "late", createdAt: 200 });

    expect(dedupeOnchainZaps([early, late])).toEqual([early]);
    // Order-independent: two relays feeding these in either order agree.
    expect(dedupeOnchainZaps([late, early])).toEqual([early]);
  });

  it("breaks a same-second tie on event id, so the result is stable", () => {
    const a = claim({ eventId: "aaa", createdAt: 100 });
    const b = claim({ eventId: "bbb", createdAt: 100 });

    expect(dedupeOnchainZaps([a, b])).toEqual([a]);
    expect(dedupeOnchainZaps([b, a])).toEqual([a]);
  });

  it("keeps a batch announced as one event per recipient", () => {
    // How Amethyst actually publishes a batch: one transaction, one zapped
    // event, and an event per recipient rather than the spec's many-`p` form.
    // Real example — txid a76003c5…e192 is a 13-output transaction announced
    // as seven separate events. Keyed on (txid, target) alone these would
    // collapse to one row and six real recipients would disappear.
    const toAlice = claim({ eventId: "1", recipientPubkeys: [ALICE] });
    const toBob = claim({ eventId: "2", recipientPubkeys: [BOB] });
    const toCarol = claim({ eventId: "3", recipientPubkeys: [CAROL] });

    expect(dedupeOnchainZaps([toAlice, toBob, toCarol])).toHaveLength(3);
  });

  it("still collapses a verbatim replay of one of those events", () => {
    const original = claim({ eventId: "aaa", createdAt: 100 });
    const replay = claim({ eventId: "zzz", createdAt: 200 });

    expect(dedupeOnchainZaps([original, replay])).toEqual([original]);
  });

  it("ignores recipient order, which relays do not preserve", () => {
    const forward = claim({ eventId: "1", recipientPubkeys: [ALICE, BOB] });
    const reversed = claim({ eventId: "2", recipientPubkeys: [BOB, ALICE] });

    expect(dedupeOnchainZaps([forward, reversed])).toHaveLength(1);
  });

  it("keeps one transaction's zaps to different targets apart", () => {
    const first = claim({ eventId: "1", targetId: TARGET });
    const second = claim({ eventId: "2", targetId: "f".repeat(64) });

    expect(dedupeOnchainZaps([first, second])).toHaveLength(2);
  });

  it("keeps an e-target and an a-target apart", () => {
    const byEvent = claim({ eventId: "1", targetId: TARGET });
    const byAddress = claim({
      eventId: "2",
      targetId: undefined,
      targetAddress: `30000:${ALICE}:list`,
    });

    expect(dedupeOnchainZaps([byEvent, byAddress])).toHaveLength(2);
  });
});

describe("verifyAgainstOutputs", () => {
  const ALICE_ADDR = "bc1p-alice";
  const BOB_ADDR = "bc1p-bob";
  const CAROL_ADDR = "bc1p-carol";
  const SENDER_ADDR = "bc1p-sender";

  it("sums what reached the single listed recipient", () => {
    expect(
      verifyAgainstOutputs(
        [{ address: ALICE_ADDR, value: 25000 }],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(25000);
  });

  it("sums across the recipients that were actually paid", () => {
    expect(
      verifyAgainstOutputs(
        [
          { address: ALICE_ADDR, value: 25000 },
          { address: BOB_ADDR, value: 50000 },
        ],
        [ALICE_ADDR, BOB_ADDR, CAROL_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(75000);
  });

  it("counts several outputs to one recipient", () => {
    expect(
      verifyAgainstOutputs(
        [
          { address: ALICE_ADDR, value: 600 },
          { address: ALICE_ADDR, value: 400 },
        ],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(1000);
  });

  it("excludes the sender's change", () => {
    // The bulk of a real transaction is usually change, so counting it would
    // inflate every zap by roughly the sender's whole balance.
    expect(
      verifyAgainstOutputs(
        [
          { address: ALICE_ADDR, value: 25000 },
          { address: SENDER_ADDR, value: 4_000_000 },
        ],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(25000);
  });

  it("ignores outputs to addresses nobody listed", () => {
    expect(
      verifyAgainstOutputs(
        [{ address: "bc1p-stranger", value: 999999 }],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(0);
  });

  it("ignores an output with no address, such as OP_RETURN", () => {
    expect(
      verifyAgainstOutputs(
        [{ value: 0 }, { address: ALICE_ADDR, value: 1000 }],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(1000);
  });

  it("ignores a non-finite or non-positive value", () => {
    expect(
      verifyAgainstOutputs(
        [
          { address: ALICE_ADDR, value: Number.NaN },
          { address: ALICE_ADDR, value: -100 },
          { address: ALICE_ADDR, value: 500 },
        ],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(500);
  });

  it("returns 0 when nothing reached a recipient", () => {
    expect(
      verifyAgainstOutputs(
        [{ address: SENDER_ADDR, value: 100000 }],
        [ALICE_ADDR],
        SENDER_ADDR,
      ),
    ).toBe(0);
  });

  it("returns 0 when no recipient address could be derived", () => {
    expect(
      verifyAgainstOutputs(
        [{ address: ALICE_ADDR, value: 1000 }],
        [],
        SENDER_ADDR,
      ),
    ).toBe(0);
  });

  it("still verifies when the sender's address is unknown", () => {
    expect(
      verifyAgainstOutputs(
        [{ address: ALICE_ADDR, value: 1000 }],
        [ALICE_ADDR],
        null,
      ),
    ).toBe(1000);
  });
});
