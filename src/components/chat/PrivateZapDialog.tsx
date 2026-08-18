/**
 * Zapping a message in a sealed conversation (CORD.md §"Private Zaps").
 *
 * A dialog rather than a `zap` window, deliberately: window props are persisted
 * to localStorage and serialized into published spellbooks (kind 30777), and the
 * id this zap names is a RUMOR id that exists on no relay. Putting it in window
 * props would leak the one thing the gift wrap around the conversation exists to
 * hide.
 *
 * The body is the shared {@link ZapComposer} in private mode: the invoice is
 * fetched with no NIP-57 zap request, the comment never reaches the provider, and
 * the settled payment's preimage is sealed into the channel by `adapter.sendZap`.
 */

import { Zap } from "lucide-react";

import { UserName } from "@/components/nostr/UserName";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ZapComposer } from "@/components/zap/ZapComposer";

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";

export interface PrivateZapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The message being zapped. Its author receives the sats. */
  message: { id: string; pubkey: string };
  conversation: Conversation;
  adapter: ChatProtocolAdapter;
}

export function PrivateZapDialog({
  open,
  onOpenChange,
  message,
  conversation,
  adapter,
}: PrivateZapDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md space-y-3">
        <DialogTitle className="flex items-center gap-2">
          <Zap className="size-4 text-yellow-500" />
          Zap <UserName pubkey={message.pubkey} />
        </DialogTitle>
        <ZapComposer
          recipientPubkey={message.pubkey}
          header={
            <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3">
              This zap stays inside the conversation: no receipt is published,
              and no relay, indexer or wallet service learns who zapped what.
              Members verify the payment themselves from its preimage.
            </p>
          }
          privateZap={{
            onSettled: (payment) =>
              adapter.sendZap!(conversation, message.id, payment),
          }}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
