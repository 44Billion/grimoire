import {
  Wifi,
  WifiOff,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Shield,
  XCircle,
  Settings,
} from "lucide-react";
import { useRelayState } from "@/hooks/useRelayState";
import type { RelayState } from "@/types/relay-state";
import { RelayLink } from "./nostr/RelayLink";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * CONN viewer - displays connection and auth status for all relays in the pool
 */
export default function ConnViewer() {
  const { relays } = useRelayState();

  const relayList = Object.values(relays);

  // Group by connection state
  const connectedRelays = relayList
    .filter((r) => r.connectionState === "connected")
    .sort((a, b) => a.url.localeCompare(b.url));

  const disconnectedRelays = relayList
    .filter((r) => r.connectionState !== "connected")
    .sort((a, b) => a.url.localeCompare(b.url));

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground">
      {/* Relay List */}
      <div className="flex-1 overflow-y-auto">
        {relayList.length === 0 && (
          <div className="text-center text-muted-foreground font-mono text-sm p-4">
            No relays in pool
          </div>
        )}

        {/* Connected */}
        {connectedRelays.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
              Connected ({connectedRelays.length})
            </div>
            {connectedRelays.map((relay) => (
              <RelayCard key={relay.url} relay={relay} />
            ))}
          </>
        )}

        {/* Disconnected */}
        {disconnectedRelays.length > 0 && (
          <>
            <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground">
              Disconnected ({disconnectedRelays.length})
            </div>
            {disconnectedRelays.map((relay) => (
              <RelayCard key={relay.url} relay={relay} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface RelayCardProps {
  relay: RelayState;
}

function RelayCard({ relay }: RelayCardProps) {
  const { setAuthPreference } = useRelayState();

  const connectionIcon = () => {
    const iconMap = {
      connected: {
        icon: <Wifi className="size-4 text-green-500" />,
        label: "Connected",
      },
      connecting: {
        icon: <Loader2 className="size-4 text-yellow-500 animate-spin" />,
        label: "Connecting",
      },
      disconnected: {
        icon: <WifiOff className="size-4 text-muted-foreground" />,
        label: "Disconnected",
      },
      error: {
        icon: <XCircle className="size-4 text-red-500" />,
        label: "Connection Error",
      },
    };
    return iconMap[relay.connectionState];
  };

  const authIcon = () => {
    const iconMap = {
      authenticated: {
        icon: <ShieldCheck className="size-4 text-green-500" />,
        label: "Authenticated",
      },
      challenge_received: {
        icon: <ShieldQuestion className="size-4 text-yellow-500" />,
        label: "Challenge Received",
      },
      authenticating: {
        icon: <Loader2 className="size-4 text-yellow-500 animate-spin" />,
        label: "Authenticating",
      },
      failed: {
        icon: <ShieldX className="size-4 text-red-500" />,
        label: "Authentication Failed",
      },
      rejected: {
        icon: <ShieldAlert className="size-4 text-muted-foreground" />,
        label: "Authentication Rejected",
      },
      none: {
        icon: <Shield className="size-4 text-muted-foreground" />,
        label: "No Authentication",
      },
    };
    return iconMap[relay.authStatus] || iconMap.none;
  };

  const connIcon = connectionIcon();
  const auth = authIcon();

  const currentPreference = relay.authPreference || "ask";

  return (
    <div className="border-b border-border">
      <div className="px-4 py-2 flex flex-col gap-2">
        {/* Main Row */}
        <div className="flex items-center gap-3 justify-between">
          <RelayLink
            url={relay.url}
            showInboxOutbox={false}
            className="line-clamp-1 hover:bg-transparent hover:underline hover:decoration-dotted"
            iconClassname="size-4"
            urlClassname="text-sm"
          />
          <div className="flex items-center gap-2">
            {relay.authStatus !== "none" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-help">{auth.icon}</div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{auth.label}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="cursor-help">{connIcon.icon}</div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{connIcon.label}</p>
              </TooltipContent>
            </Tooltip>

            {/* Auth Settings Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Settings className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <RelayLink
                    url={relay.url}
                    className="pointer-events-none"
                    iconClassname="size-4"
                    urlClassname="text-sm"
                  />
                </DropdownMenuLabel>
                <DropdownMenuLabel>
                  <div className="flex flex-row items-center gap-2">
                    <div className="cursor-help size-4">{connIcon.icon}</div>
                    <span className="text-sm">{connIcon.label}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  <div className="flex flex-row gap-2 items-center">
                    <ShieldQuestion className="size-4 text-muted-foreground" />
                    <span>Auth</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={currentPreference}
                  onValueChange={async (value) => {
                    await setAuthPreference(
                      relay.url,
                      value as "always" | "never" | "ask",
                    );
                  }}
                >
                  <DropdownMenuRadioItem value="ask">Ask</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="always">
                    Always
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="never">
                    Never
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
