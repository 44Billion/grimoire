/**
 * Who is actually making sound, and who is muted.
 *
 * Presence says who is IN a call (CORD-07 §4); it cannot say who is talking,
 * because that is a property of the media and the media is opaque to every relay
 * the protocol touches. The SFU is what knows, and it reports by SFU identity —
 * which is exactly the value presence binds to a member, so the two views join
 * on it.
 *
 * Keyed on `roomEpoch`: a §5 migration or a §7 rejoin builds a new `Room` while
 * the call stays connected, and listeners left on the old one would report a
 * silent room forever.
 */

import { useEffect, useState } from "react";
import { RoomEvent } from "livekit-client";

import { activeRoom } from "@/services/concord-call";

export interface RoomVoiceState {
  /** SFU identities currently speaking. */
  speaking: Set<string>;
  /** SFU identities whose microphone is off. */
  muted: Set<string>;
}

const EMPTY: RoomVoiceState = { speaking: new Set(), muted: new Set() };

export function useRoomSpeakers(roomEpoch: number): RoomVoiceState {
  const [state, setState] = useState<RoomVoiceState>(EMPTY);

  useEffect(() => {
    const room = activeRoom();
    if (!room) {
      setState(EMPTY);
      return;
    }

    const read = () => {
      const speaking = new Set<string>();
      const muted = new Set<string>();
      // `room.activeSpeakers` is the authority: the SFU computes it and pushes
      // it, where a remote participant's own `isSpeaking` flag is set from the
      // per-participant event this listener never subscribed to — which is why
      // a peer could be plainly audible with no ring around their tile.
      for (const p of room.activeSpeakers) speaking.add(p.identity);
      const all = [room.localParticipant, ...room.remoteParticipants.values()];
      for (const p of all) {
        if (p.isSpeaking) speaking.add(p.identity);
        if (!p.isMicrophoneEnabled) muted.add(p.identity);
      }
      setState((prev) =>
        sameSet(prev.speaking, speaking) && sameSet(prev.muted, muted)
          ? prev
          : { speaking, muted },
      );
    };

    read();
    room.on(RoomEvent.ActiveSpeakersChanged, read);
    room.on(RoomEvent.TrackMuted, read);
    room.on(RoomEvent.TrackUnmuted, read);
    room.on(RoomEvent.TrackPublished, read);
    room.on(RoomEvent.TrackUnpublished, read);
    room.on(RoomEvent.ParticipantConnected, read);
    room.on(RoomEvent.ParticipantDisconnected, read);
    room.on(RoomEvent.LocalTrackPublished, read);
    room.on(RoomEvent.LocalTrackUnpublished, read);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, read);
      room.off(RoomEvent.TrackMuted, read);
      room.off(RoomEvent.TrackUnmuted, read);
      room.off(RoomEvent.TrackPublished, read);
      room.off(RoomEvent.TrackUnpublished, read);
      room.off(RoomEvent.ParticipantConnected, read);
      room.off(RoomEvent.ParticipantDisconnected, read);
      room.off(RoomEvent.LocalTrackPublished, read);
      room.off(RoomEvent.LocalTrackUnpublished, read);
    };
  }, [roomEpoch]);

  return state;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
