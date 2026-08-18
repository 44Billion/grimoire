import { describe, expect, it } from "vitest";

import { TRUNCATION_MARKER, TURN_MAX_BYTES, fitBlock, fitTurn } from "./blob";
import type { ContentBlock } from "./types";

const digest = async (text: string) => `sha:${text.length}`;

describe("fitBlock", () => {
  it("clips an oversize text block and says how much it dropped", async () => {
    const block: ContentBlock = { type: "text", text: "x".repeat(20_000) };

    const fitted = await fitBlock(block, { digest, textMax: 100 });

    expect(fitted.type).toBe("text");
    expect("text" in fitted && fitted.text).toContain(TRUNCATION_MARKER);
    expect("truncated" in fitted && fitted.truncated).toEqual({
      bytes: 20_000,
      sha256: "sha:20000",
    });
  });

  it("references an oversize tool result instead of inlining it", async () => {
    const block: ContentBlock = {
      type: "tool_result",
      id: "tc_01",
      name: "Bash",
      ok: true,
      output: "y".repeat(50_000),
    };

    const fitted = await fitBlock(block, {
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
    const block: ContentBlock = {
      type: "tool_result",
      id: "tc_01",
      name: "Bash",
      ok: false,
      output: "z".repeat(50_000),
    };

    const fitted = await fitBlock(block, { digest, outputMax: 1024 });

    expect("output" in fitted && fitted.output).toContain(TRUNCATION_MARKER);
    expect("ref" in fitted).toBe(false);
    expect("truncated" in fitted && fitted.truncated?.bytes).toBe(50_000);
  });

  it("leaves a block that already fits alone", async () => {
    const block: ContentBlock = { type: "text", text: "short" };

    expect(await fitBlock(block, { digest })).toBe(block);
  });
});

describe("fitTurn", () => {
  it("elides thinking before it starts clipping anything else", async () => {
    const blocks: ContentBlock[] = [
      { type: "thinking", text: "t".repeat(60_000) },
      { type: "text", text: "the answer" },
    ];

    const { blocks: fitted, lossy } = await fitTurn(blocks, {
      digest,
      textMax: 100_000,
    });

    expect(lossy).toBe(true);
    expect(fitted[0]).toMatchObject({ type: "thinking", text: "[elided]" });
    expect(fitted[1]).toMatchObject({ type: "text", text: "the answer" });
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
  });

  it("never emits a turn it knows a relay will reject", async () => {
    const blocks: ContentBlock[] = Array.from({ length: 40 }, () => ({
      type: "text" as const,
      text: "w".repeat(4_000),
    }));

    const { blocks: fitted } = await fitTurn(blocks, {
      digest,
      textMax: 4_000,
    });

    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
  });
});
