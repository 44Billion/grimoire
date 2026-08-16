import { FileText } from "lucide-react";
import { getTagValue } from "applesauce-core/helpers";
import {
  BaseEventProps,
  BaseEventContainer,
  ClickableEventTitle,
} from "./BaseEventRenderer";

/**
 * Feed renderer for Kind 30041 - Publication Content (NKBIP-01)
 * Title only — a section body is long-form and reads as noise in a feed.
 */
export function PublicationSectionRenderer({ event }: BaseEventProps) {
  const title =
    getTagValue(event, "title") ||
    getTagValue(event, "d") ||
    "Untitled section";

  return (
    <BaseEventContainer event={event}>
      <ClickableEventTitle
        event={event}
        className="flex items-center gap-1.5 text-sm font-medium"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span>{title}</span>
      </ClickableEventTitle>
    </BaseEventContainer>
  );
}
