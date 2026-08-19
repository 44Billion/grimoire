/**
 * A chain of turns, read as a conversation.
 *
 * The wire shape and the reading shape are not the same, and this is where they
 * part. On the wire a tool call and its result are two turns, because the result
 * did not exist when the call was published and a turn is never rewritten. On the
 * page they are one row: "ran npm test → exit 0". Likewise a step that reasons,
 * calls three tools and then answers is four turns and one thing the agent did.
 *
 * So turns are grouped by speaker and their parts flattened, then each
 * `tool_call` is paired with the `tool_result` that answers it by id. A result
 * whose call never arrived — a gap in the chain, a session read halfway — still
 * renders on its own rather than vanishing, because a reader being shown less
 * than arrived is the one thing this must not do.
 */

import type { DecodedTurn, TurnPart } from "@/lib/agent-session/types";
import { isKnownPart } from "@/lib/agent-session/types";

/** One side of the conversation, as one block on the page. */
export interface TranscriptBlock {
  /** `user` is the operator; everything else is the agent working. */
  side: "user" | "agent";
  /** Who to credit. The agent's pubkey, or the operator's for a prompt. */
  speaker?: string;
  /** Earliest rumor clock in the block. */
  at: number;
  /** Every part the block covers, in order, tool results already folded in. */
  items: TranscriptItem[];
  /** The turns folded in, so a footer can total what they cost. */
  turns: DecodedTurn[];
}

/** A part to render, or a call and its answer as one thing. */
export type TranscriptItem =
  | { kind: "part"; part: TurnPart }
  | {
      kind: "tool";
      id: string;
      name: string;
      arguments: Record<string, unknown> | null;
      argumentsDigest?: string;
      result?: {
        ok: boolean;
        output: string | null;
        truncated?: { bytes: number; sha256: string };
        ref?: { url: string; size: number; sha256: string };
      };
    };

/**
 * Group a chain into blocks and pair every tool call with its result.
 *
 * `operator` is who said the `user` turns — a turn is signed by the agent
 * whatever its role, so the prompt's author is not on the turn itself.
 */
export function groupTurns(
  turns: DecodedTurn[],
  operator?: string,
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];

  for (const turn of turns) {
    const side: "user" | "agent" = turn.role === "user" ? "user" : "agent";
    const last = blocks[blocks.length - 1];

    // Consecutive turns from the same side are one block. A prompt always starts
    // a new one, even two in a row: two things were asked, not one.
    const block =
      last && last.side === side && side === "agent"
        ? last
        : (blocks.push({
            side,
            speaker: side === "user" ? operator : turn.pubkey,
            at: turn.created_at,
            items: [],
            turns: [],
          }),
          blocks[blocks.length - 1]!);

    block.turns.push(turn);

    for (const part of turn.parts) {
      if (!isKnownPart(part)) {
        block.items.push({ kind: "part", part });
        continue;
      }

      if (part.type === "tool_call") {
        block.items.push({
          kind: "tool",
          id: part.id,
          name: part.name,
          arguments: part.arguments,
          argumentsDigest: part.arguments_digest,
        });
        continue;
      }

      if (part.type === "tool_result") {
        // Its call is usually in this block; on a truncated read it may be in an
        // earlier one, so the whole transcript is searched before giving up.
        const call = findCall(blocks, part.id);
        if (call) {
          call.result = {
            ok: part.ok,
            output: part.output,
            truncated: part.truncated,
            ref: part.ref,
          };
          continue;
        }
        block.items.push({ kind: "part", part });
        continue;
      }

      block.items.push({ kind: "part", part });
    }
  }

  return blocks;
}

function findCall(
  blocks: TranscriptBlock[],
  id: string,
): Extract<TranscriptItem, { kind: "tool" }> | undefined {
  for (let b = blocks.length - 1; b >= 0; b -= 1) {
    const items = blocks[b]!.items;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]!;
      if (item.kind === "tool" && item.id === id && !item.result) return item;
    }
  }
  return undefined;
}

/** What a block cost, totalled across the turns folded into it. */
export function blockTotals(block: TranscriptBlock): {
  input: number;
  output: number;
  cost?: { amount: string; currency: string };
  model?: string;
  provider?: string;
  stop?: string;
} {
  let input = 0;
  let output = 0;
  let cost: { amount: string; currency: string } | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let stop: string | undefined;

  for (const turn of block.turns) {
    if (turn.usage) {
      input += turn.usage.input;
      output += turn.usage.output;
    }
    if (turn.model) {
      model = turn.model.id;
      provider = turn.model.provider;
    }
    // The last non-ordinary stop wins: a block that ended badly says so.
    if (turn.stop && turn.stop !== "end_turn") stop = turn.stop;
    if (turn.cost)
      cost = cost
        ? {
            amount: (Number(cost.amount) + Number(turn.cost.amount)).toFixed(6),
            currency: turn.cost.currency,
          }
        : { amount: turn.cost.amount, currency: turn.cost.currency };
  }

  return { input, output, cost, model, provider, stop };
}
