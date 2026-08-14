import { parseEmojiSegments, type EmojiTag } from "@/lib/emoji-helpers";
import { cn } from "@/lib/utils";

interface EmojiTextProps {
  text: string;
  /** NIP-30 emoji tags from the event the text came from */
  emojis?: EmojiTag[];
  className?: string;
}

/**
 * Renders text with NIP-30 custom emoji substituted inline. Images are em-sized
 * so they track whatever font size the caller renders at.
 *
 * Plain `<img>` on purpose: this is used inside clickable elements, so no
 * tooltip trigger (a button) may be nested here — use `CustomEmoji` elsewhere.
 */
export function EmojiText({ text, emojis, className }: EmojiTextProps) {
  const segments = parseEmojiSegments(text, emojis);

  if (segments.every((segment) => segment.type === "text")) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          segment.value
        ) : (
          <img
            key={`${segment.shortcode}-${i}`}
            src={segment.url}
            alt={`:${segment.shortcode}:`}
            title={`:${segment.shortcode}:`}
            loading="lazy"
            className={cn(
              "inline-block h-[1em] w-auto object-contain align-[-0.125em]",
              className,
            )}
          />
        ),
      )}
    </>
  );
}
