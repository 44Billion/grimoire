/**
 * The one room, and everything you can do to a room without knowing whose it is.
 *
 * A call is app-wide, not window-wide (see `concord-call.ts` for why), and it is
 * also PROTOCOL-wide: there is one microphone, one camera and one pair of ears,
 * so there is one room. Both call services park their `Room` here, and every
 * consumer that renders or drives media — the stage, the speakers, the track
 * hooks, the settings pane — reads it from here rather than from a service it
 * would otherwise have to pick between.
 *
 * What lives here is exactly what is the same in both protocols: publishing your
 * own tracks, switching a capture device, applying this device's per-member
 * volumes, and hanging up whoever is connected. What does not is left to the
 * services: minting a token, proving who is who, and announcing yourself.
 */

import { getDefaultStore } from "jotai";
import { Track, type Room } from "livekit-client";

import { verifiedAuthorOf } from "@/lib/call/roster";
import { callStateAtom, type CallState } from "@/services/call-state";
import {
  denoiseEnabled,
  setPreferredCameraId,
  setPreferredMicId,
  volumeFor,
} from "@/services/concord-devices";
import { syncRnnoise } from "@/services/concord-rnnoise";

let room: Room | undefined;
/** How to end the call currently holding the slot, as its owner defines it. */
let hangUp: (() => Promise<void>) | undefined;

function store() {
  return getDefaultStore();
}

function patch(over: Partial<CallState>): void {
  store().set(callStateAtom, { ...store().get(callStateAtom), ...over });
}

/** The live room, for the components that render its tracks. */
export function activeRoom(): Room | undefined {
  return room;
}

/**
 * Hand the slot a room and the way to end it, or clear both.
 *
 * The owner passes its own hang-up rather than being looked up later, and that
 * is the whole point: a service's module-level bookkeeping is the truth about
 * whether a call is running, and `callStateAtom` can lag it. A teardown
 * announcing a goodbye holds the atom on the old call for seconds while the
 * service already considers it gone, so dispatching on `protocol` would find
 * nobody to hang up at exactly the moment there is something to hang up.
 */
export function setActiveRoom(
  next: Room | undefined,
  ownerHangUp?: () => Promise<void>,
): void {
  room = next;
  hangUp = next ? ownerHangUp : undefined;
}

/**
 * Hang up whatever is running, whoever owns it.
 *
 * A no-op when the slot is empty, and idempotent otherwise — every owner's
 * teardown is.
 */
export async function hangUpAny(): Promise<void> {
  await hangUp?.();
}

/** What LiveKit says we are currently publishing. */
export function readPublishing(): Partial<CallState> {
  const local = room?.localParticipant;
  if (!local) return {};
  return {
    micEnabled: local.isMicrophoneEnabled,
    cameraEnabled: local.isCameraEnabled,
    screenEnabled: local.isScreenShareEnabled,
  };
}

/**
 * Match the published microphone to the noise-suppression preference.
 *
 * Never throws: a worklet that will not load costs the suppression, not the
 * call, and the raw track keeps publishing.
 */
export async function applyDenoise(): Promise<void> {
  const track = room?.localParticipant.getTrackPublication(
    Track.Source.Microphone,
  )?.audioTrack;
  await syncRnnoise(track, denoiseEnabled()).catch(() => undefined);
}

/**
 * Publish or stop publishing one of our own tracks.
 *
 * The reported state is read back off LiveKit rather than assumed from the
 * request, so a denied permission — or a screenshare dialog the member
 * cancelled — shows as off instead of a button claiming we are sending
 * something we are not.
 */
async function setPublishing(
  source: "mic" | "camera" | "screen",
  on: boolean,
): Promise<void> {
  const local = room?.localParticipant;
  if (!local) return;
  try {
    if (source === "mic") {
      await local.setMicrophoneEnabled(on);
      // The processor attaches to the TRACK, which only exists once the mic is
      // publishing — so this belongs here rather than in the room options.
      if (on) await applyDenoise();
    } else if (source === "camera") await local.setCameraEnabled(on);
    // The screen's own audio rides with it when the member shares it; it is
    // published as a separate track and mixed by the receiver like any other.
    else await local.setScreenShareEnabled(on, { audio: true });
  } catch (error) {
    patch({
      ...readPublishing(),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  patch(readPublishing());
}

/** Mic on or off. */
export async function setMicEnabled(on: boolean): Promise<void> {
  await setPublishing("mic", on);
}

/** Camera on or off. */
export async function setCameraEnabled(on: boolean): Promise<void> {
  await setPublishing("camera", on);
}

/** Screenshare on or off. */
export async function setScreenShareEnabled(on: boolean): Promise<void> {
  await setPublishing("screen", on);
}

/** Switch capture device mid-call, so a choice takes effect without rejoining. */
export async function switchCaptureDevice(
  kind: "audioinput" | "videoinput",
  deviceId: string,
): Promise<void> {
  if (kind === "audioinput") setPreferredMicId(deviceId);
  else setPreferredCameraId(deviceId);
  await room?.switchActiveDevice(kind, deviceId).catch(() => undefined);
}

/**
 * Apply this device's per-member volumes to the room.
 *
 * Under Concord this is the only moderation a blind SFU allows (CORD-07 §7):
 * nothing signed can mute anyone, so what a client can do is decline to play
 * what it receives. Local, never published, and it says nothing to the member
 * being turned down. Under NIP-29 the relay can mute for real, and this is still
 * the lever for "I, personally, would like them quieter".
 *
 * Volumes are stored per PUBKEY but applied per SFU IDENTITY, and only for an
 * identity the roster actually vouches for — an unverified one is playing
 * nothing decodable anyway, and matching it to a member would be a guess.
 */
export function applyVolumes(): void {
  if (!room) return;
  const fold = store().get(callStateAtom).fold;
  for (const participant of room.remoteParticipants.values()) {
    const author = verifiedAuthorOf(fold, participant.identity);
    const volume = author ? volumeFor(author) : 1;
    // Both sources, and the second one is not optional: `setVolume` defaults to
    // the MICROPHONE alone, and a shared screen's audio is a separate source
    // with its own entry. Setting only the default leaves someone you silenced
    // able to play a tab at you at full volume — which defeats the one lever a
    // client has.
    participant.setVolume(volume);
    participant.setVolume(volume, Track.Source.ScreenShareAudio);
  }
}
