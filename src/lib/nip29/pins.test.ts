import { describe, expect, it } from "vitest";

import {
  buildUpdatePinListTags,
  eventToPinFields,
  isEventPinned,
  parsePinAddress,
  parsePinListEntries,
  pinEntryKey,
  withPinAdded,
  withPinRemoved,
  type PinEntry,
} from "@/lib/nip29/pins";
import type { NostrEvent } from "@/types/nostr";

const ALICE = "a".repeat(64);
const EVENT_ID_1 = "1".repeat(64);
const EVENT_ID_2 = "2".repeat(64);

function message(id: string, content = "hi"): NostrEvent {
  return {
    id,
    pubkey: ALICE,
    created_at: 1000,
    kind: 9,
    content,
    tags: [["h", "pizza"]],
    sig: "",
  } as NostrEvent;
}

describe("parsePinListEntries", () => {
  it("reads e and a tags in order, ignoring everything else", () => {
    const entries = parsePinListEntries([
      ["d", "pizza"],
      ["e", EVENT_ID_1],
      ["a", `30023:${ALICE}:my-article`],
      ["e", EVENT_ID_2],
      ["p", ALICE],
    ]);
    expect(entries).toEqual([
      { type: "e", id: EVENT_ID_1 },
      { type: "a", address: `30023:${ALICE}:my-article` },
      { type: "e", id: EVENT_ID_2 },
    ]);
  });

  it("drops a repeat of an entry already seen", () => {
    const entries = parsePinListEntries([
      ["e", EVENT_ID_1],
      ["e", EVENT_ID_1],
    ]);
    expect(entries).toEqual([{ type: "e", id: EVENT_ID_1 }]);
  });

  it("drops a tag with no value", () => {
    expect(parsePinListEntries([["e"], ["a", ""]])).toEqual([]);
  });
});

describe("parsePinAddress", () => {
  it("splits kind:pubkey:identifier", () => {
    expect(parsePinAddress(`30023:${ALICE}:my-article`)).toEqual({
      kind: 30023,
      pubkey: ALICE,
      identifier: "my-article",
    });
  });

  it("keeps a colon inside the identifier", () => {
    expect(parsePinAddress(`30023:${ALICE}:2025:roundup`)).toEqual({
      kind: 30023,
      pubkey: ALICE,
      identifier: "2025:roundup",
    });
  });

  it("rejects a pubkey that is not 64 hex characters", () => {
    expect(parsePinAddress("30023:not-a-pubkey:id")).toBeUndefined();
  });

  it("rejects a non-numeric kind", () => {
    expect(parsePinAddress(`nope:${ALICE}:id`)).toBeUndefined();
  });
});

describe("buildUpdatePinListTags", () => {
  it("puts the h tag first, then the list in order", () => {
    const entries: PinEntry[] = [
      { type: "e", id: EVENT_ID_1 },
      { type: "a", address: `30023:${ALICE}:my-article` },
    ];
    expect(buildUpdatePinListTags("pizza", entries)).toEqual([
      ["h", "pizza"],
      ["e", EVENT_ID_1],
      ["a", `30023:${ALICE}:my-article`],
    ]);
  });

  it("names an empty list as clearing the pins", () => {
    expect(buildUpdatePinListTags("pizza", [])).toEqual([["h", "pizza"]]);
  });
});

describe("withPinAdded / withPinRemoved", () => {
  const entries: PinEntry[] = [{ type: "e", id: EVENT_ID_1 }];

  it("appends a new pin", () => {
    expect(withPinAdded(entries, { type: "e", id: EVENT_ID_2 })).toEqual([
      { type: "e", id: EVENT_ID_1 },
      { type: "e", id: EVENT_ID_2 },
    ]);
  });

  it("is a no-op when the entry is already pinned", () => {
    expect(withPinAdded(entries, { type: "e", id: EVENT_ID_1 })).toEqual(
      entries,
    );
  });

  it("removes a matching entry", () => {
    expect(withPinRemoved(entries, { type: "e", id: EVENT_ID_1 })).toEqual([]);
  });

  it("leaves the list alone when nothing matches", () => {
    expect(withPinRemoved(entries, { type: "e", id: EVENT_ID_2 })).toEqual(
      entries,
    );
  });
});

describe("isEventPinned", () => {
  it("finds a pinned event id", () => {
    expect(isEventPinned([{ type: "e", id: EVENT_ID_1 }], EVENT_ID_1)).toBe(
      true,
    );
  });

  it("is false for an id not in the list", () => {
    expect(isEventPinned([{ type: "e", id: EVENT_ID_1 }], EVENT_ID_2)).toBe(
      false,
    );
  });

  it("ignores address entries", () => {
    expect(
      isEventPinned(
        [{ type: "a", address: `30023:${ALICE}:${EVENT_ID_1}` }],
        EVENT_ID_1,
      ),
    ).toBe(false);
  });
});

describe("pinEntryKey", () => {
  it("keys e and a entries differently even with the same string", () => {
    expect(pinEntryKey({ type: "e", id: "x" })).not.toBe(
      pinEntryKey({ type: "a", address: "x" }),
    );
  });
});

describe("eventToPinFields", () => {
  it("carries the event's own fields, nothing invented", () => {
    const event = message(EVENT_ID_1, "pineapple belongs on pizza");
    expect(eventToPinFields(event)).toEqual({
      rumorId: EVENT_ID_1,
      authorHex: ALICE,
      kind: 9,
      content: "pineapple belongs on pizza",
      createdAt: 1000,
      tags: [["h", "pizza"]],
    });
  });
});
