import { Suspense, lazy } from "react";
import { cn } from "@/lib/utils";
import type { SnoCanvasProps } from "./SnoCanvas";

// The canvas pulls in three.js. Loading it lazily keeps that out of any chunk
// that merely registers a kind renderer.
const SnoCanvas = lazy(() => import("./SnoCanvas"));

/**
 * SnoCanvas, loaded on demand. Use this instead of importing SnoCanvas
 * directly from a module that is reachable at render time.
 */
export function LazySnoCanvas({ className, ...props }: SnoCanvasProps) {
  return (
    <Suspense
      fallback={<div className={cn("bg-muted/20 w-full", className)} />}
    >
      <SnoCanvas className={className} {...props} />
    </Suspense>
  );
}
