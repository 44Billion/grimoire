import { describe, it, expect } from "vitest";

import { NIP29_READ_MAX_FUTURE_SECS, summarizeGroupUnread } from "./unread";
import { mergeGroupWindow } from "./message-window";
import type { NostrEvent } from "@/types/nostr";

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
const NOW = 1_700_000_000;

function msg(
  created_at: number,
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: overrides.id ?? `${created_at}-${overrides.pubkey ?? PEER}`,
    pubkey: PEER,
    created_at,
    kind: 9,
    content: "hi",
    tags: [["h", "group"]],
    sig: "",
    ...overrides,
  } as NostrEvent;
}

describe("summarizeGroupUnread", () => {
  it("counts nothing when there is nothing", () => {
    expect(summarizeGroupUnread([], { after: 0, nowSecs: NOW })).toEqual({
      count: 0,
      latest: 0,
      mention: false,
      capped: false,
    });
  });

  it("treats the lower bound as exclusive — the stamp is what you last read", () => {
    const summary = summarizeGroupUnread(
      [msg(NOW - 100), msg(NOW - 50), msg(NOW - 10)],
      { after: NOW - 50, nowSecs: NOW },
    );
    expect(summary.count).toBe(1);
    expect(summary.latest).toBe(NOW - 10);
  });

  it("ignores messages dated past the future ceiling", () => {
    const summary = summarizeGroupUnread(
      [msg(NOW + NIP29_READ_MAX_FUTURE_SECS + 1), msg(NOW - 5)],
      { after: 0, nowSecs: NOW },
    );
    expect(summary.count).toBe(1);
    expect(summary.latest).toBe(NOW - 5);
  });

  it("never counts the reader's own messages — sending is reading", () => {
    const summary = summarizeGroupUnread(
      [msg(NOW - 5, { pubkey: ME, id: "mine" }), msg(NOW - 20)],
      { after: 0, nowSecs: NOW, selfPubkey: ME },
    );
    expect(summary.count).toBe(1);
    expect(summary.latest).toBe(NOW - 20);
  });

  it("reports latest as the newest counted message, whatever the input order", () => {
    const summary = summarizeGroupUnread(
      [msg(NOW - 5), msg(NOW - 500), msg(NOW - 50)],
      { after: 0, nowSecs: NOW },
    );
    expect(summary.count).toBe(3);
    expect(summary.latest).toBe(NOW - 5);
  });

  it("flags a mention, and only when the reader is p-tagged", () => {
    const tagged = msg(NOW - 5, {
      id: "tagged",
      tags: [
        ["h", "group"],
        ["p", ME],
      ],
    });
    expect(
      summarizeGroupUnread([tagged], { after: 0, nowSecs: NOW, selfPubkey: ME })
        .mention,
    ).toBe(true);
    expect(
      summarizeGroupUnread([msg(NOW - 5)], {
        after: 0,
        nowSecs: NOW,
        selfPubkey: ME,
      }).mention,
    ).toBe(false);
  });

  it("counts a message dated inside the ceiling but will not offer it as a stamp", () => {
    // `latest` is written straight into a `since` bound, so it may never name a
    // message that has not happened: the window it bounds would come back empty.
    const summary = summarizeGroupUnread(
      [msg(NOW + 60, { id: "ahead" }), msg(NOW - 30, { id: "real" })],
      { after: 0, nowSecs: NOW },
    );
    expect(summary.count).toBe(2);
    expect(summary.latest).toBe(NOW - 30);
  });

  it("offers no stamp at all when every counted message is ahead of the clock", () => {
    const summary = summarizeGroupUnread([msg(NOW + 60)], {
      after: 0,
      nowSecs: NOW,
    });
    expect(summary.count).toBe(1);
    expect(summary.latest).toBe(0);
  });

  it("caps the count and says so, keeping latest at the newest", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      msg(NOW - i, { id: `e${i}` }),
    );
    const summary = summarizeGroupUnread(events, {
      after: 0,
      nowSecs: NOW,
      cap: 5,
    });
    expect(summary).toMatchObject({ count: 5, capped: true, latest: NOW });
  });

  it("does not claim capped when the count is exactly the cap", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      msg(NOW - i, { id: `e${i}` }),
    );
    expect(
      summarizeGroupUnread(events, { after: 0, nowSecs: NOW, cap: 5 }).capped,
    ).toBe(false);
  });

  it("counts nothing when the stamp is already past the ceiling", () => {
    const summary = summarizeGroupUnread([msg(NOW - 5)], {
      after: NOW + NIP29_READ_MAX_FUTURE_SECS,
      nowSecs: NOW,
    });
    expect(summary.count).toBe(0);
  });
});

describe("mergeGroupWindow", () => {
  it("keeps identity when every event is already known", () => {
    const existing = [msg(NOW, { id: "one" })];
    expect(mergeGroupWindow(existing, [msg(NOW, { id: "one" })], 10)).toBe(
      existing,
    );
    expect(mergeGroupWindow(existing, [], 10)).toBe(existing);
  });

  it("folds new events in newest-first and trims to the cap", () => {
    const merged = mergeGroupWindow(
      [msg(NOW - 100, { id: "old" })],
      [msg(NOW, { id: "new" }), msg(NOW - 50, { id: "mid" })],
      2,
    );
    expect(merged.map((e) => e.id)).toEqual(["new", "mid"]);
  });
});
