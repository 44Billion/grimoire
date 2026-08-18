import { describe, expect, it, vi } from "vitest";

import {
  MOCK_PAYMENT_HASH,
  MOCK_PREIMAGE,
  mockInvoice,
  paymentHashOf,
} from "@/test/bolt11-mock";

import { verifyZapRumor, zapRumorTags } from "@/lib/concord/zaps";

vi.mock("applesauce-common/helpers/bolt11", async (importOriginal) => {
  const { mockParseBolt11 } = await import("@/test/bolt11-mock");
  return mockParseBolt11(
    await importOriginal<typeof import("applesauce-common/helpers/bolt11")>(),
  );
});

function zap(overrides: Partial<Record<string, string>> = {}) {
  const tags: Record<string, string | undefined> = {
    amount: "21000",
    bolt11: mockInvoice(21000),
    preimage: MOCK_PREIMAGE,
    ...overrides,
  };
  return {
    kind: 9735,
    tags: Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, value as string]),
  };
}

describe("verifyZapRumor", () => {
  it("returns the payment hash when the preimage settles the invoice", () => {
    expect(verifyZapRumor(zap())).toBe(MOCK_PAYMENT_HASH);
  });

  it("verifies any preimage/hash pair, not just the fixture's", () => {
    const preimage = "ab".repeat(32);
    expect(
      verifyZapRumor(
        zap({
          preimage,
          bolt11: mockInvoice(21000, { paymentHash: paymentHashOf(preimage) }),
        }),
      ),
    ).toBe(paymentHashOf(preimage));
  });

  it("refuses a preimage that settles a different invoice", () => {
    expect(verifyZapRumor(zap({ preimage: "ab".repeat(32) }))).toBe(null);
  });

  it("refuses an `amount` tag the invoice does not carry", () => {
    expect(verifyZapRumor(zap({ amount: "22000" }))).toBe(null);
  });

  it("refuses an amountless invoice", () => {
    expect(
      verifyZapRumor(zap({ bolt11: mockInvoice(0, { amountless: true }) })),
    ).toBe(null);
  });

  it("refuses a malformed preimage", () => {
    expect(verifyZapRumor(zap({ preimage: "nope" }))).toBe(null);
    expect(verifyZapRumor(zap({ preimage: "AB".repeat(32) }))).toBe(null);
    expect(verifyZapRumor(zap({ preimage: undefined }))).toBe(null);
  });

  it("refuses a missing or undecodable invoice", () => {
    expect(verifyZapRumor(zap({ bolt11: undefined }))).toBe(null);
    expect(verifyZapRumor(zap({ bolt11: "not-an-invoice" }))).toBe(null);
  });

  it("refuses a non-positive or absent amount", () => {
    expect(verifyZapRumor(zap({ amount: "0" }))).toBe(null);
    expect(verifyZapRumor(zap({ amount: "-1" }))).toBe(null);
    expect(verifyZapRumor(zap({ amount: undefined }))).toBe(null);
  });

  it("refuses any kind but 9735", () => {
    expect(verifyZapRumor({ ...zap(), kind: 9 })).toBe(null);
  });
});

describe("zapRumorTags", () => {
  it("builds the CORD.md tag set", () => {
    expect(
      zapRumorTags({
        targetId: "aa".repeat(32),
        targetKind: 9,
        recipient: "bb".repeat(32),
        amountMsats: 21000,
        bolt11: "lnbc21",
        preimage: MOCK_PREIMAGE,
      }),
    ).toEqual([
      ["e", "aa".repeat(32)],
      ["p", "bb".repeat(32)],
      ["k", "9"],
      ["amount", "21000"],
      ["bolt11", "lnbc21"],
      ["preimage", MOCK_PREIMAGE],
    ]);
  });

  it("omits the target for a sender whose transport appends it", () => {
    const tags = zapRumorTags({
      targetId: "aa".repeat(32),
      targetKind: 9,
      recipient: "bb".repeat(32),
      amountMsats: 21000,
      bolt11: "lnbc21",
      preimage: MOCK_PREIMAGE,
      omitTarget: true,
    });
    expect(tags.some(([name]) => name === "e")).toBe(false);
  });
});
