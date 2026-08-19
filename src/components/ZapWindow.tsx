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
 * The window is the shell; {@link ZapComposer} is the body. It also serves the
 * PRIVATE (CORD.md) zap of a message in a sealed conversation, which is the
 * same UI with the NIP-57 half switched off — see `zapTarget`.
 */

import { UserName } from "./nostr/UserName";
import { KindRenderer } from "./nostr/kinds";
import { ZapComposer } from "./zap/ZapComposer";
import { useNostrEvent } from "@/hooks/useNostrEvent";
import { useProfile } from "@/hooks/useProfile";
import { getSemanticAuthor } from "@/lib/semantic-author";
import { readZapTarget } from "@/lib/zap-targets";

import type { AddressPointer, EventPointer } from "@/lib/open-parser";

export interface ZapWindowProps {
  /** Recipient pubkey (who receives the zap) */
  recipientPubkey: string;
  /**
   * Handle for zapping a message in a SEALED conversation (CORD.md).
   *
   * Not the message id: window props are published inside spellbooks, and a
   * rumor id must never reach a relay. See `@/lib/zap-targets`. A handle that no
   * longer resolves — a reload, a restored spellbook — renders as an expired
   * target rather than a zap nobody can send.
   */
  zapTarget?: string;
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
  zapTarget,
}: ZapWindowProps) {
  // What the handle stands for, if it still stands for anything. Read once per
  // render rather than held in state: the registry is module-level and a stale
  // copy would keep a dead target alive on screen.
  const sealed = readZapTarget(zapTarget);
  const sealedExpired = Boolean(zapTarget) && !sealed;

  // Load event if we have a pointer - supports both EventPointer and AddressPointer
  const event = useNostrEvent(eventPointer || addressPointer);

  // Resolve recipient pubkey:
  // 1. Use provided pubkey if available
  // 2. Otherwise derive from event's semantic author (zapper, host, etc.)
  // 3. Fall back to addressPointer.pubkey for addressable events
  const recipientPubkey =
    sealed?.recipientPubkey ||
    initialRecipientPubkey ||
    (event ? getSemanticAuthor(event) : "") ||
    addressPointer?.pubkey ||
    "";

  const recipientProfile = useProfile(recipientPubkey);

  const recipientCard = (
    <div className="text-center space-y-2 py-4">
      <div className="text-2xl font-semibold">
        <UserName pubkey={recipientPubkey} />
      </div>
      {sealed ? (
        <div className="text-xs text-muted-foreground">
          Stays in this channel — nothing is published.
        </div>
      ) : (
        recipientProfile?.lud16 && (
          <div className="text-sm text-muted-foreground font-mono">
            {recipientProfile.lud16}
          </div>
        )
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          {sealedExpired ? (
            // The handle outlived what it named — a reload, or a spellbook
            // restored on another machine. There is nothing to zap, and there
            // is deliberately nothing in the props to recover it from.
            <div className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-md">
              This zap is no longer available. Zap the message again from the
              conversation.
            </div>
          ) : (
            <ZapComposer
              recipientPubkey={recipientPubkey}
              header={
                event && !sealed ? (
                  <KindRenderer event={event} />
                ) : (
                  recipientCard
                )
              }
              {...(sealed
                ? {
                    privateZap: {
                      onSettled: (payment) =>
                        sealed.adapter.sendZap!(
                          sealed.conversation,
                          sealed.messageId,
                          payment,
                        ),
                    },
                  }
                : {
                    publicContext: {
                      ...(eventPointer ? { eventPointer } : {}),
                      ...(addressPointer ? { addressPointer } : {}),
                      ...(customTags ? { customTags } : {}),
                      ...(propsRelays ? { relays: propsRelays } : {}),
                    },
                  })}
              {...(onClose ? { onDone: onClose } : {})}
            />
          )}
        </div>
      </div>
    </div>
  );
}
