import { describe, it, expect } from "vitest";
import { splitHighlightContext } from "./highlight-context";

describe("splitHighlightContext", () => {
  it("splits on an exact match", () => {
    expect(splitHighlightContext("a bright red car", "bright red")).toEqual({
      before: "a ",
      match: "bright red",
      after: " car",
    });
  });

  it("matches across differing whitespace and keeps the context's own text", () => {
    const context =
      "The responsibility is on us\nto build it right, and to stop.";
    const result = splitHighlightContext(context, "on us to build it right");
    expect(result).toEqual({
      before: "The responsibility is ",
      match: "on us\nto build it right",
      after: ", and to stop.",
    });
  });

  it("tolerates leading and trailing whitespace on the highlight", () => {
    expect(splitHighlightContext("one two three", "  two  ")).toEqual({
      before: "one ",
      match: "two",
      after: " three",
    });
  });

  it("handles context equal to the highlight", () => {
    expect(splitHighlightContext("same text", "same text")).toEqual({
      before: "",
      match: "same text",
      after: "",
    });
  });

  it("returns null when the highlight is longer than the context", () => {
    expect(
      splitHighlightContext("short", "a much longer highlight"),
    ).toBeNull();
  });

  it("returns null when the highlight is absent", () => {
    expect(splitHighlightContext("alpha beta", "gamma")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(splitHighlightContext("", "x")).toBeNull();
    expect(splitHighlightContext("x", "")).toBeNull();
    expect(splitHighlightContext(undefined, "x")).toBeNull();
    expect(splitHighlightContext("x", undefined)).toBeNull();
    expect(splitHighlightContext("some text", "   ")).toBeNull();
  });

  it("splits on the first occurrence only", () => {
    expect(splitHighlightContext("go go go", "go")).toEqual({
      before: "",
      match: "go",
      after: " go go",
    });
  });
});
