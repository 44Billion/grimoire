/**
 * A session's turn as it is being written.
 *
 * The durable half of a transcript arrives through the DM ingest and is read out
 * of Dexie; this is the other half, and it is deliberately not stored anywhere.
 * A delta is worth something for a few seconds — everything it carried is
 * repeated in the turn that closes it — so this holds the fragments in memory,
 * hands the viewer a snapshot, and forgets them when the turn lands.
 *
 * The subscription is shared across every window watching the same account, and
 * the last one out closes it.
 */

import { useEffect, useMemo, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import accountManager from "@/services/accounts";
import { ownDmReadRelays } from "@/lib/dm/relays";
import { hasDecryptConsent } from "@/services/dm-inbox";
import { subscribeDeltas } from "@/services/agent-delta-store";
import type { BufferedPart } from "@/lib/agent-session/buffer";

export interface LiveTurn {
  /** Which turn is being written. 0 when nothing is. */
  turn: number;
  parts: BufferedPart[];
  /** A fragment was dropped, so the preview has a hole the reader is told about. */
  incomplete: boolean;
}

const NOTHING: LiveTurn = { turn: 0, parts: [], incomplete: false };

/**
 * Watch one session's live progress.
 *
 * `settled` is the highest turn number already on disk: the buffer is cleared up
 * to it, because from the moment a `1777` arrives the stored turn is the better
 * copy and showing both means showing the same words twice.
 */
export function useAgentDeltas(
  agent: string | undefined,
  session: string | undefined,
  settled = 0,
): LiveTurn {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;

  const key = agent && session ? `${agent}:${session}` : undefined;
  const [live, setLive] = useState<LiveTurn>(NOTHING);

  useEffect(() => {
    if (!pubkey || !signer?.nip44 || !key) return;
    let cancelled = false;
    let stop: (() => void) | undefined;

    void (async () => {
      // The same consent the inbox asks for: this drives the signer once per
      // arriving wrap, which is exactly what the prompt is about.
      if (!(await hasDecryptConsent(pubkey))) return;
      const relays = await ownDmReadRelays(pubkey);
      if (cancelled || relays.length === 0) return;

      const watch = subscribeDeltas(pubkey, relays, signer, (delta) => {
        if (`${delta.session.agent}:${delta.session.session}` !== key) return;
        const buffer = watch.buffers.get(key);
        if (!buffer) return;
        setLive({
          turn: buffer.turn,
          parts: buffer.current,
          incomplete: buffer.incomplete,
        });
      });
      stop = watch.stop;

      // Paint whatever arrived before this window opened.
      const existing = watch.buffers.get(key);
      if (existing && existing.turn > 0 && !cancelled)
        setLive({
          turn: existing.turn,
          parts: existing.current,
          incomplete: existing.incomplete,
        });
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [pubkey, signer, key]);

  // Nothing to show once the stored turn has arrived. Computed rather than
  // cleared in an effect: the durable turn landing is a render's worth of new
  // information, not an event to react to.
  return useMemo(() => (live.turn > settled ? live : NOTHING), [live, settled]);
}
