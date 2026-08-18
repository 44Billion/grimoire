import { describe, expect, it } from "vitest";
import { parse as shellParse } from "shell-quote";

import {
  groupKey,
  parseGroupArgs,
  parseGroupSelection,
} from "@/lib/nip29/group-selection";

describe("parseGroupSelection", () => {
  it("assumes wss:// and keeps the group id verbatim", () => {
    expect(parseGroupSelection("relay.example.com'Bitcoin")).toEqual({
      relayUrl: "wss://relay.example.com",
      groupId: "Bitcoin",
    });
  });

  it("keeps an explicit scheme, port and path", () => {
    expect(parseGroupSelection("ws://localhost:7777/nostr'test")).toEqual({
      relayUrl: "ws://localhost:7777/nostr",
      groupId: "test",
    });
  });

  it("refuses anything that is not the pair", () => {
    expect(parseGroupSelection("relay.example.com")).toBeNull();
    expect(parseGroupSelection("'pizza")).toBeNull();
    expect(parseGroupSelection("relay.example.com'")).toBeNull();
    expect(parseGroupSelection("")).toBeNull();
  });
});

describe("parseGroupArgs", () => {
  /**
   * The reason this function exists. `shell-quote` treats `'` as a quote
   * character, so the command palette never hands a parser the string a person
   * typed — it hands it two tokens with the separator gone. If this assumption
   * ever stops holding, the rejoin below becomes wrong rather than merely
   * unnecessary, so it is asserted rather than assumed.
   */
  it("is what the palette actually produces", () => {
    expect(shellParse("call relay.example.com'bitcoin-dev")).toEqual([
      "call",
      "relay.example.com",
      "bitcoin-dev",
    ]);
  });

  it("rejoins the split pair", () => {
    expect(parseGroupArgs(["relay.example.com", "bitcoin-dev"])).toEqual({
      relayUrl: "wss://relay.example.com",
      groupId: "bitcoin-dev",
    });
  });

  it("takes a single token that survived quoting", () => {
    expect(parseGroupArgs(["relay.example.com'pizza"])).toEqual({
      relayUrl: "wss://relay.example.com",
      groupId: "pizza",
    });
  });

  // A two-word community name is not a group.
  it("only rejoins when the first token looks like a host", () => {
    expect(parseGroupArgs(["bitcoin", "builders"])).toBeNull();
    expect(parseGroupArgs(["relay.example.com'a", "b"])).toEqual({
      relayUrl: "wss://relay.example.com",
      groupId: "a",
    });
  });

  it("refuses three tokens, and none", () => {
    expect(parseGroupArgs(["relay.example.com", "a", "b"])).toBeNull();
    expect(parseGroupArgs([])).toBeNull();
  });
});

describe("groupKey", () => {
  it("names the pair, never the id alone", () => {
    expect(
      groupKey({ relayUrl: "wss://a.example", groupId: "general" }),
    ).not.toBe(groupKey({ relayUrl: "wss://b.example", groupId: "general" }));
  });
});
