/**
 * The intents pending on one session, kept fresh.
 *
 * A thin reactive wrapper over `agent-intents.ts` — the registry is the store,
 * this just re-renders when it rings.
 */

import { useEffect, useState } from "react";

import {
  getIntents,
  subscribeIntents,
  type SessionIntent,
} from "@/services/agent-intents";

export function useSessionIntents(
  agent: string | undefined,
  session: string | undefined,
): SessionIntent[] {
  const [list, setList] = useState<SessionIntent[]>(
    agent && session ? getIntents(agent, session) : [],
  );

  useEffect(() => {
    if (!agent || !session) {
      setList([]);
      return;
    }
    setList(getIntents(agent, session));
    return subscribeIntents(agent, session, () =>
      setList(getIntents(agent, session)),
    );
  }, [agent, session]);

  return list;
}
