/**
 * Read the stamp, place the divider, then move the stamp — in that order.
 *
 * The ORDER is the whole hook. The divider is "everything below the stamp as it
 * was when you walked in", and opening the channel is exactly what moves the
 * stamp — so if the write ever races ahead of the read, the pre-visit value is
 * gone and the reader is told nothing is new. Armada could capture the stamp
 * synchronously at mount; grimoire's lives in Dexie, so the capture is async and
 * the sequencing has to be enforced rather than assumed. That is what
 * `useReadMarker.test.ts` pins.
 *
 * Inert for every protocol whose adapter does not implement the optional
 * read-state methods, which today is all of them but Concord.
 */

import { useEffect, useMemo, useState } from "react";

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import { findDividerId } from "@/lib/chat/unread-divider";
import type { Conversation, Message } from "@/types/chat";

/** The stamp as it was when this visit began, per conversation. */
interface Visit {
  conversationId: string;
  lastRead: number;
}

export interface ReadMarker {
  /** The message the "New messages" line belongs above, or undefined for none. */
  dividerId: string | undefined;
  /**
   * The stamp as it was when this visit began, or undefined until it lands.
   *
   * Exposed because the divider is not the only thing measured against it: a
   * thread folded out of the timeline counts its own unread replies from the
   * same frozen number, so the line and the counts cannot disagree.
   */
  lastRead: number | undefined;
}

/**
 * Where the "New messages" line goes, and what it was measured against.
 *
 * Also marks the conversation read as newer messages land — gated on the
 * document being visible, because a window in a background tab is not being
 * read. Grimoire's tiles are tiled rather than stacked, so a mounted viewer in
 * a visible document really is on screen.
 *
 * `messages` and `rows` are deliberately two arguments. The STAMP must cover
 * everything the unread count counts — the rule `docs/chat-system.md` states, and
 * a stamp that skipped folded replies would leave a badge nothing can clear — so
 * it is taken from `messages`. The DIVIDER must name a row that is actually
 * rendered, so it is placed over `rows`. They differ exactly when threads are
 * collapsed.
 */
export function useReadMarker(
  adapter: ChatProtocolAdapter,
  conversation: Conversation | undefined,
  messages: Message[] | undefined,
  selfPubkey?: string,
  rows?: Message[],
): ReadMarker {
  const conversationId = conversation?.id;

  // Both pieces of state carry the conversation they belong to rather than
  // being cleared by an effect — the same shape the other Concord hooks use.
  // Switching channels in place would otherwise show one channel's divider over
  // another's messages for a frame, and re-stamp the wrong one.
  const [visit, setVisit] = useState<Visit>();

  // (a) Capture the pre-visit stamp. Nothing else may run until this lands.
  useEffect(() => {
    if (!conversation || !adapter.getLastRead) return;
    const id = conversation.id;
    let cancelled = false;
    void adapter
      .getLastRead(conversation)
      .catch(() => 0)
      .then((lastRead) => {
        if (!cancelled) setVisit({ conversationId: id, lastRead });
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the ID, not the object — and that is load-bearing rather than
    // tidiness. This effect sets state, so a caller handing over a fresh
    // Conversation object per render (which resolving one legitimately does)
    // would re-read, re-render, re-read, forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, conversationId]);

  const captured = visit?.conversationId === conversationId ? visit : undefined;

  // (b) Place the divider — DERIVED, on every emission, against the captured
  // stamp rather than settled once.
  //
  // Concord paints from the local store and backfills afterwards, so the first
  // emission can legitimately predate the unread window; settling on it would
  // lock the divider to "none" for the whole visit. Because the stamp it is
  // measured against is frozen, re-deriving cannot make the line disappear once
  // it appears — the only thing that moves it is history arriving that is ALSO
  // unread, i.e. a first-unread deeper than the first page, and there moving up
  // is the correct answer rather than a flicker.
  const placeOver = rows ?? messages;
  const dividerId = useMemo(
    () =>
      captured && placeOver
        ? findDividerId(placeOver, captured.lastRead, selfPubkey)
        : undefined,
    [captured, placeOver, selfPubkey],
  );

  // (c) Only now may the stamp move. Re-stamps as newer messages arrive.
  useEffect(() => {
    if (!conversation || !captured || !adapter.markRead) return;
    if (!messages || messages.length === 0) return;
    const newest = messages.reduce((max, m) => Math.max(max, m.timestamp), 0);
    if (newest <= 0) return;

    const mark = () => {
      if (document.visibilityState !== "visible") return;
      void adapter.markRead?.(conversation, newest).catch(() => undefined);
    };
    mark();
    // A channel left open in a hidden window marks itself read the moment the
    // reader comes back to it, without waiting for another message.
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
    // Keyed on the id for the same reason as (a).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, conversationId, captured, messages]);

  return { dividerId, lastRead: captured?.lastRead };
}
