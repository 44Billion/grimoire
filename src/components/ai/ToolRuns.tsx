import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { FileTextIcon, WrenchIcon } from "lucide-react";

import { CommandChips } from "./CommandChips";

import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";

import type { ToolRun } from "@/types/tool-part";

/**
 * Event ids a `query_nostr` call returned.
 *
 * `requestEvents` puts everything it fetches in the EventStore, so the ids are
 * enough — the feed renders from the store rather than from a JSON copy of it,
 * which is also why the result does not need to carry signatures.
 */
function feedOf(run: ToolRun): string[] | undefined {
  if (run.name !== "query_nostr" || run.state !== "output-available") {
    return undefined;
  }
  const events = (run.output as { events?: unknown })?.events;
  if (!Array.isArray(events)) return undefined;
  const ids = events
    .map((event) => (event as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? ids : undefined;
}

/** The command an `open_window` call ran, if it looks like one. */
function commandOf(run: ToolRun): string | undefined {
  if (run.name !== "open_window") return undefined;
  const command = (run.input as { command?: unknown })?.command;
  return typeof command === "string" ? command : undefined;
}

/**
 * Events a tool fetched, in the shape `req` shows them: a status strip over a
 * divided list of rendered events. Rendering from the EventStore means each row
 * is the same component the feed uses, so a note looks like a note here too.
 */
function ToolFeed({ ids, run }: { ids: string[]; run: ToolRun }) {
  const filter = run.input as
    { kinds?: number[]; limit?: number; authors?: string[] } | undefined;

  return (
    <div className="my-2 overflow-hidden rounded border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <WrenchIcon className="size-3" />
          <span className="font-mono">{run.name}</span>
        </span>
        {filter?.kinds?.length ? (
          <span className="font-mono">kinds {filter.kinds.join(",")}</span>
        ) : null}
        {filter?.authors?.length ? (
          <span>
            {filter.authors.length} author
            {filter.authors.length === 1 ? "" : "s"}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <FileTextIcon className="size-3" />
          {ids.length}
        </span>
      </div>
      <div className="divide-y divide-border/50">
        {ids.map((id) => (
          <EmbeddedEvent className="" eventPointer={{ id }} key={id} />
        ))}
      </div>
    </div>
  );
}

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
      {runs.map((run, index) => {
        // A completed `open_window` is just the command it ran: the Tool
        // wrapper would collapse the one thing worth seeing behind a header,
        // and the row itself re-runs it. Failures keep the wrapper, because
        // then the error is the point.
        const command = commandOf(run);
        if (command && run.state === "output-available") {
          return <CommandChips block={command} key={`${run.name}-${index}`} />;
        }

        // What Hex fetched renders as a feed, the way the same events render
        // anywhere else in grimoire. A JSON dump of them says less and is long.
        const feed = feedOf(run);
        if (feed) {
          return <ToolFeed ids={feed} key={`${run.name}-${index}`} run={run} />;
        }

        return (
          <Tool className="mb-0" key={`${run.name}-${index}`}>
            <ToolHeader state={run.state} type={`tool-${run.name}`} />
            <ToolContent>
              {/* A command Hex ran renders as a command, the way the palette and
                its proposals do — the JSON of `{command: "..."}` says less than
                the row does, and the row re-runs it. */}
              {command ? (
                <CommandChips block={command} />
              ) : (
                <ToolInput input={run.input} />
              )}
              <ToolOutput errorText={run.errorText} output={run.output} />
            </ToolContent>
          </Tool>
        );
      })}
    </div>
  );
}
