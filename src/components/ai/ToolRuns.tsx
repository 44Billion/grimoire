import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  BookOpenIcon,
  BracesIcon,
  FileTextIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { CommandChips } from "./CommandChips";
import { ReplyCodeBlock } from "./ReplyCodeBlock";

import { KindBadge } from "@/components/KindBadge";
import { NIPBadge } from "@/components/NIPBadge";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { useAddWindow } from "@/core/state";
import { cn } from "@/lib/utils";

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

interface Lookup {
  nip?: string;
  kind?: number;
  command?: string;
  /** What could not be read, when the answer was a refusal. */
  missing?: string;
}

/**
 * What a `lookup_spec` call read.
 *
 * From the output, not the input: the tool normalises a nip id and follows a
 * kind to the NIP that defines it, so the result names what was actually read.
 */
function lookupOf(run: ToolRun): Lookup | undefined {
  if (run.name !== "lookup_spec" || run.state !== "output-available") {
    return undefined;
  }
  const output = run.output as
    | {
        nip?: { id?: unknown; error?: unknown };
        kind?: { kind?: unknown; known?: unknown };
        command?: { name?: unknown; error?: unknown };
        error?: unknown;
      }
    | undefined;
  if (!output) return undefined;

  const lookup: Lookup = {};
  if (typeof output.nip?.id === "string") lookup.nip = output.nip.id;
  if (typeof output.kind?.kind === "number") lookup.kind = output.kind.kind;
  if (typeof output.command?.name === "string") {
    lookup.command = output.command.name;
  }

  const missing = [
    typeof output.error === "string" ? output.error : undefined,
    typeof output.nip?.error === "string" ? output.nip.error : undefined,
    typeof output.command?.error === "string"
      ? output.command.error
      : undefined,
    output.kind?.known === false ? "Not in the kind registry." : undefined,
  ].filter(Boolean)[0];
  if (missing) lookup.missing = missing;

  return Object.keys(lookup).length > 0 ? lookup : undefined;
}

/**
 * The strip every tool result wears: an icon, the tool's own name, then
 * whatever that tool has to show on the right. Shared so `lookup_spec` and
 * `query_nostr` line up — they sit next to each other in one turn.
 */
function ToolHeading({
  children,
  className,
  icon: Icon,
  name,
}: {
  children?: ReactNode;
  className?: string;
  icon: LucideIcon;
  name: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="size-3" />
        <span className="font-mono">{name}</span>
      </span>
      {children}
    </div>
  );
}

/**
 * What Hex read, as the things grimoire already renders: a NIP badge, a kind
 * badge, a command that opens its manual page. Each is clickable, so the answer
 * is one click from the source it came from — which is the point of a lookup
 * whose whole job was to avoid recall.
 */
function ToolLookup({ lookup, name }: { lookup: Lookup; name: string }) {
  const addWindow = useAddWindow();

  return (
    <ToolHeading
      className="my-2 rounded border border-border"
      icon={BookOpenIcon}
      name={name}
    >
      {lookup.nip && <NIPBadge className="text-xs" nipNumber={lookup.nip} />}
      {lookup.kind !== undefined && (
        <KindBadge
          className="text-xs"
          clickable
          kind={lookup.kind}
          variant="full"
        />
      )}
      {lookup.command && (
        <button
          className="flex items-center gap-1 font-mono text-foreground hover:underline"
          onClick={() =>
            addWindow(
              "man",
              { cmd: lookup.command },
              `man ${lookup.command}`,
              `MAN ${lookup.command?.toUpperCase()}`,
            )
          }
          title={`Open the manual page for ${lookup.command}`}
          type="button"
        >
          {lookup.command}
          <span className="text-muted-foreground">(1)</span>
        </button>
      )}
      {lookup.missing && (
        <span className="italic">{lookup.missing.toLowerCase()}</span>
      )}
    </ToolHeading>
  );
}

/** The REQ a query actually sent, aliases expanded — not what was asked for. */
function reqOf(run: ToolRun): string {
  const output = run.output as
    { filter?: unknown; relays?: unknown } | undefined;
  return JSON.stringify(
    {
      filter: output?.filter ?? run.input,
      ...(output?.relays ? { relays: output.relays } : {}),
    },
    null,
    2,
  );
}

/**
 * Events a tool fetched, in the shape `req` shows them: a status strip over a
 * divided list of rendered events. Rendering from the EventStore means each row
 * is the same component the feed uses, so a note looks like a note here too.
 *
 * The filter is behind a toggle rather than summarised in words: a full NIP-01
 * filter does not fit in a strip, and the JSON is the thing worth reading —
 * it is what the relays saw, `$contacts` already expanded.
 */
function ToolFeed({ ids, run }: { ids: string[]; run: ToolRun }) {
  const [showReq, setShowReq] = useState(false);

  return (
    <div className="my-2 overflow-hidden rounded border border-border">
      <ToolHeading
        className="border-b border-border"
        icon={WrenchIcon}
        name={run.name}
      >
        <button
          className={cn(
            "ml-auto flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground",
            showReq && "bg-muted text-foreground",
          )}
          onClick={() => setShowReq((open) => !open)}
          title={showReq ? "Hide the filter" : "Show the filter"}
          type="button"
        >
          <BracesIcon className="size-3" />
        </button>
        <span className="flex items-center gap-1">
          <FileTextIcon className="size-3" />
          {ids.length}
        </span>
      </ToolHeading>
      {showReq && (
        <div className="border-b border-border bg-muted/10 p-2">
          <ReplyCodeBlock code={reqOf(run)} language="json" />
        </div>
      )}
      {/* Scrolls inside itself: twenty events, each rendered whole and some
          quoting their parent, is longer than the conversation that asked for
          them — the answer was unreachable below it. */}
      <div className="max-h-80 divide-y divide-border/50 overflow-y-auto">
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

        // What Hex read renders as what it read: badges that open the NIP, the
        // kind, or the manual page. The NIP text itself is thousands of words
        // and is already in the answer.
        const lookup = lookupOf(run);
        if (lookup) {
          return (
            <ToolLookup
              key={`${run.name}-${index}`}
              lookup={lookup}
              name={run.name}
            />
          );
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
