import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
import type { EventDetailViewerProps } from "../EventDetailViewer";

// Lazy, so the preview routes don't pull EventDetailViewer into the initial
// bundle. A static import here would also defeat WindowRenderer's lazy() and
// keep the viewer from ever getting its own chunk.
const EventDetailViewer = lazy(() =>
  import("../EventDetailViewer").then((m) => ({
    default: m.EventDetailViewer,
  })),
);

/**
 * Detail viewer as the preview routes render it: full-height, scrollable,
 * with a loading fallback while the chunk arrives.
 */
export function PreviewDetail({ pointer }: EventDetailViewerProps) {
  return (
    <div className="h-full overflow-auto">
      <Suspense
        fallback={
          <div className="h-full w-full flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <EventDetailViewer pointer={pointer} />
      </Suspense>
    </div>
  );
}
