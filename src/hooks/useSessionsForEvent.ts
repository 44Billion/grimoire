/**
 * The agent sessions one message set running, live.
 *
 * Its own hook because two places ask the same question now: the strip under a
 * message in the channel, and the thread pane, which lists the runs above the
 * replies. Both read the local mirror and repaint on the same doorbell; neither
 * opens a subscription.
 */

import { useEffect, useState } from "react";

import { useAccount } from "@/hooks/useAccount";
import { listSessionsForEvent, onAgentEvents } from "@/services/agent-store";
import type { SessionForEvent } from "@/services/agent-store";

export function useSessionsForEvent(messageId: string): SessionForEvent[] {
  const { pubkey } = useAccount();
  const [sessions, setSessions] = useState<SessionForEvent[]>([]);

  useEffect(() => {
    if (!pubkey || !messageId) return;
    let live = true;
    const read = async () => {
      const next = await listSessionsForEvent(pubkey, messageId);
      if (live) setSessions(next);
    };
    void read();
    // A rumor is written to Dexie before the doorbell rings, so re-reading on any
    // ring is enough: a missed ring costs a stale row, never a lost session.
    const off = onAgentEvents(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [pubkey, messageId]);

  return sessions;
}
