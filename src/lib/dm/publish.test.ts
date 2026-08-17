import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { finalizeEvent, generateSecretKey, kinds } from "nostr-tools";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import dmPublishPool from "@/services/dm-publish-pool";
import { normalizeRelayURL } from "@/lib/relay-url";
import { publishGiftWrap, resetGiftWrapRefusals } from "./publish";

/**
 * The gift-wrap publish path, which exists to NOT do something: identify the
 * sender. Every case here is a way that guarantee can quietly lapse.
 */

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

/** A wrap looks like the real thing: ephemeral key, kind 1059, p-tagged. */
function giftWrap(recipient = "a".repeat(64)) {
  return finalizeEvent(
    {
      kind: kinds.GiftWrap,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", recipient]],
      content: "ciphertext",
    },
    generateSecretKey(),
  );
}

beforeEach(() => resetGiftWrapRefusals());

afterEach(async () => {
  dmPublishPool.close();
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("publishGiftWrap", () => {
  it("reports the relays that took the wrap", async () => {
    const r = await relay({ kind: "normal" });

    const results = await publishGiftWrap(giftWrap(), [r.url]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, authRequired: false });
    expect(r.accepted()).toHaveLength(1);
  });

  it("reports auth-required as its own outcome instead of authenticating", async () => {
    const r = await relay({ kind: "auth-required" });

    const results = await publishGiftWrap(giftWrap(), [r.url]);

    expect(results[0]).toMatchObject({ ok: false, authRequired: true });
    expect(r.accepted()).toEqual([]);
  });

  it("leaves a relay that challenges on connect no idea who we are", async () => {
    // `nip42-gated` is the behaviour that can actually catch this: it sends an
    // AUTH challenge on connect and records every pubkey that answers one. If
    // this publish is ever rerouted onto the auth-managed singleton pool, or an
    // auth manager is pointed at this one, the relay ends up holding both the
    // anonymous wrap and the real pubkey that pushed it — and this fails.
    const r = await relay({ kind: "nip42-gated" });

    const results = await publishGiftWrap(giftWrap(), [r.url]);

    expect(results[0]).toMatchObject({ ok: false, authRequired: true });
    expect(r.authedPubkeys()).toEqual([]);
    expect(r.accepted()).toEqual([]);
  });

  it("does not pay the auth wait twice for the same relay", async () => {
    const r = await relay({ kind: "auth-required" });

    await publishGiftWrap(giftWrap(), [r.url]);

    // applesauce latches `receivedAuthRequiredForEvent` per Relay instance, so
    // without the session memo this second call sits in waitForAuth until the
    // publish timeout — nothing on this pool will ever authenticate it.
    const started = performance.now();
    const results = await publishGiftWrap(giftWrap(), [r.url]);
    const elapsed = performance.now() - started;

    expect(results[0]).toMatchObject({ ok: false, authRequired: true });
    expect(elapsed).toBeLessThan(500);
  });

  it("reports each relay separately so a partial delivery is visible", async () => {
    const good = await relay({ kind: "normal" });
    const gated = await relay({ kind: "auth-required" });

    const results = await publishGiftWrap(giftWrap(), [good.url, gated.url]);
    const byRelay = new Map(
      results.map((r) => [normalizeRelayURL(r.relay), r]),
    );

    expect(byRelay.get(normalizeRelayURL(good.url))).toMatchObject({
      ok: true,
    });
    expect(byRelay.get(normalizeRelayURL(gated.url))).toMatchObject({
      ok: false,
      authRequired: true,
    });
  });

  it("never sends the same wrap to one relay twice", async () => {
    const r = await relay({ kind: "normal" });

    // Duplicate URLs reach this function easily: a peer's 10050 and the user's
    // own read set overlap far more often than not.
    const results = await publishGiftWrap(giftWrap(), [r.url, r.url]);

    expect(results).toHaveLength(1);
    expect(r.accepted()).toHaveLength(1);
  });
});
