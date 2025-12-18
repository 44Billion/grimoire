import type { CSSProperties } from "react";
import {
  MediaController,
  MediaControlBar,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaVolumeRange,
  MediaPlayButton,
  MediaMuteButton,
  MediaFullscreenButton,
  MediaPipButton,
} from "media-chrome/react";
import "hls-video-element";

interface VideoPlayerProps {
  url: string;
  title?: string;
  className?: string;
}

export function VideoPlayer({ url, title, className = "" }: VideoPlayerProps) {
  // Detect HLS format
  const isHLS = url.includes(".m3u8") || url.includes("application/x-mpegURL");

  return (
    <MediaController
      className={className}
      style={
        {
          "--media-secondary-color": "hsl(270 100% 70%)",
          "--media-primary-color": "hsl(210 40% 98%)",
          "--media-control-background": "hsl(222.2 84% 4.9% / 0.8)",
          "--media-control-hover-background": "hsl(270 100% 70% / 0.2)",
          "--media-range-track-background": "hsl(217.2 32.6% 17.5%)",
          "--media-preview-background": "hsl(222.2 84% 4.9%)",
          "--media-text-color": "hsl(210 40% 98%)",
          aspectRatio: "16 / 9",
          width: "100%",
        } as CSSProperties
      }
    >
      {isHLS ? (
        /* @ts-expect-error Web Component */
        <hls-video
          slot="media"
          src={url}
          playsInline={true}
          title={title}
          style={{ aspectRatio: "16 / 9" }}
          config={{
            lowLatencyMode: true,
          }}
        />
      ) : (
        <video
          slot="media"
          src={url}
          playsInline={true}
          title={title}
          style={{ aspectRatio: "16 / 9" }}
        />
      )}
      <MediaControlBar>
        <MediaPlayButton />
        <MediaTimeRange />
        <MediaTimeDisplay showDuration />
        <MediaMuteButton />
        <MediaVolumeRange />
        <MediaPipButton />
        <MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
  );
}
