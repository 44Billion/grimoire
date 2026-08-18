/**
 * One inbox pipeline per account, however many windows are watching it.
 *
 * Every mounted `useDirectMessages` used to run the whole sequence itself:
 * resolve the relays, open a standing REQ, sync two pages, walk the history,
 * import the legacy plane. Three panes are open in an ordinary session — a
 * chat browser, a second window, a NIP-17 conversation — so all of it ran three
 * times over, three standing REQs deep, and the two-minute top-up ran three
 * times every two minutes. The decryptions deduplicate through the seen-wrap
 * memo, so the waste was invisible; the REQs and the relay traffic were not.
 *
 * So the pipeline belongs to the ACCOUNT and the components hold references to
 * it. The last one to leave takes it down, which is also what makes a handoff
 * work: a window closing while another is still open does not interrupt a walk
 * halfway through, the way a leader-election between components would.
 *
 * Nothing here paints. Stored messages reach the UI through `dm-bus`, exactly
 * as they did when a wrap arrived on the live subscription — the only thing
 * this reports is the walk's own progress, which nothing else can observe.
 */

import { BehaviorSubject, type Observable } from "rxjs";
import {
  backfillDmHistory,
  isHistoryExhausted,
  syncDmInbox,
  watchDmInbox,
  type BackfillProgress,
  type DmSigner,
} from "./dm-inbox";
import {
  hasImportedLegacyDms,
  importLegacyDms,
  type LegacySigner,
} from "./dm-legacy-inbox";
import { followedPubkeys, ownDmReadRelays } from "@/lib/dm/relays";

/** Both planes: NIP-44 for the wraps, NIP-04 for the history that predates them. */
type InboxSigner = DmSigner & LegacySigner;

/**
 * How long a pipeline outlives its last reference.
 *
 * The hook re-runs its effect whenever the list refreshes — on a timer, on
 * focus, on a message landing — and each re-run releases and rejoins. Without
 * a grace period that is a full teardown and a fresh walk every couple of
 * minutes, which is worse than the duplication this file exists to remove.
 */
export const TEARDOWN_GRACE_MS = 10_000;

interface Run {
  refs: number;
  signer: InboxSigner;
  /** Whether the sequence has been kicked off. Not `refs > 0`: a run inside
   *  its grace period has no references and must not be started twice. */
  started: boolean;
  teardown?: ReturnType<typeof setTimeout>;
  /**
   * Bumped by every restart. Each step of the walk checks it before writing
   * anything — an aborted walk can still be inside an await when the next one
   * starts, and the two must not interleave their progress.
   */
  generation: number;
  abort: AbortController;
  progress$: BehaviorSubject<BackfillProgress | undefined>;
  stopWatching?: () => void;
  relays?: string[];
  toppingUp: boolean;
}

const runs = new Map<string, Run>();

/** The walk's progress for this account, or undefined when none is running. */
export function dmBackfillProgress(
  viewer: string,
): Observable<BackfillProgress | undefined> {
  return ensure(viewer).progress$;
}

function ensure(viewer: string, signer?: InboxSigner): Run {
  const existing = runs.get(viewer);
  if (existing) {
    if (signer) existing.signer = signer;
    return existing;
  }
  const run: Run = {
    refs: 0,
    signer: signer as InboxSigner,
    started: false,
    generation: 0,
    abort: new AbortController(),
    progress$: new BehaviorSubject<BackfillProgress | undefined>(undefined),
    toppingUp: false,
  };
  runs.set(viewer, run);
  return run;
}

/**
 * Watch this account's inbox for as long as the returned release is uncalled.
 *
 * The first caller starts the pipeline; the rest join the one already running.
 */
export function joinDmInbox(viewer: string, signer: InboxSigner): () => void {
  const run = ensure(viewer, signer);
  run.refs += 1;
  if (run.teardown !== undefined) {
    clearTimeout(run.teardown);
    run.teardown = undefined;
  }
  if (!run.started) {
    run.started = true;
    void start(viewer, run, run.generation);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    run.refs -= 1;
    if (run.refs > 0 || run.teardown !== undefined) return;
    run.teardown = setTimeout(() => {
      if (run.refs > 0) return;
      run.abort.abort();
      run.stopWatching?.();
      run.stopWatching = undefined;
      run.progress$.next(undefined);
      runs.delete(viewer);
    }, TEARDOWN_GRACE_MS);
  };
}

/**
 * Top up from the relays: on a timer, on focus, on reconnect.
 *
 * A backstop behind the standing subscription, and deduplicated because every
 * open pane asks at once. Silent until the pipeline has resolved its relays —
 * before that the start is already doing this.
 */
export async function topUpDmInbox(viewer: string): Promise<void> {
  const run = runs.get(viewer);
  if (!run || !run.relays || run.toppingUp) return;
  run.toppingUp = true;
  try {
    await syncDmInbox(viewer, run.signer, { relays: run.relays, pages: 2 });
  } catch (error) {
    console.warn("[dm] could not top up the inbox:", error);
  } finally {
    run.toppingUp = false;
  }
}

/**
 * Walk it all again — for a new relay, or a run that went wrong.
 *
 * The caller clears the walk's own state first (`resetHistoryWalk`,
 * `resetLegacyImport`); this is what makes the pipeline notice. A no-op when
 * nothing is watching, because there is then nothing to restart.
 */
export function restartDmInbox(viewer: string): void {
  const run = runs.get(viewer);
  if (!run || run.refs === 0) return;
  run.started = true;
  run.abort.abort();
  run.stopWatching?.();
  run.stopWatching = undefined;
  run.relays = undefined;
  run.abort = new AbortController();
  run.generation += 1;
  void start(viewer, run, run.generation);
}

async function start(viewer: string, run: Run, gen: number): Promise<void> {
  const live = () => run.generation === gen && !run.abort.signal.aborted;

  // Resolved once and shared by the watch, the sync and the walk: the three
  // disagreeing is how a wrap lands on a relay only one of them was reading,
  // and how the walk's relay-set signature records a set that no read used.
  let relays: string[];
  try {
    relays = await ownDmReadRelays(viewer);
  } catch (error) {
    console.warn("[dm] could not resolve the inbox relays:", error);
    return;
  }
  if (!live()) return;
  run.relays = relays;

  // The live wire goes up FIRST, and outside the try below. Started after the
  // catch-up, a sync that threw took the standing subscription with it and the
  // session ran on with a list that only moved when something remounted — every
  // message already on disk still there, so nothing looked broken until someone
  // said they had written. It is also the right order on its own terms: a wrap
  // arriving DURING the catch-up is caught rather than missed, and the
  // seen-wrap memo makes the overlap free.
  run.stopWatching = watchDmInbox(viewer, run.signer, relays);

  try {
    // The fresh end first, so a reader who opens the pane sees today's mail
    // before a long walk starts.
    await syncDmInbox(viewer, run.signer, { relays, pages: 2 });
    if (!live()) return;

    // Then the whole history, once PER RELAY SET. A wrap says nothing about
    // whose conversation it belongs to until it is open, so a complete
    // conversation list has no cheaper answer than opening everything — and
    // every wrap is opened once, ever, so this is a first-run cost. Passing the
    // relays is what makes adding one re-walk instead of silently doing nothing.
    if (!(await isHistoryExhausted(viewer, relays))) {
      await backfillDmHistory(viewer, run.signer, {
        relays,
        signal: run.abort.signal,
        onProgress: (progress) => {
          if (live())
            run.progress$.next(progress.exhausted ? undefined : progress);
        },
      });
    }
    if (!live()) return;

    // Then the legacy plane, once. NIP-17 is young — most clients shipped it in
    // 2026 — so for anyone with history the kind-4 messages ARE the
    // conversation list, and they land in the same conversations, because a
    // kind-4 exchange with someone is the same conversation as the
    // gift-wrapped one.
    //
    // Skipped entirely without a follow list: the received direction is scoped
    // to follows, so importing with none would fetch your own half of every
    // conversation and nobody's replies — a stranger half-view is worse than
    // waiting for the list to load.
    if (run.signer.nip04 && !(await hasImportedLegacyDms(viewer))) {
      const follows = await followedPubkeys(viewer);
      if (live() && follows.length > 0)
        await importLegacyDms(viewer, run.signer, {
          follows,
          relays,
          signal: run.abort.signal,
          onProgress: (progress) => {
            if (live())
              run.progress$.next({
                pages: 0,
                fetched: progress.fetched,
                written: progress.written,
                exhausted: progress.exhausted,
              });
          },
        });
    }
  } catch (error) {
    console.warn("[dm] could not sync the inbox:", error);
  } finally {
    if (live()) run.progress$.next(undefined);
  }
}

/** Test seam. */
export function resetDmPipelines(): void {
  for (const [viewer, run] of runs) {
    if (run.teardown !== undefined) clearTimeout(run.teardown);
    run.abort.abort();
    run.stopWatching?.();
    runs.delete(viewer);
  }
}
