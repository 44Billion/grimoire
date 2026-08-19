/**
 * One gift-wrap ingester, running for as long as an account is signed in.
 *
 * The inbox pipeline belongs to the ACCOUNT (see `dm-pipeline.ts`) but until now
 * only windows held references to it, so it ran when a DM pane happened to be
 * open and stopped ten seconds after the last one closed. Everything that reads
 * gift wraps then inherited a rule nobody stated: your mail arrives only while
 * you are looking at your mail. A transcript published while an agent window was
 * the only thing on screen never arrived at all, and no later render recovered it
 * — the backward walk is marked exhausted, so nothing asks again.
 *
 * There is one ingest for the whole app, and it is not a window's job to keep it
 * alive. This holds the reference at the shell, which makes every pane a pure
 * reader of the local mirror — which is what they all claim to be.
 *
 * The three healing triggers are the DM list's, for the DM list's reasons: a
 * WebSocket that a backgrounded tab or a sleeping laptop wedged does not announce
 * itself, it just stops delivering, and the only symptom is a list that stopped
 * growing. Timer, focus, reconnect. `topUpDmInbox` deduplicates across callers,
 * so a DM pane asking on its own timer costs a shared REQ rather than a second
 * one.
 */

import { useEffect } from "react";
import { use$ } from "applesauce-react/hooks";

import accountManager from "@/services/accounts";
import { hasDecryptConsent } from "@/services/dm-inbox";
import { joinDmInbox, topUpDmInbox } from "@/services/dm-pipeline";

/**
 * How often the ingester asks for anything it missed.
 *
 * The same two minutes the conversation list uses: a transcript is not more
 * urgent than a message.
 */
const TOP_UP_MS = 120_000;

export function useDmIngest(): void {
  // Read off the live account rather than captured once: a remote signer's
  // `nip44` can arrive seconds after the account does.
  const account = use$(accountManager.active$);
  const pubkey = account?.pubkey;
  const signer = account?.signer;

  useEffect(() => {
    if (!pubkey || !signer?.nip44) return;
    let cancelled = false;
    let release: (() => void) | undefined;

    void (async () => {
      // The gate the inbox already asks for. Opening a backlog of wraps means
      // two decryptions each, and an ingester nobody granted that to must not
      // start driving the signer — so with no consent this stays inert and the
      // DM pane's own prompt remains the way in.
      if (!(await hasDecryptConsent(pubkey))) return;
      if (cancelled) return;
      release = joinDmInbox(pubkey, signer);
      void topUpDmInbox(pubkey, signer);
    })();

    return () => {
      cancelled = true;
      release?.();
    };
  }, [pubkey, signer]);

  useEffect(() => {
    if (!pubkey) return;

    const heal = () => void topUpDmInbox(pubkey);
    const timer = setInterval(heal, TOP_UP_MS);
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
  }, [pubkey]);
}
