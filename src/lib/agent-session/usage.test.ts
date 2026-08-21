import { describe, expect, it } from "vitest";

import { cacheRate, latestTurnUsage } from "./usage";

describe("cacheRate", () => {
  it("divides by input, because cacheRead is part of it", () => {
    /**
     * The two places this is rendered computed it two ways, which is one more
     * than the number of correct answers. `cacheRead` is a SUBSET of `input`, so
     * dividing by `input + cacheRead` counts the cached tokens twice and always
     * reads low — 33% where the truth is 50%.
     */
    expect(
      cacheRate({ input: 100, output: 10, cacheRead: 50, cacheWrite: 0 }),
    ).toBe(0.5);
  });

  it("has no rate when nothing was cached, rather than nought percent", () => {
    // "0%" invites a reader to wonder what went wrong; nothing says nothing.
    expect(
      cacheRate({ input: 100, output: 10, cacheRead: 0, cacheWrite: 0 }),
    ).toBeUndefined();
    expect(cacheRate(undefined)).toBeUndefined();
    expect(
      cacheRate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    ).toBeUndefined();
  });
});

describe("latestTurnUsage", () => {
  it("reads the LAST turn's usage, not a sum of every turn", () => {
    /**
     * The bug this guards against: the head's `usage` tag is a running total
     * across the whole session, so a context-window percentage built from it
     * grows every turn and blows past 100% long before the window is actually
     * full. The window is only ever as full as the last request made it.
     */
    const turns = [
      { usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 } },
      { usage: { input: 4000, output: 200, cacheRead: 3000, cacheWrite: 0 } },
    ];
    expect(latestTurnUsage(turns)).toEqual({
      input: 4000,
      output: 200,
      cacheRead: 3000,
      cacheWrite: 0,
    });
  });

  it("skips turns with no usage — a tool turn, say — to find the last one that has one", () => {
    const turns = [
      { usage: { input: 4000, output: 200, cacheRead: 0, cacheWrite: 0 } },
      {},
    ];
    expect(latestTurnUsage(turns)).toEqual({
      input: 4000,
      output: 200,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("has nothing to report for an empty transcript", () => {
    expect(latestTurnUsage([])).toBeUndefined();
  });
});
