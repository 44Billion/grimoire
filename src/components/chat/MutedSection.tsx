/**
 * The muted rows, folded away at the bottom of their section.
 *
 * Muting takes a row out of the list, which is the point — but not out of the
 * app, which would make unmuting impossible: the only gesture that unmutes is
 * a right-click on the row itself. So they collapse behind one line instead of
 * vanishing, shut by default, and the line says how many so a reader who
 * forgot what they silenced can still find it.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function MutedSection({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Hide muted" : "Show muted"}
        // The category heading's own shape — this is a fold like any other, and
        // it sits in the same column as the ones Concord already draws.
        className="flex w-full cursor-crosshair items-center gap-0.5 px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <Chevron className="size-3 shrink-0" />
        <span className="truncate">Muted ({count})</span>
      </button>
      {open && children}
    </div>
  );
}
