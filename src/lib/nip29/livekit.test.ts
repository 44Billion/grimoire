import { describe, expect, it } from "vitest";

import {
  authorOfIdentity,
  foldGroupRoster,
  groupAcceptsChat,
  groupSupportedKinds,
  groupSupportsAv,
  jwtSubject,
  livekitCapabilityUrl,
  livekitOrigin,
  livekitTokenUrl,
  parseParticipants,
  parseTokenResponse,
} from "@/lib/nip29/livekit";
import type { NostrEvent } from "@/types/nostr";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const CAROL = "c".repeat(64);

function metadata(tags: string[][]): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: "9".repeat(64),
    created_at: 1,
    kind: 39000,
    content: "",
    tags,
    sig: "",
  } as NostrEvent;
}

function participants(tags: string[][]): NostrEvent {
  return { ...metadata(tags), kind: 39004 } as NostrEvent;
}

/** A JWT is three dot-separated base64url segments; only the middle is read. */
function jwt(claims: Record<string, unknown>): string {
  const payload = btoa(JSON.stringify(claims))
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

describe("livekitOrigin", () => {
  it("keeps host and non-default port, drops the path", () => {
    expect(livekitOrigin("wss://relay.example/nostr")).toBe(
      "https://relay.example",
    );
    expect(livekitOrigin("wss://relay.example:8443/x?y=1")).toBe(
      "https://relay.example:8443",
    );
    expect(livekitOrigin("wss://relay.example:443/")).toBe(
      "https://relay.example",
    );
  });

  it("lowercases the host and tolerates surrounding space", () => {
    expect(livekitOrigin("  wss://Relay.EXAMPLE  ")).toBe(
      "https://relay.example",
    );
  });

  // The header is a bearer credential naming the user.
  it("refuses plaintext, credentials and nonsense", () => {
    expect(livekitOrigin("ws://relay.example")).toBeNull();
    expect(livekitOrigin("https://relay.example")).toBeNull();
    expect(livekitOrigin("wss://user:pass@relay.example")).toBeNull();
    expect(livekitOrigin("not a url")).toBeNull();
  });
});

describe("endpoint urls", () => {
  it("builds the capability probe and the token endpoint", () => {
    expect(livekitCapabilityUrl("wss://relay.example")).toBe(
      "https://relay.example/.well-known/nip29/livekit",
    );
    expect(livekitTokenUrl("wss://relay.example", "pizza")).toBe(
      "https://relay.example/.well-known/nip29/livekit/pizza",
    );
  });

  // A relay-assigned id is usually a slug, but nothing says it must be.
  it("percent-encodes the group id", () => {
    expect(livekitTokenUrl("wss://relay.example", "a/b c")).toBe(
      "https://relay.example/.well-known/nip29/livekit/a%2Fb%20c",
    );
  });

  it("is null when the relay cannot host web endpoints", () => {
    expect(livekitTokenUrl("ws://relay.example", "pizza")).toBeNull();
    expect(livekitCapabilityUrl("ws://relay.example")).toBeNull();
  });
});

describe("group metadata", () => {
  it("reads the livekit tag", () => {
    expect(groupSupportsAv(metadata([["d", "g"], ["livekit"]]))).toBe(true);
    expect(groupSupportsAv(metadata([["d", "g"]]))).toBe(false);
    expect(groupSupportsAv(undefined)).toBe(false);
  });

  // Absent means "everything"; present-and-empty means "nothing" — an AV-only
  // space. Collapsing the two is what puts a message box on a room that has no
  // messages.
  it("distinguishes an absent supported_kinds from an empty one", () => {
    expect(groupSupportedKinds(metadata([["d", "g"]]))).toBeUndefined();
    expect(groupSupportedKinds(metadata([["supported_kinds"]]))).toEqual([]);
    expect(
      groupSupportedKinds(metadata([["supported_kinds", "9", "11"]])),
    ).toEqual([9, 11]);
  });

  it("drops a malformed kind rather than the whole list", () => {
    expect(
      groupSupportedKinds(metadata([["supported_kinds", "9", "nine", "-1"]])),
    ).toEqual([9]);
  });

  it("accepts chat unless the group excludes kind 9", () => {
    expect(groupAcceptsChat(metadata([["d", "g"]]))).toBe(true);
    expect(groupAcceptsChat(metadata([["supported_kinds", "9"]]))).toBe(true);
    expect(groupAcceptsChat(metadata([["supported_kinds"]]))).toBe(false);
    expect(groupAcceptsChat(metadata([["supported_kinds", "11"]]))).toBe(false);
  });
});

describe("identities", () => {
  it("reads the pubkey the relay bound into an identity", () => {
    expect(authorOfIdentity(`${ALICE}-7f3a`)).toBe(ALICE);
    expect(authorOfIdentity(ALICE)).toBe(ALICE);
  });

  it("refuses an identity that is not a relay-minted one", () => {
    expect(authorOfIdentity("alice")).toBeUndefined();
    expect(authorOfIdentity(`${ALICE.toUpperCase()}-1`)).toBeUndefined();
    expect(authorOfIdentity("")).toBeUndefined();
  });
});

describe("parseParticipants", () => {
  it("takes valid participant tags in order, deduped", () => {
    expect(
      parseParticipants(
        participants([
          ["d", "g"],
          ["participant", ALICE],
          ["participant", BOB],
          ["participant", ALICE],
        ]),
      ),
    ).toEqual([ALICE, BOB]);
  });

  it("drops malformed entries and ignores other kinds", () => {
    expect(
      parseParticipants(
        participants([
          ["participant", "nope"],
          ["participant"],
          ["p", BOB],
          ["participant", ALICE],
        ]),
      ),
    ).toEqual([ALICE]);
    expect(parseParticipants(metadata([["participant", ALICE]]))).toEqual([]);
    expect(parseParticipants(undefined)).toEqual([]);
  });
});

describe("foldGroupRoster", () => {
  it("matches identities to the relay's participants, keeping its order", () => {
    const roster = foldGroupRoster([ALICE, BOB], [`${BOB}-2`, `${ALICE}-1`]);
    expect(roster.present.map((p) => p.author)).toEqual([ALICE, BOB]);
    expect(roster.present.map((p) => p.identity)).toEqual([
      `${ALICE}-1`,
      `${BOB}-2`,
    ]);
    expect(roster.claims.get(`${ALICE}-1`)).toEqual([ALICE]);
  });

  // A member the relay has issued a token to but who has not connected yet.
  it("keeps a participant with no identity as a tile with no media", () => {
    const roster = foldGroupRoster([ALICE], []);
    expect(roster.present).toEqual([
      { author: ALICE, identity: "", hand: false, ms: 0 },
    ]);
    expect(roster.claims.size).toBe(0);
  });

  // Someone audible must never be invisible, even if 39004 is behind.
  it("keeps an identity the relay has not announced, sorted after", () => {
    const roster = foldGroupRoster([BOB], [`${CAROL}-1`, `${BOB}-1`]);
    expect(roster.present.map((p) => p.author)).toEqual([BOB, CAROL]);
  });

  it("gives a member joined twice one tile", () => {
    const roster = foldGroupRoster([ALICE], [`${ALICE}-1`, `${ALICE}-2`]);
    expect(roster.present).toHaveLength(1);
    expect(roster.present[0].identity).toBe(`${ALICE}-1`);
  });

  it("ignores an identity no relay could have minted", () => {
    const roster = foldGroupRoster([], ["anonymous-guest"]);
    expect(roster.present).toEqual([]);
  });

  // Every claim is single, because the relay binds the pubkey into the identity
  // — the contested case CORD-07 has to arbitrate cannot arise here.
  it("never produces a contested claim", () => {
    const roster = foldGroupRoster([ALICE, BOB], [`${ALICE}-1`, `${BOB}-1`]);
    for (const claimants of roster.claims.values()) {
      expect(claimants).toHaveLength(1);
    }
  });
});

describe("jwtSubject", () => {
  it("reads sub out of the payload", () => {
    expect(jwtSubject(jwt({ sub: `${ALICE}-1` }))).toBe(`${ALICE}-1`);
  });

  it("is undefined for anything unreadable", () => {
    expect(jwtSubject("")).toBeUndefined();
    expect(jwtSubject("one.two")).toBeUndefined();
    expect(jwtSubject("a.!!!.c")).toBeUndefined();
    expect(jwtSubject(jwt({}))).toBeUndefined();
  });
});

describe("parseTokenResponse", () => {
  const token = jwt({ sub: `${ALICE}-1` });

  it("reads the plain names", () => {
    expect(parseTokenResponse({ token, url: "wss://sfu.example" })).toEqual({
      token,
      url: "wss://sfu.example",
      identity: `${ALICE}-1`,
    });
  });

  // LiveKit's own token endpoints answer in ConnectionDetails shape.
  it("reads LiveKit's names too", () => {
    expect(
      parseTokenResponse({
        participantToken: token,
        serverUrl: "https://sfu.example",
      }).url,
    ).toBe("https://sfu.example");
  });

  it("refuses a plaintext SFU", () => {
    expect(() =>
      parseTokenResponse({ token, url: "ws://sfu.example" }),
    ).toThrow(/plaintext/);
  });

  it("refuses a response missing anything it needs", () => {
    expect(() => parseTokenResponse({ url: "wss://sfu.example" })).toThrow(
      /no LiveKit token/,
    );
    expect(() => parseTokenResponse({ token })).toThrow(/no LiveKit server/);
    expect(() =>
      parseTokenResponse({ token: "not.a.jwt", url: "wss://sfu.example" }),
    ).toThrow(/no identity/);
    expect(() => parseTokenResponse(null)).toThrow();
  });
});
