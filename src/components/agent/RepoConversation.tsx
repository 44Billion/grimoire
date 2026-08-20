/**
 * A repository, with a conversation ready to start about it.
 *
 * The same shape `Ask Hex` gives an event: the subject rendered above, a box
 * below, and whatever you type going out scoped to it. A repository is not an
 * event, but the question a reader has is identical — "talk to something about
 * THIS" — so the answer looks the same rather than inventing a second idiom.
 *
 * Runs already started on this repository are listed underneath, because the
 * second time you open this page the useful thing is usually the last answer
 * rather than a fresh question.
 */

import { useMemo } from "react";
import { FolderGit2, Globe } from "lucide-react";

import { StatusDot } from "@/components/agent/status";
import { StartConversation } from "@/components/agent/StartConversation";
import { UserName } from "@/components/nostr/UserName";
import Timestamp from "@/components/Timestamp";
import type { MyRepository } from "@/hooks/useMyRepositories";
import type { DecodedHead } from "@/lib/agent-session/types";

export function RepoConversation({
  repository,
  agent,
  agents,
  sessions,
  onAgentChange,
  onSelect,
}: {
  repository: MyRepository;
  agent: string;
  /** Every agent that has published here, for the picker. */
  agents: string[];
  sessions: DecodedHead[];
  onAgentChange: (agent: string) => void;
  onSelect: (next: { agent: string; session: string }) => void;
}) {
  /**
   * Runs that look like they were about this repository.
   *
   * Matched on the title, because the title is the first message and the first
   * message is what carried the repository's name. It is a heuristic and it is
   * labelled as one below — nothing on the wire ties a session to a repository,
   * and inventing a tag for it would be a protocol change to power a list.
   */
  const related = useMemo(() => {
    const needle = repository.name.toLowerCase();
    return sessions
      .filter((head) => head.title.toLowerCase().includes(needle))
      .sort((a, b) => b.started - a.started)
      .slice(0, 8);
  }, [sessions, repository.name]);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      <header className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-base font-medium">
          <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          {repository.name}
        </span>
        {repository.description && (
          <p className="text-sm text-muted-foreground">
            {repository.description}
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
          {repository.clone && <span>{repository.clone}</span>}
          {repository.web && (
            <a
              className="flex items-center gap-1 hover:text-foreground"
              href={repository.web}
              rel="noreferrer"
              target="_blank"
            >
              <Globe className="h-3 w-3" />
              {repository.web}
            </a>
          )}
        </div>
      </header>

      {/* Who to ask, when there is more than one candidate. */}
      {agents.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">ask</span>
          {agents.map((candidate) => (
            <button
              key={candidate}
              type="button"
              onClick={() => onAgentChange(candidate)}
              className={`rounded border px-1.5 py-0.5 ${
                candidate === agent
                  ? "border-border bg-muted"
                  : "border-dotted border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <UserName pubkey={candidate} />
            </button>
          ))}
        </div>
      )}

      {agent ? (
        <StartConversation agent={agent} repository={repository} />
      ) : (
        /*
         * No agent has published a transcript here yet, so there is nobody to
         * offer. Said rather than shown as an empty box: a composer that
         * cannot send anything is worse than a sentence explaining why.
         */
        <p className="rounded border border-dotted border-border p-2 text-xs text-muted-foreground">
          No agent has published anything to you yet, so there is nobody to ask.
          Send one a direct message first — a message that threads onto nothing
          is what opens a session.
        </p>
      )}

      {related.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Runs that mention it
          </h3>
          {related.map((head) => (
            <button
              key={`${head.session.agent}:${head.session.session}`}
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
          ))}
          {/* Said plainly, because a matched-by-name list will sometimes be
              wrong and a reader should know which kind of list this is. */}
          <p className="text-[11px] text-muted-foreground/70">
            matched by name — nothing on the wire ties a session to a repository
          </p>
        </section>
      )}
    </div>
  );
}
