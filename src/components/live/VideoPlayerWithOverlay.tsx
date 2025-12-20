import { useState, useRef, useEffect } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { StatusBadge } from "./StatusBadge";
import { UserName } from "../nostr/UserName";
import { Label } from "../ui/label";
import type { LiveStatus } from "@/types/live-activity";
import { cn } from "@/lib/utils";

interface VideoPlayerWithOverlayProps {
  url: string;
  title: string;
  description?: string;
  hostPubkey: string;
  status: LiveStatus;
  hashtags: string[];
  className?: string;
}

export function VideoPlayerWithOverlay({
  url,
  title,
  description,
  hostPubkey,
  status,
  hashtags,
  className,
}: VideoPlayerWithOverlayProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect video playing state
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const video = container.querySelector("video");
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <VideoPlayer url={url} title={title} />

      {/* Live indicator - hides when playing */}
      {status === "live" && (
        <div
          className={cn(
            "absolute top-4 left-4 transition-opacity duration-300",
            isPlaying && !isHovering ? "opacity-0" : "opacity-100",
          )}
        >
          <StatusBadge status={status} size="sm" />
        </div>
      )}

      {/* Info overlay on hover */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent",
          "flex flex-col justify-end p-6 gap-3",
          "transition-opacity duration-300",
          "pointer-events-none",
          isHovering ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">{title}</h2>

          {description && (
            <p className="text-sm text-neutral-200 line-clamp-2">
              {description}
            </p>
          )}

          <div className="flex items-center gap-2">
            <UserName
              pubkey={hostPubkey}
              className="text-sm text-white font-semibold"
            />
          </div>

          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {hashtags.slice(0, 5).map((tag) => (
                <Label key={tag} size="sm">
                  #{tag}
                </Label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
