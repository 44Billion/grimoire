import { describe, it, expect } from "vitest";
import { resolveFeedScrollTarget } from "./useFeedHomeEnd";

describe("resolveFeedScrollTarget", () => {
  const div = { tagName: "DIV", isContentEditable: false };

  it("sends Home to the first item, anchored to the top", () => {
    expect(resolveFeedScrollTarget("Home", div)).toEqual({
      index: 0,
      align: "start",
    });
  });

  it("sends End to the last item, anchored to the bottom", () => {
    expect(resolveFeedScrollTarget("End", div)).toEqual({
      index: "LAST",
      align: "end",
    });
  });

  it("ignores every other key", () => {
    for (const key of ["PageUp", "ArrowDown", "Enter", "h", "e"]) {
      expect(resolveFeedScrollTarget(key, div)).toBeNull();
    }
  });

  // The feed must not steal Home/End from a text field inside an event —
  // there they are caret movement, not scrolling.
  it.each(["INPUT", "TEXTAREA"])("leaves %s alone", (tagName) => {
    expect(
      resolveFeedScrollTarget("Home", { tagName, isContentEditable: false }),
    ).toBeNull();
    expect(
      resolveFeedScrollTarget("End", { tagName, isContentEditable: false }),
    ).toBeNull();
  });

  it("leaves contentEditable alone", () => {
    const editor = { tagName: "DIV", isContentEditable: true };
    expect(resolveFeedScrollTarget("Home", editor)).toBeNull();
    expect(resolveFeedScrollTarget("End", editor)).toBeNull();
  });
});
