/**
 * The message that started a run, whatever kind of message it was.
 *
 * A session's head names the event that caused it, and until now nothing showed
 * it: a reader looking at a transcript could see what the agent did and not
 * what it was answering. The link runs that way round on purpose — the SESSION
 * points at the message rather than the answer at the session — so this is the
 * one place the pointer is followed forwards.
 *
 * Two kinds of message, and both have to work. A run started by a private
 * message points at a RUMOR: it was never published as an event, so no relay
 * has it and only this browser's own DM store does. A run started in a group
 * points at an ordinary public event, which grimoire fetches and renders the
 * way it renders every other event. Trying only the second showed a permanent
 * skeleton for every DM-started run, which is most of them; trying only the
 * first showed nothing for a group.
 *
 * Renders NOTHING when a run has no trigger — one started over the control
 * plane names the control event, and a `hex eve` run following a session by id
 * has no trigger at all.
 */

import { useLiveQuery } from "dexie-react-hooks";

import db from "@/services/db";
import { useAccount } from "@/hooks/useAccount";
import { EmbeddedEvent } from "@/components/nostr/EmbeddedEvent";
import { RichText } from "@/components/nostr/RichText";
import { UserName } from "@/components/nostr/UserName";
import Timestamp from "@/components/Timestamp";

export function SessionTrigger({
  trigger,
}: {
  trigger?: { id: string; relay?: string };
}) {
  const { pubkey } = useAccount();

  /**
   * `useLiveQuery` rather than an effect that sets state.
   *
   * Same answer, and it re-reads on its own when the row arrives — a run whose
   * trigger is still being decrypted by the DM pipeline fills in rather than
   * staying blank until something else re-renders. `undefined` while the read
   * is in flight is the hook's own signal, which is exactly the third state
   * this needs.
   */
  const rumor = useLiveQuery(async () => {
    if (!trigger?.id || !pubkey) return null;
    const row = await db.dmRumors.get(trigger.id);
    // Somebody else's decrypted copy is not ours to render.
    return row && row.viewer === pubkey ? row : null;
  }, [trigger?.id, pubkey]);

  if (!trigger?.id) return null;
  // Undefined means the local lookup has not answered yet. Rendering the public
  // fallback first would flash a skeleton for every private message.
  if (rumor === undefined) return null;

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Started by
      </h3>
      {rumor ? (
        <div className="flex flex-col gap-1 rounded border border-dotted border-border p-2">
          <div className="flex items-center gap-1.5 text-xs">
            <UserName pubkey={rumor.pubkey} />
            <Timestamp timestamp={rumor.created_at} />
          </div>
          {/* Never raw: a message names people and events, and those are what
              the reader is here to recognise. */}
          <RichText content={rumor.content} className="text-sm" />
        </div>
      ) : (
        <EmbeddedEvent
          eventPointer={{
            id: trigger.id,
            relays: trigger.relay ? [trigger.relay] : undefined,
          }}
          className="overflow-hidden rounded border border-border"
          loadingFallback={
            <p className="rounded border border-dotted border-border p-2 text-xs text-muted-foreground">
              A message this browser does not hold. It was private, or it is on
              a relay you do not read.
            </p>
          }
        />
      )}
    </section>
  );
}
