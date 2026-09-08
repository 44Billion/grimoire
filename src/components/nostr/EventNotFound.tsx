import { SearchX } from "lucide-react";
import type { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { cn } from "@/lib/utils";

interface EventNotFoundProps {
  /** The pointer that came back empty, for the identifier shown */
  eventPointer?: EventPointer;
  addressPointer?: AddressPointer;
  /** Click to open it in a window anyway — a relay may hold it later */
  onOpen?: (id: string | AddressPointer) => void;
  className?: string;
}

/**
 * Stands in for an event no relay returned.
 *
 * Every embed used to render a skeleton for as long as its event was missing,
 * which for an event that simply is not on any reachable relay is forever —
 * indistinguishable from a slow load. This says so, and stays clickable so the
 * reader can open it in its own window and try again there.
 */
export function EventNotFound({
  eventPointer,
  addressPointer,
  onOpen,
  className,
}: EventNotFoundProps) {
  const identifier = eventPointer
    ? eventPointer.id.slice(0, 8)
    : addressPointer
      ? addressPointer.identifier || String(addressPointer.kind)
      : "";

  const body = (
    <>
      <SearchX className="size-3 flex-shrink-0" />
      <span>not found</span>
      {identifier && (
        <span className="font-mono opacity-60 truncate">{identifier}</span>
      )}
    </>
  );

  const shared = cn(
    "inline-flex items-center gap-1.5 px-1.5 py-0.5 text-xs",
    "border border-dotted border-muted text-muted-foreground",
    className,
  );

  if (!onOpen || (!eventPointer && !addressPointer)) {
    return <span className={shared}>{body}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen(eventPointer?.id ?? addressPointer!);
      }}
      className={cn(shared, "hover:text-foreground hover:border-foreground/40")}
    >
      {body}
    </button>
  );
}
