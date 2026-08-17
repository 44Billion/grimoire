import { describe, expect, it } from "vitest";
import { expand } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { nip44 } from "nostr-tools";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
} from "nostr-tools/pure";
import type { NostrEvent } from "nostr-tools/pure";

import { bytesToHex, random32 } from "./derive";
import {
  KIND_COMMENT,
  KIND_EDIT,
  KIND_MESSAGE,
  KIND_SEAL_ENCRYPTED,
} from "./kinds";
import {
  parsePinListContent,
  verifyPinEntries,
  verifyPinEntry,
  type PinProof,
  PIN_MAX_CONTENT_BYTES,
} from "./pins";

const authorSk = generateSecretKey();
const authorPk = getPublicKey(authorSk);
const channelIdHex = bytesToHex(random32());
/** Stands in for a Channel's group conversation key. */
const convKey = random32();

/** Build a chat rumor exactly as `send.ts` binds one (CORD-03 §3). */
function rumorOf(
  overrides: Partial<{
    kind: number;
    content: string;
    pubkey: string;
    tags: string[][];
    created_at: number;
  }> = {},
) {
  return {
    kind: overrides.kind ?? KIND_MESSAGE,
    pubkey: overrides.pubkey ?? authorPk,
    content: overrides.content ?? "the pinned line",
    created_at: overrides.created_at ?? 1_700_000_000,
    tags: overrides.tags ?? [
      ["channel", channelIdHex],
      ["epoch", "0"],
    ],
  };
}

/**
 * Seal a rumor the way a Chat Plane does, and disclose that ONE message's key
 * expansion — the 76 bytes a pin carries.
 */
function proofOf(
  rumor: ReturnType<typeof rumorOf>,
  sealSk = authorSk,
): PinProof {
  const nonce = random32();
  const payload = nip44.encrypt(JSON.stringify(rumor), convKey, nonce);
  const keys = expand(sha256, convKey, nonce, 76);
  const seal = finalizeEvent(
    {
      kind: KIND_SEAL_ENCRYPTED,
      content: payload,
      tags: [],
      created_at: rumor.created_at,
    },
    sealSk,
  ) as NostrEvent;
  return { seal, keys: bytesToHex(keys) };
}

describe("verifyPinEntry", () => {
  it("proves author, words and channel from the seal alone", () => {
    const rumor = rumorOf();
    const verified = verifyPinEntry(proofOf(rumor), channelIdHex);
    expect(verified?.authorHex).toBe(authorPk);
    expect(verified?.content).toBe("the pinned line");
    expect(verified?.createdAt).toBe(1_700_000_000);
    // The id is recomputed from the decrypted bytes, never taken on trust.
    expect(verified?.rumorId).toBe(getEventHash(rumor));
  });

  it("accepts a threaded reply, and no other kind", () => {
    expect(
      verifyPinEntry(proofOf(rumorOf({ kind: KIND_COMMENT })), channelIdHex),
    ).toBeDefined();
    // An Edit is only ever the `edit` bundle; a delete is never a pin.
    expect(
      verifyPinEntry(proofOf(rumorOf({ kind: KIND_EDIT })), channelIdHex),
    ).toBeUndefined();
    expect(
      verifyPinEntry(proofOf(rumorOf({ kind: 5 })), channelIdHex),
    ).toBeUndefined();
  });

  it("drops a doctored ciphertext — the MAC binds it to the disclosure", () => {
    const proof = proofOf(rumorOf());
    const bytes = atob(proof.seal.content);
    const tampered =
      bytes.slice(0, 40) +
      String.fromCharCode(bytes.charCodeAt(40) ^ 0xff) +
      bytes.slice(41);
    proof.seal = { ...proof.seal, content: btoa(tampered) };
    expect(verifyPinEntry(proof, channelIdHex)).toBeUndefined();
  });

  it("drops an unsigned or wrongly-signed seal", () => {
    const proof = proofOf(rumorOf());
    proof.seal = { ...proof.seal, sig: "0".repeat(128) };
    expect(verifyPinEntry(proof, channelIdHex)).toBeUndefined();
  });

  it("drops a seal whose author is not the rumor's — NIP-59's check", () => {
    // A keyholder re-sealing someone else's rumor under their own key.
    const proof = proofOf(rumorOf(), generateSecretKey());
    expect(verifyPinEntry(proof, channelIdHex)).toBeUndefined();
  });

  it("drops a message sealed in ANOTHER channel, and one bound to none", () => {
    // Without this, a private Channel's keyholder could pin its messages into a
    // public list and disclose them community-wide, with proof.
    const foreign = rumorOf({
      tags: [
        ["channel", bytesToHex(random32())],
        ["epoch", "0"],
      ],
    });
    expect(verifyPinEntry(proofOf(foreign), channelIdHex)).toBeUndefined();
    const unbound = rumorOf({ tags: [["epoch", "0"]] });
    expect(verifyPinEntry(proofOf(unbound), channelIdHex)).toBeUndefined();
  });

  it("drops a truncated or mis-sized key disclosure rather than guessing", () => {
    const proof = proofOf(rumorOf());
    expect(
      verifyPinEntry(
        { ...proof, keys: proof.keys.slice(0, 150) },
        channelIdHex,
      ),
    ).toBeUndefined();
    expect(
      verifyPinEntry({ ...proof, keys: "zz".repeat(76) }, channelIdHex),
    ).toBeUndefined();
  });

  describe("the edit bundle", () => {
    const original = rumorOf();
    const originalId = getEventHash(original);
    const editRumor = (over: Partial<Parameters<typeof rumorOf>[0]> = {}) =>
      rumorOf({
        kind: KIND_EDIT,
        content: "the corrected line",
        tags: [
          ["channel", channelIdHex],
          ["epoch", "0"],
          ["e", originalId],
        ],
        ...over,
      });

    it("carries the correction when it proves out", () => {
      const proof = proofOf(original);
      proof.edit = proofOf(editRumor());
      const verified = verifyPinEntry(proof, channelIdHex);
      expect(verified?.content).toBe("the pinned line");
      expect(verified?.edited?.content).toBe("the corrected line");
    });

    it("ignores an edit by anyone but the proven author", () => {
      const otherSk = generateSecretKey();
      const proof = proofOf(original);
      proof.edit = proofOf(
        editRumor({ pubkey: getPublicKey(otherSk) }),
        otherSk,
      );
      expect(verifyPinEntry(proof, channelIdHex)?.edited).toBeUndefined();
    });

    it("ignores an edit that names a different message", () => {
      const proof = proofOf(original);
      proof.edit = proofOf(
        editRumor({
          tags: [
            ["channel", channelIdHex],
            ["epoch", "0"],
            ["e", "ff".repeat(32)],
          ],
        }),
      );
      expect(verifyPinEntry(proof, channelIdHex)?.edited).toBeUndefined();
    });

    it("still renders the pin when the edit bundle is junk", () => {
      const proof = proofOf(original);
      proof.edit = { seal: proof.seal, keys: "00".repeat(76) };
      expect(verifyPinEntry(proof, channelIdHex)?.content).toBe(
        "the pinned line",
      );
    });
  });
});

describe("verifyPinEntries", () => {
  it("drops the failures and keeps one entry per proven message", () => {
    const good = proofOf(rumorOf());
    const entries = [good, good, { seal: good.seal, keys: "00".repeat(76) }];
    const verified = verifyPinEntries(entries, channelIdHex);
    expect(verified).toHaveLength(1);
  });
});

describe("parsePinListContent", () => {
  it("reads the public form", () => {
    const parsed = parsePinListContent(JSON.stringify({ entries: [1, 2] }));
    expect(parsed).toEqual({ form: "public", entries: [1, 2] });
  });

  it("reads the sealed form, epoch as the decimal string it rides as", () => {
    const parsed = parsePinListContent(
      JSON.stringify({ epoch: "4", sealed: "abc" }),
    );
    expect(parsed).toEqual({ form: "sealed", epoch: 4n, sealed: "abc" });
  });

  it("reads a violating list as EMPTY rather than refusing the edition", () => {
    // Refusing would fork the version chain between implementations; the cost
    // of the breach lands on the violator's own list instead.
    const over = JSON.stringify({
      entries: Array.from({ length: 26 }, () => 1),
    });
    expect(parsePinListContent(over)).toEqual({ form: "public", entries: [] });

    const heavy = JSON.stringify({
      entries: ["x".repeat(PIN_MAX_CONTENT_BYTES)],
    });
    expect(parsePinListContent(heavy)).toEqual({ form: "public", entries: [] });
  });

  it("reports garbage as unreadable, which is not an empty list", () => {
    // "Unreadable" must reach the UI as unavailable: an empty view and an
    // unopenable one are indistinguishable otherwise, and §7 hangs a write
    // refusal on telling them apart.
    expect(parsePinListContent("not json")).toEqual({ form: "unreadable" });
    expect(parsePinListContent("[]")).toEqual({ form: "unreadable" });
  });
});
