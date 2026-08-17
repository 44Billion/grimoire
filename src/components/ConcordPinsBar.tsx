/**
 * The channel's pins, as a strip above the timeline (CORD-04 §7).
 *
 * A pin does not quote its message, it PROVES one: the entry carries the
 * original seal plus that message's own 76-byte NIP-44 key expansion, and this
 * client re-derives author, words, channel and signed timestamp for itself.
 * Nothing here is taken on the curator's word — which is exactly why a pin
 * reaches a member who holds none of the history it came from.
 *
 * Two states that look alike are kept apart: no pins (nothing renders at all)
 * and a list this member's keys cannot open (rendered as unavailable). An
 * unopenable list must never read as an empty one.
 */

import { useState } from "react";
import { ChevronDown, Lock, Pin } from "lucide-react";

import { RichText } from "@/components/nostr/RichText";
import Timestamp from "@/components/Timestamp";
import { UserName } from "@/components/nostr/UserName";
import type { VerifiedPin } from "@/lib/concord/pins";
import { cn } from "@/lib/utils";

export function ConcordPinsBar({
  pins,
  unavailable,
}: {
  pins: VerifiedPin[];
  unavailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (unavailable) {
    return (
      <div className="flex items-center gap-1.5 border-b px-3 py-1 text-xs text-muted-foreground">
        <Lock className="size-3 shrink-0" />
        <span>
          This channel has pinned messages sealed under a key epoch you never
          held — they cannot be opened here.
        </span>
      </div>
    );
  }
  if (pins.length === 0) return null;

  return (
    <div className="border-b">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
      >
        <Pin className="size-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {pins.length === 1 ? "1 pinned message" : `${pins.length} pinned`}
          {!open && pins[0] && (
            <span className="ml-2 opacity-70">
              {(pins[0].edited?.content ?? pins[0].content).slice(0, 120)}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t">
          {pins.map((pin) => (
            <PinRow key={pin.rumorId} pin={pin} />
          ))}
        </div>
      )}
    </div>
  );
}

function PinRow({ pin }: { pin: VerifiedPin }) {
  return (
    <div className="border-b px-3 py-1.5 last:border-b-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserName pubkey={pin.authorHex} className="text-xs" />
        <Timestamp timestamp={pin.createdAt} />
        {pin.edited && (
          <span
            className="rounded border border-dotted px-1 text-[10px]"
            title="A later edit by the same author, proven the same way as the pin itself."
          >
            edited
          </span>
        )}
      </div>
      <div className="mt-0.5 text-sm break-words">
        <RichText content={pin.edited?.content ?? pin.content} />
      </div>
    </div>
  );
}
