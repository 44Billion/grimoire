import { DownloadIcon } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * The on-device model arriving.
 *
 * A first answer from Chrome's own model is a multi-hundred-megabyte download
 * before a single token, which is the hang class this repo keeps shipping. So
 * it gets a bar: what is happening, how far along, and that it only happens
 * once.
 *
 * Chrome reports progress two ways and says which in neither — a 0..1 fraction
 * in current builds, bytes loaded in older ones, with no total either way. A
 * fraction gets a real bar; bytes get a moving one, because a byte count with
 * no denominator cannot honestly be drawn as a percentage.
 */
export function ModelDownload({
  className,
  loaded,
}: {
  className?: string;
  /**
   * Whatever Chrome last reported: a fraction of one, or bytes. Undefined means
   * the download is known to be running and has reported nothing — which happens
   * whenever it started before this page did, since `create()` then waits on a
   * download it is not monitoring. A shimmering assistant and no explanation is
   * the failure this component exists to prevent.
   */
  loaded?: number;
}) {
  const fraction = loaded !== undefined && loaded <= 1;
  const percent =
    loaded === undefined ? 0 : Math.min(100, Math.round(loaded * 100));

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/30 px-3 py-2",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <DownloadIcon className="size-3 shrink-0 animate-pulse" />
        <span className="min-w-0 flex-1 truncate">
          Downloading the on-device model — kept for next time.
        </span>
        {loaded !== undefined && (
          <span className="shrink-0 font-mono tabular-nums text-foreground">
            {fraction ? `${percent}%` : `${Math.round(loaded / 1_000_000)} MB`}
          </span>
        )}
      </div>
      {fraction ? (
        <Progress
          aria-label="On-device model download"
          className="h-1.5"
          value={percent}
        />
      ) : (
        // No total, so no honest percentage: a sliding band says "still
        // arriving" without claiming to know how much is left.
        <div
          aria-label="On-device model download"
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20"
          role="progressbar"
        >
          <div className="absolute inset-y-0 w-1/3 animate-download-band rounded-full bg-primary" />
        </div>
      )}
    </div>
  );
}
