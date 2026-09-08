// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { OnchainZapClaim } from "@/lib/onchain-zap";
import type { OnchainZapResult } from "@/hooks/useOnchainZap";

/**
 * The one rule this feature exists to enforce: the sender's claimed figure
 * never reaches the screen.
 *
 * A kind-8333 event is signed by the payer, so its `amount` tag is a claim the
 * spec calls "trivially spoofable". Every state other than `verified` must
 * therefore show no number at all — not the claim, and not a zero standing in
 * for it. These cases fail if a future change reaches for `claim.claimedSats`
 * to fill a gap while the chain is still being consulted.
 */

// The amount slot is what is under test; the surrounding chrome is not, and
// `UserName` and `RichText` would each drag in the event store.
vi.mock("@/core/state", () => ({
  useGrimoire: () => ({ locale: { locale: "en-US" } }),
  useAddWindow: () => vi.fn(),
}));

const CLAIMED = 999_999;
const VERIFIED = 1_000;
const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

const claim: OnchainZapClaim = {
  eventId: "1".repeat(64),
  txid: TXID,
  senderPubkey: "a".repeat(64),
  recipientPubkeys: ["b".repeat(64)],
  claimedSats: CLAIMED,
  comment: "",
  createdAt: 1_700_000_000,
};

async function renderWith(verdict: OnchainZapResult) {
  const { OnchainZapAmount } = await import("./OnchainZapRenderer");
  return render(<OnchainZapAmount claim={claim} verdict={verdict} />);
}

const base = { confirmed: true, overclaimed: false, txid: TXID };

describe("OnchainZapAmount", () => {
  it("shows nothing numeric while the transaction is being fetched", async () => {
    const { container } = await renderWith({
      ...base,
      status: "verifying",
      confirmed: false,
    });

    expect(container.textContent).not.toContain("999");
    expect(container.textContent ?? "").not.toMatch(/\d/);
  });

  it("shows no number when the explorer cannot be reached", async () => {
    const { container } = await renderWith({
      ...base,
      status: "unavailable",
      confirmed: false,
    });

    // "unverified", not a figure: an outage is not a verdict about the money.
    expect(container.textContent).toContain("unverified");
    expect(container.textContent).not.toContain("999");
  });

  it("renders nothing at all when verification rejected the zap", async () => {
    const { container } = await renderWith({
      ...base,
      status: "rejected",
      confirmed: false,
    });

    expect(container.textContent).toBe("");
  });

  it("renders the verified figure, never the larger claim", async () => {
    const { container } = await renderWith({
      ...base,
      status: "verified",
      amountSats: VERIFIED,
      overclaimed: true,
    });

    // Compact in the row, exact in the tooltip — "1.2K" is not a figure a
    // reader could check against a transaction.
    expect(container.textContent).toContain("1K");
    expect(container.querySelector("[title]")).toBeTruthy();
    expect(container.innerHTML).toContain("1,000 sats, verified on-chain");
    expect(container.textContent).not.toContain("999");
  });

  it("marks an unconfirmed transaction as pending", async () => {
    const { container } = await renderWith({
      ...base,
      status: "verified",
      amountSats: VERIFIED,
      confirmed: false,
    });

    // It can still be replaced or dropped, so the row says so.
    expect(container.textContent).toContain("pending");
  });

  it("does not mark a confirmed transaction as pending", async () => {
    const { container } = await renderWith({
      ...base,
      status: "verified",
      amountSats: VERIFIED,
    });

    expect(container.textContent).not.toContain("pending");
  });

  it("links the transaction to mempool.space in every visible state", async () => {
    for (const verdict of [
      { ...base, status: "verifying" as const, confirmed: false },
      { ...base, status: "unavailable" as const, confirmed: false },
      { ...base, status: "verified" as const, amountSats: VERIFIED },
    ]) {
      const { container } = await renderWith(verdict);
      const link = container.querySelector("a");
      expect(link?.getAttribute("href")).toBe(
        `https://mempool.space/tx/${TXID}`,
      );
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});
