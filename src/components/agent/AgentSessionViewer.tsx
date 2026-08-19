import { useEffect, useState } from "react";
import { AlertTriangle, Bot, GitBranch } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import Timestamp from "@/components/Timestamp";
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
  const live = useAgentDeltas(selected?.agent, selected?.session, settled);

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
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border">
          {sessions.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              No agent sessions yet. An agent publishes them to your inbox as
              gift wraps.
            </p>
          ) : (
            sessions.map((head) => {
              const active =
                selected?.agent === head.session.agent &&
                selected?.session === head.session.session;
              return (
                <button
                  key={`${head.session.agent}:${head.session.session}`}
                  type="button"
                  onClick={() =>
                    setSelected({
                      agent: head.session.agent,
                      session: head.session.session,
                    })
                  }
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border p-2 text-left",
                    active && "bg-muted",
                  )}
                >
                  <span className="flex items-center gap-1 truncate text-sm">
                    <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
                    {head.title || "untitled session"}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Label size="sm">{head.status}</Label>
                    <UserName pubkey={head.session.agent} />
                    <Timestamp timestamp={head.created_at} />
                  </span>
                </button>
              );
            })
          )}
        </aside>
      )}

      <section className="flex-1 overflow-y-auto p-3">
        {!view ? (
          <p className="text-sm text-muted-foreground">
            Pick a session to read its transcript.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {view.head && <AgentSessionHeadBody head={view.head} />}

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
                <TranscriptBlockBody block={block} />
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
      </section>
    </div>
  );
}
