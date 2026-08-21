/**
 * The intents pending on one session, kept fresh.
 *
 * A thin reactive wrapper over `agent-intents.ts` — the registry is the store,
 * this just re-renders when it rings.
 */

import { useCallback, useSyncExternalStore } from "react";

import {
  getIntents,
  NO_INTENTS,
  subscribeIntents,
  type SessionIntent,
} from "@/services/agent-intents";

export function useSessionIntents(
  agent: string | undefined,
  session: string | undefined,
): readonly SessionIntent[] {
  const subscribe = useCallback(
    (onChange: () => void) =>
      agent && session ? subscribeIntents(agent, session, onChange) : () => {},
    [agent, session],
  );

  const snapshot = useCallback(
    () => (agent && session ? getIntents(agent, session) : NO_INTENTS),
    [agent, session],
  );

  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
