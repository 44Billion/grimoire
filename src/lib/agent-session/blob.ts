/**
 * Size limits, truncation and out-of-band tool results (NIP-xx: Agent Sessions).
 *
 * A tool that prints a build log will outrun any relay's event cap, and a
 * wrapped copy is ~1.4x the rumor after NIP-44 and base64. Truncation is always
 * explicit: the block says how much it dropped and the digest of what it dropped.
 */

import type { ContentBlock, BlobRef, Truncation } from "./types";

export const TEXT_INLINE_MAX = 8 * 1024;
export const TOOL_OUTPUT_INLINE_MAX = 16 * 1024;
export const TURN_MAX_BYTES = 48 * 1024;
export const TRUNCATION_MARKER = "…[truncated]";

/** Digest of the original, so a fuller copy elsewhere can be proven to match. */
export type Digest = (text: string) => Promise<string>;

/** Where an oversize output goes instead of into the event. */
export type BlobSink = (
  text: string,
  mime: string,
) => Promise<Omit<BlobRef, "sha256"> & { sha256?: string }>;

export interface ExternalizeOptions {
  digest: Digest;
  /** Absent means "truncate honestly"; the transcript then says what it lost. */
  sink?: BlobSink;
  textMax?: number;
  outputMax?: number;
}

async function truncation(text: string, digest: Digest): Promise<Truncation> {
  return { bytes: text.length, sha256: await digest(text) };
}

/** Keep the head and the tail: a stack trace's ends carry the information. */
function clip(text: string, max: number): string {
  const head = Math.floor((max * 2) / 3);
  const tail = max - head;
  return `${text.slice(0, head)}\n${TRUNCATION_MARKER}\n${text.slice(-tail)}`;
}

/**
 * Bring one block within the inline limits, uploading an oversize tool result to
 * the sink when one is supplied. Never emits a block it knows a relay will
 * reject.
 */
export async function fitBlock(
  block: ContentBlock,
  options: ExternalizeOptions,
): Promise<ContentBlock> {
  const textMax = options.textMax ?? TEXT_INLINE_MAX;
  const outputMax = options.outputMax ?? TOOL_OUTPUT_INLINE_MAX;

  if (
    (block.type === "text" || block.type === "thinking") &&
    block.text.length > textMax
  )
    return {
      ...block,
      text: clip(block.text, textMax),
      truncated: await truncation(block.text, options.digest),
    };

  if (
    block.type === "tool_result" &&
    block.output &&
    block.output.length > outputMax
  ) {
    const sha256 = await options.digest(block.output);
    if (options.sink) {
      const ref = await options.sink(block.output, "text/plain");
      return {
        ...block,
        output: null,
        ref: { ...ref, sha256: ref.sha256 ?? sha256 },
      };
    }
    return {
      ...block,
      output: clip(block.output, outputMax),
      truncated: { bytes: block.output.length, sha256 },
    };
  }

  return block;
}

/**
 * Fit a whole turn. Thinking goes first when the total is still too large — it
 * is the least load-bearing thing in a transcript and the largest.
 */
export async function fitTurn(
  blocks: ContentBlock[],
  options: ExternalizeOptions,
): Promise<{ blocks: ContentBlock[]; lossy: boolean }> {
  const fitted: ContentBlock[] = [];
  for (const block of blocks) fitted.push(await fitBlock(block, options));

  if (JSON.stringify(fitted).length <= TURN_MAX_BYTES)
    return { blocks: fitted, lossy: false };

  const elided = fitted.map((block) =>
    block.type === "thinking" ? { ...block, text: "[elided]" } : block,
  );
  if (JSON.stringify(elided).length <= TURN_MAX_BYTES)
    return { blocks: elided, lossy: true };

  // Last resort: a total budget, not a per-block one. Forty clipped blocks are
  // still forty blocks, and the relay counts the whole event.
  const clipped: ContentBlock[] = [];
  let budget = TURN_MAX_BYTES - 512; // headroom for tags and JSON scaffolding
  for (const block of elided) {
    const share = Math.max(64, Math.floor(budget / Math.max(1, elided.length)));
    if (block.type === "text" || block.type === "thinking")
      clipped.push({
        ...block,
        text: clip(block.text, Math.min(share, block.text.length)),
      });
    else if (block.type === "tool_result" && block.output)
      clipped.push({
        ...block,
        output: clip(block.output, Math.min(share, block.output.length)),
      });
    else clipped.push(block);
    budget -= JSON.stringify(clipped[clipped.length - 1]).length;
    if (budget <= 0) break;
  }
  return { blocks: clipped, lossy: true };
}
