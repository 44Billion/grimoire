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
    expect((fitted as { truncated?: unknown }).truncated).toEqual({
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
    expect((fitted as { truncated?: { bytes: number } }).truncated?.bytes).toBe(
      50_000,
    );
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

describe("fitTurn under hostile sizes", () => {
  it("bounds a tool call whose arguments are enormous", async () => {
    // Nothing clipped `arguments` before: a 200 KB call produced a turn four
    // times the cap, which the relay then refused — losing the turn entirely.
    const blocks: ContentBlock[] = [
      {
        type: "tool_call",
        id: "tc_01",
        name: "Write",
        arguments: { content: "q".repeat(200_000) },
      },
      { type: "text", text: "and then I wrote the file" },
    ];

    const { blocks: fitted, lossy } = await fitTurn(blocks, { digest });

    expect(lossy).toBe(true);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
    const call = fitted.find((b) => b.type === "tool_call");
    expect(call).toMatchObject({ arguments: null });
    expect(
      call && "arguments_digest" in call && call.arguments_digest,
    ).toBeTruthy();
  });

  it("says so when a block had to be dropped", async () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "a".repeat(60_000) },
      {
        type: "image",
        url: `data:image/png;base64,${"A".repeat(60_000)}`,
        mime: "image/png",
      },
      { type: "text", text: "the tail" },
    ];

    const { blocks: fitted } = await fitTurn(blocks, {
      digest,
      textMax: 100_000,
    });

    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(TURN_MAX_BYTES);
    const rendered = JSON.stringify(fitted);
    expect(rendered).toContain(TRUNCATION_MARKER);
  });

  it("does not label intact content as truncated", async () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "x".repeat(60_000) },
      { type: "text", text: "short and complete" },
    ];

    const { blocks: fitted } = await fitTurn(blocks, {
      digest,
      textMax: 100_000,
    });

    const tail = fitted[fitted.length - 1];
    expect(tail).toMatchObject({ type: "text", text: "short and complete" });
  });
});
