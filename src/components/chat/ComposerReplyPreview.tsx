/**
 * Who the composer is about to reply to.
 *
 * Its own file because there are two composers now — the channel's and the
 * thread's — and both need it.
 */

import { memo, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import eventStore from "@/services/event-store";
import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";
import { UserName } from "@/components/nostr/UserName";
import { RichText } from "@/components/nostr/RichText";

export const ComposerReplyPreview = memo(function ComposerReplyPreview({
  replyToId,
  adapter,
  conversation,
  onClear,
}: {
  replyToId: string;
  adapter: ChatProtocolAdapter;
  conversation: Conversation;
  onClear: () => void;
}) {
  const fromStore = use$(() => eventStore.event(replyToId), [replyToId]);
  /**
   * The adapter's own answer, for protocols whose messages never reach the
   * shared EventStore — the same two-source resolution `ReplyPreview` already
   * does for the in-timeline banner.
   *
   * Concord is the case, and it is not an edge one: its messages are decrypted
   * rumors of a private community, deliberately kept out of the store shared
   * with every other window. Reading only the store meant the composer could
   * never name what it was replying to and fell back to a raw rumor id — while
   * the timeline right above it rendered the same parent correctly.
   */
  const [fromAdapter, setFromAdapter] = useState<NostrEvent | null>(null);
  const replyEvent = fromStore ?? fromAdapter ?? undefined;

  useEffect(() => {
    if (fromStore || fromAdapter) return;
    let cancelled = false;
    adapter
      .loadReplyMessage(conversation, { id: replyToId })
      .then((event) => {
        if (!cancelled && event) setFromAdapter(event);
      })
      .catch((error: unknown) => {
        console.warn("[Chat] could not resolve the reply parent:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [fromStore, fromAdapter, adapter, conversation, replyToId]);

  if (!replyEvent) {
    return (
      <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
        <span className="flex-1 min-w-0 truncate">
          Replying to {replyToId.slice(0, 8)}...
        </span>
        <button
          onClick={onClear}
          className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs mb-1.5 overflow-hidden">
      <span className="flex-shrink-0">↳</span>
      <UserName
        pubkey={replyEvent.pubkey}
        className="font-medium flex-shrink-0"
      />
      <div className="flex-1 min-w-0 line-clamp-1 overflow-hidden text-muted-foreground">
        <RichText
          event={replyEvent}
          options={{ showMedia: false, showEventEmbeds: false }}
        />
      </div>
      <button
        onClick={onClear}
        className="ml-auto text-muted-foreground hover:text-foreground flex-shrink-0"
      >
        ✕
      </button>
    </div>
  );
});
