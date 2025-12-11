import { Circle, Inbox, Send } from "lucide-react";
import { useGrimoire } from "@/core/state";

export interface RelayLinkProps {
  url: string;
  read?: boolean;
  write?: boolean;
  connected?: boolean;
  className?: string;
}

/**
 * RelayLink - Clickable relay URL component
 * Displays relay URL with connection status indicator and read/write badges
 * Opens relay detail window on click
 */
export function RelayLink({
  url,
  read = false,
  write = false,
  connected = true,
  className,
}: RelayLinkProps) {
  const { addWindow } = useGrimoire();

  const handleClick = () => {
    addWindow("relay", { url }, `Relay ${url}`);
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 cursor-crosshair hover:bg-muted/50 ${className || ""}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1">
        <Circle
          className={`size-2 ${
            connected
              ? "fill-green-500 text-green-500"
              : "fill-muted-foreground text-muted-foreground"
          }`}
        />
        <span className="text-xs">{url}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {read && (
          <div title="Read (inbox)">
            <Inbox className="size-3 text-muted-foreground" />
          </div>
        )}
        {write && (
          <div title="Write (outbox)">
            <Send className="size-3 text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
