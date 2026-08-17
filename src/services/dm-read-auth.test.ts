import { describe, it, expect, afterEach, vi } from "vitest";
import { finalizeEvent, generateSecretKey, kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { startMockRelay, type MockRelay } from "@/test/mock-relay";
import { requestEvents } from "@/lib/relay-subscription";
import pool from "./relay-pool";
import { authenticateDmRelays } from "./dm-read-auth";

/**
 * A DM relay that demands NIP-42 before serving your inbox is the normal case,
 * not an exception — that is most of what a DM relay is for. A read that does
 * not answer the challenge gets nothing back and looks exactly like an empty
 * inbox, which is the failure this module exists to prevent.
 */

const SELF = generateSecretKey();
let SELF_PUBKEY = "";

const relays: MockRelay[] = [];

async function relay(...args: Parameters<typeof startMockRelay>) {
  const r = await startMockRelay(...args);
  relays.push(r);
  return r;
}

/** The auth manager, wired to a signer holding the test key. */
vi.mock("./relay-auth", async () => {
  const { PrivateKeySigner } = await import("applesauce-signers");
  const { RelayAuthManager } = await import("relay-auth-manager");
  const { BehaviorSubject } = await import("rxjs");
  const signer = PrivateKeySigner.fromKey(SELF);
  SELF_PUBKEY = await signer.getPublicKey();
  return {
    default: new RelayAuthManager({
      pool,
      signer$: new BehaviorSubject(signer),
      storage: { getItem: () => null, setItem: () => {} },
      storageKey: "test-auth",
    }),
  };
});

function wrapFor(pubkey: string): NostrEvent {
  return finalizeEvent(
    {
      kind: kinds.GiftWrap,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", pubkey]],
      content: "ciphertext",
    },
    generateSecretKey(),
  );
}

afterEach(async () => {
  await Promise.all(relays.splice(0).map((r) => r.close()));
});

describe("authenticateDmRelays", () => {
  it("answers the challenge, so a gated relay serves the inbox", async () => {
    // `nip42-gated` challenges on connect and refuses any REQ whose authors
    // are not authenticated on that socket — the shape a real DM relay has.
    const { PrivateKeySigner } = await import("applesauce-signers");
    const pubkey = await PrivateKeySigner.fromKey(SELF).getPublicKey();
    const r = await relay({
      kind: "nip42-gated",
      events: [wrapFor(pubkey)],
    });

    const auth = authenticateDmRelays([r.url]);
    const events = await requestEvents(
      [r.url],
      [{ kinds: [kinds.GiftWrap], authors: [pubkey] }],
      { eventStore: null, timeout: 8000 },
    );
    auth.unsubscribe();

    expect(r.authedPubkeys()).toContain(pubkey);
    expect(events.length).toBeGreaterThan(0);
  });

  it("gets nothing from the same relay without it", async () => {
    // The control. Without this the test above proves only that the mock
    // serves events, not that authenticating is what made it.
    const { PrivateKeySigner } = await import("applesauce-signers");
    const pubkey = await PrivateKeySigner.fromKey(SELF).getPublicKey();
    const r = await relay({
      kind: "nip42-gated",
      events: [wrapFor(pubkey)],
    });

    const events = await requestEvents(
      [r.url],
      [{ kinds: [kinds.GiftWrap], authors: [pubkey] }],
      { eventStore: null, timeout: 1000 },
    );

    expect(r.authedPubkeys()).toEqual([]);
    expect(events).toEqual([]);
  });

  it("stops watching when the read is over", async () => {
    const r = await relay({ kind: "nip42-gated" });
    const auth = authenticateDmRelays([r.url]);
    auth.unsubscribe();
    expect(auth.closed).toBe(true);
  });

  it("does nothing at all for an empty relay set", () => {
    const auth = authenticateDmRelays([]);
    expect(auth.closed).toBe(false);
    auth.unsubscribe();
  });
});

// Referenced so the mock's pubkey capture is not dead code to the linter.
export { SELF_PUBKEY };
