/**
 * What the UI knows about the call — and nothing that can run one.
 *
 * Split from the call services for one reason: they import `livekit-client`,
 * which is a large chunk plus a worker, and anything that merely wants to SHOW a
 * call — a window title, the pill in the tab bar — would otherwise drag the
 * whole media stack into the app's first load for every user, including the ones
 * who never make a call.
 *
 * So the atoms live here, the services write them, and a viewer that needs to
 * ACT on a call imports the service (lazily, if it is itself eagerly loaded).
 *
 * There is exactly ONE of these, across every protocol. Two calls can share a
 * pair of ears, a microphone and a camera no better than two people can, and the
 * pill in the header names one call because there is one. `protocol` says whose
 * it is, and joining anywhere hangs up whatever was running (`hangUpAny`,
 * `src/services/call-room.ts`).
 */

import { atom } from "jotai";

import { normalizeRelayURL } from "@/lib/relay-url";

import {
  EMPTY_ROSTER,
  type CallReaction,
  type CallRoster,
} from "@/lib/call/roster";

export type CallStatus =
  | "idle"
  /** Resolving where the room is and minting a token. */
  | "joining"
  | "connected"
  | "failed";

/**
 * Which protocol owns the running call. `"none"` rather than an absent field, so
 * a reader narrowing on it never has to also handle undefined — an idle call is
 * a state, not a missing one.
 */
export type CallProtocol = "none" | "concord" | "nip-29";

export interface CallState {
  status: CallStatus;
  protocol: CallProtocol;
  /** Concord: the community's idHex. */
  communityIdHex?: string;
  /** Concord: the channel's idHex. */
  channelIdHex?: string;
  channelName?: string;
  /**
   * NIP-29: the relay hosting the group, normalized. A group id is only unique
   * within its relay, so the pair travels together everywhere.
   */
  relayUrl?: string;
  /** NIP-29: the group id, VERBATIM — `#h` and `#d` are case-sensitive. */
  groupId?: string;
  /** The broker that actually minted our token — what rides our presence (§5). */
  broker?: string;
  /** Our own SFU identity. Keys our frames; never re-minted while connected. */
  identity?: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  /** Concord only: no NIP-29 event carries a raised hand. */
  handRaised: boolean;
  error?: string;
  /** Who is in the call, as the protocol's own presence tells it. */
  fold: CallRoster;
  /** The window that owns this call; it ends when that window is closed. */
  windowId?: string;
  /**
   * Bumped every time a NEW `Room` is built — a rejoin after a rekey, or a §5
   * migration. Nothing about the call's identity changes, so `status` stays
   * "connected" through a migration and a component watching status alone would
   * keep holding the room that was just torn down. Anything that binds to the
   * room object itself keys on this.
   */
  roomEpoch: number;
}

export const IDLE: CallState = {
  status: "idle",
  protocol: "none",
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
  handRaised: false,
  fold: EMPTY_ROSTER,
  roomEpoch: 0,
};

/** The UI's view of the call. Written only by the call services. */
export const callStateAtom = atom<CallState>(IDLE);

/**
 * Reactions currently in the air.
 *
 * Kept out of `callStateAtom` deliberately: these change several times a second
 * while a call is lively, and every consumer of the call's identity, roster and
 * mute state would re-render with them. Nothing is folded — an entry appears,
 * floats, and is dropped.
 */
export const callReactionsAtom = atom<CallReaction[]>([]);

/**
 * Whether the running call is a given relay group's.
 *
 * Both halves of the pair, always. A group id is only unique within its relay,
 * so a window for `relayB'general` matching on the id alone reports itself
 * connected to a call on `relayA'general`: it renders that call's roster, its
 * media toggles drive that room, and its Leave hangs up somebody else's space.
 *
 * The relay is normalized on both sides. `joinGroupCall` stores a normalized
 * URL and a window's props hold whatever the parser produced, so a bare `===`
 * is not merely fragile — it is permanently false.
 */
export function isGroupCall(
  state: CallState,
  relayUrl: string | undefined,
  groupId: string | undefined,
): boolean {
  if (state.protocol !== "nip-29") return false;
  if (!relayUrl || !groupId || !state.relayUrl) return false;
  if (state.groupId !== groupId) return false;
  try {
    return normalizeRelayURL(state.relayUrl) === normalizeRelayURL(relayUrl);
  } catch {
    return false;
  }
}
