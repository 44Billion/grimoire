/**
 * What an agent is doing right now, in a word.
 *
 * A session head says where a run STANDS — `active`, `awaiting-input`, `done` —
 * which is the right thing to persist and the wrong thing to watch. `active` for
 * ninety seconds tells a reader nothing about whether the agent is thinking,
 * writing, or three minutes into a build. The deltas say that, and they are the
 * only thing that does.
 *
 * So the verb comes from the last fragment that arrived: `thinking` on reasoning,
 * `typing` on text, `running npm test` on a tool. It EXPIRES, because a stream
 * that went quiet must not leave a reader watching a word that stopped being true
 * — after that the head's own status is the honest answer again.
 */

import { useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import accountManager from "@/services/accounts";
import { ownDmReadRelays } from "@/lib/dm/relays";
import { hasDecryptConsent } from "@/services/dm-inbox";
import { subscribeDeltas } from "@/services/agent-delta-store";
import type { DeltaKind } from "@/lib/agent-session/types";

export interface AgentActivity {
  kind: DeltaKind;
  /** The tool's name, when the last fragment was a call. */
  tool?: string;
  /** Ready to render: "thinking", "typing", "running npm test". */
  verb: string;
}

/**
 * How long a fragment keeps speaking for the agent.
 *
 * The publisher coalesces deltas and flushes on a timer well under a second, so
 * six is generous — long enough that a slow tool does not flicker back to
 * `active`, short enough that a dead stream stops claiming to be alive.
 */
const STALE_MS = 6_000;

function verbFor(kind: DeltaKind, tool?: string): string {
  switch (kind) {
    case "reasoning":
      return "thinking";
    case "text":
      return "typing";
    case "tool":
      return tool ? `running ${tool}` : "running a tool";
    case "heartbeat":
      return "working";
    default:
      return "working";
  }
}

export function useAgentActivity(
  agent: string | undefined,
  session: string | undefined,
): AgentActivity | null {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  const key = agent && session ? `${agent}:${session}` : undefined;

  const [activity, setActivity] = useState<AgentActivity | null>(null);

  useEffect(() => {
    if (!pubkey || !signer?.nip44 || !key) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;

    const show = (
      buffers: Map<
        string,
        { activity?: { kind: DeltaKind; tool?: string; at: number } }
      >,
    ) => {
      const current = buffers.get(key)?.activity;
      if (!current || Date.now() - current.at > STALE_MS) {
        setActivity(null);
        return;
      }
      setActivity({
        kind: current.kind,
        tool: current.tool,
        verb: verbFor(current.kind, current.tool),
      });
      // Clear it when it goes stale, so a stream that stopped stops speaking.
      if (expiry) clearTimeout(expiry);
      expiry = setTimeout(
        () => setActivity(null),
        STALE_MS - (Date.now() - current.at),
      );
    };

    void (async () => {
      if (!(await hasDecryptConsent(pubkey))) return;
      const relays = await ownDmReadRelays(pubkey);
      if (cancelled || relays.length === 0) return;

      const watch = subscribeDeltas(pubkey, relays, signer, (delta) => {
        if (`${delta.session.agent}:${delta.session.session}` !== key) return;
        show(watch.buffers);
      });
      stop = watch.stop;
      if (!cancelled) show(watch.buffers);
    })();

    return () => {
      cancelled = true;
      if (expiry) clearTimeout(expiry);
      stop?.();
    };
  }, [pubkey, signer, key]);

  return activity;
}
