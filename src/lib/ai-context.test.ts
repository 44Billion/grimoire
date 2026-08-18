import { describe, expect, it, vi, beforeEach } from "vitest";
import { nip19 } from "nostr-tools";
import { of, NEVER } from "rxjs";

const getEvent = vi.fn();
const getReplaceable = vi.fn();
const eventLoader = vi.fn();
const profilesGet = vi.fn();

vi.mock("@/services/event-store", () => ({
  default: {
    getEvent: (...args: unknown[]) => getEvent(...args),
    getReplaceable: (...args: unknown[]) => getReplaceable(...args),
  },
}));

vi.mock("@/services/loaders", () => ({
  eventLoader: (...args: unknown[]) => eventLoader(...args),
  addressLoader: () => NEVER,
}));

vi.mock("@/services/db", () => ({
  default: {
    profiles: { get: (...args: unknown[]) => profilesGet(...args) },
    nips: { get: () => Promise.resolve(undefined) },
  },
  // The command catalogue in the system prompt pulls in the man pages, which
  // reach the relay singletons; they need this at module init.
  relayLivenessStorage: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
  },
}));

vi.mock("@/services/nip-text", () => ({
  getNipText: () => Promise.resolve(undefined),
}));

const { buildMentionContext, parseAiTarget } = await import("./ai-context");

const PUBKEY =
  "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const NPUB = nip19.npubEncode(PUBKEY);

function eventFor(id: string, kind = 1) {
  return {
    id,
    kind,
    pubkey: PUBKEY,
    created_at: 1,
    tags: [],
    content: "the referenced note body",
    sig: "x",
  };
}

beforeEach(() => {
  getEvent.mockReset();
  eventLoader.mockReset();
  profilesGet.mockReset();
  getEvent.mockReturnValue(undefined);
  eventLoader.mockReturnValue(NEVER);
  profilesGet.mockResolvedValue(undefined);
});

describe("parseAiTarget", () => {
  it("classifies nips, kinds, and entities", () => {
    expect(parseAiTarget("nip-65")).toEqual({ type: "nip", value: "65" });
    expect(parseAiTarget("1")).toEqual({ type: "kind", value: "1" });
    expect(parseAiTarget(NPUB)).toEqual({ type: "event", value: NPUB });
    expect(parseAiTarget("relays")).toBeUndefined();
  });
});

describe("buildMentionContext", () => {
  it("returns nothing when the question names nothing", async () => {
    expect(await buildMentionContext("what is a relay?")).toEqual({
      events: [],
      pubkeys: [],
    });
  });

  it("passes a referenced event's content, from the store", async () => {
    const id = "a".repeat(64);
    getEvent.mockReturnValue(eventFor(id));
    const nevent = nip19.neventEncode({ id, kind: 1 });

    const context = await buildMentionContext(`summarize ${nevent}`);
    expect(context.system).toContain("the referenced note body");
    // The event travels with the turn, so a reopened conversation renders it
    // rather than the bech32 that named it.
    expect(context.events.map((event) => event.id)).toEqual([id]);
    // Resolved locally, so no relay was asked.
    expect(eventLoader).not.toHaveBeenCalled();
  });

  it("falls back to the loader when the store misses", async () => {
    const id = "b".repeat(64);
    eventLoader.mockReturnValue(of(eventFor(id, 30023)));
    const nevent = nip19.neventEncode({ id, kind: 30023 });

    const context = await buildMentionContext(`what is ${nevent}?`);
    expect(eventLoader).toHaveBeenCalled();
    expect(context.system).toContain("the referenced note body");
    expect(context.system).toContain("30023");
    expect(context.events).toHaveLength(1);
  });

  it("says so rather than inventing when nothing resolves", async () => {
    // A relay that accepts and never answers must not hold the send open.
    vi.useFakeTimers();
    try {
      const nevent = nip19.neventEncode({ id: "c".repeat(64), kind: 1 });
      const pending = buildMentionContext(`explain ${nevent}`);
      await vi.advanceTimersByTimeAsync(7_000);
      expect((await pending).system).toMatch(/could not be loaded/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefers the signed kind 0 to the parsed cache for a mentioned person", async () => {
    getReplaceable.mockReturnValue({
      id: "f".repeat(64),
      kind: 0,
      pubkey: PUBKEY,
      created_at: 1,
      tags: [],
      content: '{"name":"jack"}',
      sig: "x",
    });
    const context = await buildMentionContext(`who is ${NPUB}?`);
    expect(context.system).toContain("jack");
    expect(context.system).toContain(PUBKEY);
    // The event, not the row: `created_at` only exists on the former.
    expect(context.system).toContain("created_at");
    // The kind 0 is kept with the turn, so the name survives the EventStore.
    expect(context.events[0].kind).toBe(0);
    expect(context.pubkeys).toEqual([PUBKEY]);
    expect(profilesGet).not.toHaveBeenCalled();
  });

  it("falls back to cached metadata, and says it is not the event", async () => {
    getReplaceable.mockReturnValue(undefined);
    profilesGet.mockResolvedValue({ pubkey: PUBKEY, name: "jack" });
    // The relay never answers (`addressLoader` is NEVER), so this waits out the
    // resolve deadline before falling back — the same deadline a dead relay hits.
    vi.useFakeTimers();
    try {
      const pending = buildMentionContext(`who is ${NPUB}?`);
      await vi.advanceTimersByTimeAsync(7_000);
      const context = await pending;
      expect(context.system).toContain("jack");
      expect(context.system).toContain("not the signed event");
      // Nothing signed resolved, so there is no event to keep — but the pubkey
      // is worth keeping, since the profile may exist by the time it reopens.
      expect(context.events).toEqual([]);
      expect(context.pubkeys).toEqual([PUBKEY]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps how many references one question resolves", async () => {
    const ids = ["1", "2", "3", "4"].map((n) => n.repeat(64));
    getEvent.mockImplementation((pointer: { id: string }) =>
      eventFor(pointer.id),
    );
    const text = ids
      .map((id) => nip19.neventEncode({ id, kind: 1 }))
      .join(" and ");

    await buildMentionContext(text);
    expect(getEvent).toHaveBeenCalledTimes(3);
  });
});
