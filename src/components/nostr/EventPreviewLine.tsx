/**
 * One line about an event: who, a zap amount if it is one, and what it says.
 *
 * The author and content come from the semantic helpers, so a zap receipt
 * reads as the zapper and their comment rather than the LNURL provider and an
 * empty body. Meant to be placed inside a flex row the caller styles.
 */

import type { ReactNode } from "react";
import type { NostrEvent } from "@/types/nostr";
import {
  getSemanticAuthor,
  getSemanticContentEvent,
  getZapSats,
} from "@/lib/semantic-author";
import { getEventDisplayTitle } from "@/lib/event-title";
import { UserName } from "./UserName";
import { RichText } from "./RichText";
import { ZapAmountInline } from "./ZapAmountInline";

export function EventPreviewLine({
  event,
  icon,
  nameClassName = "font-medium flex-shrink-0",
  contentClassName = "",
  useTitle = false,
}: {
  event: NostrEvent;
  /** Leading icon, e.g. a kind badge or a reply arrow. */
  icon?: ReactNode;
  nameClassName?: string;
  contentClassName?: string;
  /** Show a structured title (article, repo, …) instead of the body when the event has one. */
  useTitle?: boolean;
}) {
  const content = getSemanticContentEvent(event);
  const sats = getZapSats(event);
  const title = useTitle ? getEventDisplayTitle(content, false) : undefined;
  const hasStructuredTitle = title !== undefined && title !== content.content;
  return (
    <>
      {icon}
      <UserName pubkey={getSemanticAuthor(event)} className={nameClassName} />
      {sats !== undefined && <ZapAmountInline sats={sats} />}
      {hasStructuredTitle ? (
        <span className={`truncate min-w-0 ${contentClassName}`}>{title}</span>
      ) : (
        <div
          className={`line-clamp-1 overflow-hidden flex-1 min-w-0 ${contentClassName}`}
        >
          <RichText
            className="truncate line-clamp-1 whitespace-normal [&_img]:size-3.5"
            event={content}
            options={{ showMedia: false, showEventEmbeds: false }}
          />
        </div>
      )}
    </>
  );
}
