import { Fragment } from "react";

import { ToolRuns } from "./ToolRuns";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

import type { ToolRun } from "@/types/tool-part";

/**
 * A turn's work, in the order it happened: what Hex thought, what it called,
 * what it thought about the result.
 *
 * One block of reasoning above every tool call was wrong twice over — the
 * thinking that followed a result appeared before the call that produced it,
 * and rounds read as one thought.
 */
export function TurnSteps({
  pending,
  reasoningRounds,
  toolRuns,
}: {
  pending?: boolean;
  reasoningRounds: string[];
  toolRuns: ToolRun[];
}) {
  const rounds = Math.max(
    reasoningRounds.length,
    ...toolRuns.map((run) => (run.round ?? 0) + 1),
    0,
  );
  if (rounds === 0) return null;

  return (
    <>
      {Array.from({ length: rounds }, (_, round) => {
        const thought = reasoningRounds[round];
        const runs = toolRuns.filter((run) => (run.round ?? 0) === round);
        if (!thought && runs.length === 0) return null;

        return (
          <Fragment key={round}>
            {thought && (
              // Collapsed always, streaming included: the trigger already says
              // he is thinking, and an expanding trace shoves the answer down
              // the pane while it is being written.
              <Reasoning
                className="mb-1"
                defaultOpen={false}
                isStreaming={Boolean(pending) && round === rounds - 1}
              >
                <ReasoningTrigger />
                {/* Quoted and smaller: a trace is something Hex said to itself,
                    and it should not compete with the answer for weight. */}
                <ReasoningContent className="mt-2 border-l-2 border-border pl-3 text-xs [&_li]:text-xs [&_p]:text-xs">
                  {thought}
                </ReasoningContent>
              </Reasoning>
            )}
            {runs.length > 0 && <ToolRuns runs={runs} />}
          </Fragment>
        );
      })}
    </>
  );
}
