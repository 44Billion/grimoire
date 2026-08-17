import { describe, expect, it } from "vitest";

import { parseAiCommand } from "./ai-parser";

describe("parseAiCommand", () => {
  it("joins bare words into a prompt", () => {
    expect(parseAiCommand(["is", "nostr", "dead"])).toEqual({
      prompt: "is nostr dead",
    });
  });

  it("takes a system prompt out of the words", () => {
    expect(
      parseAiCommand(["--system", "Be terse.", "explain", "nip-01"]),
    ).toEqual({ prompt: "explain nip-01", system: "Be terse." });
  });

  it("accepts --system after the prompt", () => {
    expect(parseAiCommand(["hello", "-s", "Be terse."])).toEqual({
      prompt: "hello",
      system: "Be terse.",
    });
  });

  it("opens an empty window with no args", () => {
    expect(parseAiCommand([])).toEqual({});
  });

  it("rejects a dangling --system", () => {
    expect(() => parseAiCommand(["--system"])).toThrowError(
      /--system requires a value/,
    );
  });
});
