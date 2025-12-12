import { useEffect } from "react";
import { useAtom } from "jotai";
import { grimoireStateAtom } from "@/core/state";
import relayStateManager from "@/services/relay-state-manager";
import type { AuthPreference, RelayState } from "@/types/relay-state";

/**
 * Hook for accessing and managing global relay state
 */
export function useRelayState() {
  const [state, setState] = useAtom(grimoireStateAtom);

  // Subscribe to relay state manager updates
  useEffect(() => {
    const unsubscribe = relayStateManager.subscribe((relayState) => {
      setState((prev) => ({
        ...prev,
        relayState,
      }));
    });

    // Initialize state if not set
    if (!state.relayState) {
      setState((prev) => ({
        ...prev,
        relayState: relayStateManager.getState(),
      }));
    }

    return unsubscribe;
  }, [setState, state.relayState]);

  const relayState = state.relayState;

  return {
    // Current state
    relayState,
    relays: relayState?.relays || {},
    pendingChallenges: relayState?.pendingChallenges || [],
    authPreferences: relayState?.authPreferences || {},

    // Get single relay state
    getRelay: (url: string): RelayState | undefined => {
      return relayState?.relays[url];
    },

    // Get auth preference
    getAuthPreference: async (
      url: string,
    ): Promise<AuthPreference | undefined> => {
      return await relayStateManager.getAuthPreference(url);
    },

    // Set auth preference
    setAuthPreference: async (url: string, preference: AuthPreference) => {
      await relayStateManager.setAuthPreference(url, preference);
    },

    // Authenticate with relay
    authenticateRelay: async (url: string) => {
      await relayStateManager.authenticateRelay(url);
    },

    // Reject auth for relay
    rejectAuth: (url: string, rememberForSession = true) => {
      relayStateManager.rejectAuth(url, rememberForSession);
    },

    // Ensure relay is monitored
    ensureRelayMonitored: (url: string) => {
      relayStateManager.ensureRelayMonitored(url);
    },
  };
}
