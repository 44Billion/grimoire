/**
 * The call in a channel's header (CORD-07 §4).
 *
 * A count, and the roster behind it. Presence is announced over the channel
 * itself, so this is what every member can see without joining anything and
 * without any relay or broker learning who is talking.
 *
 * The roster itself lives in the call window, which has room for it and can
 * also say who is SPEAKING — something presence cannot know, because it is a
 * property of media no relay ever sees.
 */

import { Phone } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The header control: a phone, and how many are in the call.
 *
 * Always present, because every channel is callable (CORD-07 §1) — there is no
 * voice channel to have been created, so an empty count is an invitation rather
 * than an absence. Clicking opens the call in its own window, which is where the
 * roster, the controls and the tiles live.
 */
export function VoiceHeaderButton({
  count,
  active,
  onOpen,
}: {
  count: number;
  /** Whether the app's one call is this channel's. */
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        active
          ? "You are in this call"
          : count === 0
            ? "Start a call in this channel"
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
