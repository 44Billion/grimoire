import { describe, it, expect } from "vitest";
import { addSeenRelay } from "applesauce-core/helpers/relays";
import type { NostrEvent } from "@/types/nostr";
import {
  getPublicationAuthors,
  getPublicationDerivative,
  getPublicationEntries,
  getPublicationExternalIds,
  getPublicationMeta,
  getPublicationType,
  isPublicationLeafKind,
  normalizeWikiTarget,
} from "./nkbip01-helpers";

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);
const EVENT_ID = "c".repeat(64);

let counter = 0;

// Each event needs a distinct id: the helpers cache on the event object
function makeEvent(tags: string[][], content = ""): NostrEvent {
  return {
    id: `test-${counter++}`,
    pubkey: PUBKEY_A,
    created_at: 0,
    kind: 30040,
    tags,
    content,
    sig: "test",
  };
}

describe("getPublicationEntries", () => {
  it("preserves a-tag order across interleaved tags", () => {
    const event = makeEvent([
      ["d", "book"],
      ["a", `30041:${PUBKEY_A}:one`],
      ["title", "Book"],
      ["a", `30041:${PUBKEY_A}:two`],
      ["a", `30040:${PUBKEY_B}:part`],
    ]);
    expect(getPublicationEntries(event).map((e) => e.coordinate)).toEqual([
      `30041:${PUBKEY_A}:one`,
      `30041:${PUBKEY_A}:two`,
      `30040:${PUBKEY_B}:part`,
    ]);
  });

  it("adds the relays the index was seen on to every pointer", () => {
    const event = makeEvent([
      ["a", `30041:${PUBKEY_A}:one`, "wss://hint.example.com"],
    ]);
    addSeenRelay(event, "wss://seen.example.com");

    const [entry] = getPublicationEntries(event);
    expect(entry.pointer.relays).toEqual([
      "wss://hint.example.com",
      "wss://seen.example.com",
    ]);
    // The published hint is still reported separately
    expect(entry.relayHint).toBe("wss://hint.example.com");
  });

  it("keeps a valid relay hint and drops an invalid one", () => {
    const event = makeEvent([
      ["a", `30041:${PUBKEY_A}:one`, "wss://relay.example.com"],
      ["a", `30041:${PUBKEY_A}:two`, "not a relay"],
    ]);
    const [first, second] = getPublicationEntries(event);
    expect(first.relayHint).toBe("wss://relay.example.com");
    expect(first.pointer.relays).toEqual(["wss://relay.example.com"]);
    expect(second.relayHint).toBeUndefined();
    expect(second.pointer.relays).toBeUndefined();
  });

  it("records the 4th element as a pinned event id when it is a valid id", () => {
    const event = makeEvent([
      ["a", `30041:${PUBKEY_A}:one`, "", EVENT_ID],
      ["a", `30041:${PUBKEY_A}:two`, "", "short"],
    ]);
    const [first, second] = getPublicationEntries(event);
    expect(first.pinnedEventId).toBe(EVENT_ID);
    expect(second.pinnedEventId).toBeUndefined();
  });

  it("drops entries with an invalid pubkey or a non-numeric kind", () => {
    const event = makeEvent([
      ["a", `30041:nothex:one`],
      ["a", `notakind:${PUBKEY_A}:two`],
      ["a", `30041:${PUBKEY_A}:good`],
    ]);
    expect(
      getPublicationEntries(event).map((e) => e.pointer.identifier),
    ).toEqual(["good"]);
  });

  it("reassembles a d-tag containing colons", () => {
    const event = makeEvent([["a", `30041:${PUBKEY_A}:part:one:two`]]);
    expect(getPublicationEntries(event)[0].pointer.identifier).toBe(
      "part:one:two",
    );
  });

  it("returns an empty list for a stub index", () => {
    expect(getPublicationEntries(makeEvent([["title", "Stub"]]))).toEqual([]);
  });
});

describe("getPublicationAuthors", () => {
  it("reads a bare author name", () => {
    expect(getPublicationAuthors(makeEvent([["author", "Aesop"]]))).toEqual([
      { name: "Aesop" },
    ]);
  });

  it("accepts the role in either the 3rd or 4th element", () => {
    const event = makeEvent([
      ["author", "Aesop", "author"],
      ["author", "James Black", "", "translator"],
    ]);
    expect(getPublicationAuthors(event)).toEqual([
      { name: "Aesop", role: "author" },
      { name: "James Black", role: "translator" },
    ]);
  });

  it("skips author tags with no name", () => {
    expect(getPublicationAuthors(makeEvent([["author", ""]]))).toEqual([]);
  });
});

describe("getPublicationType", () => {
  it("accepts every documented value", () => {
    for (const type of [
      "book",
      "illustrated",
      "magazine",
      "documentation",
      "academic",
      "blog",
    ]) {
      expect(getPublicationType(makeEvent([["type", type]]))).toBe(type);
    }
  });

  it("falls back to book when missing or unknown", () => {
    expect(getPublicationType(makeEvent([]))).toBe("book");
    expect(getPublicationType(makeEvent([["type", "zine"]]))).toBe("book");
  });
});

describe("getPublicationDerivative", () => {
  it("returns null when neither p nor E is present", () => {
    expect(getPublicationDerivative(makeEvent([["title", "x"]]))).toBeNull();
  });

  it("reads p tags alone", () => {
    const result = getPublicationDerivative(makeEvent([["p", PUBKEY_B]]));
    expect(result).toEqual({ origins: [{ pubkey: PUBKEY_B }] });
  });

  it("reads a full E tag", () => {
    const event = makeEvent([
      ["p", PUBKEY_B],
      ["E", EVENT_ID, "wss://relay.example.com", PUBKEY_B],
    ]);
    expect(getPublicationDerivative(event)).toEqual({
      origins: [
        {
          pubkey: PUBKEY_B,
          event: {
            id: EVENT_ID,
            relay: "wss://relay.example.com",
            pubkey: PUBKEY_B,
          },
        },
      ],
    });
  });

  // The spec puts the E tag "immediately after the p tag", so several
  // derivations pair up rather than collapsing into one flat list.
  it("pairs each E tag with the p tag it follows", () => {
    const OTHER_ID = "d".repeat(64);
    const event = makeEvent([
      ["p", PUBKEY_B],
      ["E", EVENT_ID],
      ["p", PUBKEY_A],
      ["E", OTHER_ID],
    ]);
    expect(getPublicationDerivative(event)).toEqual({
      origins: [
        { pubkey: PUBKEY_B, event: { id: EVENT_ID } },
        { pubkey: PUBKEY_A, event: { id: OTHER_ID } },
      ],
    });
  });

  it("keeps an E tag that has no preceding p tag", () => {
    expect(getPublicationDerivative(makeEvent([["E", EVENT_ID]]))).toEqual({
      origins: [{ event: { id: EVENT_ID } }],
    });
  });
});

describe("metadata helpers", () => {
  it("reads meta tags", () => {
    const event = makeEvent([
      ["version", "3rd edition"],
      ["published_on", "2003-05-13"],
      ["published_by", "public domain"],
      ["image", "https://example.com/cover.jpg"],
      ["summary", "Fables."],
      ["s", "https://www.gutenberg.org/ebooks/130"],
    ]);
    expect(getPublicationMeta(event)).toEqual({
      version: "3rd edition",
      publishedOn: "2003-05-13",
      publishedBy: "public domain",
      image: "https://example.com/cover.jpg",
      summary: "Fables.",
      source: "https://www.gutenberg.org/ebooks/130",
    });
  });

  it("accepts the legacy `source` tag name for `s`", () => {
    const event = makeEvent([
      ["source", "https://www.gutenberg.org/ebooks/130"],
    ]);
    expect(getPublicationMeta(event).source).toBe(
      "https://www.gutenberg.org/ebooks/130",
    );
  });

  it("prefers `s` over `source` when both are present", () => {
    const event = makeEvent([
      ["s", "https://example.com/new"],
      ["source", "https://example.com/old"],
    ]);
    expect(getPublicationMeta(event).source).toBe("https://example.com/new");
  });

  it("reads external identifiers in order", () => {
    const event = makeEvent([
      ["i", "isbn:9780765382030"],
      ["i", "gutenberg:130"],
    ]);
    expect(getPublicationExternalIds(event)).toEqual([
      "isbn:9780765382030",
      "gutenberg:130",
    ]);
  });

  it("knows which kinds may be publication leaves", () => {
    expect(isPublicationLeafKind(30041)).toBe(true);
    expect(isPublicationLeafKind(30023)).toBe(true);
    expect(isPublicationLeafKind(1)).toBe(false);
  });
});

describe("normalizeWikiTarget", () => {
  it("lowercases and hyphenates", () => {
    expect(normalizeWikiTarget("Bitcoin Improvement Proposal")).toBe(
      "bitcoin-improvement-proposal",
    );
  });

  it("collapses punctuation runs and trims separators", () => {
    expect(normalizeWikiTarget("  Aesop's -- Fables!  ")).toBe(
      "aesop-s-fables",
    );
  });

  it("is idempotent on already-normalized input", () => {
    expect(normalizeWikiTarget("aesops-fables")).toBe("aesops-fables");
  });
});
