import {
  CheckIcon,
  Loader2,
  PenLineIcon,
  SendIcon,
  Server,
  ServerOff,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NostrEvent } from "nostr-tools";

import { KindBadge } from "@/components/KindBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { RelayLink } from "@/components/nostr/RelayLink";
import { RichText } from "@/components/nostr/RichText";
import { UserName } from "@/components/nostr/UserName";
import { Label } from "@/components/ui/label";
import { draftRelays, publishDraft } from "@/actions/publish-draft";
import { useAccount } from "@/hooks/useAccount";
import { useRelayState } from "@/hooks/useRelayState";
import { getAuthIcon } from "@/lib/relay-status-utils";
import pool from "@/services/relay-pool";
import { use$ } from "applesauce-react/hooks";
import type { EventDraft } from "@/lib/ai-draft";
import type { RelayPublishStatus } from "@/services/publish-service";

/**
 * An event Hex drafted, as something the user signs.
 *
 * Shown as the event it would be — through the same kind renderer the feed uses,
 * so what is previewed is what will appear once it is published. The model wrote
 * the content; the signature and the publish are a press of the button and
 * nothing else, which the button says by existing.
 *
 * The relays are listed and untickable, as in the post composer: where an event
 * goes is the user's decision, and a publish that half works is the normal case,
 * so each relay reports for itself.
 */
export function DraftEvent({ draft }: { draft: EventDraft }) {
  const { canSign, pubkey } = useAccount();
  // Connection and auth state, as the post composer shows them: which relays are
  // actually reachable is the part that decides whether a publish lands.
  const relayPool = use$(pool.relays$);
  const { getRelay } = useRelayState();
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ id: string; relays: number }>();
  const [error, setError] = useState<string>();
  const [relays, setRelays] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<
    Record<string, { status: RelayPublishStatus; error?: string }>
  >({});

  // Where it would go, resolved once: the same outbox selection the publish
  // itself would make, so the list is what will actually be used.
  useEffect(() => {
    let live = true;
    void draftRelays().then((urls) => {
      if (!live) return;
      setRelays(urls);
      setSelected(new Set(urls));
    });
    return () => {
      live = false;
    };
  }, [pubkey]);

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
    setStatus({});
    setPublishing(true);
    try {
      const result = await publishDraft(draft, {
        relays: [...selected],
        onStatus: (relay, relayStatus, relayError) =>
          setStatus((previous) => ({
            ...previous,
            [relay]: {
              status: relayStatus,
              ...(relayError ? { error: relayError } : {}),
            },
          })),
      });
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
          disabled={!canSign || publishing || selected.size === 0}
          onClick={() => void publish()}
          size="sm"
          title={
            canSign
              ? "Sign this with your key and publish it to the selected relays"
              : "This account cannot sign"
          }
          type="button"
        >
          <SendIcon className="size-3" />
          {publishing ? "Publishing…" : "Sign & publish"}
        </Button>
      </div>

      {/* The body as it will render once published — mentions, hashtags, emoji
          and media all resolved. Not the full kind renderer: its header carries a
          timestamp and a context menu, and an unsigned event has neither a time
          nor an id to act on. */}
      <div className="space-y-1 px-3 py-2">
        {pubkey && <UserName className="font-medium" pubkey={pubkey} />}
        <RichText className="text-sm" content={draft.content} event={preview} />
        {draft.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {draft.tags.map((tag, index) => (
              <Label key={`${tag[0]}-${index}`} size="sm">
                {tag.join(" ")}
              </Label>
            ))}
          </div>
        )}
      </div>

      {relays.length > 0 && (
        <div className="border-t border-dashed border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Relays ({selected.size} of {relays.length})
          </span>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {relays.map((url) => {
              const state = status[url];
              const connected = relayPool?.get(url)?.connected ?? false;
              const auth = getAuthIcon(getRelay(url));
              return (
                <div className="flex items-center gap-2" key={url}>
                  <Checkbox
                    checked={selected.has(url)}
                    disabled={publishing}
                    id={`draft-${url}`}
                    onCheckedChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        if (next.has(url)) next.delete(url);
                        else next.add(url);
                        return next;
                      })
                    }
                  />
                  {connected ? (
                    <span className="shrink-0" title="Connected">
                      <Server className="size-3 text-green-500" />
                    </span>
                  ) : (
                    <ServerOff className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="shrink-0" title={auth.label}>
                    {auth.icon}
                  </span>
                  <RelayLink className="min-w-0 flex-1 text-xs" url={url} />
                  {state?.status === "publishing" && (
                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  )}
                  {state?.status === "success" && (
                    <CheckIcon className="size-3 shrink-0 text-green-500" />
                  )}
                  {state?.status === "error" && (
                    <span
                      className="shrink-0"
                      title={state.error ?? "Failed to publish"}
                    >
                      <XIcon className="size-3 text-red-500" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p className="border-t border-dashed border-border px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
