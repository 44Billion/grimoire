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

import { useCallback, useEffect, useMemo, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import accountManager from "@/services/accounts";
import { DM_LIST_SCOPE, onDmScope } from "@/services/dm-bus";
import {
  grantDecryptConsent,
  hasDecryptConsent,
  resetHistoryWalk,
  type BackfillProgress,
} from "@/services/dm-inbox";
import {
  dmBackfillProgress,
  joinDmInbox,
  restartDmInbox,
  topUpDmInbox,
} from "@/services/dm-pipeline";
import { dmUnreadSummary, listDmConversations } from "@/services/dm-store";
import { markAllDmsRead, readDmLastRead } from "@/services/dm-reads";
import { resetLegacyImport } from "@/services/dm-legacy-inbox";
import type { DmConversationRow } from "@/services/db";

/**
 * How often an open list tops itself up.
 *
 * A backstop behind the live subscription, so it is measured in minutes rather
 * than seconds: the cost is one REQ per relay, and anything faster is paying
 * for a socket that is almost always working.
 */
const LIST_REFRESH_MS = 120_000;

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
  /**
   * Messages waiting, counted — the viewer's own never count, and neither do
   * reactions. Capped at {@link DM_UNREAD_CAP}.
   */
  unreadCount: number;
  /** Shorthand for `unreadCount > 0`, which is what the row styling asks. */
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
  /** Stamp every listed conversation at its own newest message. */
  markAllRead: () => Promise<void>;
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
    // Both planes: the reader pressing this is asking for everything, and a
    // rescan that quietly skipped the legacy half would be the same
    // half-answer that made them press it.
    await resetHistoryWalk(pubkey);
    await resetLegacyImport(pubkey);
    // The pipeline is shared and long-lived, so clearing the walk's state is
    // not enough to make it walk again — nothing would re-read it until the
    // last pane closed. Say so directly.
    restartDmInbox(pubkey);
    refresh();
  }, [pubkey, refresh]);

  const grantConsent = useCallback(async () => {
    if (!pubkey) return;
    await grantDecryptConsent(pubkey);
    refresh();
  }, [pubkey, refresh]);

  // The walk belongs to the account, so its progress does too — a second window
  // opened mid-walk shows the same bar as the one that started it.
  useEffect(() => {
    if (!enabled || !pubkey) return;
    const subscription = dmBackfillProgress(pubkey).subscribe(setBackfill);
    return () => subscription.unsubscribe();
  }, [enabled, pubkey]);

  useEffect(() => {
    // No clearing on the way out: what was loaded is already keyed by viewer,
    // and the render below discards a value belonging to another account. A
    // setState here would only be a cascading render saying the same thing.
    if (!enabled || !pubkey) return;

    let cancelled = false;
    // Dropped on the way out. A long walk stops when the LAST pane watching it
    // closes, not when this one does — the pipeline is refcounted.
    let release: (() => void) | undefined;

    const read = async (status: DirectMessagesStatus) => {
      const rows = await listDmConversations(pubkey);
      const conversations = await Promise.all(
        rows.map(async (row) => {
          const lastRead = await readDmLastRead(pubkey, row.conversationId);
          const peer =
            row.participants.find((p) => p !== pubkey) ?? row.participants[0];
          // Your own notes are never unread to you, so Saved messages does not
          // pay for the count either.
          const isSelf = peer === pubkey;
          const unreadCount = isSelf
            ? 0
            : (
                await dmUnreadSummary(pubkey, row.conversationId, {
                  after: lastRead,
                })
              ).count;
          return {
            ...row,
            peer,
            isSelf,
            lastRead,
            unreadCount,
            unread: unreadCount > 0,
          };
        }),
      );
      // Saved messages always exists, even empty. It is a place rather than a
      // correspondence — somewhere to put a link before you lose it — and a
      // notepad you can only reach after already writing in it is one nobody
      // discovers. Every other row appears because a message arrived; this one
      // appears because the account does.
      if (!conversations.some((c) => c.isSelf))
        conversations.push({
          viewer: pubkey,
          conversationId: pubkey,
          participants: [pubkey],
          lastAt: 0,
          peer: pubkey,
          isSelf: true,
          lastRead: 0,
          unreadCount: 0,
          unread: false,
        });

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

      // Paint what is already on disk before touching a relay. Everything the
      // relays then have to say arrives through `dm-bus`, which is what the
      // effect below listens to — this hook reads the local mirror and nothing
      // else, and the pipeline it joins belongs to the account rather than to
      // any one pane. See `dm-pipeline.ts`.
      await read("ready");
      if (cancelled) return;
      release = joinDmInbox(pubkey, signer);
    })();

    return () => {
      cancelled = true;
      release?.();
    };
  }, [enabled, pubkey, signer, nonce]);

  // A message landing anywhere changes this list's contents or its order.
  useEffect(
    () => (enabled ? onDmScope(DM_LIST_SCOPE, refresh) : undefined),
    [enabled, refresh],
  );

  /**
   * Heal a stale list: on a timer, on focus, and on reconnect.
   *
   * The standing subscription is the primary path and this is the backstop,
   * because a WebSocket that a backgrounded tab or a sleeping laptop wedged
   * does not announce itself — it just silently stops delivering, and the only
   * symptom is a conversation list that stopped growing. Armada learned the
   * same thing and lands on the same three triggers.
   *
   * Two halves: re-read the local mirror, and ask the relays for anything the
   * wedged socket missed. The second is deduplicated across every open pane —
   * three of them asking on the same timer is three times the REQs for one
   * answer — and cheap even so, because every wrap it sees again is already in
   * the seen memo, so the cost is a REQ rather than a decryption.
   */
  useEffect(() => {
    if (!enabled || !pubkey) return;

    const heal = () => {
      refresh();
      void topUpDmInbox(pubkey);
    };
    const timer = setInterval(heal, LIST_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") heal();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", heal);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", heal);
    };
  }, [enabled, pubkey, refresh]);

  // Keyed by viewer rather than reset in an effect: a stale account's
  // correspondents must never render under a new one, not even for a frame.
  const current = loaded?.pubkey === pubkey ? loaded : undefined;
  // Memoized so the empty fallback is not a fresh array every render, which
  // would rebuild `markAllRead` — and every effect keyed on it — for nothing.
  const conversations = useMemo(
    () => current?.conversations ?? [],
    [current?.conversations],
  );

  const markAllRead = useCallback(async () => {
    if (!pubkey) return;
    // Only the ones with something to clear, and each at its own newest
    // message — see `markAllDmsRead`. The doorbell it rings brings the list
    // back, so there is no refresh to fire here.
    await markAllDmsRead(
      pubkey,
      conversations
        .filter((c) => c.unreadCount > 0)
        .map((c) => ({ conversationId: c.conversationId, lastAt: c.lastAt })),
    );
  }, [pubkey, conversations]);

  return {
    conversations,
    status: current?.status ?? "loading",
    grantConsent,
    refresh,
    rescan,
    markAllRead,
    ...(backfill ? { backfill } : {}),
  };
}
