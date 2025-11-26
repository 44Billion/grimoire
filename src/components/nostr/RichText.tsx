import type { NostrEvent } from "@/types/nostr";
import { useRenderedContent } from "applesauce-react/hooks";
import { cn } from "@/lib/utils";
import { Text } from "./RichText/Text";
import { Hashtag } from "./RichText/Hashtag";
import { Mention } from "./RichText/Mention";
import { Link } from "./RichText/Link";
import { Emoji } from "./RichText/Emoji";
import { Gallery } from "./RichText/Gallery";

interface RichTextProps {
  event?: NostrEvent;
  content?: string;
  className?: string;
}

// Content node component types for rendering
const contentComponents = {
  text: Text,
  hashtag: Hashtag,
  mention: Mention,
  link: Link,
  emoji: Emoji,
  gallery: Gallery,
};

/**
 * RichText component that renders Nostr event content with rich formatting
 * Supports mentions, hashtags, links, emojis, and galleries
 * Can also render plain text without requiring a full event
 */
export function RichText({ event, content, className = "" }: RichTextProps) {
  // If plain content is provided, just render it
  if (content && !event) {
    return (
      <span
        className={cn(
          "whitespace-pre-line leading-tight break-words",
          className,
        )}
      >
        {content.trim()}
      </span>
    );
  }

  // Render event content with rich formatting
  if (event) {
    const trimmedEvent = {
      ...event,
      content: event.content.trim(),
    };
    const renderedContent = useRenderedContent(trimmedEvent, contentComponents);
    return (
      <span
        className={cn(
          "whitespace-pre-line leading-tight break-words",
          className,
        )}
      >
        {renderedContent}
      </span>
    );
  }

  return null;
}
