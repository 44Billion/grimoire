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
  getGiftWrapSeal,
  getSealRumor,
  internalGiftWrapEvents,
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
const exhaustedKey = (viewer: string) => `${viewer}:exhausted`;

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

/**
 * Whether the walk backwards has reached the end of what the relays hold.
 *
 * Sticky, and per account. Reaching the beginning once is a fact about the
 * history, not about the session — re-walking it on every load would cost a
 * full relay sweep to discover the same nothing.
 */
export async function isHistoryExhausted(viewer: string): Promise<boolean> {
  return (await readDmKv<boolean>(exhaustedKey(viewer))) === true;
}

/** Walk the history again from the top — for a new relay, or a bad first run. */
export async function resetHistoryWalk(viewer: string): Promise<void> {
  await writeDmKv(exhaustedKey(viewer), false);
  await writeDmKv(cursorKey(viewer), undefined);
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

  // Within the batch first. `{ eventStore: null }` disables applesauce's
  // cross-relay dedupe, so four inbox relays hand us the same wrap four times
  // — which without this is four times the signer calls.
  const unique = new Map<string, NostrEvent>();
  for (const wrap of addressed)
    if (!unique.has(wrap.id)) unique.set(wrap.id, wrap);

  const seen = await seenWrapIds(viewer, [...unique.keys()]);
  const todo = [...unique.values()].filter(
    (w) => !seen.has(w.id) && !inFlight.has(`${viewer}:${w.id}`),
  );
  if (todo.length === 0) return { written: 0, failed: 0 };

  // And across concurrent calls. `watchDmInbox` fires one `unlockWraps` per
  // arriving wrap per relay, and they all read `seenWrapIds` before any of
  // them has written it back.
  for (const wrap of todo) inFlight.add(`${viewer}:${wrap.id}`);
  try {
    return await openAndStore(viewer, signer, todo);
  } finally {
    for (const wrap of todo) inFlight.delete(`${viewer}:${wrap.id}`);
  }
}

/** Wraps being opened right now, so two callers cannot both open one. */
const inFlight = new Set<string>();

async function openAndStore(
  viewer: string,
  signer: DmSigner,
  todo: NostrEvent[],
): Promise<UnlockOutcome> {
  const rumors: Rumor[] = [];
  let failed = 0;

  for (let i = 0; i < todo.length; i += DECRYPT_WAVE) {
    const wave = todo.slice(i, i + DECRYPT_WAVE);
    const marks: Array<{ id: string; created_at: number; opened: boolean }> =
      [];

    await Promise.all(
      wave.map(async (wrap) => {
        let opened = false;
        try {
          rumors.push(await unlockGiftWrap(wrap, signer));
          opened = true;
        } catch {
          failed += 1;
        }
        discardPlaintext(wrap);
        marks.push({ id: wrap.id, created_at: wrap.created_at, opened });
      }),
    );

    // Per WAVE, not once at the end. A throw anywhere in the batch used to
    // mean nothing was recorded, so a single malformed wrap made the whole
    // page decryptable-again forever — two signer prompts per message, every
    // session, for as long as it sat in the inbox.
    await markWrapsSeen(viewer, marks);

    // Let the browser paint between waves.
    if (i + DECRYPT_WAVE < todo.length)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Store first, doorbell second. A missed ring is a stale render; a ring
  // before the write is a reader that looks and finds nothing.
  const { written, touched } = await writeDmRumors(viewer, rumors);
  if (touched.length > 0)
    emitDmScopes([DM_LIST_SCOPE, ...touched.map(conversationScope)]);

  return { written: written.length, failed };
}

/**
 * Get the decrypted message out of memory once Dexie has it.
 *
 * `lockGiftWrap` alone is not enough, and its name oversells it twice over.
 * It drops the symbol references on the wrap, but every seal and rumor it ever
 * derived stays in applesauce's module-level `internalGiftWrapEvents` — an
 * `EventMemory` over an LRU constructed with no bound, so nothing is ever
 * evicted and a logout cannot reach it. Worse, it re-derives the seal to find
 * what to lock, which re-runs `JSON.parse` on plaintext that already failed to
 * parse — so on a malformed wrap it throws on the way out.
 *
 * The rumor is the entry that holds the message body, and it is added by
 * `getSealRumor` rather than by anything that takes a wrap — so evicting the
 * wrap is a no-op and evicting the seal does not reach it. All three are
 * handled here, and none of it is allowed to throw.
 */
function discardPlaintext(wrap: NostrEvent): void {
  try {
    const seal = getGiftWrapSeal(wrap);
    if (!seal) return;
    // The RUMOR is the entry that matters: `getSealRumor` adds it to the
    // memory, and it is the one holding the message body in cleartext. Evict
    // it first, because evicting the seal does not reach it.
    try {
      // By id: a rumor is unsigned, and `remove` takes an id or a full event.
      const rumor = getSealRumor(seal);
      if (rumor?.id) internalGiftWrapEvents.remove(rumor.id);
    } catch {
      // A seal that will not parse produced no rumor.
    }
    internalGiftWrapEvents.remove(seal);
  } catch {
    // A wrap that will not parse has no seal to evict.
  } finally {
    try {
      lockGiftWrap(wrap);
    } catch {
      // `lockGiftWrap` re-derives to find what to clear, and re-derivation is
      // exactly what fails on the wraps that need clearing most.
    }
  }
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
  /**
   * How many pages to walk backwards before stopping.
   *
   * One page is the newest {@link BACKFILL_PAGE} wraps a relay will serve, and
   * a wrap says nothing about which conversation it belongs to until it is
   * open — so a single page of an active inbox can be one correspondent
   * repeated two hundred times while the rest of the list stays invisible.
   * Walking a few pages on the first load is what makes the sidebar look like
   * the reader's actual mail.
   */
  pages?: number;
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

  const limit = options.limit ?? BACKFILL_PAGE;
  const pages = Math.max(1, options.pages ?? 1);

  let written = 0;
  let failed = 0;
  let fetched = 0;
  let oldest: number | undefined;
  let until = options.until;

  for (let page = 0; page < pages; page += 1) {
    const filter = {
      ...inboxFilter(viewer),
      limit,
      ...(until !== undefined ? { until } : {}),
    };

    const wraps = await requestEvents(relays, [filter], { eventStore: null });
    if (wraps.length === 0) {
      console.info(
        `[dm] page ${page + 1}: no wraps from ${relays.length} relay(s)`,
      );
      break;
    }

    const outcome = await unlockWraps(viewer, signer, wraps);
    written += outcome.written;
    failed += outcome.failed;
    fetched += wraps.length;

    // Loud on purpose, once per page. Every question anyone has asked about a
    // short conversation list — is it the relays, the decryption, or the store
    // refusing rows — is answered by these numbers, and none of them is
    // visible from the UI.
    console.info(
      `[dm] page ${page + 1}: ${wraps.length} wraps from ${relays.length} relay(s) → ` +
        `${outcome.written} stored, ${outcome.failed} would not open, ` +
        `${wraps.length - outcome.written - outcome.failed} already known`,
    );

    const pageOldest = wraps.reduce<number | undefined>(
      (min, w) =>
        min === undefined || w.created_at < min ? w.created_at : min,
      undefined,
    );
    if (pageOldest === undefined) break;
    if (oldest === undefined || pageOldest < oldest) oldest = pageOldest;

    // Strictly older next time, or a relay that returns the same page forever
    // makes this loop `pages` round trips for one page of history.
    if (until !== undefined && pageOldest >= until) break;
    until = pageOldest;
  }

  if (oldest !== undefined) {
    const previous = await readCursor(viewer);
    // The cursor only ever recedes: it records how far back we have walked.
    if (previous === undefined || oldest < previous)
      await writeDmKv(cursorKey(viewer), oldest);
  }

  console.info(
    `[dm] sync done: ${fetched} wraps seen, ${written} stored, ${failed} unopenable — relays: ${relays.join(", ")}`,
  );

  return {
    written,
    failed,
    fetched,
    ...(oldest !== undefined ? { oldest } : {}),
  };
}

/** How long a single backfill page waits before the walk gives up on it. */
const BACKFILL_PAGE_TIMEOUT_MS = 15_000;

export interface BackfillProgress {
  /** Pages walked so far. */
  pages: number;
  /** Wraps the relays have handed over. */
  fetched: number;
  /** Messages stored. Lower than `fetched`: most pages are mostly re-runs. */
  written: number;
  /** The walk reached the beginning of what the relays hold. */
  exhausted: boolean;
}

/**
 * Walk this account's whole gift-wrap history, oldest-ward, until it runs dry.
 *
 * A DM inbox is one undifferentiated stream: a wrap says nothing about whose
 * conversation it belongs to until it is open, so "show me my conversations"
 * has no cheaper answer than "open everything". One page of an active inbox
 * can be a single correspondent repeated two hundred times while everyone else
 * stays invisible — which is exactly what a short conversation list looks like.
 *
 * Three properties make that affordable rather than reckless:
 *
 * - **Resumable.** The cursor records how far back the walk has got and only
 *   ever recedes, so a reload continues rather than restarting. Reaching the
 *   beginning is recorded too, and is sticky.
 * - **Paid once.** Every wrap opened is mirrored, and the seen memo covers the
 *   ones that would not open — so the expensive run is the first one, and
 *   every run after it is a handful of pages of already-known ids.
 * - **Interruptible.** The walk yields between pages and stops on `signal`, so
 *   closing the window does not leave it grinding.
 *
 * It rings the doorbell as it goes, so the list fills in while it runs rather
 * than appearing all at once at the end.
 */
export async function backfillDmHistory(
  viewer: string,
  signer: DmSigner,
  options: {
    relays?: string[];
    /** Stop after this many pages. Absent means walk to the end. */
    maxPages?: number;
    signal?: AbortSignal;
    onProgress?: (progress: BackfillProgress) => void;
  } = {},
): Promise<BackfillProgress> {
  const relays = options.relays ?? (await ownDmReadRelays(viewer));
  const progress: BackfillProgress = {
    pages: 0,
    fetched: 0,
    written: 0,
    exhausted: false,
  };
  if (relays.length === 0) return progress;

  let until = await readCursor(viewer);
  // Ids this walk has already been handed. A relay that ignores `until` — or
  // one whose page cap is filled by the boundary wrap alone — would otherwise
  // serve the same page forever, and the walk would never end.
  const seenThisWalk = new Set<string>();
  /**
   * Whether the last page came back with nothing new.
   *
   * `until` is inclusive, so the wrap the bound was taken from comes back in
   * the next page. That is deliberate — an exclusive bound would drop its
   * same-second siblings — but it means a page can be entirely repeats while
   * older wraps still exist behind the relay's page cap. One strict step past
   * the boundary distinguishes "the cap hid the rest" from "there is no rest";
   * two in a row means there is genuinely nothing older.
   */
  let steppedPast = false;

  while (!options.signal?.aborted) {
    if (options.maxPages !== undefined && progress.pages >= options.maxPages)
      break;

    const wraps = await requestEvents(
      relays,
      [
        {
          ...inboxFilter(viewer),
          limit: BACKFILL_PAGE,
          ...(until !== undefined ? { until } : {}),
        },
      ],
      { eventStore: null, timeout: BACKFILL_PAGE_TIMEOUT_MS },
    );

    progress.pages += 1;

    if (wraps.length === 0) {
      progress.exhausted = true;
      break;
    }

    const fresh = wraps.filter((w) => !seenThisWalk.has(w.id));
    for (const wrap of wraps) seenThisWalk.add(wrap.id);

    if (fresh.length === 0) {
      if (steppedPast || until === undefined) {
        // Stepping past the boundary changed nothing: there is nothing older.
        progress.exhausted = true;
        break;
      }
      // Everything in this page was already seen. Either the relay is ignoring
      // the bound, or its page cap was filled by the boundary wrap's own
      // second — one strict step tells us which. The cost, in the pathological
      // case where a whole page shares one timestamp, is the rest of that
      // second; the alternative is a walk that does not terminate.
      steppedPast = true;
      until -= 1;
      continue;
    }
    steppedPast = false;

    const outcome = await unlockWraps(viewer, signer, fresh);
    progress.fetched += fresh.length;
    progress.written += outcome.written;

    const pageOldest = fresh.reduce(
      (min, w) => Math.min(min, w.created_at),
      Number.POSITIVE_INFINITY,
    );
    if (!Number.isFinite(pageOldest)) {
      progress.exhausted = true;
      break;
    }

    // Inclusive, so a run of same-second wraps is not split across the bound;
    // `seenThisWalk` is what stops that from looping.
    until = pageOldest;
    await writeDmKv(cursorKey(viewer), pageOldest);

    console.info(
      `[dm] backfill page ${progress.pages}: ${fresh.length} new wraps, ` +
        `${outcome.written} stored, back to ${new Date(pageOldest * 1000).toISOString()}`,
    );
    options.onProgress?.({ ...progress });

    // Between pages, not inside them: the decrypt waves already yield, and
    // this is what keeps the window responsive across a long walk.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (progress.exhausted) await writeDmKv(exhaustedKey(viewer), true);
  options.onProgress?.({ ...progress });
  console.info(
    `[dm] backfill ${progress.exhausted ? "complete" : "paused"}: ` +
      `${progress.pages} pages, ${progress.fetched} wraps, ${progress.written} stored`,
  );
  return progress;
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
