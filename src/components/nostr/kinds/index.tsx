import type { BaseEventProps } from "./BaseEventRenderer";
import { Kind0Renderer } from "./Kind0Renderer";
import { Kind1Renderer } from "./Kind1Renderer";
import { Kind6Renderer } from "./Kind6Renderer";
import { Kind7Renderer } from "./Kind7Renderer";
import { Kind9735Renderer } from "./Kind9735Renderer";
import { Kind9802Renderer } from "./Kind9802Renderer";
import { Kind30023Renderer } from "./Kind30023Renderer";
import { NostrEvent } from "@/types/nostr";
import { BaseEventContainer } from "./BaseEventRenderer";

/**
 * Registry of kind-specific renderers
 * Add custom renderers here for specific event kinds
 */
const kindRenderers: Record<number, React.ComponentType<BaseEventProps>> = {
  0: Kind0Renderer, // Profile Metadata
  1: Kind1Renderer, // Short Text Note
  6: Kind6Renderer, // Repost
  7: Kind7Renderer, // Reaction
  1111: Kind1Renderer, // Post
  9735: Kind9735Renderer, // Zap Receipt
  9802: Kind9802Renderer, // Highlight
  30023: Kind30023Renderer, // Long-form Article
};

/**
 * Default renderer for kinds without custom implementations
 * Shows basic event info with raw content
 */
function DefaultKindRenderer({ event, showTimestamp }: BaseEventProps) {
  return (
    <BaseEventContainer event={event} showTimestamp={showTimestamp}>
      <div className="text-sm text-muted-foreground">
        <div className="text-xs mb-1">Kind {event.kind} event</div>
        <pre className="text-xs overflow-x-auto whitespace-pre-wrap break-words">
          {event.content || "(empty content)"}
        </pre>
      </div>
    </BaseEventContainer>
  );
}

/**
 * Main KindRenderer component
 * Automatically selects the appropriate renderer based on event kind
 */
export function KindRenderer({
  event,
  showTimestamp = false,
}: {
  event: NostrEvent;
  showTimestamp?: boolean;
}) {
  const Renderer = kindRenderers[event.kind] || DefaultKindRenderer;
  return <Renderer event={event} showTimestamp={showTimestamp} />;
}

/**
 * Export individual renderers and base components for reuse
 */
export {
  BaseEventContainer,
  EventAuthor,
  EventMenu,
} from "./BaseEventRenderer";
export type { BaseEventProps } from "./BaseEventRenderer";
export { Kind1Renderer } from "./Kind1Renderer";
export { Kind6Renderer } from "./Kind6Renderer";
export { Kind7Renderer } from "./Kind7Renderer";
export { Kind9735Renderer } from "./Kind9735Renderer";
