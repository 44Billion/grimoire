import { PenLineIcon, SendIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { NostrEvent } from "nostr-tools";

import { EventErrorBoundary } from "@/components/EventErrorBoundary";
import { KindBadge } from "@/components/KindBadge";
import { Button } from "@/components/ui/button";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { KindRenderer } from "@/components/nostr/kinds";
import { publishDraft } from "@/actions/publish-draft";
import { useAccount } from "@/hooks/useAccount";
import type { EventDraft } from "@/lib/ai-draft";

/**
 * An event Hex drafted, as something the user signs.
 *
 * Shown as the event it would be — through the same kind renderer the feed uses,
 * so what is previewed is what will appear once it is published. The model wrote
 * the content; the signature and the publish are a press of the button and
 * nothing else, which the button says by existing. Once published the card
 * becomes the published event, so "did that work" is answered by the event.
 */
export function DraftEvent({ draft }: { draft: EventDraft }) {
  const { canSign, pubkey } = useAccount();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string; relays: number }>();
  const [error, setError] = useState<string>();

  // Stamped once, on mount: a `created_at` recomputed each render would restart
  // every relative timestamp the renderer draws, and reading the clock in a
  // render body is impure. The real one is stamped when the event is signed.
  const [draftedAt] = useState(() => Math.floor(Date.now() / 1000));

  const preview = useMemo<NostrEvent>(
    () => ({
      id: "",
      sig: "",
      pubkey: pubkey ?? "",
      created_at: draftedAt,
      kind: draft.kind,
      tags: draft.tags,
      content: draft.content,
    }),
    [draft, draftedAt, pubkey],
  );

  const publish = async () => {
    setError(undefined);
    setPublishing(true);
    try {
      const result = await publishDraft(draft);
      setPublished({ id: result.event.id, relays: result.relays.length });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPublishing(false);
    }
  };

  if (published) {
    return (
      <div className="my-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <SendIcon className="size-3 shrink-0" />
          <span>Published to {published.relays} relays</span>
        </div>
        <EmbeddedEvent
          className="overflow-hidden rounded border border-border"
          eventPointer={{ id: published.id }}
        />
      </div>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded border border-dashed border-border">
      <div className="flex items-center gap-2 border-b border-dashed border-border px-3 py-1.5">
        <PenLineIcon className="size-3 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Draft</span>
        <KindBadge className="text-xs" kind={draft.kind} variant="compact" />
        {/* The action is the point of the card, so it leads on the right rather
            than trailing a paragraph explaining itself. */}
        <Button
          className="ml-auto h-7"
          disabled={!canSign || publishing}
          onClick={() => void publish()}
          size="sm"
          title={
            canSign
              ? "Sign this with your key and publish it to your write relays"
              : "This account cannot sign"
          }
          type="button"
        >
          <SendIcon className="size-3" />
          {publishing ? "Publishing…" : "Sign & publish"}
        </Button>
      </div>

      {/* The event as grimoire renders one. A draft is wrapped like a feed row,
          because an unsigned event has no id and a renderer that reaches for one
          must not take the reply down with it. */}
      <EventErrorBoundary event={preview}>
        <KindRenderer event={preview} />
      </EventErrorBoundary>

      {error && (
        <p className="border-t border-dashed border-border px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
