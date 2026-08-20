import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  GitBranch,
  PanelLeftClose,
  Inbox,
  PanelLeftOpen,
  Play,
  Search,
  FolderGit2,
} from "lucide-react";

import { useAccount } from "@/hooks/useAccount";
import { onDmScopes } from "@/services/dm-bus";
import {
  listAgentSessions,
  readAgentSession,
  type AgentSessionView,
} from "@/services/agent-store";
import { TERMINAL_STATUSES, type DecodedHead } from "@/lib/agent-session/types";
import { TranscriptBlockBody } from "@/components/nostr/kinds/AgentTurnRenderer";
import { LiveTurnBody } from "@/components/agent/LiveTurn";
import { useAgentDeltas } from "@/hooks/useAgentDeltas";
import { groupTurns } from "@/components/agent/transcript";
import { AgentSessionHeadBody } from "@/components/nostr/kinds/AgentSessionRenderers";
import { StatusBadge } from "@/components/agent/status";
import { SessionComposer } from "@/components/agent/SessionComposer";
import { SessionSetup } from "@/components/agent/SessionSetup";
import { SessionSubjects } from "@/components/agent/SessionSubjects";
import { SessionTrigger } from "@/components/agent/SessionTrigger";
import { SessionTitle } from "@/components/agent/SessionTitle";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { AgentDashboard } from "@/components/agent/Dashboard";
import { AgentPage } from "@/components/agent/AgentPage";
import { RepoConversation } from "@/components/agent/RepoConversation";
import {
  useMyRepositories,
  type MyRepository,
} from "@/hooks/useMyRepositories";
import { UserName } from "@/components/nostr/UserName";
import { cn } from "@/lib/utils";

/**
 * An agent's transcripts, read out of the local mirror.
 *
 * Everything here is a Dexie read plus the doorbell — the events arrived as
 * gift wraps through the ordinary DM inbox, so this window holds no
 * subscription of its own and works with no relay reachable.
 */

/** What the main pane is showing. */
type Showing =
  | { kind: "dashboard" }
  | { kind: "agent"; agent: string }
  | { kind: "repo"; repository: MyRepository; agent: string }
  | { kind: "session"; agent: string; session: string };

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
  /**
   * What the main pane is showing.
   *
   * Four modes rather than "a session or nothing", because the sidebar offers
   * three kinds of thing to click and each answers a different question. An
   * agent is a subject; a repository is a run you have not started yet; a
   * session is a record. Collapsing them into one selection meant clicking an
   * agent could only ever filter a list.
   */
  const [showing, setShowing] = useState<Showing>(
    agent && session
      ? { kind: "session", agent, session }
      : { kind: "dashboard" },
  );
  /**
   * Memoised, because an effect depends on it.
   *
   * Derived fresh, this is a NEW OBJECT on every render, and the read effect
   * lists it as a dependency — so every render tore down the doorbell
   * subscription and set up another. A ring landing in that gap is a turn, a
   * tool call or a delta the open session never shows, which is exactly the
   * "it stops updating while I watch it" this window was doing.
   */
  const selected = useMemo(
    () =>
      showing.kind === "session"
        ? { agent: showing.agent, session: showing.session }
        : null,
    // The two fields, not the object: a new `showing` with the same session
    // must not count as a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      showing.kind,
      showing.kind === "session" ? showing.agent : null,
      showing.kind === "session" ? showing.session : null,
    ],
  );
  const setSelected = (next: { agent: string; session: string }) =>
    setShowing({ kind: "session", ...next });
  const [view, setView] = useState<AgentSessionView | null>(null);

  /** Everyone who has published a transcript here, busiest first. */
  const knownAgents = useMemo(() => {
    const seen = new Map<string, number>();
    for (const head of sessions)
      seen.set(head.session.agent, (seen.get(head.session.agent) ?? 0) + 1);
    return [...seen.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([agent]) => agent);
  }, [sessions]);

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
    /*
     * Clear first. `view` outlives the selection, so until the read lands the
     * pane rendered the previous run's turns, head and stats under the newly
     * chosen session's heading — one session wearing another's name.
     */
    setView(null);
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
          showing={showing}
          onShow={setShowing}
        />
      )}

      {/*
        The transcript scrolls; the composer does not.
        Every other conversation in this app puts its input at the bottom, and a
        session is a conversation — one you can still change the course of.
      */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* `h-8` and a bottom border, level with the sidebar's search row —
            the same heading chat uses, for the same reason: the two panes are
            read as one surface and a title that floats inside the scroll area
            disappears the moment anyone scrolls. */}
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">
            {showing.kind === "dashboard" ? (
              "Agents"
            ) : showing.kind === "agent" ? (
              "Agent"
            ) : showing.kind === "repo" ? (
              showing.repository.name
            ) : (
              <SessionTitle title={view?.head?.title} />
            )}
          </span>
          {/*
            The status, and only the status.
            A turn count and the protocol are both already in the session's own
            header a line below — repeated up here they were the same fact
            twice, and the heading is for saying WHICH session this is.
          */}
          {showing.kind === "session" && view?.head && (
            <StatusBadge status={view.head.status} />
          )}
        </div>

        {showing.kind === "dashboard" ? (
          /* Nothing picked is not nothing to say — see AgentDashboard. */
          <AgentDashboard
            sessions={sessions}
            onSelect={setSelected}
            onOpenAgent={(agent) => setShowing({ kind: "agent", agent })}
          />
        ) : showing.kind === "agent" ? (
          <AgentPage
            agent={showing.agent}
            sessions={sessions}
            onSelect={setSelected}
          />
        ) : showing.kind === "repo" ? (
          <RepoConversation
            repository={showing.repository}
            agent={showing.agent}
            agents={knownAgents}
            sessions={sessions}
            onAgentChange={(next) => setShowing({ ...showing, agent: next })}
            onSelect={setSelected}
          />
        ) : !view ? (
          <p className="p-3 text-sm text-muted-foreground">Reading…</p>
        ) : (
          /*
           * The `ai` window's conversation, around a transcript instead of a
           * live chat.
           *
           * They are one object seen from two ends — a run being written and a
           * run being read — so the reading end should not scroll differently,
           * space its turns differently, or follow a stream differently from
           * the writing end. `Conversation` is StickToBottom: a delta arriving
           * mid-read keeps the newest turn in view, which a plain
           * `overflow-y-auto` never did.
           */
          <Conversation className="min-h-0 flex-1" initial="smooth">
            <ConversationContent className="flex flex-col gap-3 p-3">
              {view.head && (
                <>
                  <AgentSessionHeadBody
                    head={view.head}
                    definition={view.definition ?? undefined}
                    titled={false}
                  />
                  {view.definition && (
                    <SessionSetup definition={view.definition} />
                  )}
                  {/* What it IS, what it was pointed at, and who set it off. */}
                  <SessionSubjects subjects={view.head.subjects} />
                  <SessionTrigger trigger={view.head.trigger} />
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
                      forked at seq {view.forks.join(", ")} — two chains claim
                      the same history
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

              {groupTurns(view.turns, view.head?.operator.pubkey).map(
                (block) => (
                  /*
                   * A rule under the agent's side and none under yours, exactly as
                   * the `ai` window closes an exchange: a question and the answer
                   * to it are one thing, and ruling between them cuts the pair in
                   * half.
                   */
                  <article
                    key={block.turns[0]!.id}
                    className={cn(
                      "pb-2",
                      block.side !== "user" && "border-b border-border/50",
                      "last:border-0",
                    )}
                  >
                    <TranscriptBlockBody
                      block={block}
                      pending={view.head?.pending}
                    />
                  </article>
                ),
              )}

              {/* The turn being written, if one is. Ephemeral: nothing here is
                stored, and it vanishes when the stored turn arrives. */}
              {selected && <LiveTurnBody live={live} agent={selected.agent} />}

              {view.turns.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This session's head is here, but none of its turns are.
                </p>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}

        {/*
          Only over an open session.
          `view` outlives the selection — it holds whatever was read last — so
          the composer followed the reader onto the dashboard, an agent's page
          and a repository, offering to "say something to this session" on three
          screens where there is no session to say it to.
        */}
        {showing.kind === "session" && view?.head && (
          <SessionComposer
            /*
             * From the SELECTION, not from `view`.
             *
             * `view` holds whatever was read last and is asynchronous, so
             * between picking a session and its read landing, the composer was
             * addressing the PREVIOUS run — a steer typed into one transcript
             * went to another, and the only sign was that nothing happened in
             * the one you were looking at.
             */
            agent={showing.agent}
            session={showing.session}
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
/**
 * Who you have transcripts from, and then what they did.
 *
 * Three sections, answering three questions. Who has published here — pick one
 * to narrow the list. What of YOURS something could work on — your own kind-30617
 * repositories, which start a run rather than filter one. And below, every
 * session grouped by
 * STATUS and nothing else: a reader scanning this list is looking for what is
 * happening now, and a second level of nesting by agent buried the one running
 * session under a heading per agent. The agent's name rides on the session row
 * instead, where it costs a line nobody has to expand.
 */
function SessionList({
  sessions,
  selected,
  showing,
  onShow,
}: {
  sessions: DecodedHead[];
  selected: { agent: string; session: string } | null;
  showing: Showing;
  onShow: (next: Showing) => void;
}) {
  const onSelect = (next: { agent: string; session: string }) =>
    onShow({ kind: "session", ...next });
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const { repositories } = useMyRepositories();

  /** Runs stopped on a person — the number the Inbox row exists to show. */
  const blocked = sessions.filter((head) =>
    ["awaiting-input", "payment-required"].includes(head.status),
  ).length;
  /**
   * Which agent the list is narrowed to.
   *
   * Derived from what the main pane is showing rather than held separately: an
   * agent's page and a list narrowed to that agent are the same intent, and two
   * pieces of state for it means clicking an agent can leave the list showing
   * somebody else's runs.
   */
  const only =
    showing.kind === "agent"
      ? showing.agent
      : showing.kind === "repo"
        ? null
        : null;

  /** Every agent that has published something here, with what it is doing. */
  const agents = useMemo(() => {
    const seen = new Map<string, { total: number; live: number }>();
    for (const head of sessions) {
      const at = seen.get(head.session.agent) ?? { total: 0, live: 0 };
      at.total += 1;
      if (!(TERMINAL_STATUSES as readonly string[]).includes(head.status))
        at.live += 1;
      seen.set(head.session.agent, at);
    }
    // Busiest first: an agent with a run in flight is the one being watched.
    return [...seen.entries()].sort(
      ([, a], [, b]) => b.live - a.live || b.total - a.total,
    );
  }, [sessions]);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sessions.filter((head) => {
      if (only && head.session.agent !== only) return false;
      if (!needle) return true;
      return (
        head.title.toLowerCase().includes(needle) ||
        head.session.session.toLowerCase().includes(needle)
      );
    });
  }, [sessions, query, only]);

  const groups = useMemo(() => {
    const byStatus = new Map<string, DecodedHead[]>();
    for (const head of matching)
      byStatus.set(head.status, [...(byStatus.get(head.status) ?? []), head]);
    // Newest first inside a status: a list of runs is read from the top.
    for (const heads of byStatus.values())
      heads.sort((a, b) => b.started - a.started);
    return [...byStatus.entries()].sort(
      ([a], [b]) => statusRank(a) - statusRank(b),
    );
  }, [matching]);

  if (!open)
    return (
      <aside className="shrink-0 border-r border-border">
        {/* `h-8`, so it sits level with the transcript's heading beside it. */}
        <div className="flex h-8 items-center px-1">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded p-1 text-muted-foreground hover:bg-muted/50"
            title="Show sessions"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      {/* The same shape chat uses: one `h-8` row, search filling it, the pane
          toggle at the end. */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border pl-2 pr-1">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sessions"
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
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
        {/*
          Not gated on having sessions. Everything below used to sit behind
          "no sessions yet", which hid the repositories a reader would start
          their FIRST run from — the one thing that produces a session.
        */}
        {
          <>
            {/*
              First, and clickable, because it is the only row here that is a
              QUESTION rather than a thing: everything else is something you
              have, and this is what is waiting on you. Zero is worth showing —
              "nothing is waiting" is the answer people open this to get.
            */}
            <button
              type="button"
              onClick={() => onShow({ kind: "dashboard" })}
              className={cn(
                "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-muted/50",
                showing.kind === "dashboard" && "bg-muted",
              )}
            >
              <Inbox className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="font-medium">Inbox</span>
              <span
                className={cn(
                  "ml-auto shrink-0 text-[11px]",
                  blocked > 0 ? "text-warning" : "text-muted-foreground",
                )}
              >
                {blocked}
              </span>
            </button>

            {agents.length > 0 && <SectionLabel>Agents</SectionLabel>}
            {agents.map(([agentKey, counts]) => (
              <button
                key={agentKey}
                type="button"
                onClick={() =>
                  onShow(
                    only === agentKey
                      ? { kind: "dashboard" }
                      : { kind: "agent", agent: agentKey },
                  )
                }
                className={cn(
                  "flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs hover:bg-muted/50",
                  only === agentKey && "bg-muted",
                )}
                title={
                  only === agentKey ? "Back to every agent" : "Open this agent"
                }
              >
                <Bot className="h-3 w-3 shrink-0 text-muted-foreground" />
                <UserName pubkey={agentKey} className="truncate" />
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {/* Live first, because that is the number worth glancing at. */}
                  {counts.live > 0
                    ? `${counts.live}/${counts.total}`
                    : counts.total}
                </span>
              </button>
            ))}

            {/*
              Shown whenever there ARE repositories, agents or not. Gating this
              on a published transcript was a bootstrap trap: a fresh reader has
              no sessions, so no known agents, so no way to start the first run
              that would produce one. The page below says who to ask.
            */}
            {repositories.length > 0 && (
              <>
                <SectionLabel>Repositories</SectionLabel>
                {repositories.map((repository) => (
                  <button
                    key={repository.address}
                    type="button"
                    onClick={() =>
                      // Whichever agent is in view, or the busiest one. The
                      // page offers a picker, so this only decides what it
                      // opens with.
                      onShow({
                        kind: "repo",
                        repository,
                        agent: only ?? agents[0]?.[0] ?? "",
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-xs hover:bg-muted/50",
                      showing.kind === "repo" &&
                        showing.repository.address === repository.address &&
                        "bg-muted",
                    )}
                    title={`Talk to an agent about ${repository.name}`}
                  >
                    <FolderGit2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{repository.name}</span>
                    <Play className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </>
            )}

            {sessions.length > 0 && (
              <SectionLabel>
                Sessions
                {only && (
                  <button
                    type="button"
                    onClick={() => onShow({ kind: "dashboard" })}
                    className="ml-1 underline decoration-dotted hover:text-foreground"
                  >
                    clear filter
                  </button>
                )}
              </SectionLabel>
            )}

            {sessions.length === 0 ? null : groups.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                Nothing matches.
              </p>
            ) : (
              groups.map(([status, heads]) => {
                const shut = collapsed[status];
                return (
                  <div key={status}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed((was) => ({
                          ...was,
                          [status]: !was[status],
                        }))
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
                        {heads.length}
                      </span>
                    </button>

                    {!shut &&
                      heads.map((head) => {
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
                              "flex w-full items-center gap-1.5 py-0.5 pr-2 pl-5 text-left text-xs hover:bg-muted/50",
                              active && "bg-muted",
                            )}
                            title={sessionLabel(head)}
                          >
                            <span className="truncate">
                              {sessionLabel(head)}
                            </span>
                            {/* Whose run it is, on the row rather than in a
                                heading above it — dropped when the list is
                                already narrowed to one agent. */}
                            {!only && (
                              <UserName
                                pubkey={head.session.agent}
                                className="ml-auto max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground"
                              />
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
            {sessions.length === 0 && repositories.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                No agent sessions yet. An agent publishes them to your inbox as
                gift wraps.
              </p>
            )}
          </>
        }
      </div>
    </aside>
  );
}

/**
 * What to call a session in a list.
 *
 * An agent that titles its run after its own runtime id — `wrun_01M0D…` — has
 * said nothing a reader can use, and a column of those is a column of noise.
 * But it is not nothing: it is still the one thing that tells two rows apart,
 * so it is SHORTENED rather than thrown away. Replacing it with "untitled"
 * made every row identical, which is strictly worse than an ugly id.
 */
function sessionLabel(head: DecodedHead): string {
  const title = head.title.trim();
  if (!title) return "untitled session";
  const machine = /^(wrun_|ses_|sess_|run_)?[0-9A-Za-z]{16,}$/.test(title);
  return machine ? `${title.slice(0, 12)}…` : title;
}

/** A heading between the sidebar's two halves. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 bg-background px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}
