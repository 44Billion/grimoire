/**
 * Getting this account's gift wraps off the relays and into the store.
 *
 * Reads run on the SINGLETON pool, authenticated. That is the opposite of the
 * publish path (`dm-publish-pool.ts`) and deliberately so: this REQ asks the
 * user's own inbox relays for the user's own mail, most of which require NIP-42
 * before they will serve it, and identifying yourself to your own mailbox
 * discloses nothing it does not already hold.
 *
 * Three things shape everything here:
 *
 * - **A wrap's `created_at` is randomised up to two days into the past** so its
 *   arrival time says nothing about when it was written. A cursor-based `since`
 *   therefore filters out almost every wrap that is genuinely new, which is why
 *   {@link WRAP_BACKDATE_SECS} exists and why the cursor is slack rather than
 *   exact.
 * - **Opening a wrap costs two `nip44.decrypt` calls.** Against a browser
 *   extension or a bunker that is two prompts or two round trips, per message,
 *   so a cold inbox of two hundred is four hundred of them. Hence the consent
 *   gate, the seen-wrap memo, and unlocking in small waves.
 * - **Nothing is decrypted twice, ever.** The rumor goes to Dexie and the wrap
 *   id to the seen table, including when it would not open — a wrap that failed
 *   once fails identically forever, and retrying it is a prompt per session for
 *   a message that does not exist.
 */

import { kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import {
  unlockGiftWrap,
  lockGiftWrap,
} from "applesauce-common/helpers/gift-wrap";
import type { Rumor } from "applesauce-common/helpers/gift-wrap";
import type { EncryptedContentSigner } from "applesauce-core/helpers/encrypted-content";
import { requestEvents } from "@/lib/relay-subscription";
import { ownDmReadRelays } from "@/lib/dm/relays";
import pool from "./relay-pool";
import {
  markWrapsSeen,
  readDmKv,
  seenWrapIds,
  writeDmKv,
  writeDmRumors,
} from "./dm-store";
import { DM_LIST_SCOPE, conversationScope, emitDmScopes } from "./dm-bus";

/** How far back a wrap's timestamp may be randomised (NIP-59 says two days). */
export const WRAP_BACKDATE_SECS = 2 * 24 * 3600;

/** Extra slack on top, for clock skew between us and the sender. */
export const WRAP_SINCE_SLACK_SECS = 3600;

/**
 * Wraps opened per wave, with a yield between waves.
 *
 * Armada's number, and its reasoning holds: a whole page unlocked as one
 * microtask chain blocks the main thread for seconds on noble's NIP-44, while
 * waves this small still keep a remote bunker's pipeline busy.
 */
export const DECRYPT_WAVE = 4;

/** Wraps per backfill page. */
export const BACKFILL_PAGE = 200;

const consentKey = (viewer: string) => `${viewer}:consent`;
const cursorKey = (viewer: string) => `${viewer}:cursor`;

/** Has this account agreed to have its inbox opened? */
export async function hasDecryptConsent(viewer: string): Promise<boolean> {
  return (await readDmKv<boolean>(consentKey(viewer))) === true;
}

/**
 * Record that the reader asked for their messages.
 *
 * Permanent for the account. The gate exists to stop a burst of signer prompts
 * nobody asked for, and once the reader has asked once, asking again every
 * session would be the same annoyance wearing a different hat.
 */
export async function grantDecryptConsent(viewer: string): Promise<void> {
  await writeDmKv(consentKey(viewer), true);
}

/** The oldest wrap timestamp this account has walked back to, if any. */
async function readCursor(viewer: string): Promise<number | undefined> {
  return readDmKv<number>(cursorKey(viewer));
}

/** A signer that can open a wrap. Absent `nip44` means it cannot. */
export type DmSigner = EncryptedContentSigner;

export interface UnlockOutcome {
  /** Rumors written to the store. */
  written: number;
  /** Wraps that would not open, and never will. */
  failed: number;
}

/**
 * Open wraps, in waves, and write what comes out.
 *
 * Wraps not addressed to `viewer` are dropped before the signer is touched:
 * they can never open, and every attempt is a wasted prompt. Own sends land
 * here too — the self-copy comes back from the relay — but `dm/send.ts` has
 * already marked those seen, so they cost nothing.
 */
export async function unlockWraps(
  viewer: string,
  signer: DmSigner,
  wraps: NostrEvent[],
): Promise<UnlockOutcome> {
  const addressed = wraps.filter(
    (wrap) =>
      wrap.kind === kinds.GiftWrap &&
      wrap.tags.some((t) => t[0] === "p" && t[1] === viewer),
  );

  const seen = await seenWrapIds(
    viewer,
    addressed.map((w) => w.id),
  );
  const todo = addressed.filter((w) => !seen.has(w.id));
  if (todo.length === 0) return { written: 0, failed: 0 };

  const rumors: Rumor[] = [];
  const marks: Array<{ id: string; created_at: number; opened: boolean }> = [];

  for (let i = 0; i < todo.length; i += DECRYPT_WAVE) {
    const wave = todo.slice(i, i + DECRYPT_WAVE);
    await Promise.all(
      wave.map(async (wrap) => {
        try {
          const rumor = await unlockGiftWrap(wrap, signer);
          rumors.push(rumor);
          marks.push({
            id: wrap.id,
            created_at: wrap.created_at,
            opened: true,
          });
        } catch {
          marks.push({
            id: wrap.id,
            created_at: wrap.created_at,
            opened: false,
          });
        } finally {
          // Drop the plaintext applesauce hangs off the wrap object. Dexie is
          // the only place a decrypted message is meant to live.
          lockGiftWrap(wrap);
        }
      }),
    );
    // Let the browser paint between waves.
    if (i + DECRYPT_WAVE < todo.length)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await markWrapsSeen(viewer, marks);

  // Store first, doorbell second. A missed ring is a stale render; a ring
  // before the write is a reader that looks and finds nothing.
  const { written, touched } = await writeDmRumors(viewer, rumors);
  if (touched.length > 0)
    emitDmScopes([DM_LIST_SCOPE, ...touched.map(conversationScope)]);

  return {
    written: written.length,
    failed: marks.filter((m) => !m.opened).length,
  };
}

/** The filter for this account's mail, with the backdating slack applied. */
export function inboxFilter(viewer: string, since?: number) {
  return {
    kinds: [kinds.GiftWrap],
    "#p": [viewer],
    ...(since !== undefined
      ? { since: since - WRAP_BACKDATE_SECS - WRAP_SINCE_SLACK_SECS }
      : {}),
  };
}

export interface SyncOptions {
  /** Override the relay set. Resolved from the account's lists otherwise. */
  relays?: string[];
  /** Walk backwards from here instead of fetching the newest page. */
  until?: number;
  limit?: number;
}

/**
 * One pass: fetch wraps, open them, store them.
 *
 * Returns the outcome plus the oldest wrap seen, which is what a caller pages
 * `until` on. Note that DM history pages by WRAP, not by conversation — the
 * stream is one undifferentiated inbox and there is no way to ask a relay for
 * "older messages with this person".
 */
export async function syncDmInbox(
  viewer: string,
  signer: DmSigner,
  options: SyncOptions = {},
): Promise<UnlockOutcome & { oldest?: number; fetched: number }> {
  const relays = options.relays ?? (await ownDmReadRelays(viewer));
  if (relays.length === 0) return { written: 0, failed: 0, fetched: 0 };

  const filter = {
    ...inboxFilter(viewer),
    limit: options.limit ?? BACKFILL_PAGE,
    ...(options.until !== undefined ? { until: options.until } : {}),
  };

  const wraps = await requestEvents(relays, [filter], { eventStore: null });
  const outcome = await unlockWraps(viewer, signer, wraps);

  const oldest = wraps.reduce<number | undefined>(
    (min, w) => (min === undefined || w.created_at < min ? w.created_at : min),
    undefined,
  );
  if (oldest !== undefined) {
    const previous = await readCursor(viewer);
    // The cursor only ever recedes: it records how far back we have walked.
    if (previous === undefined || oldest < previous)
      await writeDmKv(cursorKey(viewer), oldest);
  }

  return {
    ...outcome,
    fetched: wraps.length,
    ...(oldest !== undefined ? { oldest } : {}),
  };
}

/**
 * Watch for new wraps until unsubscribed.
 *
 * No `since`: the standing REQ opens with the relay's own recent window, and
 * the seen-wrap memo makes a replayed wrap free. Trying to be clever with a
 * cursor here is what the backdating defeats.
 */
export function watchDmInbox(
  viewer: string,
  signer: DmSigner,
  relays: string[],
): () => void {
  const subscription = pool
    .subscription(relays, [inboxFilter(viewer)], { eventStore: null })
    .subscribe({
      next: (wrap) => {
        void unlockWraps(viewer, signer, [wrap]);
      },
      error: () => {},
    });

  return () => subscription.unsubscribe();
}
