/**
 * The call in a NIP-29 group — one per app, and not owned by any window.
 *
 * The same ownership rule as `concord-call.ts`, for the same reason: the call
 * window unmounts on a workspace switch while its window still exists in the
 * layout tree, so a `Room` held in React state would drop the call every time
 * the reader flips desktops. The room lives at module level and the window is a
 * VIEW of it — the call ends when the WINDOW leaves `state.windows`.
 *
 * Everything else is smaller than Concord's, and the reason is one sentence: the
 * party that enforces the group's rules and the party that issues the media
 * credential are the same relay.
 *
 * - **No E2EE.** Concord encrypts because its broker is deliberately blind and
 *   must stay that way. Here the relay already reads every message in the group;
 *   encrypting the audio to it would protect nothing it does not already have,
 *   and the spec defines no key schedule to do it with.
 * - **No rendezvous, no migration.** A group lives on one relay. There is one
 *   endpoint, and if it is down there is no call.
 * - **No heartbeat.** Presence is `kind:39004`, published by the relay, which is
 *   the only party that can actually see the room.
 * - **No identity arbitration.** The relay binds the member's pubkey into the
 *   JWT's `sub`, so a claim is single by construction.
 *
 * What the relay CANNOT do is prove itself honest: a hostile one can put anyone
 * in a room under anyone's name. That is the same trust a reader already extends
 * to it for `kind:39000` and for moderation, which is the trust NIP-29 is built
 * on — stated here because it is the thing E2EE buys Concord and this does not
 * buy.
 */

import { getDefaultStore } from "jotai";
import {
  Room,
  RoomEvent,
  VideoPresets,
  type RoomOptions,
} from "livekit-client";

import { grimoireStateAtom } from "@/core/state";
import {
  foldGroupRoster,
  livekitTokenUrl,
  parseTokenResponse,
} from "@/lib/nip29/livekit";
import { httpAuthHeader, signHttpAuth, type HttpAuthSigner } from "@/lib/nip98";
import { normalizeRelayURL } from "@/lib/relay-url";
import {
  activeRoom,
  applyVolumes,
  hangUpAny,
  readPublishing,
  setActiveRoom,
} from "@/services/call-room";
import { callStateAtom, IDLE, type CallState } from "@/services/call-state";
import { preferredCameraId, preferredMicId } from "@/services/concord-devices";
import {
  groupParticipantsOf,
  watchGroupParticipants,
} from "@/services/nip29-participants";

/** How long to wait on the relay's token endpoint. */
const MINT_TIMEOUT_MS = 8_000;

interface ActiveGroupCall {
  relayUrl: string;
  groupId: string;
  identity: string;
  room: Room;
  releaseParticipants: () => void;
  releaseWindows: () => void;
  torn: boolean;
}

let active: ActiveGroupCall | undefined;

function store() {
  return getDefaultStore();
}

function patch(over: Partial<CallState>): void {
  store().set(callStateAtom, { ...store().get(callStateAtom), ...over });
}

/**
 * Mint a LiveKit session from the relay hosting a group.
 *
 * The URL is built once and handed to both the signature and the fetch: the
 * server compares its own request URL against the `u` tag, and a caller that
 * canonicalizes one and not the other gets a 401 with nothing in it to say why.
 */
async function mint(
  relayUrl: string,
  groupId: string,
  signer: HttpAuthSigner,
): Promise<{ token: string; url: string; identity: string }> {
  const endpoint = livekitTokenUrl(relayUrl, groupId);
  if (!endpoint) {
    throw new Error(
      "This group is hosted over an insecure connection, so its space cannot be joined.",
    );
  }

  const authorization = httpAuthHeader(await signHttpAuth(signer, endpoint));
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
    });
  } catch {
    // A network error against an https endpoint the group itself advertised is
    // almost always the relay not answering CORS — the request never reaches
    // the application, so there is no status to report and the browser will not
    // say which header was missing.
    throw new Error(
      "The relay did not answer its media endpoint. It may not allow browser requests to it (CORS).",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("The relay will not let you into this group's space.");
  }
  if (response.status === 404) {
    throw new Error("This relay hosts no media space for this group.");
  }
  if (!response.ok) {
    throw new Error(
      `The relay refused to issue a token: HTTP ${response.status}`,
    );
  }

  return parseTokenResponse(await response.json());
}

/**
 * Join a group's AV space.
 *
 * Hangs up whatever call was running first, whichever protocol owned it — one
 * microphone, one camera, one room.
 */
export async function joinGroupCall(opts: {
  relayUrl: string;
  groupId: string;
  groupName?: string;
  pubkey: string;
  signer: HttpAuthSigner;
  windowId?: string;
}): Promise<void> {
  await hangUpAny();

  const relayUrl = normalizeRelayURL(opts.relayUrl);
  // The group id is NOT normalized: `#d` and `#h` are case-sensitive and the id
  // is relay-assigned.
  const { groupId } = opts;

  patch({
    status: "joining",
    protocol: "nip-29",
    relayUrl,
    groupId,
    // Cleared, not merely unset: a failed Concord join leaves these behind with
    // no call to own them, and a Concord window matching on them would then
    // claim to be connected to this space.
    communityIdHex: undefined,
    channelIdHex: undefined,
    channelName: opts.groupName ?? groupId,
    error: undefined,
    micEnabled: false,
    cameraEnabled: false,
    screenEnabled: false,
    handRaised: false,
    ...(opts.windowId !== undefined ? { windowId: opts.windowId } : {}),
  });

  try {
    await connect({ relayUrl, groupId, signer: opts.signer });
  } catch (error) {
    patch({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function connect(opts: {
  relayUrl: string;
  groupId: string;
  signer: HttpAuthSigner;
}): Promise<void> {
  const { relayUrl, groupId } = opts;
  const token = await mint(relayUrl, groupId, opts.signer);

  const options: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      ...(preferredMicId() ? { deviceId: preferredMicId() } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    videoCaptureDefaults: {
      ...(preferredCameraId() ? { deviceId: preferredCameraId() } : {}),
      resolution: VideoPresets.h720.resolution,
    },
    publishDefaults: {
      videoSimulcastLayers: [
        VideoPresets.h180,
        VideoPresets.h360,
        VideoPresets.h720,
      ],
      screenShareEncoding: VideoPresets.h1080.encoding,
    },
  };
  const room = new Room(options);

  const call: ActiveGroupCall = {
    relayUrl,
    groupId,
    identity: token.identity,
    room,
    releaseParticipants: () => {},
    releaseWindows: () => {},
    torn: false,
  };
  active = call;
  setActiveRoom(room, () => leaveGroupCall());

  try {
    // The relay's list and the room's own participants are folded together, and
    // both change on their own schedule: a member holds a token before their
    // session is up, and the relay republishes after it. Either edge repaints.
    call.releaseParticipants = watchGroupParticipants(relayUrl, [groupId], () =>
      refold(call),
    );
    const repaint = () => refold(call);
    room.on(RoomEvent.ParticipantConnected, repaint);
    room.on(RoomEvent.ParticipantDisconnected, repaint);

    const followPublishing = () => {
      if (active === call) patch(readPublishing());
    };
    room.on(RoomEvent.LocalTrackPublished, followPublishing);
    room.on(RoomEvent.LocalTrackUnpublished, followPublishing);
    room.on(RoomEvent.TrackMuted, followPublishing);
    room.on(RoomEvent.TrackUnmuted, followPublishing);
    room.on(RoomEvent.Disconnected, () => {
      // Nothing retries. The token names an identity, and re-minting would
      // change who we are mid-call; the reader can simply join again.
      if (active === call && !call.torn) {
        void leaveGroupCall("The call disconnected.");
      }
    });

    await room.connect(token.url, token.token);
    // Joined muted. A call that starts hot publishes a room before its member
    // has decided to speak in it.
    await room.localParticipant.setMicrophoneEnabled(false);

    call.releaseWindows = watchOwningWindow(call);

    patch({
      status: "connected",
      identity: token.identity,
      error: undefined,
      micEnabled: false,
      cameraEnabled: false,
      screenEnabled: false,
      fold: currentRoster(call),
      roomEpoch: store().get(callStateAtom).roomEpoch + 1,
    });
    applyVolumes();
  } catch (error) {
    await teardown(call);
    throw error;
  }
}

/** The roster as both sources currently have it. */
function currentRoster(call: ActiveGroupCall) {
  const identities = [
    call.identity,
    ...[...call.room.remoteParticipants.values()].map((p) => p.identity),
  ];
  return foldGroupRoster(
    groupParticipantsOf(call.relayUrl, call.groupId),
    identities,
  );
}

function refold(call: ActiveGroupCall): void {
  if (active !== call) return;
  patch({ fold: currentRoster(call) });
  // Volumes are applied per identity, so a joiner is turned down as soon as
  // there is a roster naming them.
  applyVolumes();
}

/**
 * Hang up when the owning WINDOW is gone — removed from state, not unmounted.
 *
 * `state.windows` is a flat record across every workspace, so this is one
 * membership test and is workspace-independent. Keying off unmount instead would
 * end the call on a workspace switch, which is the one thing a module-level call
 * exists to survive.
 */
function watchOwningWindow(call: ActiveGroupCall): () => void {
  const windowId = store().get(callStateAtom).windowId;
  if (!windowId) return () => {};
  return store().sub(grimoireStateAtom, () => {
    if (active !== call) return;
    const state = store().get(grimoireStateAtom);
    if (!(windowId in state.windows)) void leaveGroupCall();
  });
}

/** Leave the group's space. */
export async function leaveGroupCall(error?: string): Promise<void> {
  const call = active;
  if (!call) {
    if (error) patch({ status: "failed", error });
    return;
  }
  await teardown(call);
  // A newer call may have taken the state while this one was tearing down — and
  // it may belong to the OTHER protocol, whose `active` this module cannot see.
  // The room slot is the one thing both write, so it is what answers: anything
  // in it means somebody else owns the atom now.
  if (activeRoom()) return;
  store().set(callStateAtom, {
    ...IDLE,
    roomEpoch: store().get(callStateAtom).roomEpoch + 1,
    ...(error !== undefined ? { status: "failed", error } : {}),
  });
}

/** Release everything one call holds, exactly once. */
async function teardown(call: ActiveGroupCall): Promise<void> {
  if (call.torn) return;
  call.torn = true;
  if (active === call) active = undefined;
  call.releaseWindows();
  call.releaseParticipants();

  try {
    await call.room.disconnect();
  } catch {
    // Already gone.
  }
  call.room.removeAllListeners();
  if (activeRoom() === call.room) setActiveRoom(undefined);
}
