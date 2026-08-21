/**
 * The agent sessions a message set running, listed one per row.
 *
 * A session's head names the event that caused the run, so this is the question
 * asked from the other end: what did this message start? That direction is the
 * whole point — an agent does not have to reply, or carry a pointer in its answer,
 * for a reader to find the work. It publishes a transcript that says which
 * message it came from, and the conversation grows a row.
 *
 * **This is the THREAD PANE's view.** In the channel the same fact is folded into
 * one line with the replies (`MessageActivity`), because a run and the replies it
 * produced were two rows answering one question. Here there is room, so every run
 * gets its own row and its own way in — which is what keeps a second session
 * reachable after the channel row started speaking for only one.
 *
 * Live, because a run in progress is exactly when this is worth looking at: the
 * status moves `active` → `awaiting-input` → `idle` off the local mirror, through
 * the same doorbell every other pane uses. There is no subscription here.
 *
 * Renders NOTHING when there are no sessions, which is almost every message in
 * almost every conversation.
 */

import { useAddWindow } from "@/core/state";
import { useAgentActivity } from "@/hooks/useAgentActivity";
import { useSessionsForEvent } from "@/hooks/useSessionsForEvent";
import { UserName } from "@/components/nostr/UserName";
import { StatusDot, statusStyle } from "@/components/agent/status";
import { SessionSpend } from "@/components/agent/SessionSpend";
import type { DecodedHead } from "@/lib/agent-session/types";
import { cn } from "@/lib/utils";

/**
 * One session's row.
 *
 * A component of its own because the live verb is per session: the row watches
 * the delta stream for its own address and says what the agent is doing, falling
 * back to the head's status when nothing has arrived lately. `active` for ninety
 * seconds tells a reader nothing; `running npm test` tells them everything.
 */
function SessionRow({
  head,
  onOpen,
}: {
  head: DecodedHead;
  onOpen: () => void;
}) {
  const activity = useAgentActivity(
    head.session.agent,
    head.session.session,
    head.deltaRelays,
  );
  const style = statusStyle(head.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      // Fixed height, matching the channel's activity row: both grow under a
      // message already on screen, and a row that changes height when a figure or
      // a name arrives shifts the timeline under the reader.
      // No horizontal padding: this is only rendered in the thread pane, under
      // the message it belongs to, and a step to the right of that message's own
      // text read as an indent nothing had asked for.
      className="flex h-5 w-full max-w-full items-center gap-1.5 whitespace-nowrap rounded text-left text-xs hover:bg-muted/50"
      title={head.title}
    >
      <StatusDot status={head.status} live={Boolean(activity)} />
      {/* `UserName` already flags a bot from its kind-0. A second robot beside
          it said the same thing twice, in a row with no space to spare. */}
      <UserName pubkey={head.session.agent} className="shrink-0 text-xs" />
      <span className={cn("truncate", style.text)}>
        {activity?.verb ?? style.label ?? head.status}
      </span>
      <span className="ml-auto pl-2">
        <SessionSpend heads={[head]} />
      </span>
    </button>
  );
}

export function MessageSessions({ messageId }: { messageId: string }) {
  const addWindow = useAddWindow();
  const sessions = useSessionsForEvent(messageId);

  if (sessions.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {sessions.map(({ head }) => (
        <SessionRow
          key={`${head.session.agent}:${head.session.session}`}
          head={head}
          onOpen={() =>
            addWindow("agent", {
              agent: head.session.agent,
              session: head.session.session,
            })
          }
        />
      ))}
    </div>
  );
}
