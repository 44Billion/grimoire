import { HEX_NAME, HexHoverAvatar } from "./Hex";

import { useAddWindow } from "@/core/state";
import { isAnyInferenceReachable } from "@/services/inference";
import { cn } from "@/lib/utils";

import type { AiTarget } from "@/lib/ai-target";

/**
 * Open an `ai` window grounded in whatever is on screen.
 *
 * One component for every entry point — a profile, a NIP, a kind — because they
 * all need the same three things right: the gate (nothing offers a provider that
 * is not there), the full command string (the edit box re-runs it, and an
 * abbreviated bech32 rebuilds a window pointing at nothing), and the same
 * affordance, so it reads as one feature rather than three.
 */
export function AskHexButton({
  className,
  label,
  target,
  title,
}: {
  className?: string;
  /** Window title. Defaults to `ASK HEX`. */
  label?: string;
  target: AiTarget;
  /** Tooltip. Defaults to naming the subject. */
  title?: string;
}) {
  const addWindow = useAddWindow();
  if (!isAnyInferenceReachable()) return null;

  const command = `ai ${target.value}`;

  return (
    <button
      aria-label={title ?? `Ask ${HEX_NAME} about this`}
      className={cn(
        "group flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      onClick={() =>
        addWindow(
          "ai",
          { target },
          command,
          label ?? `ASK ${HEX_NAME.toUpperCase()}`,
        )
      }
      title={title ?? `Ask ${HEX_NAME} about this`}
      type="button"
    >
      <HexHoverAvatar className="size-3" />
      <span>Ask {HEX_NAME}</span>
    </button>
  );
}
