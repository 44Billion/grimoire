/**
 * NIP-29 `kind:39004` — who the relay says is live in a group's AV space.
 *
 * A relay-signed snapshot with no content, so the tags are the whole event: the
 * `d` is the group, and each `participant` is a member currently in the room.
 * Rendered as members rather than as pubkeys, because that is the only reason
 * anyone would open one.
 */

import { Phone } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { getSeenRelays } from "applesauce-core/helpers/relays";

import { UserName } from "@/components/nostr/UserName";
import { parseParticipants } from "@/lib/nip29/livekit";
import type { NostrEvent } from "@/types/nostr";
import { BaseEventContainer, ClickableEventTitle } from "./BaseEventRenderer";

export function GroupParticipantsRenderer({ event }: { event: NostrEvent }) {
  const groupId = getTagValue(event, "d") || "";
  const participants = parseParticipants(event);
  // The relay this arrived from is the only one whose word about this group id
  // means anything, so it is also the only sensible source of relay hints.
  const relayHints = [...(getSeenRelays(event) ?? [])];

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-1">
        <ClickableEventTitle event={event} className="font-semibold">
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            {groupId}
          </span>
        </ClickableEventTitle>

        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is in the room.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {participants.map((pubkey) => (
              <li key={pubkey}>
                <UserName pubkey={pubkey} relayHints={relayHints} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </BaseEventContainer>
  );
}
