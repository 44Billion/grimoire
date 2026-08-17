/**
 * CORD-07's decisions, tested where they are pure.
 *
 * Three of these guard interop rather than correctness-in-isolation: the origin
 * canonicalization and the tie-break must agree byte for byte with every other
 * client or the §5 rendezvous never settles, and the grant must carry a fresh
 * nonce or two members joining one room in the same second collide on one event
 * id. A wrong-but-self-consistent implementation passes everything else.
 */

import { describe, expect, it } from "vitest";
import { verifyEvent } from "nostr-tools/pure";

import { bytesToHex, hex32, voiceGroupKey } from "@/lib/concord/derive";
import { KIND_VOICE_PRESENCE } from "@/lib/concord/kinds";
import type { OpenedEvent } from "@/lib/concord/stream";
import {
  brokerRank,
  canonicalOrigin,
  foldVoicePresence,
  heartbeatDelayMs,
  KIND_HTTP_AUTH,
  migrationTarget,
  orderBrokers,
  parsePresence,
  parseReaction,
  presenceTags,
  reactionTag,
  rendezvousCandidates,
  signAvGrant,
  verifiedAuthorOf,
  VOICE_HEARTBEAT_MS,
  VOICE_STALE_MS,
  type VoicePresenceEntry,
} from "@/lib/concord/voice";

const SECRET = new Uint8Array(32).fill(1);
const CHANNEL = new Uint8Array(32).fill(2);
const ROOM = voiceGroupKey(SECRET, CHANNEL, 0n);

function opened(over: Partial<OpenedEvent> = {}): OpenedEvent {
  return {
    rumorId: "a".repeat(64),
    author: "b".repeat(64),
    kind: KIND_VOICE_PRESENCE,
    content: "joined",
    tags: [
      ["channel", bytesToHex(CHANNEL)],
      ["epoch", "0"],
      ["identity", "PA-abc"],
      ["broker", "https://broker.example"],
    ],
    ms: 1_700_000_000_000,
    createdAt: 1_700_000_000,
    ...over,
  };
}

function entry(over: Partial<VoicePresenceEntry> = {}): VoicePresenceEntry {
  return {
    author: "b".repeat(64),
    status: "joined",
    identity: "PA-abc",
    ms: 1_000_000,
    rumorId: "a".repeat(64),
    ...over,
  };
}

describe("origins (§5)", () => {
  it("canonicalizes to the RFC 6454 form", () => {
    expect(canonicalOrigin("https://Broker.Example/")).toBe(
      "https://broker.example",
    );
    expect(canonicalOrigin("https://broker.example:443/path?q=1")).toBe(
      "https://broker.example",
    );
    expect(canonicalOrigin("  https://broker.example:8443  ")).toBe(
      "https://broker.example:8443",
    );
  });

  it("refuses anything that is not a clean https origin", () => {
    // The grant is a bearer credential for its whole freshness window, so
    // plaintext is refused rather than downgraded.
    expect(canonicalOrigin("http://broker.example")).toBeNull();
    expect(canonicalOrigin("wss://broker.example")).toBeNull();
    expect(canonicalOrigin("https://user:pw@broker.example")).toBeNull();
    expect(canonicalOrigin("broker.example")).toBeNull();
    expect(canonicalOrigin("")).toBeNull();
  });

  it("ranks by sha256(room || origin) and orders smallest first", () => {
    const room = ROOM.pk;
    const a = "https://a.example";
    const b = "https://b.example";
    const ordered = orderBrokers(room, [b, a]);
    expect(ordered).toHaveLength(2);
    expect(brokerRank(room, ordered[0]) < brokerRank(room, ordered[1])).toBe(
      true,
    );
    // Same set, either input order — one answer, or two clients split the call.
    expect(orderBrokers(room, [a, b])).toEqual(ordered);
  });

  it("dedupes and drops junk while ordering", () => {
    const room = ROOM.pk;
    expect(
      orderBrokers(room, [
        "https://a.example/",
        "https://A.example",
        "http://a.example",
      ]),
    ).toEqual(["https://a.example"]);
  });

  it("ranks differently per room, so one origin cannot win everywhere", () => {
    const other = voiceGroupKey(SECRET, new Uint8Array(32).fill(3), 0n).pk;
    expect(brokerRank(ROOM.pk, "https://a.example")).not.toBe(
      brokerRank(other, "https://a.example"),
    );
  });
});

describe("the token grant (§2)", () => {
  it("is signed by the room key, so pubkey IS the room name", () => {
    const url = `https://broker.example/.well-known/concord/av/${ROOM.pk}`;
    const event = JSON.parse(atob(signAvGrant(ROOM, url)));
    expect(event.kind).toBe(KIND_HTTP_AUTH);
    expect(event.pubkey).toBe(ROOM.pk);
    expect(event.content).toBe("");
    expect(event.tags).toContainEqual(["u", url]);
    expect(event.tags).toContainEqual(["method", "GET"]);
    expect(verifyEvent(event)).toBe(true);
  });

  it("carries a fresh nonce, so two joiners never collide on one event id", () => {
    // Every member of a channel signs with the SAME key. Without the nonce two
    // grants minted in the same second are byte-identical, and the broker's
    // anti-replay set rejects whichever arrives second.
    const url = `https://broker.example/.well-known/concord/av/${ROOM.pk}`;
    const one = JSON.parse(atob(signAvGrant(ROOM, url)));
    const two = JSON.parse(atob(signAvGrant(ROOM, url)));
    const nonce = (e: { tags: string[][] }) =>
      e.tags.find((t) => t[0] === "nonce")?.[1];
    expect(nonce(one)).toMatch(/^[0-9a-f]{64}$/);
    expect(nonce(one)).not.toBe(nonce(two));
    expect(one.id).not.toBe(two.id);
  });
});

describe("presence parsing (§4)", () => {
  it("reads a joined with its identity and canonical broker", () => {
    const p = parsePresence(opened());
    expect(p).toMatchObject({
      status: "joined",
      identity: "PA-abc",
      broker: "https://broker.example",
      hand: false,
    });
  });

  it("reads a left, which names neither identity nor broker", () => {
    const p = parsePresence(
      opened({
        content: "left",
        tags: [
          ["channel", bytesToHex(CHANNEL)],
          ["epoch", "0"],
        ],
      }),
    );
    expect(p).toMatchObject({ status: "left" });
    expect(p?.identity).toBeUndefined();
  });

  it("rejects a joined with no identity — it claims no SFU participant", () => {
    expect(
      parsePresence(
        opened({
          tags: [
            ["channel", bytesToHex(CHANNEL)],
            ["epoch", "0"],
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects an unknown verb and a foreign kind", () => {
    expect(parsePresence(opened({ content: "speaking" }))).toBeNull();
    expect(parsePresence(opened({ kind: 9 }))).toBeNull();
  });

  it("bounds the identity and drops an unusable broker hint", () => {
    expect(
      parsePresence(opened({ tags: identityTags("x".repeat(129)) })),
    ).toBeNull();
    const p = parsePresence(
      opened({
        tags: [
          ...identityTags("PA-abc"),
          ["broker", "http://insecure.example"],
        ],
      }),
    );
    // The presence still counts; only the untrusted hint is discarded.
    expect(p?.identity).toBe("PA-abc");
    expect(p?.broker).toBeUndefined();
  });

  it("reads the raised hand only from a joined, and only when it is 1", () => {
    expect(
      parsePresence(
        opened({ tags: [...identityTags("PA-abc"), ["hand", "1"]] }),
      )?.hand,
    ).toBe(true);
    expect(
      parsePresence(
        opened({ tags: [...identityTags("PA-abc"), ["hand", "0"]] }),
      )?.hand,
    ).toBe(false);
    expect(
      parsePresence(
        opened({
          content: "left",
          tags: [
            ["channel", bytesToHex(CHANNEL)],
            ["epoch", "0"],
            ["hand", "1"],
          ],
        }),
      )?.hand,
    ).toBe(false);
  });

  it("emits identity, broker and hand only on a joined", () => {
    expect(presenceTags("joined", "PA-abc", "https://b.example")).toEqual([
      ["identity", "PA-abc"],
      ["broker", "https://b.example"],
    ]);
    expect(
      presenceTags("joined", "PA-abc", "https://b.example", { hand: true }),
    ).toContainEqual(["hand", "1"]);
    expect(presenceTags("left", "PA-abc", "https://b.example")).toEqual([]);
  });
});

describe("reactions (armada extension)", () => {
  it("reads an emoji and its nonce", () => {
    const r = parseReaction(
      opened({ tags: [...identityTags("PA-abc"), reactionTag("🎉", "n1")] }),
    );
    expect(r).toMatchObject({ emoji: "🎉", nonce: "n1" });
  });

  it("is absent from a plain heartbeat", () => {
    expect(parseReaction(opened())).toBeNull();
  });

  it("REJECTS an oversize payload rather than truncating it", () => {
    // Truncation would let two clients disagree on what floated.
    expect(
      parseReaction(
        opened({
          tags: [...identityTags("PA-abc"), reactionTag("a".repeat(65), "n1")],
        }),
      ),
    ).toBeNull();
    expect(
      parseReaction(
        opened({
          tags: [...identityTags("PA-abc"), reactionTag("🎉", "n".repeat(129))],
        }),
      ),
    ).toBeNull();
    expect(
      parseReaction(
        opened({ tags: [...identityTags("PA-abc"), reactionTag("", "n1")] }),
      ),
    ).toBeNull();
    expect(
      parseReaction(
        opened({ tags: [...identityTags("PA-abc"), reactionTag("🎉", "")] }),
      ),
    ).toBeNull();
  });
});

describe("the presence fold (§4)", () => {
  const now = 2_000_000;

  it("keeps the latest entry per author", () => {
    const fold = foldVoicePresence(
      [
        entry({ ms: now - 1000, identity: "old" }),
        entry({ ms: now - 10, identity: "new" }),
      ],
      now,
    );
    expect(fold.present).toHaveLength(1);
    expect(fold.present[0].identity).toBe("new");
  });

  it("breaks an equal-ms tie on the lower rumor id", () => {
    const fold = foldVoicePresence(
      [
        entry({ ms: now, identity: "z", rumorId: "f".repeat(64) }),
        entry({ ms: now, identity: "a", rumorId: "0".repeat(64) }),
      ],
      now,
    );
    expect(fold.present[0].identity).toBe("a");
  });

  it("ages a joined out after three missed heartbeats", () => {
    expect(
      foldVoicePresence([entry({ ms: now - VOICE_STALE_MS + 1 })], now).present,
    ).toHaveLength(1);
    expect(
      foldVoicePresence([entry({ ms: now - VOICE_STALE_MS - 1 })], now).present,
    ).toHaveLength(0);
  });

  it("treats a left as absent even when it is the newest", () => {
    const fold = foldVoicePresence(
      [
        entry({ ms: now - 100 }),
        entry({ ms: now - 10, status: "left", identity: undefined }),
      ],
      now,
    );
    expect(fold.present).toHaveLength(0);
  });

  it("verifies an identity only when exactly one fresh author claims it", () => {
    const contested = foldVoicePresence(
      [
        entry({ author: "1".repeat(64), identity: "PA-x", ms: now }),
        entry({ author: "2".repeat(64), identity: "PA-x", ms: now }),
      ],
      now,
    );
    // A member can copy a victim's identity into their own joined; a contested
    // claim proves nothing about either author.
    expect(verifiedAuthorOf(contested, "PA-x")).toBeUndefined();
    expect(contested.claims.get("PA-x")).toHaveLength(2);

    const sole = foldVoicePresence(
      [entry({ author: "1".repeat(64), identity: "PA-x", ms: now })],
      now,
    );
    expect(verifiedAuthorOf(sole, "PA-x")).toBe("1".repeat(64));
    // Anything unclaimed is likewise unverified.
    expect(verifiedAuthorOf(sole, "PA-unknown")).toBeUndefined();
  });

  it("frees a contested identity once the impostor's claim goes stale", () => {
    const fold = foldVoicePresence(
      [
        entry({ author: "1".repeat(64), identity: "PA-x", ms: now - 10 }),
        entry({
          author: "2".repeat(64),
          identity: "PA-x",
          ms: now - VOICE_STALE_MS - 1,
        }),
      ],
      now,
    );
    expect(verifiedAuthorOf(fold, "PA-x")).toBe("1".repeat(64));
  });
});

describe("rendezvous (§5)", () => {
  const now = 2_000_000;

  it("prefers an occupied broker over our own default", () => {
    const fold = foldVoicePresence(
      [entry({ ms: now, broker: "https://theirs.example" })],
      now,
    );
    expect(
      rendezvousCandidates(ROOM.pk, fold, ["https://ours.example"]),
    ).toEqual(["https://theirs.example", "https://ours.example"]);
  });

  it("falls back to our own defaults when the room is empty", () => {
    expect(
      rendezvousCandidates(ROOM.pk, foldVoicePresence([], now), [
        "https://ours.example",
        "http://junk.example",
      ]),
    ).toEqual(["https://ours.example"]);
  });

  it("caps how many broker hints strangers can steer us through", () => {
    const fold = foldVoicePresence(
      [1, 2, 3, 4, 5].map((n) =>
        entry({
          author: String(n).repeat(64),
          identity: `PA-${n}`,
          broker: `https://b${n}.example`,
          ms: now,
        }),
      ),
      now,
    );
    const candidates = rendezvousCandidates(ROOM.pk, fold, [
      "https://ours.example",
    ]);
    expect(candidates).toHaveLength(4); // 3 hints + our own
    expect(candidates[3]).toBe("https://ours.example");
  });

  it("migrates only toward an origin that beats the connected one", () => {
    const ranked = orderBrokers(ROOM.pk, [
      "https://a.example",
      "https://b.example",
    ]);
    const [winner, loser] = ranked;
    const fold = foldVoicePresence([entry({ ms: now, broker: winner })], now);
    expect(migrationTarget(ROOM.pk, fold, loser)).toBe(winner);
    // Already on the winner, or presence naming only a loser: stay put.
    expect(migrationTarget(ROOM.pk, fold, winner)).toBeUndefined();
    const behind = foldVoicePresence([entry({ ms: now, broker: loser })], now);
    expect(migrationTarget(ROOM.pk, behind, winner)).toBeUndefined();
  });
});

describe("the heartbeat clock (§4)", () => {
  it("jitters downward only, so three beats still fit the stale window", () => {
    expect(heartbeatDelayMs(() => 0)).toBe(VOICE_HEARTBEAT_MS * 0.8);
    expect(heartbeatDelayMs(() => 0.999999)).toBeLessThanOrEqual(
      VOICE_HEARTBEAT_MS,
    );
    // Jittering ABOVE 30s would shrink the margin to two missed heartbeats.
    expect(heartbeatDelayMs(() => 1) * 3).toBeLessThanOrEqual(VOICE_STALE_MS);
  });
});

/** Binding tags plus one identity — the minimum a `joined` needs. */
function identityTags(identity: string): string[][] {
  return [
    ["channel", bytesToHex(CHANNEL)],
    ["epoch", "0"],
    ["identity", identity],
  ];
}

describe("the room name", () => {
  it("is the voice key's x-only pubkey, and rolls with the epoch", () => {
    expect(hex32(ROOM.pk)).toHaveLength(32);
    expect(voiceGroupKey(SECRET, CHANNEL, 1n).pk).not.toBe(ROOM.pk);
  });
});
