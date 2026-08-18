/**
 * Redaction profiles (NIP-xx: Agent Sessions).
 *
 * One session can be mirrored private and public at once, so each copy declares
 * what it is. Applied before signing — there is no post-hoc redaction on Nostr.
 */

import type {
  ContentBlock,
  Cost,
  RedactionProfile,
  ToolResultBlock,
} from "./types";

/** Under `summary`, how much of a tool result survives. */
const SUMMARY_OUTPUT_BYTES = 1024;

/** Absolute paths, home dirs and host-ish strings a public copy must not carry. */
const PATH_PATTERNS: RegExp[] = [
  /\/(?:Users|home)\/[^\s"'`)]+/g,
  /[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s"'`)]+/g,
  /\b(?:file|ssh):\/\/[^\s"'`)]+/g,
];

/** Replace anything that names the machine the agent ran on. */
export function stripPaths(text: string): string {
  return PATH_PATTERNS.reduce(
    (out, pattern) => out.replace(pattern, "[path]"),
    text,
  );
}

function digestPlaceholder(block: ContentBlock): string | undefined {
  return "arguments_digest" in block ? block.arguments_digest : undefined;
}

function redactToolResult(
  block: ToolResultBlock,
  profile: RedactionProfile,
): ToolResultBlock {
  if (profile === "full") return block;
  if (profile === "public")
    return {
      type: "tool_result",
      id: block.id,
      name: block.name,
      ok: block.ok,
      output: null,
    };

  if (block.output && block.output.length > SUMMARY_OUTPUT_BYTES)
    return {
      ...block,
      output: `${block.output.slice(0, SUMMARY_OUTPUT_BYTES)}…[truncated]`,
      truncated: block.truncated ?? {
        bytes: block.output.length,
        sha256: "",
      },
    };
  return block;
}

/**
 * Apply a profile to a turn's blocks. `thinking` disappears below `full`, tool
 * arguments below `summary`, and a public copy keeps only whether a tool
 * succeeded — the digest still proves which call it was.
 */
export function applyProfile(
  blocks: ContentBlock[],
  profile: RedactionProfile,
): ContentBlock[] {
  const out: ContentBlock[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "thinking":
        if (profile === "full") out.push(block);
        break;

      case "tool_call":
        if (profile === "public")
          out.push({
            type: "tool_call",
            id: block.id,
            name: block.name,
            arguments: null,
            ...(digestPlaceholder(block)
              ? { arguments_digest: digestPlaceholder(block) }
              : {}),
          });
        else out.push(block);
        break;

      case "tool_result":
        out.push(redactToolResult(block, profile));
        break;

      case "image":
        if (profile !== "public") out.push(block);
        break;

      case "text":
        out.push(
          profile === "public"
            ? { ...block, text: stripPaths(block.text) }
            : block,
        );
        break;
    }
  }

  return out;
}

/** Cost is the operator's business, not the room's. */
export function redactCost(cost: Cost | undefined, profile: RedactionProfile) {
  return profile === "public" ? undefined : cost;
}

/** `alt` is rendered by clients that skip the blocks, so it is redacted too. */
export function redactAlt(alt: string | undefined, profile: RedactionProfile) {
  if (!alt) return alt;
  return profile === "public" ? stripPaths(alt) : alt;
}

/** A public stream carries no deltas at all. */
export function emitsDeltas(profile: RedactionProfile): boolean {
  return profile !== "public";
}
