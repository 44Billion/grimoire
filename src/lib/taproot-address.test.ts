import { describe, it, expect } from "vitest";
import {
  deriveTaprootAddress,
  deriveTaprootAddresses,
} from "./taproot-address";

/**
 * The vector below is BIP-341's own, from `bip-0341/wallet-test-vectors.json`
 * in bitcoin/bips — the `scriptPubKey` case whose `scriptTree` is null, i.e. a
 * key-path-only output, which is exactly the shape a Nostr pubkey produces.
 * Sourced rather than invented on purpose: a hand-written pair would let a
 * wrong TapTweak pass, and a wrong tweak fails silently — every derived
 * address would look valid and match no transaction output, so every on-chain
 * zap would verify to zero and simply vanish from the UI.
 */
const BIP341_INTERNAL_KEY =
  "d6889cb081036e0faefa3a35157ad71086b123b2b144b649798b494c300a961d";
const BIP341_ADDRESS =
  "bc1p2wsldez5mud2yam29q22wgfh9439spgduvct83k3pm50fcxa5dps59h4z5";

describe("deriveTaprootAddress", () => {
  it("matches the BIP-341 key-path test vector", async () => {
    await expect(deriveTaprootAddress(BIP341_INTERNAL_KEY)).resolves.toBe(
      BIP341_ADDRESS,
    );
  });

  it("produces a mainnet bech32m address", async () => {
    const address = await deriveTaprootAddress(BIP341_INTERNAL_KEY);
    // `bc1p` is witness v1 on mainnet. The spec scopes kind 8333 to mainnet,
    // and this module takes no network argument so it cannot drift.
    expect(address?.startsWith("bc1p")).toBe(true);
  });

  it("accepts uppercase hex — a pubkey is a number, not a string", async () => {
    await expect(
      deriveTaprootAddress(BIP341_INTERNAL_KEY.toUpperCase()),
    ).resolves.toBe(BIP341_ADDRESS);
  });

  it("returns null for anything that is not a 32-byte hex key", async () => {
    for (const bad of [
      "",
      "deadbeef",
      BIP341_INTERNAL_KEY.slice(0, 63),
      `${BIP341_INTERNAL_KEY}ff`,
      `${BIP341_INTERNAL_KEY.slice(0, 63)}z`,
      "npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ]) {
      await expect(deriveTaprootAddress(bad)).resolves.toBeNull();
    }
  });

  it("returns null rather than throwing on a key off the curve", async () => {
    // 0xff…ff exceeds the field prime, so there is no curve point for it.
    await expect(deriveTaprootAddress("ff".repeat(32))).resolves.toBeNull();
  });

  it("is stable across calls, since the result is memoised", async () => {
    const first = await deriveTaprootAddress(BIP341_INTERNAL_KEY);
    const second = await deriveTaprootAddress(BIP341_INTERNAL_KEY);
    expect(second).toBe(first);
  });
});

describe("deriveTaprootAddresses", () => {
  it("keys by the lowercased pubkey and drops what it cannot derive", async () => {
    const map = await deriveTaprootAddresses([
      BIP341_INTERNAL_KEY.toUpperCase(),
      "not-a-pubkey",
      "ff".repeat(32),
    ]);

    expect(map.size).toBe(1);
    expect(map.get(BIP341_INTERNAL_KEY)).toBe(BIP341_ADDRESS);
  });

  it("returns an empty map for an empty input", async () => {
    await expect(deriveTaprootAddresses([])).resolves.toEqual(new Map());
  });
});
