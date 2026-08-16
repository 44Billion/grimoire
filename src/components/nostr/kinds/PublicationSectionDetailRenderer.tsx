import { Copy, CopyCheck } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { toast } from "sonner";
import { UserName } from "../UserName";
import { AsciiDocContent } from "../AsciiDocContent";
import { KindBadge } from "@/components/KindBadge";
import { NIPBadge } from "@/components/NIPBadge";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/useCopy";
import { formatTimestamp } from "@/hooks/useLocale";
import {
  getPublicationNormalizedTitle,
  PUBLICATION_SECTION_KIND,
} from "@/lib/nkbip01-helpers";
import type { NostrEvent } from "@/types/nostr";

/**
 * Detail renderer for Kind 30041 - Publication Content (NKBIP-01)
 * Renders the section's AsciiDoc body with its title and author.
 */
export function PublicationSectionDetailRenderer({
  event,
}: {
  event: NostrEvent;
}) {
  const title =
    getTagValue(event, "title") ||
    getTagValue(event, "d") ||
    "Untitled section";
  const normalizedTitle = getPublicationNormalizedTitle(event);

  const { copy, copied } = useCopy();
  const handleCopy = () => {
    copy(event.content);
    toast.success("Section source copied to clipboard");
  };

  return (
    <div dir="auto" className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <header className="flex flex-col gap-4 border-b border-border pb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold">{title}</h1>
          {event.content.trim() && (
            <Button
              variant="link"
              size="icon"
              onClick={handleCopy}
              title="Copy section source"
              aria-label="Copy section source"
            >
              {copied ? <CopyCheck /> : <Copy />}
            </Button>
          )}
        </div>

        {normalizedTitle && normalizedTitle !== title && (
          <div className="text-xs font-mono text-muted-foreground">
            {normalizedTitle}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={PUBLICATION_SECTION_KIND} variant="full" clickable />
          <NIPBadge nipNumber="NKBIP-01" showNIPPrefix={false} />
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>By</span>
            <UserName pubkey={event.pubkey} className="font-semibold" />
          </div>
          <span>•</span>
          <time>{formatTimestamp(event.created_at, "long")}</time>
        </div>
      </header>

      {event.content.trim() ? (
        <AsciiDocContent content={event.content} authorPubkey={event.pubkey} />
      ) : (
        <div className="text-sm text-muted-foreground italic">
          This section has no content.
        </div>
      )}
    </div>
  );
}
