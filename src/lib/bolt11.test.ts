import { describe, expect, it, vi } from "vitest";

import { bolt11AmountSats, bolt11Info } from "@/lib/bolt11";
import { mockInvoice } from "@/test/bolt11-mock";

vi.mock("applesauce-common/helpers/bolt11", async (importOriginal) => {
  const { mockParseBolt11 } = await import("@/test/bolt11-mock");
  return mockParseBolt11(
    await importOriginal<typeof import("applesauce-common/helpers/bolt11")>(),
  );
});

/** BOLT11 spec test vector: 2500u = 250,000,000 msats. */
const REAL_INVOICE =
  "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh";

describe("bolt11Info", () => {
  it("reads a real invoice's amount and payment hash", () => {
    const info = bolt11Info(REAL_INVOICE);
    expect(info.amountMsats).toBe(250_000_000);
    expect(info.paymentHash).toBe(
      "0001020304050607080900010203040506070809000102030405060708090102",
    );
    expect(bolt11AmountSats(REAL_INVOICE)).toBe(250_000);
  });

  it("treats an amountless invoice as unpriced rather than zero", () => {
    expect(bolt11Info(mockInvoice(0, { amountless: true })).amountMsats).toBe(
      null,
    );
    expect(bolt11AmountSats(mockInvoice(0, { amountless: true }))).toBe(null);
  });

  it("never throws on an undecodable invoice", () => {
    expect(bolt11Info("not-an-invoice")).toEqual({
      amountMsats: null,
      paymentHash: null,
    });
  });
});
