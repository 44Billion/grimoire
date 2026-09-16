import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";

/**
 * `fetchManifestEvent` and the difference between an id and an address.
 *
 * The bug this pins down: the EventStore is hydrated from Dexie, so for a
 * replaceable manifest it held whatever was newest the last time anybody
 * looked, and returning that copy without asking a relay served a month-old
 * root site to a reader whose relays all had the redeploy.
 */
const store = { getTimeline: vi.fn() };
const requestEvent = vi.fn();
const requestEvents = vi.fn();

vi.mock("./event-store", () => ({ default: store, defaultEventStore: store }));
vi.mock("@/lib/relay-subscription", () => ({
  requestEvent: (...a: unknown[]) => requestEvent(...a),
  requestEvents: (...a: unknown[]) => requestEvents(...a),
  streamWithEose: vi.fn(),
}));
vi.mock("./relay-selection", () => ({
  selectRelaysForFilter: vi.fn(async () => ({ relays: ["wss://a.example"] })),
  fetchRelayList: vi.fn(),
}));
vi.mock("./napplet-library", () => ({
  getCachedManifest: vi.fn(async () => undefined),
  recordNapplet: vi.fn(),
}));
vi.mock("./blossom", () => ({ fetchUserServers: vi.fn() }));
vi.mock("./relay-list-cache", () => ({ default: {} }));
vi.mock("./loaders", () => ({ FALLBACK_RELAYS: [] }));

const { fetchManifestEvent } = await import("./napplet-host");

const pubkey = "a".repeat(64);
function manifest(kind: number, created_at: number, id: string): NostrEvent {
  return {
    id: id.padEnd(64, "0"),
    kind,
    pubkey,
    created_at,
    content: "",
    sig: "",
    tags: kind === 35128 ? [["d", "site"]] : [],
  } as NostrEvent;
}

beforeEach(() => {
  store.getTimeline.mockReset();
  requestEvent.mockReset();
  requestEvents.mockReset();
});

describe("fetchManifestEvent", () => {
  it("answers an id from the store without asking a relay", async () => {
    const cached = manifest(5128, 100, "1");
    store.getTimeline.mockReturnValue([cached]);
    const out = await fetchManifestEvent({ id: cached.id });
    expect(out).toBe(cached);
    expect(requestEvent).not.toHaveBeenCalled();
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("asks the relays for a replaceable manifest even when the store has one, and the newest wins", async () => {
    const stale = manifest(15128, 100, "old");
    const fresh = manifest(15128, 200, "new");
    store.getTimeline.mockReturnValue([stale]);
    requestEvents.mockResolvedValue([fresh]);
    const out = await fetchManifestEvent({
      kind: 15128,
      pubkey,
      identifier: "",
    });
    expect(requestEvents).toHaveBeenCalledTimes(1);
    expect(out).toBe(fresh);
  });

  it("keeps the store copy when the relays only hold something older", async () => {
    const newer = manifest(35128, 300, "store");
    const behind = manifest(35128, 200, "relay");
    store.getTimeline.mockReturnValue([newer]);
    requestEvents.mockResolvedValue([behind]);
    const out = await fetchManifestEvent({
      kind: 35128,
      pubkey,
      identifier: "site",
    });
    expect(out).toBe(newer);
  });

  it("takes the newest across several relays, not the first to answer", async () => {
    store.getTimeline.mockReturnValue([]);
    const first = manifest(15128, 100, "first");
    const newest = manifest(15128, 500, "newest");
    requestEvents.mockResolvedValue([first, newest]);
    const out = await fetchManifestEvent({
      kind: 15128,
      pubkey,
      identifier: "",
    });
    expect(out).toBe(newest);
  });
});
