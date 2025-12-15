import { useMemo } from "react";
import { getTagValue } from "applesauce-core/helpers";
import { UserName } from "../UserName";
import { MarkdownContent } from "../MarkdownContent";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30817 - Community NIP
 * Displays full markdown content with NIP-specific metadata
 */
export function CommunityNIPDetailRenderer({ event }: { event: NostrEvent }) {
  const title = useMemo(
    () => getTagValue(event, "title") || "Untitled NIP",
    [event],
  );

  // Get canonical URL from "r" tag to resolve relative URLs
  const canonicalUrl = useMemo(() => {
    return getTagValue(event, "r");
  }, [event]);

  // Format created date
  const createdDate = new Date(event.created_at * 1000).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      {/* NIP Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        {/* Title */}
        <h1 className="text-3xl font-bold">{title}</h1>

        {/* Metadata */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Proposed by</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{createdDate}</time>
        </div>
      </header>

      {/* NIP Content - Markdown */}
      <MarkdownContent content={event.content} canonicalUrl={canonicalUrl} />
    </div>
  );
}
