import { describe, expect, it } from "vitest";

import {
  extractGroupEntries,
  sortGroupsByRecency,
} from "./useNip29GroupList";
import type { NostrEvent } from "@/types/nostr";

function list(tags: string[][]): NostrEvent {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 10009,
    created_at: 1,
    content: "",
    tags,
    sig: "",
  } as NostrEvent;
}

describe("extractGroupEntries", () => {
  it("normalises a schemeless relay", () => {
    expect(extractGroupEntries(list([["group", "bitcoin", "relay.example.com"]])))
      .toEqual([{ groupId: "bitcoin", relayUrl: "wss://relay.example.com/" }]);
  });

  it("drops an entry with no relay", () => {
    // A group id is only unique WITHIN a relay, so an entry that lost its host
    // names no room — two relays can each have a `bitcoin`.
    expect(extractGroupEntries(list([["group", "bitcoin"]]))).toEqual([]);
  });

  it("keeps the same id on two relays as two groups", () => {
    const entries = extractGroupEntries(
      list([
        ["group", "bitcoin", "wss://one.example.com"],
        ["group", "bitcoin", "wss://two.example.com"],
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it("ignores tags that are not groups, and unparseable relays", () => {
    expect(
      extractGroupEntries(
        list([
          ["p", "somebody"],
          ["group", "bitcoin", "not a url at all::"],
        ]),
      ),
    ).toEqual([]);
  });

  it("has nothing to say about an account with no list", () => {
    expect(extractGroupEntries(undefined)).toEqual([]);
  });
});

describe("sortGroupsByRecency", () => {
  const message = (created_at: number) => ({ created_at }) as NostrEvent;

  it("puts the newest conversation first", () => {
    const sorted = sortGroupsByRecency([
      { groupId: "old", relayUrl: "wss://a/", lastMessage: message(10) },
      { groupId: "new", relayUrl: "wss://a/", lastMessage: message(90) },
    ]);
    expect(sorted.map((g) => g.groupId)).toEqual(["new", "old"]);
  });

  it("sorts a group nobody has written in LAST, not first", () => {
    // Treating "no last message" as time zero is the whole point: a silent
    // group at the top would push the live ones off a short sidebar.
    const sorted = sortGroupsByRecency([
      { groupId: "silent", relayUrl: "wss://a/" },
      { groupId: "live", relayUrl: "wss://a/", lastMessage: message(5) },
    ]);
    expect(sorted.map((g) => g.groupId)).toEqual(["live", "silent"]);
  });

  it("does not reorder its argument in place", () => {
    const groups = [
      { groupId: "old", relayUrl: "wss://a/", lastMessage: message(10) },
      { groupId: "new", relayUrl: "wss://a/", lastMessage: message(90) },
    ];
    sortGroupsByRecency(groups);
    expect(groups[0].groupId).toBe("old");
  });
});
