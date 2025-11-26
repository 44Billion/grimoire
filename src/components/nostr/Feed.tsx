import { useTimeline } from "@/hooks/useTimeline";
import { kinds } from "nostr-tools";
import { NostrEvent } from "@/types/nostr";
import { KindRenderer } from "./kinds";

interface FeedEventProps {
  event: NostrEvent;
}

/**
 * FeedEvent - Renders a single event using the appropriate kind renderer
 */
export function FeedEvent({ event }: FeedEventProps) {
  return <KindRenderer event={event} />;
}

/**
 * Feed - Main feed component displaying timeline of events
 */
export default function Feed({ className }: { className?: string }) {
  const relays = ["wss://theforest.nostr1.com"];
  const { events } = useTimeline(
    "feed-forest",
    {
      kinds: [kinds.ShortTextNote],
    },
    relays,
    {
      limit: 200,
    },
  );

  return (
    <div className={className}>
      {events.map((e) => (
        <FeedEvent key={e.id} event={e} />
      ))}
    </div>
  );
}
