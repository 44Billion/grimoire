/**
 * What the UI knows about the call — and nothing that can run one.
 *
 * Split from `concord-call.ts` for one reason: that module imports
 * `livekit-client`, which is a large chunk plus a worker, and anything that
 * merely wants to SHOW a call — a window title, the pill in the tab bar — would
 * otherwise drag the whole media stack into the app's first load for every
 * user, including the ones who never make a call.
 *
 * So the atoms live here, the service writes them, and a viewer that needs to
 * ACT on a call imports the service (lazily, if it is itself eagerly loaded).
 */

import { atom } from "jotai";

import type {
  VoicePresenceFold,
  VoiceReactionEntry,
} from "@/lib/concord/voice";

export type CallStatus =
  | "idle"
  /** Probing brokers and minting a token (CORD-07 §2/§5). */
  | "joining"
  | "connected"
  | "failed";

export interface CallState {
  status: CallStatus;
  communityIdHex?: string;
  channelIdHex?: string;
  channelName?: string;
  /** The broker that actually minted our token — what rides our presence (§5). */
  broker?: string;
  /** Our own SFU identity. Keys our frames; never re-minted while connected. */
  identity?: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  handRaised: boolean;
  error?: string;
  /** Who is in the call, as presence tells it. */
  fold: VoicePresenceFold;
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
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
  handRaised: false,
  fold: { present: [], claims: new Map() },
  roomEpoch: 0,
};

/** The UI's view of the call. Written only by `concord-call.ts`. */
export const callStateAtom = atom<CallState>(IDLE);

/**
 * Reactions currently in the air.
 *
 * Kept out of `callStateAtom` deliberately: these change several times a second
 * while a call is lively, and every consumer of the call's identity, roster and
 * mute state would re-render with them. Nothing is folded — an entry appears,
 * floats, and is dropped.
 */
export const callReactionsAtom = atom<VoiceReactionEntry[]>([]);
