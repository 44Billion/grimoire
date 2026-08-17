import { getTagValue } from "applesauce-core/helpers";
import type { NostrEvent } from "@/types/nostr";

/** What the default renderer should show for an event with no kind-specific renderer. */
export type EventFallbackDisplay =
  | { type: "content"; text: string }
  | { type: "alt"; text: string }
  | { type: "empty" };

/**
 * Pick the fallback body for a kind with no registered renderer.
 *
 * Tag-only kinds (themes, payment targets, profile tabs, …) publish an empty
 * content field and describe themselves in a NIP-31 `alt` tag, so prefer that
 * over rendering nothing.
 */
export function getEventFallbackDisplay(
  event: NostrEvent,
): EventFallbackDisplay {
  const content = event.content?.trim();
  if (content) return { type: "content", text: event.content };

  const alt = getTagValue(event, "alt")?.trim();
  if (alt) return { type: "alt", text: alt };

  return { type: "empty" };
}
