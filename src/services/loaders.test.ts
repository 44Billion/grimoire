import { describe, it, expect, vi, beforeEach } from "vitest";
import { addressLoader, batchedAddressLoader, eventLoader } from "./loaders";
import type { NostrEvent } from "@/types/nostr";
import { SeenRelaysSymbol } from "applesauce-core/helpers/relays";
import type { EventPointer } from "nostr-tools/nip19";
import { Observable, firstValueFrom, toArray } from "rxjs";

// Mock dependencies
vi.mock("./relay-pool", () => ({
  default: {}, // Mock pool object
}));

vi.mock("./event-store", () => ({
  default: {
    getEvent: vi.fn(),
    getReplaceable: vi.fn(),
  },
}));

vi.mock("./relay-list-cache", () => ({
  relayListCache: {
    getOutboxRelaysSync: vi.fn(),
    getOutboxRelays: vi.fn(),
  },
}));

// Real Observables, not `{ subscribe }` stubs: `eventLoader` composes the base
// loader with rxjs operators now, and rxjs rejects a bare subscribable.
// Pointers are recorded because a composed stream cannot carry `_testPointer`.
const mocks = vi.hoisted(() => ({
  eventLoaderPointers: [] as any[],
  addressLoaderPointers: [] as any[],
  /** Per-pubkey relay lists the mocked address loader should "deliver". */
  deliveredRelayLists: new Map<string, string[]>(),
}));

vi.mock("applesauce-loaders/loaders", () => ({
  createEventLoader: vi.fn(() => (pointer: EventPointer) => {
    mocks.eventLoaderPointers.push(pointer);
    const observable = new Observable<never>((subscriber) => {
      subscriber.complete();
    });
    (observable as any)._testPointer = pointer;
    return observable as any;
  }),
  createAddressLoader: vi.fn(() => (pointer: any) => {
    mocks.addressLoaderPointers.push(pointer);
    const observable = new Observable<never>((subscriber) => {
      subscriber.complete();
    });
    (observable as any)._testPointer = pointer;
    return observable as any;
  }),
  createTimelineLoader: vi.fn(),
  createEventLoaderForStore: vi.fn(),
}));

import eventStore from "./event-store";
import { relayListCache } from "./relay-list-cache";

// Test helpers
function createMockEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "test-event-id",
    pubkey: "test-pubkey",
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: "test content",
    sig: "test-sig",
    ...overrides,
  };
}

function createEventWithSeenRelays(relays: string[]): NostrEvent {
  const event = createMockEvent();
  (event as any)[SeenRelaysSymbol] = new Set(relays);
  return event;
}

function createEventWithTags(tags: string[][]): NostrEvent {
  return createMockEvent({ tags });
}

/** The pointer the FIRST pass was issued with. */
function firstPassPointer(): EventPointer {
  return mocks.eventLoaderPointers[0];
}

describe("eventLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventLoaderPointers.length = 0;
    mocks.addressLoaderPointers.length = 0;
    mocks.deliveredRelayLists.clear();
    vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue(null);
  });

  describe("basic functionality", () => {
    it("should handle string ID with no context", () => {
      const result = eventLoader({ id: "test123" });

      expect(result).toBeDefined();
      expect((result as any)._testPointer.id).toBe("test123");
      // mergeRelaySets normalizes URLs with trailing slash
      expect(firstPassPointer().relays).toContain("wss://nos.lol/");
    });

    it("should handle EventPointer with relay hints", () => {
      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://relay.example.com/"],
      };

      eventLoader(pointer);

      // mergeRelaySets normalizes URLs with trailing slash
      expect(firstPassPointer().relays).toContain("wss://relay.example.com/");
    });

    it("should handle undefined context gracefully", () => {
      const result = eventLoader({ id: "test123" }, undefined);

      expect(result).toBeDefined();
      // mergeRelaySets normalizes URLs with trailing slash
      expect(firstPassPointer().relays).toContain("wss://nos.lol/");
    });
  });

  describe("backward compatibility with string authorHint", () => {
    it("should accept string pubkey as context", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://author-relay.com/",
      ]);

      eventLoader({ id: "test123" }, "author-pubkey");

      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "author-pubkey",
      );
      expect(firstPassPointer().relays).toContain("wss://author-relay.com/");
    });

    it("should use cached relays when authorHint provided", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached1.com/",
        "wss://cached2.com/",
        "wss://cached3.com/",
        "wss://cached4.com/", // Should be limited to 3
      ]);

      eventLoader({ id: "test123" }, "author-pubkey");

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://cached1.com/");
      expect(relays).toContain("wss://cached2.com/");
      expect(relays).toContain("wss://cached3.com/");
      // Should be limited to top 3 cached relays
      expect(
        relays.filter((r: string) => r.startsWith("wss://cached")).length,
      ).toBeLessThanOrEqual(3);
    });
  });

  describe("comprehensive context with NostrEvent", () => {
    it("should extract and use seen-at relays", () => {
      const event = createEventWithSeenRelays([
        "wss://seen1.com/",
        "wss://seen2.com/",
      ]);

      eventLoader({ id: "parent123" }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://seen1.com/");
      expect(relays).toContain("wss://seen2.com/");
    });

    it("should extract and use r tags", () => {
      const event = createEventWithTags([
        ["r", "wss://r-tag1.com/"],
        ["r", "wss://r-tag2.com/"],
        ["r", "wss://r-tag3.com/"],
      ]);

      eventLoader({ id: "parent123" }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://r-tag1.com/");
      expect(relays).toContain("wss://r-tag2.com/");
      expect(relays).toContain("wss://r-tag3.com/");
    });

    it("should extract relay hints from e tags", () => {
      // Use valid 64-char hex event IDs (v5 validates event ID format)
      const validEventId1 =
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const validEventId2 =
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const validEventId3 =
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

      const event = createEventWithTags([
        ["e", validEventId1, "wss://e-tag1.com/", "reply"],
        ["e", validEventId2, "wss://e-tag2.com/", "root"],
        ["e", validEventId3], // No relay hint, should be skipped
      ]);

      eventLoader({ id: "parent123" }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://e-tag1.com/");
      expect(relays).toContain("wss://e-tag2.com/");
    });

    it("should extract relay hints from q tags", () => {
      // A quote's hint is often the only one an event carries for the quoted
      // note — the inline nostr:nevent frequently omits it.
      const quotedId =
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      const secondQuotedId =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

      const event = createEventWithTags([
        ["q", quotedId, "wss://q-tag1.com/", "quoted-author-pubkey"],
        ["q", secondQuotedId, "wss://q-tag2.com/"],
      ]);

      eventLoader({ id: quotedId }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://q-tag1.com/");
      expect(relays).toContain("wss://q-tag2.com/");
    });

    it("should filter non-relay URLs out of q tag hints", () => {
      const quotedId =
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      const event = createEventWithTags([
        ["q", quotedId, "https://example.com/note"],
      ]);

      eventLoader({ id: quotedId }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).not.toContain("https://example.com/note");
    });

    it("should use both the first and last p tag as author candidates", () => {
      // NIP-25 puts the reacted event's author in the LAST p tag, while
      // clients that copy thread participants leave a stranger in the first.
      vi.mocked(relayListCache.getOutboxRelaysSync).mockImplementation(
        (pubkey: string) =>
          pubkey === "first-author"
            ? ["wss://first-outbox.com/"]
            : pubkey === "last-author"
              ? ["wss://last-outbox.com/"]
              : [],
      );

      const event = createEventWithTags([
        ["p", "first-author"],
        ["p", "middle-author"],
        ["p", "last-author"],
      ]);

      eventLoader({ id: "parent123" }, event);

      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "first-author",
      );
      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "last-author",
      );
      // The middle ones would be a connection each for no gain
      expect(relayListCache.getOutboxRelaysSync).not.toHaveBeenCalledWith(
        "middle-author",
      );

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://first-outbox.com/");
      expect(relays).toContain("wss://last-outbox.com/");
    });

    it("should extract relay hints from the edge p tags", () => {
      // Valid 64-char hex pubkeys: getProfilePointerFromPTag returns null for
      // anything else, hint and all.
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([]);

      const first = "11".repeat(32);
      const middle = "22".repeat(32);
      const last = "33".repeat(32);

      const event = createEventWithTags([
        ["p", first, "wss://p-first.com/"],
        ["p", middle, "wss://p-middle.com/"],
        ["p", last, "wss://p-last.com/"],
      ]);

      eventLoader({ id: "parent123" }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://p-first.com/");
      expect(relays).toContain("wss://p-last.com/");
      expect(relays).not.toContain("wss://p-middle.com/");
    });

    it("should merge a hint-less e tag with the p tag author's outbox", () => {
      // The reaction case: ["e", id] with no relay hint at all, so the p tag
      // author's outbox is the only routing that exists.
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://reacted-author-outbox.com/",
      ]);

      const reactedId =
        "8669d2dc6a2d7d019127f2360f9924ae65b1acc2b9454647bc545c09b5e09d81";
      const event = createEventWithTags([
        ["e", reactedId],
        ["p", "reacted-author-pubkey"],
        ["k", "1"],
      ]);

      eventLoader({ id: reactedId }, event);

      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://reacted-author-outbox.com/");
    });

    it("should combine all relay sources", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached.com/",
      ]);

      // Use valid 64-char hex event ID (v5 validates event ID format)
      const validEventId =
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://r-tag.com/"],
          ["e", validEventId, "wss://e-tag.com/"],
        ],
      });

      // Add seen relays
      (event as any)[SeenRelaysSymbol] = new Set(["wss://seen.com/"]);

      const pointer: EventPointer = {
        id: "parent123",
        relays: ["wss://direct.com/"],
      };

      eventLoader(pointer, event);

      const relays = firstPassPointer().relays!;

      // Verify all sources are present
      expect(relays).toContain("wss://direct.com/");
      expect(relays).toContain("wss://seen.com/");
      expect(relays).toContain("wss://cached.com/");
      expect(relays).toContain("wss://r-tag.com/");
      expect(relays).toContain("wss://e-tag.com/");
      // mergeRelaySets normalizes fallback relays with trailing slash
      expect(relays).toContain("wss://nos.lol/");
    });
  });

  describe("pointer author", () => {
    it("should use the pointer's author for outbox lookup with no context", () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://pointer-author-outbox.com/",
      ]);

      const pointer: EventPointer = {
        id: "quoted123",
        author: "quoted-author-pubkey",
      };

      eventLoader(pointer);

      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "quoted-author-pubkey",
      );
      const relays = firstPassPointer().relays!;
      expect(relays).toContain("wss://pointer-author-outbox.com/");
    });

    it("should merge the pointer author's outbox with the context p tag's", () => {
      // NOT first-answer-wins: a pointer author whose relay list happens to be
      // cached must not discard the p tag author's, or a reaction loses the
      // only routing it had.
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockImplementation(
        (pubkey: string) =>
          pubkey === "quoted-author-pubkey"
            ? ["wss://pointer-author-outbox.com/"]
            : ["wss://p-tag-outbox.com/"],
      );

      const event = createEventWithTags([["p", "mentioned-author-pubkey"]]);
      const pointer: EventPointer = {
        id: "quoted123",
        author: "quoted-author-pubkey",
      };

      eventLoader(pointer, event);

      const relays: string[] = firstPassPointer().relays!;
      expect(relays).toContain("wss://pointer-author-outbox.com/");
      expect(relays).toContain("wss://p-tag-outbox.com/");
      // Most authoritative author first
      expect(relays.indexOf("wss://pointer-author-outbox.com/")).toBeLessThan(
        relays.indexOf("wss://p-tag-outbox.com/"),
      );
    });

    it("should merge the stored event's outbox with the pointer author's", () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(
        createMockEvent({ pubkey: "stored-pubkey" }) as any,
      );
      vi.mocked(relayListCache.getOutboxRelaysSync).mockImplementation(
        (pubkey: string) =>
          pubkey === "stored-pubkey"
            ? ["wss://stored-outbox.com/"]
            : ["wss://pointer-author-outbox.com/"],
      );

      eventLoader({
        id: "quoted123",
        author: "quoted-author-pubkey",
      } as EventPointer);

      const relays: string[] = firstPassPointer().relays!;
      expect(relays).toContain("wss://stored-outbox.com/");
      expect(relays).toContain("wss://pointer-author-outbox.com/");
      expect(relays.indexOf("wss://stored-outbox.com/")).toBeLessThan(
        relays.indexOf("wss://pointer-author-outbox.com/"),
      );
    });

    it("should cap outbox relays per author, not in total", () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockImplementation(
        (pubkey: string) =>
          pubkey === "quoted-author-pubkey"
            ? [
                "wss://a1.com/",
                "wss://a2.com/",
                "wss://a3.com/",
                "wss://a4.com/",
              ]
            : [
                "wss://b1.com/",
                "wss://b2.com/",
                "wss://b3.com/",
                "wss://b4.com/",
              ],
      );

      const event = createEventWithTags([["p", "mentioned-author-pubkey"]]);
      eventLoader(
        { id: "quoted123", author: "quoted-author-pubkey" } as EventPointer,
        event,
      );

      const relays: string[] = firstPassPointer().relays!;
      expect(relays).toContain("wss://a3.com/");
      expect(relays).not.toContain("wss://a4.com/");
      expect(relays).toContain("wss://b3.com/");
      expect(relays).not.toContain("wss://b4.com/");
    });
  });

  describe("second pass: resolving an unknown outbox", () => {
    /** Drains a loader so its lazy second pass actually runs. */
    const drain = (loader: ReturnType<typeof eventLoader>) =>
      firstValueFrom(loader.pipe(toArray()));

    it("should retry on relays discovered after the synchronous miss", async () => {
      // The cold-session case: nothing cached, so the first pass has only the
      // fallback relays — but the author's list is one Dexie read away.
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
      vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue([
        "wss://discovered.com/",
      ]);

      const event = createEventWithTags([
        ["e", "aa".repeat(32)],
        ["p", "bb".repeat(32)],
      ]);

      await drain(eventLoader({ id: "aa".repeat(32) }, event));

      expect(mocks.eventLoaderPointers).toHaveLength(2);
      expect(mocks.eventLoaderPointers[0].relays).not.toContain(
        "wss://discovered.com/",
      );
      expect(mocks.eventLoaderPointers[1].relays).toEqual([
        "wss://discovered.com/",
      ]);
    });

    it("should ask the indexers when the cache cannot answer either", async () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
      vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue(null);

      const author = "bb".repeat(32);
      const event = createEventWithTags([
        ["e", "aa".repeat(32)],
        ["p", author],
      ]);

      await drain(eventLoader({ id: "aa".repeat(32) }, event));

      // Kind 10002 through the address loader — the cache is not the only
      // source of truth for a relay list.
      expect(mocks.addressLoaderPointers).toEqual(
        expect.arrayContaining([{ kind: 10002, pubkey: author }]),
      );
    });

    it("should not retry once the event is in the store", async () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
      vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue([
        "wss://discovered.com/",
      ]);

      const event = createEventWithTags([
        ["e", "aa".repeat(32)],
        ["p", "bb".repeat(32)],
      ]);

      // Absent when the loader is built, present by the time it is subscribed
      vi.mocked(eventStore.getEvent).mockReturnValueOnce(undefined as any);
      const loader = eventLoader({ id: "aa".repeat(32) }, event);
      vi.mocked(eventStore.getEvent).mockReturnValue(createMockEvent() as any);

      await drain(loader);

      expect(mocks.eventLoaderPointers).toHaveLength(1);
    });

    it("should not retry when every discovered relay was already tried", async () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined as any);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
      // Normalization differs from the hint by a trailing slash on purpose
      vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue([
        "wss://already-tried.com",
      ]);

      const event = createEventWithTags([["p", "bb".repeat(32)]]);

      await drain(
        eventLoader(
          { id: "aa".repeat(32), relays: ["wss://already-tried.com/"] },
          event,
        ),
      );

      expect(mocks.eventLoaderPointers).toHaveLength(1);
    });

    it("should not resolve anything when the event is already held", async () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(
        createMockEvent({ pubkey: "cc".repeat(32) }) as any,
      );
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
      vi.mocked(relayListCache.getOutboxRelays).mockResolvedValue([
        "wss://discovered.com/",
      ]);

      await drain(eventLoader({ id: "aa".repeat(32) }));

      expect(relayListCache.getOutboxRelays).not.toHaveBeenCalled();
      expect(mocks.eventLoaderPointers).toHaveLength(1);
    });
  });

  describe("relay priority ordering", () => {
    it("should prioritize direct hints over seen relays", () => {
      const event = createEventWithSeenRelays(["wss://seen.com/"]);

      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://direct.com/"],
      };

      eventLoader(pointer, event);
      const relays = firstPassPointer().relays!;

      // Direct hints should come before seen relays due to mergeRelaySets priority
      const directIndex = relays.indexOf("wss://direct.com/");
      const seenIndex = relays.indexOf("wss://seen.com/");
      expect(directIndex).toBeLessThan(seenIndex);
    });

    it("should prioritize seen relays over cached relays", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached.com/",
      ]);

      const event = createMockEvent({
        tags: [["p", "author-pubkey"]],
      });
      (event as any)[SeenRelaysSymbol] = new Set(["wss://seen.com/"]);

      eventLoader({ id: "test123" }, event);
      const relays = firstPassPointer().relays!;

      const seenIndex = relays.indexOf("wss://seen.com/");
      const cachedIndex = relays.indexOf("wss://cached.com/");
      expect(seenIndex).toBeLessThan(cachedIndex);
    });
  });

  describe("deduplication", () => {
    it("should deduplicate same relay from different sources", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://duplicate.com/",
      ]);

      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://duplicate.com/"],
        ],
      });
      (event as any)[SeenRelaysSymbol] = new Set(["wss://duplicate.com/"]);

      const pointer: EventPointer = {
        id: "test123",
        relays: ["wss://duplicate.com/"],
      };

      eventLoader(pointer, event);
      const relays = firstPassPointer().relays!;

      // Should only appear once despite being in 4 sources
      const count = relays.filter(
        (r: string) => r === "wss://duplicate.com/",
      ).length;
      expect(count).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("should handle event with no tags", () => {
      const event = createMockEvent({ tags: [] });

      const result = eventLoader({ id: "test123" }, event);

      expect(result).toBeDefined();
      // mergeRelaySets normalizes fallback relays with trailing slash
      expect(firstPassPointer().relays).toContain("wss://nos.lol/");
    });

    it("should handle invalid e tags gracefully", () => {
      // Use valid 64-char hex event ID (v5 validates event ID format)
      const validEventId =
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

      const event = createEventWithTags([
        ["e"], // Missing event ID - invalid, should be skipped
        ["e", validEventId, "wss://valid.com/"],
      ]);

      eventLoader({ id: "test123" }, event);

      // Should still include the valid relay
      expect(firstPassPointer().relays).toContain("wss://valid.com/");
    });

    it("should handle empty r tags", () => {
      const event = createEventWithTags([
        ["r", ""], // Empty URL
        ["r", "wss://valid.com/"],
      ]);

      eventLoader({ id: "test123" }, event);

      // Should filter out empty r tag
      expect(firstPassPointer().relays).toContain("wss://valid.com/");
    });

    it("should use existing event author when event is in store", () => {
      const existingEvent = createMockEvent({ pubkey: "existing-author" });
      vi.mocked(eventStore.getEvent).mockReturnValue(existingEvent);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://existing-author-relay.com/",
      ]);

      eventLoader({ id: "test123" });

      expect(eventStore.getEvent).toHaveBeenCalledWith("test123");
      expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
        "existing-author",
      );
      expect(firstPassPointer().relays).toContain(
        "wss://existing-author-relay.com/",
      );
    });

    it("should fall back to the fallback relays when no other relays available", () => {
      vi.mocked(eventStore.getEvent).mockReturnValue(undefined);
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([]);

      const event = createMockEvent({ tags: [] });

      eventLoader({ id: "test123" }, event);

      const relays = firstPassPointer().relays!;

      // Should only have fallback relays (normalized with trailing slash)
      expect(relays).toContain("wss://nos.lol/");
      expect(relays).toContain("wss://relay.snort.social/");
      expect(relays).toContain("wss://relay.damus.io/");
    });

    it("should limit cached relays to 3", () => {
      vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
        "wss://cached1.com/",
        "wss://cached2.com/",
        "wss://cached3.com/",
        "wss://cached4.com/",
        "wss://cached5.com/",
      ]);

      const event = createMockEvent({
        tags: [["p", "author-pubkey"]],
      });

      eventLoader({ id: "test123" }, event);
      const relays = firstPassPointer().relays!;

      // Count how many cached relays made it through
      const cachedCount = relays.filter((r: string) =>
        r.startsWith("wss://cached"),
      ).length;

      // Should be exactly 3 (top 3 cached relays)
      expect(cachedCount).toBe(3);
    });
  });

  describe("event with no seen relays (standard NostrEvent)", () => {
    it("should handle event without SeenRelaysSymbol", () => {
      const event = createMockEvent({
        tags: [
          ["p", "author-pubkey"],
          ["r", "wss://r-tag.com/"],
        ],
      });
      // No SeenRelaysSymbol added

      const result = eventLoader({ id: "test123" }, event);

      expect(result).toBeDefined();
      // Should still work with r tags and p tags
      expect(firstPassPointer().relays).toContain("wss://r-tag.com/");
    });
  });
});

describe("addressLoader outbox routing", () => {
  const OUTBOX = ["wss://a.example/", "wss://b.example/"];
  const pointer = (kind: number, extra = {}) => ({
    kind,
    pubkey: "author-pubkey",
    identifier: "",
    ...extra,
  });
  const relaysOf = (result: unknown) =>
    (result as { _testPointer: { relays?: string[] } })._testPointer.relays;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the author's write relays to a hint-less list pointer", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(OUTBOX);

    expect(relaysOf(addressLoader(pointer(10133)))).toEqual(OUTBOX);
    expect(relayListCache.getOutboxRelaysSync).toHaveBeenCalledWith(
      "author-pubkey",
    );
  });

  it("caps the relays it adds at three", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([
      "wss://1/",
      "wss://2/",
      "wss://3/",
      "wss://4/",
    ]);

    expect(relaysOf(addressLoader(pointer(10063)))).toHaveLength(3);
  });

  it("leaves a pointer that already carries relay hints alone", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(OUTBOX);

    expect(
      relaysOf(addressLoader(pointer(30023, { relays: ["wss://hint/"] }))),
    ).toEqual(["wss://hint/"]);
    expect(relayListCache.getOutboxRelaysSync).not.toHaveBeenCalled();
  });

  it("never routes discovery kinds by outbox — that would be circular", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(OUTBOX);

    for (const kind of [0, 3, 10002]) {
      expect(relaysOf(addressLoader(pointer(kind)))).toBeUndefined();
    }
    expect(relayListCache.getOutboxRelaysSync).not.toHaveBeenCalled();
  });

  it("falls back to the loader's own relays when nothing knows the author's", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
    vi.mocked(eventStore.getReplaceable).mockReturnValue(undefined);
    expect(relaysOf(addressLoader(pointer(10133)))).toBeUndefined();

    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue([]);
    expect(relaysOf(addressLoader(pointer(10133)))).toBeUndefined();
  });

  it("reads the relay list out of the store when the LRU has evicted it", () => {
    // The memory cache holds 100 pubkeys; a session that resolves a follow
    // list holds hundreds of relay lists, so this is the common case, not the
    // edge case.
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(null);
    vi.mocked(eventStore.getReplaceable).mockReturnValue({
      kind: 10002,
      pubkey: "author-pubkey",
      created_at: 0,
      content: "",
      sig: "",
      id: "relay-list",
      tags: [
        ["r", "wss://write.relay.io/", "write"],
        ["r", "wss://read.relay.io/", "read"],
      ],
    } as never);

    expect(relaysOf(addressLoader(pointer(10133)))).toEqual([
      "wss://write.relay.io/",
    ]);
    expect(eventStore.getReplaceable).toHaveBeenCalledWith(
      10002,
      "author-pubkey",
      "",
    );
  });

  it("routes the batched loader the same way", () => {
    vi.mocked(relayListCache.getOutboxRelaysSync).mockReturnValue(OUTBOX);

    expect(relaysOf(batchedAddressLoader(pointer(30023)))).toEqual(OUTBOX);
  });
});
