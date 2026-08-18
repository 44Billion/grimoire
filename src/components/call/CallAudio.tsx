/**
 * The call's speakers.
 *
 * LiveKit hands decoded audio over as MediaStreamTracks; something has to attach
 * them to an element for them to be heard. This is deliberately NOT inside a
 * participant tile: a tile unmounts whenever the roster changes shape, and
 * taking the `<audio>` with it cuts the speaker off mid-sentence.
 *
 * Autoplay is the other half. A browser blocks audio until the page has been
 * interacted with, and LiveKit reports that as `audioPlaybackChanged`; the room
 * exposes `startAudio()` to retry from a real click. Silence with no explanation
 * is the failure mode this avoids.
 */

import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { RoomEvent, type RemoteTrack } from "livekit-client";

import { Button } from "@/components/ui/button";
import { callStateAtom } from "@/services/call-state";
import { activeRoom } from "@/services/call-room";

export default function CallAudio() {
  const holder = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);
  // A §5 migration and a §7 rejoin both build a NEW room while the call stays
  // "connected" throughout, so binding on mount alone would leave this attached
  // to a room that has been disconnected and stripped of its listeners — the
  // call would look healthy and be silent. `roomEpoch` is what changes.
  const roomEpoch = useAtomValue(callStateAtom).roomEpoch;

  useEffect(() => {
    const room = activeRoom();
    if (!room) return;

    const attach = (track: RemoteTrack) => {
      if (track.kind !== "audio" || !holder.current) return;
      const element = track.attach();
      element.setAttribute("data-lk-audio", "1");
      holder.current.appendChild(element);
    };
    const detach = (track: RemoteTrack) => {
      if (track.kind !== "audio") return;
      for (const element of track.detach()) element.remove();
    };

    // Tracks already subscribed when this mounted — a workspace switch remounts
    // the window into a call that is already running.
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) attach(publication.track as RemoteTrack);
      }
    }

    const onPlayback = () => setBlocked(!room.canPlaybackAudio);
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, detach);
    room.on(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
    onPlayback();

    return () => {
      room.off(RoomEvent.TrackSubscribed, attach);
      room.off(RoomEvent.TrackUnsubscribed, detach);
      room.off(RoomEvent.AudioPlaybackStatusChanged, onPlayback);
      holder.current?.replaceChildren();
    };
  }, [roomEpoch]);

  return (
    <>
      <div ref={holder} className="hidden" />
      {blocked && (
        <div className="flex items-center justify-center gap-2 border-t bg-muted/30 px-3 py-1.5 text-xs">
          <span>This browser is holding the call&apos;s audio back.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void activeRoom()?.startAudio()}
          >
            Play
          </Button>
        </div>
      )}
    </>
  );
}
