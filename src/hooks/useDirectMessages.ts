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
  backfillDmHistory,
  grantDecryptConsent,
  hasDecryptConsent,
  isHistoryExhausted,
  resetHistoryWalk,
  syncDmInbox,
  type BackfillProgress,
} from "@/services/dm-inbox";
import { listDmConversations } from "@/services/dm-store";
import { readDmLastRead } from "@/services/dm-reads";
import { ownDmReadRelays } from "@/lib/dm/relays";
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
  /**
   * The walk back through the whole history, while it is running.
   *
   * Absent once it has reached the beginning — which is sticky, so it is
   * absent on every load after the first successful one.
   */
  backfill?: BackfillProgress;
  /** Walk it again from the top: for a new relay, or a run that went wrong. */
  rescan: () => Promise<void>;
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
  const [backfill, setBackfill] = useState<BackfillProgress>();

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const rescan = useCallback(async () => {
    if (!pubkey) return;
    await resetHistoryWalk(pubkey);
    refresh();
  }, [pubkey, refresh]);

  const grantConsent = useCallback(async () => {
    if (!pubkey) return;
    await grantDecryptConsent(pubkey);
    refresh();
  }, [pubkey, refresh]);

  useEffect(() => {
    // No clearing on the way out: what was loaded is already keyed by viewer,
    // and the render below discards a value belonging to another account. A
    // setState here would only be a cascading render saying the same thing.
    if (!enabled || !pubkey) return;

    let cancelled = false;
    // A long walk must stop when the pane closes or the account changes, not
    // grind on against relays nobody is reading from any more.
    const abort = new AbortController();

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
        // The fresh end first: whatever arrived since last time, so a reader
        // who opens the pane sees today's mail before a long walk starts.
        await syncDmInbox(pubkey, signer, { pages: 2 });
        if (cancelled) return;
        await read("ready");

        // Then the whole history, once PER RELAY SET. A wrap says nothing
        // about whose conversation it belongs to until it is open, so a
        // complete conversation list has no cheaper answer than opening
        // everything — and every wrap is opened once, ever, so this is a
        // first-run cost. Passing the relays is what makes adding one re-walk
        // instead of silently doing nothing.
        const relays = await ownDmReadRelays(pubkey);
        if (!(await isHistoryExhausted(pubkey, relays))) {
          await backfillDmHistory(pubkey, signer, {
            relays,
            signal: abort.signal,
            onProgress: (progress) => {
              if (!cancelled)
                setBackfill(progress.exhausted ? undefined : progress);
            },
          });
        }
      } catch (error) {
        console.warn("[dm] could not sync the inbox:", error);
      }
      if (!cancelled) {
        setBackfill(undefined);
        await read("ready");
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
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
    rescan,
    ...(backfill ? { backfill } : {}),
  };
}
