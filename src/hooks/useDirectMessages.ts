/**
 * React access to this account's private messages.
 *
 * Reads the local mirror and re-reads when `dm-bus` rings — never a relay, and
 * never a decryption. The status is what the UI branches on, and the four
 * unhappy ones are all first-class rather than variations of "empty": an
 * account that cannot decrypt, one that has not agreed to, and one that is
 * only watching are three different things to say.
 *
 * Keyed by viewer pubkey rather than reset in an effect, like `useConcord` —
 * so there is no window where one account's correspondents show under another's.
 */

import { useCallback, useEffect, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import { DM_LIST_SCOPE, onDmScope } from "@/services/dm-bus";
import {
  grantDecryptConsent,
  hasDecryptConsent,
  syncDmInbox,
} from "@/services/dm-inbox";
import { listDmConversations } from "@/services/dm-store";
import { readDmLastRead } from "@/services/dm-reads";
import type { DmConversationRow } from "@/services/db";

export type DirectMessagesStatus =
  /** Still working out which of the below applies. */
  | "loading"
  /** No account, or a read-only one: nothing to decrypt with. */
  | "readonly"
  /** A signer that cannot do NIP-44. Private messages are unreadable to it. */
  | "no-nip44"
  /** Able, but the reader has not asked for their inbox to be opened yet. */
  | "needs-consent"
  | "ready";

export interface DmConversationSummary extends DmConversationRow {
  /** The other side, or the first stranger in a group. */
  peer: string;
  /**
   * A conversation with nobody but yourself.
   *
   * NIP-17 makes this fall out for free — a message p-tagged to your own key
   * is wrapped to you and nobody else — and in practice people use it as a
   * notepad rather than as a conversation. It is pinned above the list and
   * named for what it is, because sorting your own scratchpad by recency puts
   * it wherever it happens to land.
   */
  isSelf: boolean;
  /** How far the reader has got, in unix seconds. 0 means never opened. */
  lastRead: number;
  /** Something has arrived here since they last looked. */
  unread: boolean;
}

export interface DirectMessagesResult {
  conversations: DmConversationSummary[];
  status: DirectMessagesStatus;
  /** Open the inbox. Permanent for this account. */
  grantConsent: () => Promise<void>;
  refresh: () => void;
}

export function useDirectMessages(
  /**
   * `false` keeps the hook inert — no store read, no inbox sync.
   *
   * ChatViewer is protocol-agnostic and must call this unconditionally to obey
   * the rules of hooks, but a NIP-29 window has no business pulling a gift-wrap
   * inbox.
   */
  { enabled = true }: { enabled?: boolean } = {},
): DirectMessagesResult {
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;

  const [loaded, setLoaded] = useState<{
    pubkey: string;
    conversations: DmConversationSummary[];
    status: DirectMessagesStatus;
  }>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const grantConsent = useCallback(async () => {
    if (!pubkey) return;
    await grantDecryptConsent(pubkey);
    refresh();
  }, [pubkey, refresh]);

  useEffect(() => {
    if (!enabled || !pubkey) {
      setLoaded(undefined);
      return;
    }

    let cancelled = false;

    const read = async (status: DirectMessagesStatus) => {
      const rows = await listDmConversations(pubkey);
      const conversations = await Promise.all(
        rows.map(async (row) => {
          const lastRead = await readDmLastRead(pubkey, row.conversationId);
          const peer =
            row.participants.find((p) => p !== pubkey) ?? row.participants[0];
          return {
            ...row,
            peer,
            isSelf: peer === pubkey,
            lastRead,
            // Your own notes are never unread to you.
            unread: peer !== pubkey && row.lastAt > lastRead,
          };
        }),
      );
      // Saved messages first, then by recency. The store already sorted by
      // `lastAt`, so this only lifts the one row out.
      conversations.sort((a, b) => Number(b.isSelf) - Number(a.isSelf));

      if (!cancelled) setLoaded({ pubkey, conversations, status });
    };

    void (async () => {
      // The signer comes off the live account: a remote signer's `nip44` can
      // arrive seconds after the account does.
      if (!signer) return read("readonly");
      if (!signer.nip44) return read("no-nip44");
      if (!(await hasDecryptConsent(pubkey))) return read("needs-consent");

      // Paint what is already on disk before touching a relay.
      await read("ready");
      try {
        await syncDmInbox(pubkey, signer);
      } catch (error) {
        console.warn("[dm] could not sync the inbox:", error);
      }
      if (!cancelled) await read("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, pubkey, signer, nonce]);

  // A message landing anywhere changes this list's contents or its order.
  useEffect(
    () => (enabled ? onDmScope(DM_LIST_SCOPE, refresh) : undefined),
    [enabled, refresh],
  );

  // Keyed by viewer rather than reset in an effect: a stale account's
  // correspondents must never render under a new one, not even for a frame.
  const current = loaded?.pubkey === pubkey ? loaded : undefined;

  return {
    conversations: current?.conversations ?? [],
    status: current?.status ?? "loading",
    grantConsent,
    refresh,
  };
}
