/**
 * One decoded video track, attached to an element.
 *
 * `track.attach()` mints the element and wires the MediaStream; detaching on
 * teardown is what stops the decoder. Nothing here knows the track is
 * end-to-end encrypted — by this point the worker has already decrypted the
 * frames, or it has not and there is simply no picture.
 *
 * `muted` is set on every element: a camera track carries no audio, and a
 * screenshare's audio is published as its own track, so an unmuted element here
 * would only ever echo a stream `CallAudio` is already playing.
 */

import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

import { cn } from "@/lib/utils";

export function VideoSurface({
  track,
  className,
  /** A screen keeps its whole frame; a face fills the tile. */
  contain,
  mirror,
}: {
  track: Track;
  className?: string;
  contain?: boolean;
  mirror?: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;
    const element = track.attach();
    element.muted = true;
    element.setAttribute("playsinline", "");
    element.className = cn(
      "h-full w-full",
      contain ? "object-contain" : "object-cover",
      mirror && "-scale-x-100",
    );
    parent.appendChild(element);
    return () => {
      for (const attached of track.detach()) attached.remove();
      parent.replaceChildren();
    };
  }, [track, contain, mirror]);

  return <div ref={holder} className={cn("h-full w-full", className)} />;
}
