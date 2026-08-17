/**
 * The invites waiting for this key (CORD-05 §6).
 *
 * Pull, never push: an invite is a giftwrap sitting on a relay, and reading the
 * inbox is the only way to learn of one. Refetched on demand rather than on a
 * timer — nothing about an invite is urgent, and each one costs the signer a
 * NIP-44 round-trip to unwrap.
 */

import { useCallback, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";

import accountManager from "@/services/accounts";
import {
  readDirectInvites,
  type PendingInvite,
} from "@/services/concord-invites";

export interface ConcordInvitesResult {
  invites: PendingInvite[];
  loading: boolean;
  error?: string;
  refresh: () => void;
}

export function useConcordInvites(enabled = true): ConcordInvitesResult {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !pubkey || !signer) return;
    let cancelled = false;
    void (async () => {
      // Inside the async body, not the effect's: a render-time setState is what
      // the React Compiler rules forbid, and the spinner is a consequence of
      // the fetch rather than of mounting.
      setLoading(true);
      try {
        const found = await readDirectInvites(pubkey, signer);
        if (cancelled) return;
        setInvites(found);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, pubkey, signer, nonce]);

  return { invites, loading, ...(error ? { error } : {}), refresh };
}
