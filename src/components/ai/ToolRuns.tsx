import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { ToolRun } from "@/types/tool-part";

/**
 * Tool calls the page executed for a turn, collapsed.
 *
 * Shown because the model asking for data is a thing the user paid for and
 * should be able to audit: which tool, with what arguments, and what came back.
 */
export function ToolRuns({ runs }: { runs: ToolRun[] }) {
  if (runs.length === 0) return null;

  return (
    <div className="my-2 space-y-3">
      {runs.map((run, index) => (
        <Tool className="mb-0" key={`${run.name}-${index}`}>
          <ToolHeader state={run.state} type={`tool-${run.name}`} />
          <ToolContent>
            <ToolInput input={run.input} />
            <ToolOutput errorText={run.errorText} output={run.output} />
          </ToolContent>
        </Tool>
      ))}
    </div>
  );
}
