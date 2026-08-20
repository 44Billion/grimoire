/**
 * An intent, rendered as itself — half-strength, and gone the moment a fact
 * replaces it.
 *
 * The same idea `LiveTurnBody` renders for the agent's side: a preview that
 * says plainly it is provisional, so a reader never mistakes it for history.
 * Here it is the operator's own words, sent but not yet answered for by
 * anything the agent has published back.
 */

import { UserName } from "@/components/nostr/UserName";
import { RichText } from "@/components/nostr/RichText";
import Timestamp from "@/components/Timestamp";
import type { SessionIntent } from "@/services/agent-intents";

/** The same pulsing dot `LiveTurnBody` uses for "happening now", muted rather
 * than `success`-green — this is a guess about what landed, not a report of
 * work in progress. */
export function Sending() {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-muted-foreground opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground" />
    </span>
  );
}

/** What to say for an intent with no text of its own — `cancel` carries none. */
function summarize(intent: SessionIntent): string | undefined {
  if (intent.command === "cancel") return "stopping this run";
  return intent.text ?? intent.option;
}

export function PendingIntentBody({
  intent,
  viewer,
}: {
  intent: SessionIntent;
  /** Whoever is sending — the operator, on this browser. */
  viewer: string;
}) {
  const text = summarize(intent);

  return (
    <div className="flex w-full max-w-[85%] flex-col items-start gap-1 opacity-50">
      <div className="flex w-full items-center gap-1.5">
        <UserName pubkey={viewer} />
        <span className="text-[11px] text-muted-foreground">
          <Timestamp timestamp={Math.floor(intent.createdAt / 1000)} />
        </span>
        <Sending />
      </div>
      {text && <RichText content={text} className="text-sm" />}
    </div>
  );
}
