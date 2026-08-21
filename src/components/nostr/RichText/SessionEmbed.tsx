import { useEffect, useState } from "react";
import type { NostrEvent } from "nostr-tools";
import type { AddressPointer } from "nostr-tools/nip19";

import { useAccount } from "@/hooks/useAccount";
import { readSessionHeadRumor, onAgentEvents } from "@/services/agent-store";
import { AgentSessionHeadRenderer } from "@/components/nostr/kinds/AgentSessionRenderers";
import type { Rumor } from "@/lib/agent-session/types";
import { EventEmbed } from "./EventEmbed";

/**
 * A session pointer, resolved locally before it is resolved on the network.
 *
 * An agent posts the `naddr` of its own run into the room it is working in, and
 * that address names a replaceable event — so the reflex is to hand it to the
 * relay loader. For most sessions that is right. For the two kinds that matter
 * here it is not: a run carried on a Concord channel is sealed under the
 * channel key, and a run wrapped to its operator is inside a gift wrap. Neither
 * is on a relay in any shape a filter can ask for, so the pointer rendered a
 * loading skeleton forever while the run itself sat in a store one pane away.
 *
 * Local first, then the network. The fallback is the ordinary case — a session
 * an agent published in the open — and it gives up nothing: a REQ for one
 * replaceable event names a kind, a pubkey and a session id, and says nothing
 * about which community anybody is in.
 */
export function SessionEmbed({
  pointer,
  depth,
}: {
  pointer: AddressPointer;
  depth?: number;
}) {
  const account = useAccount();
  const viewer = account?.pubkey;
  const [local, setLocal] = useState<Rumor | null | undefined>(undefined);

  useEffect(() => {
    if (!viewer) {
      setLocal(null);
      return;
    }
    let live = true;
    const read = async () => {
      const found = await readSessionHeadRumor(
        viewer,
        pointer.pubkey,
        pointer.identifier,
      ).catch(() => null);
      if (live) setLocal(found);
    };
    void read();
    // A head is republished as the run moves; without the doorbell the embed
    // would keep showing whatever state it happened to be in when it mounted.
    const off = onAgentEvents(() => void read());
    return () => {
      live = false;
      off();
    };
  }, [viewer, pointer.pubkey, pointer.identifier]);

  // Undefined is "not looked yet", and going to the network in that moment
  // would fetch for every session that was about to resolve locally.
  if (local === undefined) return null;
  if (local) return <AgentSessionHeadRenderer event={local as NostrEvent} />;
  return <EventEmbed node={{ pointer }} depth={depth} />;
}
