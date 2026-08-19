import { describe, expect, it } from "vitest";

import { DeltaBuffer, MAX_PARTS } from "./buffer";
import type { DecodedDelta, DeltaKind } from "./types";

const AGENT = "9".repeat(64);
const SESSION = "a".repeat(64);

function delta(
  turn: number,
  part: number,
  text: string,
  kind: DeltaKind = "text",
): DecodedDelta {
  return {
    type: "delta",
    id: `${turn}-${part}`,
    pubkey: AGENT,
    created_at: 1000,
    session: { agent: AGENT, session: SESSION },
    turn,
    part,
    delta: kind,
    text,
  } as DecodedDelta;
}

describe("DeltaBuffer", () => {
  it("appends fragments in part order, whatever order they arrive", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(1, 1, "the "));
    buffer.apply(delta(1, 3, "arrived"));
    buffer.apply(delta(1, 2, "answer "));
    // Ordered by `part`, never by a clock: a wrap's timestamp is the publisher's
    // to choose and two machines disagree.
    expect(buffer.text("text")).toBe("the answer arrived");
  });

  it("stops at a hole instead of rendering across it", () => {
    // Never rendered across: text with an invisible gap in it is worse than short
    // text, because nobody can see the gap.
    const buffer = new DeltaBuffer();
    buffer.apply(delta(1, 1, "half a "));
    buffer.apply(delta(1, 4, "sentence"));
    expect(buffer.text("text")).toBe("half a ");
    expect(buffer.incomplete).toBe(true);

    // And a late fragment filling the hole completes it, because "missing" and
    // "out of order" look identical at the moment they happen.
    buffer.apply(delta(1, 2, "whole "));
    buffer.apply(delta(1, 3, "long "));
    expect(buffer.text("text")).toBe("half a whole long sentence");
    expect(buffer.incomplete).toBe(false);
  });

  it("starts fresh on a new turn", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(1, 1, "first turn"));
    buffer.apply(delta(2, 1, "second turn"));
    expect(buffer.turn).toBe(2);
    expect(buffer.text("text")).toBe("second turn");
  });

  it("ignores a delta from a turn already gone by", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(2, 1, "current"));
    expect(buffer.apply(delta(1, 1, "stale"))).toBe(false);
    expect(buffer.text("text")).toBe("current");
  });

  it("treats the same part twice as a relay duplicate, not more text", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(1, 1, "once"));
    expect(buffer.apply(delta(1, 1, "once"))).toBe(false);
    expect(buffer.text("text")).toBe("once");
  });

  it("keeps kinds apart, so reasoning never lands in the answer", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(1, 1, "thinking", "reasoning"));
    buffer.apply(delta(1, 2, "speaking", "text"));
    expect(buffer.text("reasoning")).toBe("thinking");
    expect(buffer.text("text")).toBe("speaking");
  });

  it("stops growing, because anyone can send you deltas", () => {
    const buffer = new DeltaBuffer();
    for (let part = 1; part <= MAX_PARTS + 50; part += 1)
      buffer.apply(delta(1, part, "x"));
    expect(buffer.current.length).toBeLessThanOrEqual(MAX_PARTS);
    expect(buffer.incomplete).toBe(true);
  });

  it("forgets everything once the stored turn has arrived", () => {
    const buffer = new DeltaBuffer();
    buffer.apply(delta(3, 1, "preview"));
    buffer.settle(3);
    expect(buffer.turn).toBe(0);
    expect(buffer.text("text")).toBe("");
  });
});
