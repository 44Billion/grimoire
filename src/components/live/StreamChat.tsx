import { useMemo } from "react";
import { useLiveTimeline } from "@/hooks/useLiveTimeline";
import type { NostrEvent } from "@/types/nostr";
import { kinds } from "nostr-tools";
import { UserName } from "../nostr/UserName";
import { RichText } from "../nostr/RichText";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { getZapAmount, getZapSender } from "applesauce-core/helpers";

interface StreamChatProps {
  streamEvent: NostrEvent;
  streamRelays: string[];
  hostRelays: string[];
  className?: string;
}

// isConsecutive removed

const isSameDay = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
};

export function StreamChat({
  streamEvent,
  streamRelays,
  hostRelays,
  className,
}: StreamChatProps) {
  // const [message, setMessage] = useState("");

  // Combine stream relays + host relays
  const allRelays = useMemo(
    () => Array.from(new Set([...streamRelays, ...hostRelays])),
    [streamRelays, hostRelays],
  );

  // Fetch chat messages (kind 1311) and zaps (kind 9735) that a-tag this stream
  const timelineFilter = useMemo(
    () => ({
      kinds: [1311, 9735],
      "#a": [
        `${streamEvent.kind}:${streamEvent.pubkey}:${streamEvent.tags.find((t) => t[0] === "d")?.[1] || ""}`,
      ],
      limit: 100,
    }),
    [streamEvent],
  );

  const { events: allMessages } = useLiveTimeline(
    `stream-feed-${streamEvent.id}`,
    timelineFilter,
    allRelays,
    { stream: true },
  );

  /*
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement sending chat message
    console.log("Send message:", message);
    setMessage("");
  };
  */

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Chat messages area */}
      <div className="flex-1 flex flex-col-reverse gap-0.5 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
        {allMessages.map((event, index) => {
          const currentDate = new Date(event.created_at * 1000);
          const prevEvent = allMessages[index + 1];
          // If prevEvent exists, compare days. If different, we need a separator AFTER this message (visually before/above it)
          // Actually, in flex-col-reverse:
          // [Newest Message] (index 0)
          // <Day Label Today>
          // [Old Message] (index 1)

          // Wait, logic is simpler:
          // Loop through events. Determine if Date Header is needed between this event and the next one (older one).

          const prevDate = prevEvent
            ? new Date(prevEvent.created_at * 1000)
            : null;
          const showDateHeader = !prevDate || !isSameDay(currentDate, prevDate);

          return (
            <div key={event.id} className="flex flex-col-reverse">
              {event.kind === kinds.Zap ? (
                <ZapMessage event={event} />
              ) : (
                <ChatMessage event={event} />
              )}
              {showDateHeader && (
                <div className="flex justify-center py-2 pointer-events-none">
                  <span className="text-[10px] font-light text-muted-foreground">
                    {currentDate.toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chat input - Commented out for now */}
      {/* <form
        onSubmit={handleSubmit}
        className="flex gap-0 border-t border-border bg-background"
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send message..."
          className="flex-1 px-2 py-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50 h-8"
        />
        <Button
          type="submit"
          disabled={!message.trim()}
          variant="default"
          size="sm"
          aria-label="Send message"
          className="h-8 rounded-none px-3"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form> */}
    </div>
  );
}

function ChatMessage({ event }: { event: NostrEvent }) {
  return (
    <RichText
      className="text-xs leading-tight text-foreground/90"
      event={event}
      options={{ showMedia: false, showEventEmbeds: false }}
    >
      <UserName
        pubkey={event.pubkey}
        className="font-bold leading-tight flex-shrink-0 mr-1.5 text-accent"
      />
    </RichText>
  );
}

function ZapMessage({ event }: { event: NostrEvent }) {
  const amount = getZapAmount(event);
  const zapper = getZapSender(event);

  if (!amount || !zapper) return null;

  return (
    <RichText
      className="text-xs"
      event={event}
      options={{ showMedia: false, showEventEmbeds: false }}
    >
      <div className="flex flex-row justify-between items-center">
        <UserName pubkey={zapper} className="font-bold text-xs truncate" />
        <span className="text-xs font-bold text-yellow-500 inline-flex items-center gap-1">
          <Zap className="w-3 h-3 fill-yellow-500" />
          <span className="text-sm">
            {(amount / 1000).toLocaleString("en", {
              notation: "compact",
            })}
          </span>
        </span>
      </div>
    </RichText>
  );
}
