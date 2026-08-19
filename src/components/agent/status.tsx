/**
 * What a session's status looks like, in one place.
 *
 * A status is read in three places — nested under a chat message, in the
 * session list, and on the head of an open transcript — and the same word has to
 * mean the same thing in all of them. Colour carries it: green is going, amber
 * wants you, red stopped badly, grey is over. The theme's own tokens, so a
 * palette change moves all of it at once.
 *
 * `active` and `awaiting-input` pulse, because both are states where something
 * is expected to change and a still dot says otherwise.
 */

import { cn } from "@/lib/utils";

export interface StatusStyle {
  dot: string;
  text: string;
  /** Said instead of the raw status, when the raw status reads badly. */
  label?: string;
  pulse?: boolean;
}

const UNKNOWN: StatusStyle = {
  dot: "bg-muted-foreground",
  text: "text-muted-foreground",
};

const STATUS_STYLE: Record<string, StatusStyle> = {
  active: {
    dot: "bg-success",
    text: "text-success",
    label: "running",
    pulse: true,
  },
  "awaiting-input": {
    dot: "bg-warning",
    text: "text-warning",
    label: "waiting for you",
    pulse: true,
  },
  idle: { dot: "bg-info", text: "text-info" },
  /**
   * Blocked on a sign-in the agent cannot do for itself.
   *
   * It had no entry at all, so it fell through to the unknown style: a grey dot,
   * the raw string as its label, and a sort rank below `done`. A session waiting
   * on a person was filed under "over".
   */
  "payment-required": {
    dot: "bg-warning",
    text: "text-warning",
    label: "needs sign-in",
    pulse: true,
  },
  done: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  error: { dot: "bg-destructive", text: "text-destructive" },
  aborted: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** A status this build has never heard of still renders, in the quiet colour. */
export function statusStyle(status: string): StatusStyle {
  return STATUS_STYLE[status] ?? UNKNOWN;
}

export function StatusDot({
  status,
  /** Fragments are arriving, so pulse whatever the head last said. */
  live = false,
  className,
}: {
  status: string;
  live?: boolean;
  className?: string;
}) {
  const style = statusStyle(status);

  return (
    <span
      className={cn("relative flex h-2 w-2 shrink-0", className)}
      title={status}
    >
      {(style.pulse || live) && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            style.dot,
          )}
        />
      )}
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", style.dot)}
      />
    </span>
  );
}

/**
 * The dot and the word together, for anywhere a status stands on its own.
 *
 * No border and no fill: this sits beside a title, and a boxed badge next to a
 * heading reads as a second heading.
 */
export function StatusBadge({
  status,
  live = false,
  className,
}: {
  status: string;
  live?: boolean;
  className?: string;
}) {
  const style = statusStyle(status);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs",
        style.text,
        className,
      )}
      title={status}
    >
      <StatusDot status={status} live={live} />
      {style.label ?? status}
    </span>
  );
}
