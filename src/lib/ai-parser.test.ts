import { describe, expect, it } from "vitest";

import { parseAiCommand } from "./ai-parser";

const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";

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

describe("conversations", () => {
  it("reopens a stored conversation", () => {
    expect(parseAiCommand(["--conversation", "abc-123"])).toEqual({
      conversation: "abc-123",
    });
    expect(parseAiCommand(["-c", "abc-123"]).conversation).toBe("abc-123");
  });

  it("rejects a dangling --conversation", () => {
    expect(() => parseAiCommand(["--conversation"])).toThrowError(
      /requires a conversation id/,
    );
  });
});

describe("targets", () => {
  it("takes a leading nip id as the target", () => {
    expect(parseAiCommand(["nip-01", "why", "the", "id", "field?"])).toEqual({
      target: { type: "nip", value: "01" },
      prompt: "why the id field?",
    });
  });

  it("pads a single-digit nip", () => {
    expect(parseAiCommand(["nip9"]).target).toEqual({
      type: "nip",
      value: "09",
    });
  });

  it("takes a leading kind number as the target", () => {
    expect(parseAiCommand(["30023"]).target).toEqual({
      type: "kind",
      value: "30023",
    });
  });

  it("takes a leading bech32 entity as the target", () => {
    expect(parseAiCommand([NPUB, "who", "is", "this?"])).toEqual({
      target: { type: "event", value: NPUB },
      prompt: "who is this?",
    });
  });

  it("leaves a mid-sentence npub in the prompt", () => {
    const parsed = parseAiCommand(["who", "is", NPUB]);
    expect(parsed.target).toBeUndefined();
    expect(parsed.prompt).toBe(`who is ${NPUB}`);
  });

  it("does not mistake an ordinary question for a target", () => {
    expect(parseAiCommand(["explain", "relays"]).target).toBeUndefined();
  });
});
