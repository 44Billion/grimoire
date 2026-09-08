import { describe, expect, it } from "vitest";

import type { NostrEvent } from "@/types/nostr";
import {
  dropReplayedOnchainZaps,
  onchainZapToMessage,
} from "./onchain-zap-message";

const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";
const SENDER = "a".repeat(64);
const ALICE = "b".repeat(64);
const TARGET = "e".repeat(64);

function zap(tags: string[][], content = "nice"): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: SENDER,
    created_at: 1_700_000_000,
    kind: 8333,
    tags,
    content,
    sig: "0".repeat(128),
  };
}

const wellFormed = [
  ["i", `bitcoin:tx:${TXID}`],
  ["p", ALICE],
  ["amount", "25000"],
  ["e", TARGET, "wss://relay.example.com"],
  ["alt", "Onchain zap: 25000 sats"],
];

describe("onchainZapToMessage", () => {
  it("builds a zap row authored by the sender", () => {
    const message = onchainZapToMessage(zap(wellFormed), "conv", "nip-10");

    expect(message).toMatchObject({
      id: "1".repeat(64),
      conversationId: "conv",
      // The signer IS the sender. A 9735 needs `getZapSender` because its
      // signer is the recipient's LNURL provider; an 8333 has no such detour.
      author: SENDER,
      content: "nice",
      type: "zap",
      protocol: "nip-10",
    });
  });

  it("never sets zapAmount, which ChatViewer would print unchecked", () => {
    // This is the load-bearing assertion for the whole chat path: the claimed
    // figure must not reach a field that is rendered directly, and it must not
    // be replaced by a 0 that would render as a literal "0" either.
    const message = onchainZapToMessage(zap(wellFormed), "conv", "nip-10");

    expect(message?.metadata).not.toHaveProperty("zapAmount");
    expect(message?.metadata?.onchainZap?.claimedSats).toBe(25000);
  });

  it("keeps the relay hint from the e tag in the reply pointer", () => {
    const message = onchainZapToMessage(zap(wellFormed), "conv", "nip-10");

    expect(message?.replyTo).toMatchObject({ id: TARGET });
    // applesauce normalises and validates the hint, hence the trailing slash;
    // it drops one it cannot parse, which is why the fixture uses a real shape.
    expect((message?.replyTo as { relays?: string[] }).relays).toContain(
      "wss://relay.example.com/",
    );
  });

  it("has no reply target for a profile-level tip", () => {
    const message = onchainZapToMessage(
      zap([
        ["i", `bitcoin:tx:${TXID}`],
        ["p", ALICE],
        ["amount", "1000"],
      ]),
      "conv",
      "nip-22",
    );

    expect(message?.replyTo).toBeUndefined();
  });

  it("gives no row to a self-zap or a malformed event", () => {
    expect(
      onchainZapToMessage(
        zap([
          ["i", `bitcoin:tx:${TXID}`],
          ["p", SENDER],
          ["amount", "1000"],
        ]),
        "conv",
        "nip-10",
      ),
    ).toBeNull();

    expect(
      onchainZapToMessage(
        zap([
          ["p", ALICE],
          ["amount", "1000"],
        ]),
        "conv",
        "nip-10",
      ),
    ).toBeNull();
  });

  it("carries the protocol it was told, so the row routes correctly", () => {
    for (const protocol of ["nip-10", "nip-22", "nip-53"] as const) {
      expect(
        onchainZapToMessage(zap(wellFormed), "conv", protocol)?.protocol,
      ).toBe(protocol);
    }
  });
});

const THIEF = "f".repeat(64);
const OTHER_TX = "b".repeat(64);

function at(created_at: number, over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    ...zap(wellFormed),
    created_at,
    id: `${created_at}`.padEnd(64, "0"),
    ...over,
  };
}

describe("dropReplayedOnchainZaps", () => {
  it("keeps the earliest claim when a zap is re-signed by someone else", () => {
    // The attack this exists for: an 8333 is self-attested, so a thief can
    // re-sign someone else's tags under their own key. Nothing downstream
    // catches it — they are not in the `p` set, so the self-zap gate passes,
    // and verification SUCCEEDS, because the transaction really did pay the
    // listed recipients. The row would credit the thief with a verified zap.
    const original = at(1_000);
    const stolen = at(2_000, { pubkey: THIEF });

    const kept = dropReplayedOnchainZaps([original, stolen]);

    expect(kept).toEqual([original]);
  });

  it("does not depend on arrival order", () => {
    const original = at(1_000);
    const stolen = at(2_000, { pubkey: THIEF });

    expect(dropReplayedOnchainZaps([stolen, original])).toEqual([original]);
  });

  it("keeps a batch announced as one event per recipient", () => {
    // Amethyst's real shape: one transaction, one zapped event, an event per
    // recipient. These are not replays of each other.
    const toAlice = at(1_000);
    const toOther = at(1_001, {
      tags: [
        ["i", `bitcoin:tx:${TXID}`],
        ["p", "c".repeat(64)],
        ["amount", "606"],
        ["e", TARGET],
      ],
    });

    expect(dropReplayedOnchainZaps([toAlice, toOther])).toHaveLength(2);
  });

  it("keeps zaps of different transactions", () => {
    const first = at(1_000);
    const second = at(1_001, {
      tags: [
        ["i", `bitcoin:tx:${OTHER_TX}`],
        ["p", ALICE],
        ["amount", "25000"],
        ["e", TARGET],
      ],
    });

    expect(dropReplayedOnchainZaps([first, second])).toHaveLength(2);
  });

  it("passes other kinds through untouched", () => {
    const note = { ...zap([]), kind: 1, id: "note".padEnd(64, "0") };
    const reaction = { ...zap([]), kind: 7, id: "react".padEnd(64, "0") };
    const original = at(1_000);
    const stolen = at(2_000, { pubkey: THIEF });

    const kept = dropReplayedOnchainZaps([note, original, reaction, stolen]);

    expect(kept.map((e) => e.kind)).toEqual([1, 8333, 7]);
  });

  it("leaves a single-zap batch alone without doing any work", () => {
    const only = at(1_000);
    const events = [only];

    // Same array back, so the common case allocates nothing.
    expect(dropReplayedOnchainZaps(events)).toBe(events);
  });

  it("leaves malformed zaps for the per-event gate to reject", () => {
    // Dropping them here would be indistinguishable from deduping them, and
    // `onchainZapToMessage` already refuses each one individually.
    const malformed = at(1_000, { tags: [["p", ALICE]] });
    const alsoMalformed = at(1_001, { tags: [["amount", "1"]] });
    const events = [malformed, alsoMalformed];

    expect(dropReplayedOnchainZaps(events)).toEqual(events);
    expect(onchainZapToMessage(malformed, "conv", "nip-10")).toBeNull();
  });
});
