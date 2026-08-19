import { describe, expect, it } from "vitest";

import { TRUNCATION_MARKER, TURN_MAX_BYTES, fitPart, fitTurn } from "./blob";
import type { ContentPart } from "./types";

const digest = async (text: string) => `sha:${text.length}`;

describe("fitPart", () => {
  it("clips an oversize text part and says how much it dropped", async () => {
    const part: ContentPart = { type: "text", text: "x".repeat(20_000) };

    const fitted = await fitPart(part, { digest, textMax: 100 });

    expect(fitted.type).toBe("text");
    expect("text" in fitted && fitted.text).toContain(TRUNCATION_MARKER);
    expect((fitted as { truncated?: unknown }).truncated).toEqual({
      bytes: 20_000,
      sha256: "sha:20000",
    });
  });

  it("references an oversize tool result instead of inlining it", async () => {
    const part: ContentPart = {
      type: "tool_result",
      id: "tc_01",
      name: "Bash",
      ok: true,
      output: "y".repeat(50_000),
    };

    const fitted = await fitPart(part, {
      digest,
      outputMax: 1024,
      sink: async (text, mime) => ({
        url: "https://blossom.example/blob",
        size: text.length,
        mime,
      }),
    });

    expect(fitted).toMatchObject({
      output: null,
      ref: {
        url: "https://blossom.example/blob",
        size: 50_000,
        mime: "text/plain",
        sha256: "sha:50000",
      },
    });
  });

  it("is honest about what it lost when there is no sink", async () => {
    const part: ContentPart = {
      type: "tool_result",
      id: "tc_01",
      name: "Bash",
      ok: false,
      output: "z".repeat(50_000),
    };

    const fitted = await fitPart(part, { digest, outputMax: 1024 });

    expect("output" in fitted && fitted.output).toContain(TRUNCATION_MARKER);
    expect("ref" in fitted).toBe(false);
    expect((fitted as { truncated?: { bytes: number } }).truncated?.bytes).toBe(
      50_000,
    );
  });

  it("leaves a part that already fits alone", async () => {
    const part: ContentPart = { type: "text", text: "short" };

    expect(await fitPart(part, { digest })).toBe(part);
  });
});

describe("fitTurn", () => {
  it("elides reasoning before it starts clipping anything else", async () => {
    const parts: ContentPart[] = [
      { type: "reasoning", text: "t".repeat(60_000) },
      { type: "text", text: "the answer" },
    ];

    const { parts: fitted, lossy } = await fitTurn(parts, {
      digest,
      textMax: 100_000,
    });

    expect(lossy).toBe(true);
    expect(fitted[0]).toMatchObject({ type: "reasoning", text: "[elided]" });
    expect(fitted[1]).toMatchObject({ type: "text", text: "the answer" });
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
  });

  it("never emits a turn it knows a relay will reject", async () => {
    const parts: ContentPart[] = Array.from({ length: 40 }, () => ({
      type: "text" as const,
      text: "w".repeat(4_000),
    }));

    const { parts: fitted } = await fitTurn(parts, {
      digest,
      textMax: 4_000,
    });

    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
  });
});

describe("fitTurn under hostile sizes", () => {
  it("bounds a tool call whose arguments are enormous", async () => {
    // Nothing clipped `arguments` before: a 200 KB call produced a turn four
    // times the cap, which the relay then refused — losing the turn entirely.
    const parts: ContentPart[] = [
      {
        type: "tool_call",
        id: "tc_01",
        name: "Write",
        arguments: { content: "q".repeat(200_000) },
      },
      { type: "text", text: "and then I wrote the file" },
    ];

    const { parts: fitted, lossy } = await fitTurn(parts, { digest });

    expect(lossy).toBe(true);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
    const call = fitted.find((b) => b.type === "tool_call");
    expect(call).toMatchObject({ arguments: null });
    expect(
      call && "arguments_digest" in call && call.arguments_digest,
    ).toBeTruthy();
  });

  it("says so when a part had to be dropped", async () => {
    const parts: ContentPart[] = [
      { type: "text", text: "a".repeat(60_000) },
      {
        type: "image",
        url: `data:image/png;base64,${"A".repeat(60_000)}`,
        mime: "image/png",
      },
      { type: "text", text: "the tail" },
    ];

    const { parts: fitted } = await fitTurn(parts, {
      digest,
      textMax: 100_000,
    });

    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
    const rendered = JSON.stringify(fitted);
    expect(rendered).toContain(TRUNCATION_MARKER);
  });

  it("does not label intact content as truncated", async () => {
    const parts: ContentPart[] = [
      { type: "text", text: "x".repeat(60_000) },
      { type: "text", text: "short and complete" },
    ];

    const { parts: fitted } = await fitTurn(parts, {
      digest,
      textMax: 100_000,
    });

    const tail = fitted[fitted.length - 1];
    expect(tail).toMatchObject({ type: "text", text: "short and complete" });
  });
});
