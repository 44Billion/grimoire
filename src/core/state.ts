import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { GrimoireState, AppId } from "@/types/app";
import * as Logic from "./logic";

// Initial State Definition
const initialState: GrimoireState = {
  windows: {
    "win-1": {
      id: "win-1",
      appId: "win",
      title: "WIN - Window Tree",
      props: {},
    },
    "feed-1": {
      id: "feed-1",
      appId: "feed",
      title: "FEED - Nostr Feed",
      props: {},
    },
    "nip-1": {
      id: "nip-1",
      appId: "nip",
      title: "NIP-01 - Basic protocol",
      props: { number: "01" },
    },
    "kind-1": {
      id: "kind-1",
      appId: "kind",
      title: "KIND-1 - Short Text Note",
      props: { number: "1" },
    },
    "man-1": {
      id: "man-1",
      appId: "man",
      title: "MAN - Help",
      props: { cmd: "help" },
    },
  },
  activeWorkspaceId: "default",
  workspaces: {
    default: {
      id: "default",
      label: "1",
      windowIds: ["win-1", "feed-1", "nip-1", "kind-1", "man-1"],
      layout: {
        direction: "row",
        first: {
          direction: "column",
          first: "win-1",
          second: "feed-1",
          splitPercentage: 50,
        },
        second: {
          direction: "column",
          first: {
            direction: "row",
            first: "nip-1",
            second: "kind-1",
            splitPercentage: 50,
          },
          second: "man-1",
          splitPercentage: 50,
        },
        splitPercentage: 50,
      },
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
