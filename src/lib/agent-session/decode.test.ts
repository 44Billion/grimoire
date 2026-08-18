import { describe, expect, it } from "vitest";
import { getEventHash } from "nostr-tools";

import { buildDelta, buildTurn, sessionAddress } from "./encode";
import { parseAgentEvent, sealMatchesRumor } from "./decode";
import type { Rumor, SessionRef, UnsignedRumor } from "./types";

const AGENT = "9".repeat(64);
const IMPOSTOR = "a".repeat(64);
const OPERATOR = "1".repeat(64);
const SESSION = "3a7c".padEnd(64, "0");
const ref: SessionRef = { agent: AGENT, session: SESSION };

function rehash(rumor: UnsignedRumor): Rumor {
  return {
    ...rumor,
    id: getEventHash(rumor as Parameters<typeof getEventHash>[0]),
  };
}

function aTurn() {
  return buildTurn(
    AGENT,
    ref,
    {
      role: "assistant",
      blocks: [{ type: "text", text: "hi" }],
      turn: 1,
      createdAt: 1_755_500_000,
    },
    { seq: 1 },
    { pubkey: OPERATOR },
    "full",
  );
}

describe("parseAgentEvent — the author check", () => {
  it("drops a turn whose author is not the agent named in its own address", () => {
    // Anyone can publish a 1777 claiming to belong to any session. The agent's
    // pubkey is inside the `a` address, so this is the check that kills it.
    const forged = rehash({ ...aTurn(), pubkey: IMPOSTOR });

    expect(parseAgentEvent(forged)).toBeNull();
  });

  it("drops an event whose `a` tag is not a session address", () => {
    const turn = aTurn();
    const broken = rehash({
      ...turn,
      tags: turn.tags.map((t) =>
        t[0] === "a" ? ["a", `30023:${AGENT}:x`] : t,
      ),
    });

    expect(parseAgentEvent(broken)).toBeNull();
  });

  it("accepts the honest one and keeps its address", () => {
    const decoded = parseAgentEvent(aTurn());

    expect(decoded?.type).toBe("turn");
    const session = decoded && "session" in decoded ? decoded.session : null;
    expect(session && sessionAddress(session.agent, session.session)).toBe(
      `31777:${AGENT}:${SESSION}`,
    );
  });

  it("rejects a seal that does not match the rumor it carries", () => {
    // The wrap is signed by a throwaway key and proves nothing; the seal is the
    // authorship proof, so a mismatch is one agent forwarding another's words.
    expect(sealMatchesRumor({ pubkey: IMPOSTOR }, { pubkey: AGENT })).toBe(
      false,
    );
    expect(sealMatchesRumor({ pubkey: AGENT }, { pubkey: AGENT })).toBe(true);
  });
});

describe("parseAgentEvent — shape", () => {
  it("requires prev above seq 1", () => {
    const turn = buildTurn(
      AGENT,
      ref,
      { role: "assistant", blocks: [], turn: 2, createdAt: 1 },
      { seq: 2, prev: "b".repeat(64) },
      { pubkey: OPERATOR },
      "full",
    );
    const orphan = rehash({
      ...turn,
      tags: turn.tags.filter((t) => t[0] !== "prev"),
    });

    expect(parseAgentEvent(orphan)).toBeNull();
  });

  it("survives unparseable content, leaving alt to carry the turn", () => {
    const turn = aTurn();
    const garbled = rehash({
      ...turn,
      content: "not json",
      tags: [...turn.tags, ["alt", "said hi"]],
    });

    const decoded = parseAgentEvent(garbled);

    expect(decoded?.type).toBe("turn");
    expect(decoded && "blocks" in decoded && decoded.blocks).toEqual([]);
    expect(decoded?.alt).toBe("said hi");
  });

  it("reads a delta by part, and refuses a tool delta with no tool-id", () => {
    const delta = buildDelta(
      AGENT,
      ref,
      { turn: 3, part: 2, delta: "text", text: "…tok", createdAt: 1 },
      { pubkey: OPERATOR },
      "full",
    );
    const decoded = parseAgentEvent(delta);
    expect(decoded).toMatchObject({
      type: "delta",
      turn: 3,
      part: 2,
      delta: "text",
    });

    const broken = rehash({
      ...delta,
      tags: delta.tags.map((t) => (t[0] === "delta" ? ["delta", "tool"] : t)),
    });
    expect(parseAgentEvent(broken)).toBeNull();
  });
});

describe("parseAgentEvent — hostile counters and addresses", () => {
  it("refuses a counter no session could reach", () => {
    const turn = aTurn();
    const huge = rehash({
      ...turn,
      tags: turn.tags.map((t) =>
        t[0] === "turn" ? ["turn", "99999999999999999999"] : t,
      ),
    });

    expect(parseAgentEvent(huge)).toBeNull();
  });

  it("refuses an event carrying two session addresses", () => {
    // A relay indexes every `a` tag, so an event with two addresses comes back
    // from a REQ for either. Validating only the first would file an attacker's
    // own honest event inside somebody else's transcript.
    const turn = aTurn();
    const twoFaced = rehash({
      ...turn,
      tags: [...turn.tags, ["a", `31777:${IMPOSTOR}:victim-session`]],
    });

    expect(parseAgentEvent(twoFaced)).toBeNull();
  });
});
