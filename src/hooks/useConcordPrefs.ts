/**
 * The sidebar arrangement this device remembers, live.
 *
 * A thin binding over `concord-prefs`: the snapshot comes through `use$` so
 * every mounted sidebar repaints when any of them changes a pin or folds a
 * category, and the predicates close over THAT snapshot rather than reading the
 * manager, so a render only ever sees the value it subscribed to.
 */

import { useCallback, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";

import {
  concordPrefsManager,
  isCategoryCollapsed,
  isChannelMuted,
  isChannelPinned,
  isMutedFor,
  isPinnedFor,
  type ChatPrefs,
} from "@/services/concord-prefs";
import type { ChatProtocol } from "@/types/chat";

/** One row, in whichever family it belongs to. */
export type RowRef = [
  protocol: ChatProtocol,
  containerId: string,
  channelId: string,
];

export interface ConcordPrefs {
  prefs: ChatPrefs;
  isPinned: (communityIdHex: string, channelIdHex: string) => boolean;
  togglePin: (communityIdHex: string, channelIdHex: string) => void;
  isMuted: (communityIdHex: string, channelIdHex: string) => boolean;
  toggleMute: (communityIdHex: string, channelIdHex: string) => void;
  /** The same two, for a private conversation or a relay group. */
  isRowPinned: (row: RowRef) => boolean;
  toggleRowPin: (row: RowRef) => void;
  isRowMuted: (row: RowRef) => boolean;
  toggleRowMute: (row: RowRef) => void;
  isCollapsed: (communityIdHex: string, categoryKey: string) => boolean;
  toggleCollapsed: (communityIdHex: string, categoryKey: string) => void;
}

export function useConcordPrefs(): ConcordPrefs {
  // The stream is a BehaviorSubject's, so `use$` has the current value on the
  // first render; the fallback is a type guard rather than a state anyone sees.
  const prefs = use$(concordPrefsManager.stream$) ?? concordPrefsManager.value;

  const isPinned = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      isChannelPinned(prefs, communityIdHex, channelIdHex),
    [prefs],
  );
  const isCollapsed = useCallback(
    (communityIdHex: string, categoryKey: string) =>
      isCategoryCollapsed(prefs, communityIdHex, categoryKey),
    [prefs],
  );
  const isMuted = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      isChannelMuted(prefs, communityIdHex, channelIdHex),
    [prefs],
  );
  const isRowPinned = useCallback(
    ([protocol, containerId, channelId]: RowRef) =>
      isPinnedFor(prefs, protocol, containerId, channelId),
    [prefs],
  );
  const isRowMuted = useCallback(
    ([protocol, containerId, channelId]: RowRef) =>
      isMutedFor(prefs, protocol, containerId, channelId),
    [prefs],
  );

  const togglePin = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      concordPrefsManager.togglePin(communityIdHex, channelIdHex),
    [],
  );
  const toggleMute = useCallback(
    (communityIdHex: string, channelIdHex: string) =>
      concordPrefsManager.toggleMute(communityIdHex, channelIdHex),
    [],
  );
  const toggleRowPin = useCallback(
    ([protocol, containerId, channelId]: RowRef) =>
      concordPrefsManager.togglePinFor(protocol, containerId, channelId),
    [],
  );
  const toggleRowMute = useCallback(
    ([protocol, containerId, channelId]: RowRef) =>
      concordPrefsManager.toggleMuteFor(protocol, containerId, channelId),
    [],
  );
  const toggleCollapsed = useCallback(
    (communityIdHex: string, categoryKey: string) =>
      concordPrefsManager.toggleCategoryCollapsed(communityIdHex, categoryKey),
    [],
  );
  return useMemo(
    () => ({
      prefs,
      isPinned,
      togglePin,
      isMuted,
      toggleMute,
      isRowPinned,
      toggleRowPin,
      isRowMuted,
      toggleRowMute,
      isCollapsed,
      toggleCollapsed,
    }),
    [
      prefs,
      isPinned,
      togglePin,
      isMuted,
      toggleMute,
      isRowPinned,
      toggleRowPin,
      isRowMuted,
      toggleRowMute,
      isCollapsed,
      toggleCollapsed,
    ],
  );
}
