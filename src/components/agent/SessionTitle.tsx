/**
 * A run's title, with the entities in it resolved.
 *
 * An agent titles a run from the first thing it was asked, and what a person
 * asks about is very often a person or an event: "summarise
 * nostr:nevent1qqs…", "what has nostr:npub1… been posting". Rendered raw, those
 * are sixty characters of base32 in a row that has room for about forty, so the
 * only part a reader can see is the part that says nothing.
 *
 * `RichText` with the embeds turned OFF, which is the whole reason this is a
 * component and not a call site: a title lives in a one-line row and in a pane
 * heading, and an embedded note card in either would be a card where a line
 * should be. What survives is the inline half — a name for a pubkey, a short
 * label for an event — which is exactly the half that was missing.
 */

import { RichText } from "@/components/nostr/RichText";
import { cn } from "@/lib/utils";

/** No cards, no images, no players. One line of resolved text. */
const INLINE = {
  showMedia: false,
  showImages: false,
  showVideos: false,
  showAudio: false,
  showEventEmbeds: false,
};

export function SessionTitle({
  title,
  className,
  /** What to say when the agent has not named the run yet. */
  fallback = "a run with no name yet",
}: {
  title?: string;
  className?: string;
  fallback?: string;
}) {
  const text = title?.trim();
  if (!text)
    return (
      <span className={cn("text-muted-foreground", className)}>{fallback}</span>
    );

  return (
    <RichText
      content={text}
      options={INLINE}
      // `inline-*` so it sits in a row rather than opening a block, and the
      // truncation belongs to the caller's column, not to this.
      className={cn("[&_p]:inline [&_p]:m-0", className)}
    />
  );
}
