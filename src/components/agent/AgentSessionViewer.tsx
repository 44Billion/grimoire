import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { onDmScopes } from "@/services/dm-bus";
import {
  listAgentSessions,
  readAgentSession,
  type AgentSessionView,
} from "@/services/agent-store";
import type { DecodedHead } from "@/lib/agent-session/types";
import { TranscriptBlockBody } from "@/components/nostr/kinds/AgentTurnRenderer";
import { LiveTurnBody } from "@/components/agent/LiveTurn";
import { useAgentDeltas } from "@/hooks/useAgentDeltas";
import { groupTurns } from "@/components/agent/transcript";
import { AgentSessionHeadBody } from "@/components/nostr/kinds/AgentSessionRenderers";
import { StatusBadge } from "@/components/agent/status";
import { SessionComposer } from "@/components/agent/SessionComposer";
import { SessionSetup } from "@/components/agent/SessionSetup";
import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";

/**
 * An agent's transcripts, read out of the local mirror.
 *
 * Everything here is a Dexie read plus the doorbell — the events arrived as
 * gift wraps through the ordinary DM inbox, so this window holds no
 * subscription of its own and works with no relay reachable.
 */

interface AgentSessionViewerProps {
  agent?: string;
  session?: string;
}

export function AgentSessionViewer({
  agent,
  session,
}: AgentSessionViewerProps) {
  const { pubkey } = useAccount();
  const viewer = pubkey ?? "";

  // Nothing here subscribes: the events arrived as gift wraps through the app's
  // one ingester (`useDmIngest`, held by the shell), so this window works with no
  // relay reachable and never has to keep a wire up itself.

  const [sessions, setSessions] = useState<DecodedHead[]>([]);
  const [selected, setSelected] = useState<{
    agent: string;
    session: string;
  } | null>(agent && session ? { agent, session } : null);
  const [view, setView] = useState<AgentSessionView | null>(null);

  /**
   * Live progress for the open session.
   *
   * `settled` is the highest turn already on disk, so the preview clears itself
   * the moment the real turn lands rather than showing the same words twice.
   */
  const settled = view?.turns.length
    ? (view.turns[view.turns.length - 1]?.turn ?? 0)
    : 0;
  const live = useAgentDeltas(
    selected?.agent,
    selected?.session,
    settled,
    view?.head?.deltaRelays,
  );

  // Both effects only subscribe and read; every setState lands in an async
  // callback, because the doorbell is the external system here and a render is
  // never the thing that fetches.
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    const read = async () => {
      const next = await listAgentSessions(viewer);
      if (live) setSessions(next);
    };
    void read();
    // A rumor is written to Dexie first and the doorbell rung second, so a
    // re-read on any ring is enough: a missed ring costs a stale render, never
    // a lost turn.
    const off = onDmScopes(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer || !selected) return;
    let live = true;
    const read = async () => {
      const next = await readAgentSession(
        viewer,
        selected.agent,
        selected.session,
      );
      if (live) setView(next);
    };
    void read();
    const off = onDmScopes(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [viewer, selected]);

  if (!viewer)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Sign in to read the transcripts addressed to you.
      </div>
    );

  /**
   * Named a session, so show that session.
   *
   * A window opened from a message is a window about ONE run — the reader clicked
   * a specific session and a list of every other one is in the way. Opened with no
   * session, the list is the whole point.
   */
  const single = Boolean(agent && session);

  return (
    <div className="flex h-full">
      {!single && (
        <SessionList
          sessions={sessions}
          selected={selected}
          onSelect={setSelected}
        />
      )}

      {/*
        The transcript scrolls; the composer does not.
        Every other conversation in this app puts its input at the bottom, and a
        session is a conversation — one you can still change the course of.
      */}
      <section className="flex min-w-0 flex-1 flex-col">
        {!view ? (
          <p className="p-3 text-sm text-muted-foreground">
            Pick a session to read its transcript.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {view.head && (
              <>
                <AgentSessionHeadBody head={view.head} />
                {view.definition && (
                  <SessionSetup definition={view.definition} />
                )}
              </>
            )}

            {(view.gaps.length > 0 ||
              view.forks.length > 0 ||
              view.duplicates.length > 0) && (
              <div className="flex flex-col gap-1 rounded border border-dotted border-border p-2 text-xs">
                {view.gaps.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    missing {view.gaps.length} event
                    {view.gaps.length === 1 ? "" : "s"} (seq{" "}
                    {view.gaps.slice(0, 12).join(", ")}
                    {view.gaps.length > 12 ? "…" : ""})
                  </span>
                )}
                {view.forks.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <GitBranch className="h-3 w-3" />
                    forked at seq {view.forks.join(", ")} — two chains claim the
                    same history
                  </span>
                )}
                {view.duplicates.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <AlertTriangle className="h-3 w-3" />
                    seq {view.duplicates.join(", ")} arrived twice
                  </span>
                )}
              </div>
            )}

            {groupTurns(view.turns, view.head?.operator.pubkey).map((block) => (
              <article key={block.turns[0]!.id} className="pb-1">
                <TranscriptBlockBody
                  block={block}
                  pending={view.head?.pending}
                />
              </article>
            ))}

            {/* The turn being written, if one is. Ephemeral: nothing here is
                stored, and it vanishes when the stored turn arrives. */}
            {selected && <LiveTurnBody live={live} agent={selected.agent} />}

            {view.turns.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This session's head is here, but none of its turns are.
              </p>
            )}
          </div>
        )}

        {view?.head && (
          <SessionComposer
            agent={view.head.session.agent}
            session={view.head.session.session}
            status={view.head.status}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The order statuses are read in.
 *
 * What is happening first, what wants something from the reader next, then the
 * long tail of finished work. A list sorted by time buries a live run under
 * yesterday's, which is exactly backwards for the one thing a reader opens this
 * window to watch.
 */
const STATUS_ORDER = [
  "active",
  "awaiting-input",
  "payment-required",
  "idle",
  "error",
  "aborted",
  "done",
];

function statusRank(status: string): number {
  const at = STATUS_ORDER.indexOf(status);
  return at === -1 ? STATUS_ORDER.length : at;
}

/**
 * Every session, by status and then by agent.
 *
 * Two levels, because both questions get asked: "is anything running" is about
 * status, and "what has Hex been doing" is about the agent. Grouping by status
 * first answers the one that changes.
 *
 * A row is ONE line. A session's title is the useful half and everything else —
 * the agent, the time — is what the group heading and the open transcript
 * already say.
 */
function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: DecodedHead[];
  selected: { agent: string; session: string } | null;
  onSelect: (next: { agent: string; session: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const byStatus = new Map<string, Map<string, DecodedHead[]>>();
    for (const head of sessions) {
      const byAgent = byStatus.get(head.status) ?? new Map();
      byStatus.set(head.status, byAgent);
      byAgent.set(head.session.agent, [
        ...(byAgent.get(head.session.agent) ?? []),
        head,
      ]);
    }
    return [...byStatus.entries()].sort(
      ([a], [b]) => statusRank(a) - statusRank(b),
    );
  }, [sessions]);

  if (!open)
    return (
      <aside className="shrink-0 border-r border-border p-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-muted/50"
          title="Show sessions"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </aside>
    );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-xs text-muted-foreground">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted/50"
          title="Hide sessions"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No agent sessions yet. An agent publishes them to your inbox as gift
            wraps.
          </p>
        ) : (
          groups.map(([status, byAgent]) => {
            const shut = collapsed[status];
            const count = [...byAgent.values()].reduce(
              (total, heads) => total + heads.length,
              0,
            );
            return (
              <div key={status}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((was) => ({ ...was, [status]: !was[status] }))
                  }
                  className="flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-muted/50"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                      !shut && "rotate-90",
                    )}
                  />
                  <StatusBadge status={status} />
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {count}
                  </span>
                </button>

                {!shut &&
                  [...byAgent.entries()].map(([agentKey, heads]) => (
                    <div key={agentKey}>
                      <span className="flex items-center gap-1 py-0.5 pr-2 pl-5 text-[11px] text-muted-foreground">
                        <Bot className="h-3 w-3 shrink-0" />
                        <UserName pubkey={agentKey} className="truncate" />
                      </span>
                      {heads.map((head) => {
                        const active =
                          selected?.agent === head.session.agent &&
                          selected?.session === head.session.session;
                        return (
                          <button
                            key={`${head.session.agent}:${head.session.session}`}
                            type="button"
                            onClick={() =>
                              onSelect({
                                agent: head.session.agent,
                                session: head.session.session,
                              })
                            }
                            className={cn(
                              "flex w-full items-center gap-1 py-0.5 pr-2 pl-8 text-left text-xs hover:bg-muted/50",
                              active && "bg-muted",
                            )}
                            title={head.title || head.session.session}
                          >
                            <span className="truncate">
                              {head.title || "untitled session"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
