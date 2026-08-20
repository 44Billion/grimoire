/**
 * One agent, as a subject rather than as a filter.
 *
 * Clicking an agent used to narrow a list, which answers "which of its runs" and
 * never "what is this thing". This answers the second: who it is, what it was
 * set up with, what it has been doing and what that has cost — and a box to
 * start something new, because the most likely reason to open an agent's page is
 * to give it work.
 */

import { useMemo } from "react";
import { Bot } from "lucide-react";

import { StatusDot } from "@/components/agent/status";
import { SessionSetup } from "@/components/agent/SessionSetup";
import { StartConversation } from "@/components/agent/StartConversation";
import { StatStrip, summariseHeads } from "@/components/agent/Stats";
import { UserName } from "@/components/nostr/UserName";
import Timestamp from "@/components/Timestamp";
import type { DecodedDefinition, DecodedHead } from "@/lib/agent-session/types";

export function AgentPage({
  agent,
  sessions,
  definition,
  onSelect,
}: {
  agent: string;
  /** Every session, unfiltered — this narrows them itself. */
  sessions: DecodedHead[];
  /** The agent's standing definition, when one has been published. */
  definition?: DecodedDefinition;
  onSelect: (next: { agent: string; session: string }) => void;
}) {
  const mine = useMemo(
    () =>
      sessions
        .filter((head) => head.session.agent === agent)
        .sort((a, b) => b.started - a.started),
    [sessions, agent],
  );

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 text-base font-medium">
          <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
          <UserName pubkey={agent} />
        </span>
      </header>

      {/* The same four numbers as the dashboard and a session header, scoped to
          this agent — one component, so the three cannot drift. */}
      <StatStrip
        countLabel="runs"
        stats={{ ...summariseHeads(mine), count: mine.length }}
      />

      {definition?.about && (
        <p className="text-sm text-muted-foreground">{definition.about}</p>
      )}

      {/* Start something, because that is the likeliest reason to be here. */}
      <StartConversation agent={agent} />

      {definition && <SessionSetup definition={definition} />}

      <section className="flex flex-col gap-1">
        <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Sessions
        </h3>
        {mine.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing yet. Ask it something above.
          </p>
        ) : (
          mine.map((head) => (
            <button
              key={head.session.session}
              type="button"
              onClick={() =>
                onSelect({
                  agent: head.session.agent,
                  session: head.session.session,
                })
              }
              className="flex items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-muted/50"
            >
              <StatusDot status={head.status} live={head.status === "active"} />
              <span className="truncate">
                {head.title || "untitled session"}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                <Timestamp timestamp={head.started} />
              </span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}
