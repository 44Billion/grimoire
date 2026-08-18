/**
 * ZapWindow Component
 *
 * UI for sending Lightning zaps to Nostr users and events (NIP-57)
 *
 * Features:
 * - Send zaps to profiles or events
 * - Preset and custom amounts
 * - Remembers most-used amounts
 * - NWC wallet payment or QR code fallback
 * - Shows feed render of zapped event
 *
 * The window is the shell; {@link ZapComposer} is the shared body — the same one
 * the private (CORD.md) zap dialog mounts, so both surfaces run one payment
 * pipeline instead of two drifting copies.
 */

import { UserName } from "./nostr/UserName";
import { KindRenderer } from "./nostr/kinds";
import { ZapComposer } from "./zap/ZapComposer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useProfile } from "@/hooks/useProfile";
import { getSemanticAuthor } from "@/lib/semantic-author";

import type { AddressPointer, EventPointer } from "@/lib/open-parser";

export interface ZapWindowProps {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /** Optional event being zapped (adds e-tag for context) */
  eventPointer?: EventPointer;
  /** Optional addressable event context (adds a-tag, e.g., live activity) */
  addressPointer?: AddressPointer;
  /** Callback to close the window */
  onClose?: () => void;
  /**
   * Custom tags to include in the zap request
   * Used for protocol-specific tagging like NIP-53 live activity references
   */
  customTags?: string[][];
  /** Relays where the zap receipt should be published */
  relays?: string[];
}

export function ZapWindow({
  recipientPubkey: initialRecipientPubkey,
  eventPointer,
  addressPointer,
  onClose,
  customTags,
  relays: propsRelays,
}: ZapWindowProps) {
  // Load event if we have a pointer - supports both EventPointer and AddressPointer
  const event = useNostrEvent(eventPointer || addressPointer);

  // Resolve recipient pubkey:
  // 1. Use provided pubkey if available
  // 2. Otherwise derive from event's semantic author (zapper, host, etc.)
  // 3. Fall back to addressPointer.pubkey for addressable events
  const recipientPubkey =
    initialRecipientPubkey ||
    (event ? getSemanticAuthor(event) : "") ||
    addressPointer?.pubkey ||
    "";

  const recipientProfile = useProfile(recipientPubkey);

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          <ZapComposer
            recipientPubkey={recipientPubkey}
            header={
              event ? (
                <KindRenderer event={event} />
              ) : (
                <div className="text-center space-y-2 py-4">
                  <div className="text-2xl font-semibold">
                    <UserName pubkey={recipientPubkey} />
                  </div>
                  {recipientProfile?.lud16 && (
                    <div className="text-sm text-muted-foreground font-mono">
                      {recipientProfile.lud16}
                    </div>
                  )}
                </div>
              )
            }
            publicContext={{
              ...(eventPointer ? { eventPointer } : {}),
              ...(addressPointer ? { addressPointer } : {}),
              ...(customTags ? { customTags } : {}),
              ...(propsRelays ? { relays: propsRelays } : {}),
            }}
            {...(onClose ? { onDone: onClose } : {})}
          />
        </div>
      </div>
    </div>
  );
}
