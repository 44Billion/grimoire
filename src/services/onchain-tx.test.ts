import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import db from "@/services/db";
import {
  ensureOnchainTx,
  getAttemptState,
  resetOnchainTxAttempts,
} from "./onchain-tx";

const TXID = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

function esploraResponse(
  body: unknown,
  init: { status?: number } = {},
): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

const confirmedTx = {
  status: { confirmed: true },
  vout: [
    { scriptpubkey_address: "bc1p-alice", value: 25000 },
    { scriptpubkey_address: "bc1p-sender", value: 4_000_000 },
  ],
};

/**
 * Run one lookup to completion.
 *
 * Awaits the promise `ensureOnchainTx` hands back rather than spinning a fixed
 * number of microtasks. A tick count is a race, and this suite proved it:
 * these cases passed alone and failed inside the full run.
 */
async function settle(lookup?: Promise<void>): Promise<void> {
  await lookup;
}

describe("ensureOnchainTx", () => {
  beforeEach(async () => {
    resetOnchainTxAttempts();
    await db.onchainTxCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("caches the transaction's outputs and confirmation state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => esploraResponse(confirmedTx)),
    );

    await settle(ensureOnchainTx(TXID));

    const row = await db.onchainTxCache.get(TXID);
    expect(row?.confirmed).toBe(1);
    expect(row?.missing).toBe(0);
    expect(row?.outputs).toEqual([
      { address: "bc1p-alice", value: 25000 },
      { address: "bc1p-sender", value: 4_000_000 },
    ]);
  });

  it("records an unconfirmed transaction as pending, not as absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        esploraResponse({
          status: { confirmed: false },
          vout: [{ scriptpubkey_address: "bc1p-alice", value: 1000 }],
        }),
      ),
    );

    await settle(ensureOnchainTx(TXID));

    expect((await db.onchainTxCache.get(TXID))?.confirmed).toBe(0);
  });

  it("keeps an output with no address form, such as OP_RETURN", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        esploraResponse({
          status: { confirmed: true },
          vout: [
            { value: 0 },
            { scriptpubkey_address: "bc1p-alice", value: 5 },
          ],
        }),
      ),
    );

    await settle(ensureOnchainTx(TXID));

    // Kept rather than dropped so the stored outputs still mirror the
    // transaction; `verifyAgainstOutputs` is what skips it.
    expect((await db.onchainTxCache.get(TXID))?.outputs).toEqual([
      { value: 0 },
      { address: "bc1p-alice", value: 5 },
    ]);
  });

  it("makes one request when several rows cite the same transaction", async () => {
    const fetchMock = vi.fn(async () => esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    const first = ensureOnchainTx(TXID);
    ensureOnchainTx(TXID);
    ensureOnchainTx(TXID);
    await settle(first);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refetch a confirmed transaction — its outputs are immutable", async () => {
    const fetchMock = vi.fn(async () => esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));
    resetOnchainTxAttempts();
    await settle(ensureOnchainTx(TXID));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("persists a 404 as missing, so the zap is discarded for good", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => esploraResponse({}, { status: 404 })),
    );

    await settle(ensureOnchainTx(TXID));

    const row = await db.onchainTxCache.get(TXID);
    expect(row?.missing).toBe(1);
    expect(row?.outputs).toEqual([]);
    // "No such transaction" is an answer, not a failure to reach anyone.
    expect(getAttemptState(TXID)).toBe("idle");
  });

  it("leaves nothing cached when the explorer cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await settle(ensureOnchainTx(TXID));

    // Nothing persisted: an outage must never harden into a verdict about the
    // transaction, or a zap would stay hidden after the network came back.
    expect(await db.onchainTxCache.get(TXID)).toBeUndefined();
    expect(getAttemptState(TXID)).toBe("failed");
  });

  it("treats a 5xx as unreachable rather than as a missing transaction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => esploraResponse({}, { status: 503 })),
    );

    await settle(ensureOnchainTx(TXID));

    // No verdict cached: a bad afternoon at an explorer says nothing about
    // whether the money moved.
    expect(await db.onchainTxCache.get(TXID)).toBeUndefined();
    expect(getAttemptState(TXID)).toBe("failed");
  });

  it("holds off briefly after a failure, then tries again", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    // One lookup costs one request per host, since neither could answer.
    await settle(ensureOnchainTx(TXID));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Immediately after: still cooling down, so no new requests.
    await settle(ensureOnchainTx(TXID));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    await settle(ensureOnchainTx(TXID));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.mocked(Date.now).mockRestore();
  });

  it("reports pending while the lookup is in flight", async () => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await blocked;
        return esploraResponse(confirmedTx);
      }),
    );

    const lookup = ensureOnchainTx(TXID);
    // `inFlight` is populated synchronously, so this needs no waiting at all.
    expect(getAttemptState(TXID)).toBe("pending");

    release();
    await settle(lookup);
    expect(getAttemptState(TXID)).toBe("idle");
  });

  it("refuses to put a malformed txid into a request path", async () => {
    const fetchMock = vi.fn(async () => esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx("../../etc/passwd"));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ensureOnchainTx — host failover", () => {
  beforeEach(async () => {
    resetOnchainTxAttempts();
    await db.onchainTxCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to the second host when the first 5xxs", async () => {
    // Not hypothetical: the first live run of this code got a 503 from
    // mempool.space and then a hard timeout, while blockstream answered 200
    // for the same transaction.
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("mempool.space")
        ? esploraResponse({}, { status: 503 })
        : esploraResponse(confirmedTx),
    );
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    expect((await db.onchainTxCache.get(TXID))?.confirmed).toBe(1);
    expect(fetchMock.mock.calls.map(([u]) => u as string)).toEqual([
      expect.stringContaining("mempool.space"),
      expect.stringContaining("blockstream.info"),
    ]);
  });

  it("falls back when the first host does not respond at all", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("mempool.space")) throw new Error("timeout");
      return esploraResponse(confirmedTx);
    });
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    expect((await db.onchainTxCache.get(TXID))?.outputs).toHaveLength(2);
  });

  it("does not ask a second host after a 404", async () => {
    // Both hosts index the same chain, so "no such transaction" is an answer.
    // Asking again would only widen who learns the txid.
    const fetchMock = vi.fn(async () => esploraResponse({}, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await db.onchainTxCache.get(TXID))?.missing).toBe(1);
  });

  it("reports unreachable only when every host failed", async () => {
    const fetchMock = vi.fn(async () => esploraResponse({}, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.onchainTxCache.get(TXID)).toBeUndefined();
    expect(getAttemptState(TXID)).toBe("failed");
  });

  it("stops at the first host when it answers", async () => {
    const fetchMock = vi.fn(async () => esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    // In the ordinary case exactly one party learns the txid, and it is the
    // one the reader can see named in the transaction link.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ensureOnchainTx — cache lifetimes", () => {
  beforeEach(async () => {
    resetOnchainTxAttempts();
    await db.onchainTxCache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-asks about a 404 after a while", async () => {
    // The spec publishes an 8333 AFTER broadcasting, and relay propagation can
    // beat an explorer's index, so a real zap can 404 once. Treating that as
    // final would discard it permanently on this browser.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(esploraResponse({}, { status: 404 }))
      .mockResolvedValue(esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));
    expect((await db.onchainTxCache.get(TXID))?.missing).toBe(1);

    // Still inside the window: taken as settled.
    resetOnchainTxAttempts();
    await settle(ensureOnchainTx(TXID));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    resetOnchainTxAttempts();
    await settle(ensureOnchainTx(TXID));

    const row = await db.onchainTxCache.get(TXID);
    expect(row?.missing).toBe(0);
    expect(row?.confirmed).toBe(1);
  });

  it("re-asks about an unconfirmed transaction sooner", async () => {
    const unconfirmed = {
      status: { confirmed: false },
      vout: [{ scriptpubkey_address: "bc1p-alice", value: 1000 }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(esploraResponse(unconfirmed))
      .mockResolvedValue(esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));
    expect((await db.onchainTxCache.get(TXID))?.confirmed).toBe(0);

    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 90_000);
    resetOnchainTxAttempts();
    await settle(ensureOnchainTx(TXID));

    // It settled, so the row is now final.
    expect((await db.onchainTxCache.get(TXID))?.confirmed).toBe(1);
  });

  it("never re-asks about a confirmed transaction", async () => {
    const fetchMock = vi.fn(async () => esploraResponse(confirmedTx));
    vi.stubGlobal("fetch", fetchMock);

    await settle(ensureOnchainTx(TXID));

    // A mined transaction's outputs are immutable, so there is nothing to
    // learn by asking again — not after a minute, not after a year.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 365 * 24 * 3600_000);
    resetOnchainTxAttempts();
    await settle(ensureOnchainTx(TXID));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
