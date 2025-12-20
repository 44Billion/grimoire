import { useEffect, useCallback } from "react";
import { atom, useAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import {
  GrimoireState,
  AppId,
  WindowInstance,
  LayoutConfig,
  RelayInfo,
} from "@/types/app";
import { useLocale } from "@/hooks/useLocale";
import * as Logic from "./logic";
import * as SpellbookManager from "@/lib/spellbook-manager";
import { CURRENT_VERSION, validateState, migrateState } from "@/lib/migrations";
import { toast } from "sonner";
import { ParsedSpellbook } from "@/types/spell";

// Initial State Definition - Empty canvas on first load
const initialState: GrimoireState = {
  __version: CURRENT_VERSION,
  windows: {},
  activeWorkspaceId: "default",
  layoutConfig: {
    insertionMode: "smart", // Smart auto-balancing by default
    splitPercentage: 50, // Equal split
    insertionPosition: "second", // New windows on right/bottom
    autoPreset: undefined, // No preset maintenance
  },
  compactModeKinds: [6, 7, 16, 9735],
  workspaces: {
    default: {
      id: "default",
      number: 1,
      windowIds: [],
      layout: null,
    },
  },
};

// Custom storage with error handling and migrations
const storage = createJSONStorage<GrimoireState>(() => ({
  getItem: (key: string) => {
    try {
      const value = localStorage.getItem(key);
      if (!value) return null;

      // Parse and validate/migrate state
      const parsed = JSON.parse(value);
      const storedVersion = parsed.__version || 5;

      // Check if migration is needed
      if (storedVersion < CURRENT_VERSION) {
        console.log(
          `[Storage] State version outdated (v${storedVersion}), migrating...`,
        );
        const migrated = migrateState(parsed);

        // Save migrated state back to localStorage
        localStorage.setItem(key, JSON.stringify(migrated));

        toast.success("State Updated", {
          description: `Migrated from v${storedVersion} to v${CURRENT_VERSION}`,
          duration: 3000,
        });

        return JSON.stringify(migrated);
      }

      // Validate current version state
      if (!validateState(parsed)) {
        console.warn(
          "[Storage] State validation failed, resetting to initial state",
        );
        toast.error("State Corrupted", {
          description: "Your state was corrupted and has been reset.",
          duration: 5000,
        });
        return null; // Return null to use initialState
      }

      return value;
    } catch (error) {
      console.error("[Storage] Failed to read from localStorage:", error);
      toast.error("Failed to Load State", {
        description: "Using default state.",
        duration: 5000,
      });
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error("Failed to write to localStorage:", error);
      // Handle quota exceeded or other errors
      if (
        error instanceof DOMException &&
        error.name === "QuotaExceededError"
      ) {
        console.error(
          "localStorage quota exceeded. State will not be persisted.",
        );
        toast.error("Storage Full", {
          description: "Could not save state. Storage quota exceeded.",
          duration: 5000,
        });
      }
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn("Failed to remove from localStorage:", error);
    }
  },
}));

// Persistence Atom with custom storage (The Dashboard)
export const grimoireStateAtom = atomWithStorage<GrimoireState>(
  "grimoire_v6",
  initialState,
  storage,
);

// Temporary Atom for Previews/Sessions (In-memory only)
export const temporaryStateAtom = atom<GrimoireState | null>(null);

// The Hook
export const useGrimoire = () => {
  const [persistentState, setPersistentState] = useAtom(grimoireStateAtom);
  const [tempState, setTempState] = useAtom(temporaryStateAtom);
  
  // Decide which state we are using
  // If tempState is set, we are in a temporary session (Preview or Direct Link)
  const isTemporary = tempState !== null;
  const state = isTemporary ? tempState : persistentState;

  const setState = useCallback((
    updater: (prev: GrimoireState) => GrimoireState
  ) => {
    if (isTemporary) {
      setTempState(prev => {
        const current = prev || persistentState;
        return updater(current);
      });
    } else {
      setPersistentState(updater);
    }
  }, [isTemporary, setTempState, setPersistentState, persistentState]);

  const browserLocale = useLocale();

  // Initialize locale from browser if not set (moved to useEffect to avoid race condition)
  useEffect(() => {
    if (!state.locale) {
      setState((prev: GrimoireState) => ({ ...prev, locale: browserLocale }));
    }
  }, [state.locale, browserLocale, setState]);

  // Wrap all callbacks in useCallback for stable references
  const createWorkspace = useCallback(() => {
    setState((prev: GrimoireState) => {
      const nextNumber = Logic.findLowestAvailableWorkspaceNumber(
        prev.workspaces,
      );
      return Logic.createWorkspace(prev, nextNumber);
    });
  }, [setState]);

  const createWorkspaceWithNumber = useCallback(
    (number: number) => {
      setState((prev: GrimoireState) => {
        // Check if we're leaving an empty workspace and should auto-remove it
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;

        if (shouldDeleteCurrent) {
          // Delete the empty workspace, then create new one
          const afterDelete = Logic.deleteWorkspace(
            prev,
            prev.activeWorkspaceId,
          );
          return Logic.createWorkspace(afterDelete, number);
        }

        // Normal workspace creation
        return Logic.createWorkspace(prev, number);
      });
    },
    [setState],
  );

  const addWindow = useCallback(
    (
      appId: AppId,
      props: any,
      commandString?: string,
      customTitle?: string,
      spellId?: string,
    ) =>
      setState((prev: GrimoireState) =>
        Logic.addWindow(prev, {
          appId,
          props,
          commandString,
          customTitle,
          spellId,
        }),
      ),
    [setState],
  );

  const updateWindow = useCallback(
    (
      windowId: string,
      updates: Partial<
        Pick<
          WindowInstance,
          "props" | "title" | "customTitle" | "commandString" | "appId"
        >
      >,
    ) => setState((prev: GrimoireState) => Logic.updateWindow(prev, windowId, updates)),
    [setState],
  );

  const removeWindow = useCallback(
    (id: string) => setState((prev: GrimoireState) => Logic.removeWindow(prev, id)),
    [setState],
  );

  const moveWindowToWorkspace = useCallback(
    (windowId: string, targetWorkspaceId: string) =>
      setState((prev: GrimoireState) =>
        Logic.moveWindowToWorkspace(prev, windowId, targetWorkspaceId),
      ),
    [setState],
  );

  const updateLayout = useCallback(
    (layout: any) => setState((prev: GrimoireState) => Logic.updateLayout(prev, layout)),
    [setState],
  );

  const setActiveWorkspace = useCallback(
    (id: string) =>
      setState((prev: GrimoireState) => {
        // Validate target workspace exists
        if (!prev.workspaces[id]) {
          console.warn(`Cannot switch to non-existent workspace: ${id}`);
          return prev;
        }

        // If not actually switching, return unchanged
        if (prev.activeWorkspaceId === id) {
          return prev;
        }

        // Check if we're leaving an empty workspace and should auto-remove it
        const currentWorkspace = prev.workspaces[prev.activeWorkspaceId];
        const shouldDeleteCurrent =
          currentWorkspace &&
          currentWorkspace.windowIds.length === 0 &&
          Object.keys(prev.workspaces).length > 1;

        if (shouldDeleteCurrent) {
          // Delete the empty workspace, then switch to target
          const afterDelete = Logic.deleteWorkspace(
            prev,
            prev.activeWorkspaceId,
          );
          return { ...afterDelete, activeWorkspaceId: id };
        }

        // Normal workspace switch
        return { ...prev, activeWorkspaceId: id };
      }),
    [setState],
  );

  const setActiveAccount = useCallback(
    (pubkey: string | undefined) =>
      setState((prev: GrimoireState) => Logic.setActiveAccount(prev, pubkey)),
    [setState],
  );

  const setActiveAccountRelays = useCallback(
    (relays: RelayInfo[]) =>
      setState((prev: GrimoireState) => Logic.setActiveAccountRelays(prev, relays)),
    [setState],
  );

  const updateLayoutConfig = useCallback(
    (layoutConfig: Partial<LayoutConfig>) =>
      setState((prev: GrimoireState) => Logic.updateLayoutConfig(prev, layoutConfig)),
    [setState],
  );

  const applyPresetLayout = useCallback(
    (preset: any) => setState((prev: GrimoireState) => Logic.applyPresetLayout(prev, preset)),
    [setState],
  );

  const updateWorkspaceLabel = useCallback(
    (workspaceId: string, label: string | undefined) =>
      setState((prev: GrimoireState) => Logic.updateWorkspaceLabel(prev, workspaceId, label)),
    [setState],
  );

  const reorderWorkspaces = useCallback(
    (orderedIds: string[]) =>
      setState((prev: GrimoireState) => Logic.reorderWorkspaces(prev, orderedIds)),
    [setState],
  );

  const setCompactModeKinds = useCallback(
    (kinds: number[]) =>
      setState((prev: GrimoireState) => Logic.setCompactModeKinds(prev, kinds)),
    [setState],
  );

  const loadSpellbook = useCallback(
    (spellbook: ParsedSpellbook) =>
      setState((prev: GrimoireState) => SpellbookManager.loadSpellbook(prev, spellbook)),
    [setState],
  );

  const clearActiveSpellbook = useCallback(
    () => setState((prev: GrimoireState) => Logic.clearActiveSpellbook(prev)),
    [setState],
  );

  const switchToTemporary = useCallback((spellbook?: ParsedSpellbook) => {
    setTempState(prev => {
      const current = prev || persistentState;
      return spellbook 
        ? SpellbookManager.loadSpellbook(current, spellbook)
        : { ...current };
    });
  }, [persistentState, setTempState]);

  const applyTemporaryToPersistent = useCallback(() => {
    if (tempState) {
      setPersistentState(tempState);
      setTempState(null);
    }
  }, [tempState, setPersistentState, setTempState]);

  const discardTemporary = useCallback(() => {
    setTempState(null);
  }, [setTempState]);

  return {
    state,
    isTemporary,
    locale: state.locale || browserLocale,
    activeWorkspace: state.workspaces[state.activeWorkspaceId],
    createWorkspace,
    createWorkspaceWithNumber,
    addWindow,
    updateWindow,
    removeWindow,
    moveWindowToWorkspace,
    updateLayout,
    setActiveWorkspace,
    setActiveAccount,
    setActiveAccountRelays,
    updateLayoutConfig,
    applyPresetLayout,
    updateWorkspaceLabel,
    reorderWorkspaces,
    setCompactModeKinds,
    loadSpellbook,
    clearActiveSpellbook,
    switchToTemporary,
    applyTemporaryToPersistent,
    discardTemporary,
  };
};
