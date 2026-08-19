import { describe, expect, it } from "vitest";

import { DeltaCoalescer, HEARTBEAT_MS, type CoalescedDelta } from "./coalesce";

/** A hand-cranked clock: nothing here should wait on a real timer. */
function harness(
  options: Partial<ConstructorParameters<typeof DeltaCoalescer>[0]> = {},
) {
  const emitted: CoalescedDelta[] = [];
  let pending: (() => void) | null = null;

  const coalescer = new DeltaCoalescer({
    emit: (delta) => emitted.push(delta),
    setTimer: (fn) => {
      pending = fn;
      return 1;
    },
    clearTimer: () => {
      pending = null;
    },
    ...options,
  });

  return { coalescer, emitted, tick: () => pending?.() };
}

describe("DeltaCoalescer", () => {
  it("holds tokens until the timer fires", () => {
    const { coalescer, emitted, tick } = harness();

    coalescer.startTurn(1);
    coalescer.push("text", "one ");
    coalescer.push("text", "two");
    expect(emitted).toEqual([]);

    tick();

    expect(emitted).toEqual([
      { turn: 1, part: 1, delta: "text", text: "one two" },
    ]);
  });

  it("flushes on the byte threshold without waiting", () => {
    const { coalescer, emitted } = harness({ flushBytes: 8 });

    coalescer.startTurn(1);
    coalescer.push("text", "123456789");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.text).toBe("123456789");
  });

  it("never lets one delta exceed the hard cap", () => {
    const { coalescer, emitted } = harness({
      flushBytes: 10_000,
      maxBytes: 16,
    });

    coalescer.startTurn(1);
    coalescer.push("text", "x".repeat(64));

    expect(emitted[0]!.text).toHaveLength(16);
  });

  it("flushes at a boundary — a tool call, done, an error", () => {
    const { coalescer, emitted } = harness();

    coalescer.startTurn(2);
    coalescer.push("text", "partial");
    coalescer.boundary();

    expect(emitted).toEqual([
      { turn: 2, part: 1, delta: "text", text: "partial" },
    ]);
  });

  it("does not interleave text and reasoning in one part", () => {
    const { coalescer, emitted, tick } = harness();

    coalescer.startTurn(1);
    coalescer.push("reasoning", "hmm");
    coalescer.push("text", "answer");
    tick();

    expect(emitted.map((d) => [d.delta, d.text])).toEqual([
      ["reasoning", "hmm"],
      ["text", "answer"],
    ]);
    expect(emitted.map((d) => d.part)).toEqual([1, 2]);
  });

  it("restarts part at each turn — deltas are ordered inside a turn, not across", () => {
    const { coalescer, emitted } = harness({ flushBytes: 1 });

    coalescer.startTurn(1);
    coalescer.push("text", "a");
    coalescer.startTurn(2);
    coalescer.push("text", "b");

    expect(emitted).toEqual([
      { turn: 1, part: 1, delta: "text", text: "a" },
      { turn: 2, part: 1, delta: "text", text: "b" },
    ]);
  });

  it("degrades to a heartbeat once a turn has flooded", () => {
    const { coalescer, emitted } = harness({ flushBytes: 1, maxPerTurn: 3 });

    coalescer.startTurn(1);
    for (let i = 0; i < 3; i += 1) coalescer.push("text", "x");
    expect(emitted).toHaveLength(3);

    coalescer.push("text", "x", 0);
    coalescer.push("text", "x", 100);
    coalescer.push("text", "x", HEARTBEAT_MS + 1);

    const beats = emitted.filter((d) => d.delta === "heartbeat");
    expect(beats).toHaveLength(2);
    expect(beats.every((d) => d.text === "")).toBe(true);
  });
});
