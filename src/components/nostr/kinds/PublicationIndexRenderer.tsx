import { Library } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import { Label } from "@/components/ui/label";
import {
  getPublicationAuthors,
  getPublicationEntries,
  getPublicationHashtags,
  getPublicationMeta,
  getPublicationType,
} from "@/lib/nkbip01-helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * Feed renderer for Kind 30040 - Publication Index (NKBIP-01)
 * The content field is empty by spec, so everything here comes from tags.
 */
export function PublicationIndexRenderer({ event }: BaseEventProps) {
  const title =
    getTagValue(event, "title") ||
    getTagValue(event, "d") ||
    "Untitled publication";
  const authors = getPublicationAuthors(event);
  const entries = getPublicationEntries(event);
  const hashtags = getPublicationHashtags(event);
  const { version, summary } = getPublicationMeta(event);
  const type = getPublicationType(event);

  const shownAuthors = authors.slice(0, 2);
  const remainingAuthors = authors.length - shownAuthors.length;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-2">
        <ClickableEventTitle
          event={event}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <Library className="size-4 shrink-0 text-muted-foreground" />
          <span>{title}</span>
        </ClickableEventTitle>

        {authors.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {shownAuthors
              .map((a) => (a.role ? `${a.name} (${a.role})` : a.name))
              .join(", ")}
            {remainingAuthors > 0 && ` +${remainingAuthors} more`}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Label>{type}</Label>
          {version && <Label>{version}</Label>}
          {entries.length > 0 ? (
            <Label>
              {entries.length} {entries.length === 1 ? "section" : "sections"}
            </Label>
          ) : (
            <Label>stub index</Label>
          )}
        </div>

        {entries.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            No sections listed yet
          </div>
        )}

        {summary && (
          <p dir="auto" className="text-sm text-muted-foreground line-clamp-2">
            {summary}
          </p>
        )}

        {hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {hashtags.map((tag) => (
              <Label key={tag}>#{tag}</Label>
            ))}
          </div>
        )}
      </div>
    </BaseEventContainer>
  );
}
