import { useState } from "react";
import { useProfile } from "@/hooks/useProfile";
import { UserName } from "./nostr/UserName";
import Nip05 from "./nostr/nip05";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
  Circle,
  Inbox,
  Send,
} from "lucide-react";
import { kinds, nip19 } from "nostr-tools";
import { useEventStore, useObservableMemo } from "applesauce-react/hooks";
import { getInboxes, getOutboxes } from "applesauce-core/helpers/mailboxes";
import { useCopy } from "../hooks/useCopy";
import { RichText } from "./nostr/RichText";

export interface ProfileViewerProps {
  pubkey: string;
}

/**
 * ProfileViewer - Detailed view for a user profile
 * Shows profile metadata, inbox/outbox relays, and raw JSON
 */
export function ProfileViewer({ pubkey }: ProfileViewerProps) {
  const profile = useProfile(pubkey);
  const eventStore = useEventStore();
  const [showInboxes, setShowInboxes] = useState(false);
  const [showOutboxes, setShowOutboxes] = useState(false);

  // Get mailbox relays (kind 10002)
  const mailboxEvent = useObservableMemo(
    () => eventStore.replaceable(kinds.RelayList, pubkey, ""),
    [eventStore, pubkey],
  );
  const inboxRelays =
    mailboxEvent && mailboxEvent.tags ? getInboxes(mailboxEvent) : [];
  const outboxRelays =
    mailboxEvent && mailboxEvent.tags ? getOutboxes(mailboxEvent) : [];

  // Get profile metadata event (kind 0)
  const profileEvent = useObservableMemo(
    () => eventStore.replaceable(0, pubkey, ""),
    [eventStore, pubkey],
  );

  const { copy, copied } = useCopy();

  // Combine all relays (inbox + outbox) for nprofile
  const allRelays = [...new Set([...inboxRelays, ...outboxRelays])];

  // Generate npub or nprofile depending on relay availability
  const identifier =
    allRelays.length > 0
      ? nip19.nprofileEncode({
          pubkey,
          relays: allRelays,
        })
      : nip19.npubEncode(pubkey);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header - Single Line */}
      <div className="border-b border-border px-4 py-2 font-mono text-xs flex items-center justify-between gap-3">
        {/* Left: npub/nprofile */}
        <button
          onClick={() => copy(identifier)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors truncate min-w-0"
          title={identifier}
        >
          {copied ? (
            <Check className="size-3 flex-shrink-0 text-green-500" />
          ) : (
            <Copy className="size-3 flex-shrink-0" />
          )}
          <code className="truncate">
            {identifier.slice(0, 16)}...{identifier.slice(-8)}
          </code>
        </button>

        {/* Right: Profile icon and Relay counts */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground">
            <UserIcon className="size-3" />
            <span>Profile</span>
          </div>

          {allRelays.length > 0 && (
            <>
              {inboxRelays.length > 0 && (
                <button
                  onClick={() => setShowInboxes(!showInboxes)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Inbox relays"
                >
                  {showInboxes ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  <Inbox className="size-3" />
                  <span>{inboxRelays.length}</span>
                </button>
              )}

              {outboxRelays.length > 0 && (
                <button
                  onClick={() => setShowOutboxes(!showOutboxes)}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Outbox relays"
                >
                  {showOutboxes ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  <Send className="size-3" />
                  <span>{outboxRelays.length}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Expandable Inbox Relays */}
      {showInboxes && inboxRelays.length > 0 && (
        <div className="border-b border-border px-4 py-2 bg-muted">
          <div className="text-xs text-muted-foreground mb-2 font-semibold">
            Inbox Relays
          </div>
          <div className="flex flex-col gap-2">
            {inboxRelays.map((relay) => (
              <div key={relay} className="flex items-center gap-2">
                <Circle className="size-2 fill-blue-500 text-blue-500" />
                <span className="text-xs font-mono text-muted-foreground">
                  {relay}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable Outbox Relays */}
      {showOutboxes && outboxRelays.length > 0 && (
        <div className="border-b border-border px-4 py-2 bg-muted">
          <div className="text-xs text-muted-foreground mb-2 font-semibold">
            Outbox Relays
          </div>
          <div className="flex flex-col gap-2">
            {outboxRelays.map((relay) => (
              <div key={relay} className="flex items-center gap-2">
                <Circle className="size-2 fill-green-500 text-green-500" />
                <span className="text-xs font-mono text-muted-foreground">
                  {relay}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {!profile && !profileEvent && (
          <div className="text-center text-muted-foreground text-sm">
            Loading profile...
          </div>
        )}

        {!profile && profileEvent && (
          <div className="text-center text-muted-foreground text-sm">
            No profile metadata found
          </div>
        )}

        {profile && (
          <div className="flex flex-col gap-4 max-w-2xl">
            <div className="flex flex-col gap-0">
              {/* Display Name */}
              <UserName
                pubkey={pubkey}
                className="text-2xl font-bold pointer-events-none"
              />
              {/* NIP-05 */}
              {profile.nip05 && (
                <div className="text-xs text-muted-foreground">
                  <Nip05 pubkey={pubkey} profile={profile} />
                </div>
              )}
            </div>

            {/* About/Bio */}
            {profile.about && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  About
                </div>
                <RichText
                  className="text-sm whitespace-pre-wrap break-words"
                  content={profile.about}
                />
              </div>
            )}

            {/* Website */}
            {profile.website && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Website
                </div>
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent underline decoration-dotted"
                >
                  {profile.website}
                </a>
              </div>
            )}

            {/* Lightning Address */}
            {profile.lud16 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Lightning Address
                </div>
                <code className="text-sm font-mono">{profile.lud16}</code>
              </div>
            )}

            {/* LUD06 (LNURL) */}
            {profile.lud06 && (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  LNURL
                </div>
                <code className="text-sm font-mono break-all">
                  {profile.lud06}
                </code>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
