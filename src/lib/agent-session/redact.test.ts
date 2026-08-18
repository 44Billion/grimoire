import { describe, expect, it } from "vitest";

import {
  applyProfile,
  emitsDeltas,
  redactAlt,
  redactCost,
  stripPaths,
} from "./redact";
import type { ContentBlock } from "./types";

const blocks: ContentBlock[] = [
  { type: "text", text: "editing /Users/alice/grimoire/src/main.tsx" },
  { type: "thinking", text: "the caller never unsubscribes" },
  {
    type: "tool_call",
    id: "tc_01",
    name: "Bash",
    arguments: { command: "npm test" },
    arguments_digest: "ab12",
  },
  {
    type: "tool_result",
    id: "tc_01",
    name: "Bash",
    ok: true,
    output: "x".repeat(4096),
  },
  { type: "image", url: "https://example/x.png", mime: "image/png" },
];

describe("applyProfile", () => {
  it("full keeps everything", () => {
    expect(applyProfile(blocks, "full")).toEqual(blocks);
  });

  it("summary drops thinking and clips tool output, keeping arguments", () => {
    const out = applyProfile(blocks, "summary");

    expect(out.some((b) => b.type === "thinking")).toBe(false);
    const call = out.find((b) => b.type === "tool_call");
    expect(call && "arguments" in call && call.arguments).toEqual({
      command: "npm test",
    });
    const result = out.find((b) => b.type === "tool_result");
    expect(result && "output" in result && result.output).toMatch(
      /…\[truncated]$/,
    );
    expect(result && "truncated" in result && result.truncated?.bytes).toBe(
      4096,
    );
  });

  it("public nulls arguments but keeps the digest, and keeps only ok", () => {
    const out = applyProfile(blocks, "public");

    const call = out.find((b) => b.type === "tool_call");
    expect(call).toMatchObject({ arguments: null, arguments_digest: "ab12" });
    const result = out.find((b) => b.type === "tool_result");
    expect(result).toMatchObject({ ok: true, output: null });
    expect(result && "ref" in result).toBe(false);
  });

  it("public drops thinking and images, and strips paths from text", () => {
    const out = applyProfile(blocks, "public");

    expect(out.some((b) => b.type === "thinking")).toBe(false);
    expect(out.some((b) => b.type === "image")).toBe(false);
    const text = out.find((b) => b.type === "text");
    expect(text && "text" in text && text.text).toBe("editing [path]");
  });
});

describe("the rest of the profile table", () => {
  it("omits cost publicly and keeps it otherwise", () => {
    const cost = { amount: "0.084", currency: "USD" };
    expect(redactCost(cost, "public")).toBeUndefined();
    expect(redactCost(cost, "summary")).toBe(cost);
    expect(redactCost(cost, "full")).toBe(cost);
  });

  it("strips paths from alt, which is what a dumb client renders", () => {
    expect(redactAlt("wrote /home/bob/x.ts", "public")).toBe("wrote [path]");
    expect(redactAlt("wrote /home/bob/x.ts", "full")).toBe(
      "wrote /home/bob/x.ts",
    );
  });

  it("emits no deltas on a public stream", () => {
    expect(emitsDeltas("public")).toBe(false);
    expect(emitsDeltas("summary")).toBe(true);
  });

  it("strips windows paths and file urls too", () => {
    expect(stripPaths("C:\\Users\\bob\\repo\\x.ts and file:///etc/hosts")).toBe(
      "[path] and [path]",
    );
  });
});
