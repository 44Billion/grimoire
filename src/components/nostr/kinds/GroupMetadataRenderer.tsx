import type { NostrEvent } from "@/types/nostr";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";
import { useAddWindow } from "@/core/state";
import { MessageSquare, Phone } from "lucide-react";
import { Label } from "@/components/ui/label";
import { groupSupportedKinds, groupSupportsAv } from "@/lib/nip29/livekit";

interface GroupMetadataRendererProps {
  event: NostrEvent;
}

/**
 * Renderer for NIP-29 Group Metadata events (kind 39000)
 * Displays group info and links to chat
 */
export function GroupMetadataRenderer({ event }: GroupMetadataRendererProps) {
  const addWindow = useAddWindow();

  // Extract group metadata
  const groupId = getTagValue(event, "d") || "";
  const name = getTagValue(event, "name") || groupId;
  const about = getTagValue(event, "about");

  // Get relay URL from where we saw this event
  const seenRelaysSet = getSeenRelays(event);
  const relayUrl = seenRelaysSet?.values().next().value;

  const handleOpenChat = () => {
    if (!relayUrl) return;

    addWindow("chat", {
      protocol: "nip-29",
      identifier: {
        type: "group",
        value: groupId,
        relays: [relayUrl],
      },
    });
  };

  const canOpenChat = !!relayUrl && !!groupId;

  // What the group says it is. `supported_kinds` absent means every kind;
  // present and empty means none, which is an AV-only space.
  const hasSpace = groupSupportsAv(event);
  const supportedKinds = groupSupportedKinds(event);
  const avOnly = hasSpace && supportedKinds?.length === 0;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1">
        <ClickableEventTitle event={event} className="font-semibold">
          {name}
        </ClickableEventTitle>

        {about && (
          <p className="text-xs text-muted-foreground line-clamp-2">{about}</p>
        )}

        {(hasSpace || supportedKinds) && (
          <div className="flex flex-wrap items-center gap-1">
            {hasSpace && (
              <Label className="inline-flex items-center gap-1">
                <Phone className="size-2.5 shrink-0" />
                {avOnly ? "audio/video only" : "audio/video"}
              </Label>
            )}
            {supportedKinds && supportedKinds.length > 0 && (
              <Label>kinds {supportedKinds.join(", ")}</Label>
            )}
          </div>
        )}

        {canOpenChat && !avOnly && (
          <button
            onClick={handleOpenChat}
            className="text-xs text-primary hover:underline flex items-center gap-1 w-fit mt-1"
          >
            <MessageSquare className="size-3" />
            Open Chat
          </button>
        )}
      </div>
    </BaseEventContainer>
  );
}
