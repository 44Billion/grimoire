import { useState } from "react";
import { EventPointer, AddressPointer } from "nostr-tools/nip19";
import { Plus, Minus } from "lucide-react";
import { EmbeddedEvent } from "../EmbeddedEvent";

interface EventEmbedNodeProps {
  node: {
    pointer: EventPointer | AddressPointer;
  };
}

function isEventPointer(
  pointer: EventPointer | AddressPointer,
): pointer is EventPointer {
  return "id" in pointer;
}

export function EventEmbed({ node }: EventEmbedNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { pointer } = node;

  // Determine the type label and short identifier
  const isEvent = isEventPointer(pointer);
  const label = isEvent ? "nevent" : "naddr";
  const identifier = isEvent
    ? pointer.id.slice(0, 8)
    : pointer.identifier || pointer.pubkey.slice(0, 8);

  return (
    <div className="flex flex-col w-full">
      <button onClick={() => setIsExpanded(!isExpanded)}>
        <div
          className="flex flex-row items-center gap-1 w-full
            text-muted-foreground hover:text-foreground
            cursor-crosshair"
        >
          {isExpanded ? (
            <Minus className="h-3 w-3" />
          ) : (
            <Plus className="h-3 w-3" />
          )}
          <span className="">
            [{label}: {identifier}...]
          </span>
        </div>
      </button>

      {isExpanded && (
        <EmbeddedEvent
          eventId={"id" in pointer ? pointer.id : undefined}
          addressPointer={
            "kind" in pointer && "pubkey" in pointer ? pointer : undefined
          }
        />
      )}
    </div>
  );
}
