import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject, EMPTY, type Observable } from "rxjs";
import type { NostrEvent } from "nostr-tools";
import type { IEventStore } from "applesauce-core/event-store";

/**
 * How referenced emoji sets reach the autocomplete index.
 *
 * The bug: a set named by the kind 10030 list was asked for once, from the
 * indexers, with a 15s deadline, and then forgotten — so a set living on its
 * author's relays never showed up, and fetching it by hand afterwards did
 * nothing either. These pin the three properties that fix it.
 */
const addressLoader = vi.fn(
  (..._args: unknown[]): Observable<NostrEvent> => EMPTY,
);
const fetchRelayList = vi.fn(async (..._args: unknown[]) => {});

vi.mock("./loaders", () => ({
  addressLoader: (...a: unknown[]) => addressLoader(...a),
}));
vi.mock("./relay-selection", () => ({
  fetchRelayList: (...a: unknown[]) => fetchRelayList(...a),
}));
vi.mock("./emoji-set-cache", () => ({
  emojiSetCache: {
    setUserEmojiList: vi.fn(),
    setEmojiSet: vi.fn(),
    getUserEmojiList: vi.fn(async () => undefined),
    getEmojiSetsForAddresses: vi.fn(async () => []),
  },
}));
vi.mock("./emoji-usage", () => ({ getRecentEmojiKeys: () => [] }));

const { EmojiSearchService } = await import("./emoji-search");

const me = "a".repeat(64);
const them = "b".repeat(64);

/** A store whose `replaceable` is one subject per address, so a test can land an event later. */
function fakeStore() {
  const subjects = new Map<string, BehaviorSubject<NostrEvent | undefined>>();
  const key = (k: number, p: string, d?: string) => `${k}:${p}:${d ?? ""}`;
  const subject = (k: string) => {
    const s = new BehaviorSubject<NostrEvent | undefined>(undefined);
    subjects.set(k, s);
    return s;
  };
  return {
    subjects,
    land(event: NostrEvent) {
      const d = event.tags.find((t) => t[0] === "d")?.[1];
      const k = key(event.kind, event.pubkey, event.kind === 10030 ? "" : d);
      (subjects.get(k) ?? subject(k)).next(event);
    },
    subject,
    store: {
      replaceable(k: number, p: string, d?: string) {
        const id = key(k, p, d);
        return subjects.get(id) ?? subject(id);
      },
    } as unknown as IEventStore,
  };
}

function list(sets: [string, string?][]): NostrEvent {
  return {
    id: "1".repeat(64),
    kind: 10030,
    pubkey: me,
    created_at: 1,
    content: "",
    sig: "",
    tags: sets.map(([a, hint]) => (hint ? ["a", a, hint] : ["a", a])),
  } as NostrEvent;
}

function set(pubkey: string, d: string, shortcodes: string[]): NostrEvent {
  return {
    id: "2".repeat(64),
    kind: 30030,
    pubkey,
    created_at: 1,
    content: "",
    sig: "",
    tags: [
      ["d", d],
      ...shortcodes.map((c) => ["emoji", c, `https://x/${c}.png`]),
    ],
  } as NostrEvent;
}

beforeEach(() => {
  addressLoader.mockClear();
  fetchRelayList.mockClear();
});

describe("emoji sets named by the kind 10030 list", () => {
  it("asks for a set through the outbox-aware loader, following the a-tag's relay hint", async () => {
    const fs = fakeStore();
    const svc = new EmojiSearchService();
    svc.subscribeForUser(me, fs.store);
    fs.land(list([[`30030:${them}:cats`, "wss://hint.example"]]));
    await new Promise((r) => setTimeout(r, 0));

    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30030,
        pubkey: them,
        identifier: "cats",
        relays: ["wss://hint.example"],
      }),
    );
    // A hint is a place to look; the author's relay list is not needed first.
    expect(fetchRelayList).not.toHaveBeenCalled();
  });

  it("resolves the author's relay list first when the a-tag carries no hint", async () => {
    const fs = fakeStore();
    const svc = new EmojiSearchService();
    svc.subscribeForUser(me, fs.store);
    fs.land(list([[`30030:${them}:dogs`]]));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchRelayList).toHaveBeenCalledWith(them, expect.any(Number));
    expect(addressLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30030,
        pubkey: them,
        identifier: "dogs",
        relays: undefined,
      }),
    );
  });

  it("indexes a set that lands in the store later, however it got there", async () => {
    const fs = fakeStore();
    const svc = new EmojiSearchService();
    svc.subscribeForUser(me, fs.store);
    fs.land(list([[`30030:${them}:late`]]));
    await new Promise((r) => setTimeout(r, 0));
    expect(await svc.search("blobcat")).toEqual([]);

    // Somebody ran `req -k 30030` a minute later.
    fs.land(set(them, "late", ["blobcat"]));
    await new Promise((r) => setTimeout(r, 0));

    const hits = await svc.search("blobcat");
    expect(hits.map((h) => h.shortcode)).toEqual(["blobcat"]);
    expect(hits[0].address).toBe(`30030:${them}:late`);
  });

  it("stops watching a set the list no longer names", async () => {
    const fs = fakeStore();
    const svc = new EmojiSearchService();
    svc.subscribeForUser(me, fs.store);
    fs.land(list([[`30030:${them}:old`], [`30030:${them}:kept`]]));
    await new Promise((r) => setTimeout(r, 0));
    fs.land({ ...list([[`30030:${them}:kept`]]), created_at: 2 });
    await new Promise((r) => setTimeout(r, 0));

    expect(fs.subjects.get(`30030:${them}:old`)!.observed).toBe(false);
    expect(fs.subjects.get(`30030:${them}:kept`)!.observed).toBe(true);
  });
});
