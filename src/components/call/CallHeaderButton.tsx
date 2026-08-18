/**
 * The call in a room's header.
 *
 * A count, and the way into the roster behind it. Both protocols can answer
 * "how many are in there" without anyone joining: Concord because presence is
 * announced over the channel itself, encrypted, and a relay group because the
 * relay publishes a `kind:39004` naming who is live.
 *
 * The roster itself lives in the call window, which has room for it and can
 * also say who is SPEAKING — something no roster can know, because it is a
 * property of media only the SFU sees.
 */

import { Phone } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The header control: a phone, and how many are in the call.
 *
 * An empty count is an invitation rather than an absence — under CORD-07 every
 * channel is callable, so there is no voice channel to have been created, and a
 * relay group that advertises a `livekit` tag has a room whether or not anyone
 * is in it. What differs is only whether the caller renders the button at all:
 * a group without the tag has nowhere to go.
 *
 * Clicking opens the call in its own window, which is where the roster, the
 * controls and the tiles live.
 */
export function CallHeaderButton({
  count,
  active,
  onOpen,
  emptyTitle = "Start a call here",
}: {
  count: number;
  /** Whether the app's one call is this room's. */
  active: boolean;
  onOpen: () => void;
  /** What the phone offers when nobody is in the room yet. */
  emptyTitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        active
          ? "You are in this call"
          : count === 0
            ? emptyTitle
            : count === 1
              ? "1 member is in a call — join them"
              : `${count} members are in a call — join them`
      }
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-xs tabular-nums leading-none hover:bg-muted",
        active && "bg-muted text-primary",
      )}
    >
      <Phone className="size-3.5 shrink-0" />
      {count > 0 ? count : null}
    </button>
  );
}
