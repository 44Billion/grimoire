/**
 * The video the SFU is currently forwarding, per SFU identity.
 *
 * CORD-07 §6: video and screenshare are the same call. A member simply publishes
 * more tracks, under the same per-sender key and the same presence — there are
 * no extra keys, no extra events, and nothing new for a relay or a broker to
 * learn. So this is purely a rendering concern: which identities have a picture
 * to show, and which of those pictures is a screen.
 *
 * Keyed by identity rather than by pubkey because that is what the SFU speaks,
 * and what §4's verification rule binds a member to. An identity presence
 * cannot vouch for is keyed with random bytes and never decodes, so it has no
 * track here to render either.
 */

import { useEffect, useState } from "react";
import { RoomEvent, Track, type Participant } from "livekit-client";

import { activeRoom } from "@/services/concord-call";

export interface IdentityTracks {
  camera?: Track;
  screen?: Track;
  /** A screenshare's own audio, when the publisher shared it. */
  screenAudio?: Track;
}

const EMPTY = new Map<string, IdentityTracks>();

export function useRoomTracks(roomEpoch: number): Map<string, IdentityTracks> {
  const [tracks, setTracks] = useState<Map<string, IdentityTracks>>(EMPTY);

  useEffect(() => {
    const room = activeRoom();
    if (!room) {
      setTracks(EMPTY);
      return;
    }

    const read = () => {
      const next = new Map<string, IdentityTracks>();
      const all: Participant[] = [
        room.localParticipant,
        ...room.remoteParticipants.values(),
      ];
      for (const participant of all) {
        const entry: IdentityTracks = {};
        const camera = participant.getTrackPublication(Track.Source.Camera);
        const screen = participant.getTrackPublication(
          Track.Source.ScreenShare,
        );
        const screenAudio = participant.getTrackPublication(
          Track.Source.ScreenShareAudio,
        );
        // A muted publication still exists; rendering its element gives a frozen
        // last frame, which reads as a live picture of someone who turned their
        // camera off.
        if (camera?.track && !camera.isMuted) entry.camera = camera.track;
        if (screen?.track && !screen.isMuted) entry.screen = screen.track;
        if (screenAudio?.track && !screenAudio.isMuted) {
          entry.screenAudio = screenAudio.track;
        }
        if (entry.camera ?? entry.screen ?? entry.screenAudio) {
          next.set(participant.identity, entry);
        }
      }
      setTracks((prev) => (sameTracks(prev, next) ? prev : next));
    };

    read();
    const events = [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ] as const;
    for (const event of events) room.on(event, read);
    return () => {
      for (const event of events) room.off(event, read);
    };
  }, [roomEpoch]);

  return tracks;
}

function sameTracks(
  a: Map<string, IdentityTracks>,
  b: Map<string, IdentityTracks>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [identity, entry] of a) {
    const other = b.get(identity);
    if (!other) return false;
    if (
      entry.camera !== other.camera ||
      entry.screen !== other.screen ||
      entry.screenAudio !== other.screenAudio
    ) {
      return false;
    }
  }
  return true;
}
