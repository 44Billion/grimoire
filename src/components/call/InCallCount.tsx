/**
 * How many people are in a room's call, as a sidebar pill.
 *
 * Shared by Concord channels and NIP-29 groups because it says the same thing
 * about both, from two completely different sources: Concord folds its members'
 * own presence, a relay group reads the relay's `kind:39004`. What a reader
 * needs from either is a number and a way in.
 *
 * The count survives a mute. Muting silences the MESSAGES, and who is in a call
 * right now is a fact about the room rather than a notification about it.
 */

import { Phone } from "lucide-react";

export function InCallCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-muted-foreground"
      title={
        count === 1
          ? "1 member is in a call here"
          : `${count} members are in a call here`
      }
    >
      <Phone className="size-2.5 shrink-0" />
      {count}
    </span>
  );
}
