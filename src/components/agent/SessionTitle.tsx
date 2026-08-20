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
 *
 * One line, ellipsis, always. An agent titles a run from the first thing it was
 * asked, and what a person asks can be a paragraph — which wrapped to four
 * lines and pushed every row below it down the list. Truncation lives here
 * rather than at the call sites because every call site wants it and one of
 * them will forget.
 */

import { RichText } from "@/components/nostr/RichText";
import { cn } from "@/lib/utils";

/**
 * `min-w-0` earns its place: a truncating child of a flex row will not shrink
 * below its content without it, so the ellipsis never appears and the row grows
 * instead. And `whitespace-nowrap` is spelled out beside `truncate`, which
 * already implies it: `RichText`'s root sets `whitespace-pre-wrap`, and the two
 * survived side by side — the class merge does not treat the composite
 * `truncate` as conflicting with it, so stylesheet order decided and pre-wrap
 * won. Naming the property directly is what makes the merge collapse them.
 */
const ONE_LINE = "block min-w-0 truncate whitespace-nowrap";

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
      <span className={cn(ONE_LINE, "text-muted-foreground", className)}>
        {fallback}
      </span>
    );

  return (
    /**
     * The classes go on `RichText` itself, not on a wrapper.
     *
     * Its root div carries `whitespace-pre-wrap` — right for a note, wrong for
     * a title — and `cn` puts the caller's classes last, so `truncate` beats it
     * only from here. A wrapping span outside it loses that fight and the title
     * still ran to three lines.
     */
    <RichText
      content={text}
      options={INLINE}
      className={cn(ONE_LINE, "[&_p]:m-0 [&_p]:inline", className)}
    />
  );
}
