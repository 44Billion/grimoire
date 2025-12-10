import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { GrimoireState, AppId } from "@/types/app";
import * as Logic from "./logic";

// Initial State Definition - Empty canvas on first load
const initialState: GrimoireState = {
  windows: {},
  activeWorkspaceId: "default",
  workspaces: {
    default: {
      id: "default",
      label: "1",
      windowIds: [],
      layout: null,
    },
  },
};

// Persistence Atom
export const grimoireStateAtom = atomWithStorage<GrimoireState>(
  "grimoire_v6",
  initialState,
);

// The Hook
export const useGrimoire = () => {
  const [state, setState] = useAtom(grimoireStateAtom);

  return {
    state,
    activeWorkspace: state.workspaces[state.activeWorkspaceId],
    createWorkspace: () => {
      const count = Object.keys(state.workspaces).length + 1;
      setState((prev) => Logic.createWorkspace(prev, count.toString()));
    },
    addWindow: (appId: AppId, props: any, title?: string) =>
      setState((prev) =>
        Logic.addWindow(prev, {
          appId,
          props,
          title: title || appId.toUpperCase(),
        }),
      ),
    removeWindow: (id: string) =>
      setState((prev) => Logic.removeWindow(prev, id)),
    moveWindowToWorkspace: (windowId: string, targetWorkspaceId: string) =>
      setState((prev) =>
        Logic.moveWindowToWorkspace(prev, windowId, targetWorkspaceId),
      ),
    updateLayout: (layout: any) =>
      setState((prev) => Logic.updateLayout(prev, layout)),
    setActiveWorkspace: (id: string) =>
      setState((prev) => ({ ...prev, activeWorkspaceId: id })),
    setActiveAccount: (pubkey: string | undefined) =>
      setState((prev) => Logic.setActiveAccount(prev, pubkey)),
    setActiveAccountRelays: (relays: any) =>
      setState((prev) => Logic.setActiveAccountRelays(prev, relays)),
  };
};
