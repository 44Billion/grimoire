import { Suspense, lazy } from "react";
import type { VideoPlayerProps } from "./VideoPlayer";

// The player pulls in media-chrome (and, for HLS sources, hls.js). Loading it
// lazily keeps that out of any chunk that merely registers a kind renderer.
const VideoPlayer = lazy(() =>
  import("./VideoPlayer").then((m) => ({ default: m.VideoPlayer })),
);

/**
 * VideoPlayer, loaded on demand. Use this instead of importing VideoPlayer
 * directly from a module that is reachable at render time.
 */
export function LazyVideoPlayer({
  className = "",
  ...props
}: VideoPlayerProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`bg-muted/20 w-full ${className}`}
          style={{ aspectRatio: "16 / 9" }}
        />
      }
    >
      <VideoPlayer className={className} {...props} />
    </Suspense>
  );
}
