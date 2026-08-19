import { describe, expect, it } from "vitest";

import { cacheRate } from "./usage";

describe("cacheRate", () => {
  it("divides by input, because cacheRead is part of it", () => {
    /**
     * The two places this is rendered computed it two ways, which is one more
     * than the number of correct answers. `cacheRead` is a SUBSET of `input`, so
     * dividing by `input + cacheRead` counts the cached tokens twice and always
     * reads low — 33% where the truth is 50%.
     */
    expect(cacheRate({ input: 100, output: 10, cacheRead: 50, cacheWrite: 0 }))
      .toBe(0.5);
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
