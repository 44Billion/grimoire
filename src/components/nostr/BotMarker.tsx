import { Bot } from "lucide-react";
import { useProfile } from "@/hooks/useProfile";
import { isAutomatedProfile } from "@/lib/nostr-utils";
import { cn } from "@/lib/utils";

interface BotMarkerProps {
  /** Undefined renders nothing — convenient where the subject is conditional. */
  pubkey?: string;
  className?: string;
}

/**
 * "This account is automation", from NIP-24's `bot` on its own kind 0.
 *
 * A quiet icon rather than a badge: the account is saying it is automated,
 * which is not a thing being vouched for. Renders nothing for everyone else,
 * including profiles that have not loaded — absence of the flag is not evidence
 * of a human, and marking someone a bot on a guess is worse than saying nothing.
 *
 * `UserName` covers every place a name is drawn; this exists for the places
 * that draw a subject without one, like a conversation heading.
 */
export function BotMarker({ pubkey, className }: BotMarkerProps) {
  const profile = useProfile(pubkey);
  if (!isAutomatedProfile(profile)) return null;

  return (
    <Bot
      aria-label="Automated account"
      className={cn(
        "inline-block w-[0.85em] h-[0.85em] shrink-0 text-muted-foreground",
        className,
      )}
    />
  );
}
