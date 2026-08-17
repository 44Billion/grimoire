/**
 * A channel's pins (CORD-04 §7): a count in the header, the list below it.
 *
 * A pin does not quote its message, it PROVES one — the entry carries the
 * original seal plus that message's own 76-byte NIP-44 key expansion, so a
 * member holding none of the chat history can still verify author, words,
 * channel and signed timestamp for themselves.
 *
 * Two states that look alike are kept apart: a channel with no pins shows
 * nothing at all, while a list sealed under a key epoch this member never held
 * shows as unavailable. §7 hangs a write refusal on that distinction, and an
 * empty view is the one thing it must not look like.
 */

import { Lock, Pin } from "lucide-react";

import { RichText } from "@/components/nostr/RichText";
import Timestamp from "@/components/Timestamp";
import { UserName } from "@/components/nostr/UserName";
import type { VerifiedPin } from "@/lib/concord/pins";
import { cn } from "@/lib/utils";
import type { NostrEvent } from "@/types/nostr";

/** The header control: a pin and a count, or a padlock when it cannot open. */
export function PinsHeaderButton({
  count,
  unavailable,
  open,
  onToggle,
}: {
  count: number;
  unavailable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (unavailable) {
    return (
      <span
        className="flex items-center gap-0.5 text-muted-foreground"
        title="This channel has pinned messages sealed under a key epoch you never held — they cannot be opened here."
      >
        <Lock className="size-3.5" />
      </span>
    );
  }
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={count === 1 ? "1 pinned message" : `${count} pinned messages`}
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted",
        open && "bg-muted",
      )}
    >
      <Pin className="size-3.5" />
      {count}
    </button>
  );
}

/**
 * The list, rendered under the header rather than inside the timeline: a pin
 * reaches members who hold none of the history it came from, so it has no
 * position in the conversation to sit at.
 */
export function ConcordPinsList({
  pins,
  onOpen,
}: {
  pins: VerifiedPin[];
  onOpen: (rumorId: string) => void;
}) {
  if (pins.length === 0) return null;
  return (
    <div className="max-h-56 overflow-y-auto border-b bg-muted/20">
      {pins.map((pin) => (
        <PinRow key={pin.rumorId} pin={pin} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PinRow({
  pin,
  onOpen,
}: {
  pin: VerifiedPin;
  onOpen: (rumorId: string) => void;
}) {
  // A pseudo-event so the renderer can resolve what the rumor itself carries:
  // NIP-30 custom emoji live in its tags, and a pin that renders `:shortcode:`
  // as text shows something its author never wrote.
  const asEvent = {
    id: pin.rumorId,
    pubkey: pin.authorHex,
    created_at: pin.edited?.createdAt ?? pin.createdAt,
    kind: pin.kind,
    tags: pin.tags,
    content: pin.edited?.content ?? pin.content,
    sig: "",
  } as NostrEvent;

  return (
    <button
      type="button"
      onClick={() => onOpen(pin.rumorId)}
      className="block w-full cursor-crosshair border-b px-3 py-1.5 text-left last:border-b-0 hover:bg-muted/50"
      title="Jump to this message"
    >
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
        <RichText
          event={asEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
    </button>
  );
}
