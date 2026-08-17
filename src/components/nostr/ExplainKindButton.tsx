import { Sparkles } from "lucide-react";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";

import { Button } from "@/components/ui/button";
import { useAddWindow } from "@/core/state";
import { isInferenceAvailable } from "@/services/inference";

/**
 * Offer to explain an event grimoire has no renderer for.
 *
 * A click, never a render: an automatic call here would spend the user's
 * credits once per unknown event scrolled past. Hidden entirely when no
 * injector is installed, so it never advertises something that cannot happen.
 */
export function ExplainKindButton({ event }: { event: NostrEvent }) {
  const addWindow = useAddWindow();

  if (!isInferenceAvailable()) return null;

  const open = () => {
    // Kind metadata lets the context builder describe the event without
    // fetching it again.
    const bech32 = nip19.neventEncode({
      id: event.id,
      kind: event.kind,
      author: event.pubkey,
    });
    addWindow(
      "ai",
      {
        target: { type: "event", value: bech32 },
        prompt: `What is this kind ${event.kind} event, and what is it for?`,
      },
      `ai ${bech32.slice(0, 16)}`,
      `EXPLAIN KIND ${event.kind}`,
    );
  };

  return (
    <Button
      className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
      onClick={open}
      size="sm"
      title={`Ask a model what kind ${event.kind} is`}
      type="button"
      variant="ghost"
    >
      <Sparkles className="size-3" />
      Explain
    </Button>
  );
}
