/**
 * Bringing back a timeline that mounted into a container that was not there.
 *
 * `initialTopMostItemIndex` is what opens a channel at its newest message, and
 * react-virtuoso implements it by keeping the item list `visibility: hidden`
 * until that initial scroll reaches its final location. Reaching it needs a
 * measurement, and a measurement needs a laid-out container inside a document
 * that is painting. Mount before either is true — a mosaic tile mid-split, a
 * workspace that was not on screen, a tab the browser had stopped rendering —
 * and the scroll never lands. Nothing retries it. The list stays hidden with
 * zero rows for as long as the window is open: the blank timeline.
 *
 * Confirmed against react-virtuoso 4.18.11 with the viewer's exact prop set: a
 * list mounted without frames renders only its Header, `visibility: hidden`,
 * zero children, while a list WITHOUT `initialTopMostItemIndex` renders its
 * rows in the same conditions. The prop is the trigger, and dropping it is not
 * the fix — it is the thing that makes a channel open where the reader left it.
 *
 * So the list gets remounted WITHOUT the gate, and scrolled to the end by hand.
 *
 * Remounting with the prop still set was the first version of this fix, and it
 * does not work: observed live, the watchdog fired, remounted three times, and
 * every mount came back with zero rows — whatever starved the first measurement
 * starves the next one just the same. Calling `scrollToIndex` on the stuck list
 * does not lift it either; the gate is not a scroll position, it is a flag that
 * only the initial scroll clears. Dropping the prop for the revival mount is
 * what renders, and the imperative scroll is what puts the reader back at the
 * newest message. The first mount keeps the prop: it costs nothing when it
 * works, and it works without a flash.
 */

/** How long a timeline may hold data while rendering nothing before it is revived. */
export const REVIVE_AFTER_MS = 1200;

/** How many times one conversation may be revived before we stop trying. */
export const MAX_REVIVALS = 3;

/** How often a revived list re-tries the scroll that puts it at the newest message. */
export const REVIVE_ANCHOR_EVERY_MS = 250;

/**
 * How many of those tries it gets — about eight seconds' worth.
 *
 * Generous because the retry is what covers a list revived while the document
 * was not painting: the scroll cannot land until frames resume, and a reader
 * coming back to a backgrounded tab must not find the channel at the top of its
 * history. It costs nothing to be patient — the first try that lands stops it.
 */
export const REVIVE_ANCHOR_TRIES = 32;

/**
 * Whether a list showing `rendered` rows out of `dataLength` is stuck.
 *
 * Capped: a list that renders nothing for some OTHER reason must not remount
 * forever, and each remount costs the reader a repaint. Three is enough for the
 * layout races this exists for — those resolve on the first retry — and small
 * enough that a genuine defect surfaces as a blank pane rather than a loop.
 */
export function shouldRevive(
  rendered: number,
  dataLength: number,
  revivals: number,
): boolean {
  return dataLength > 0 && rendered === 0 && revivals < MAX_REVIVALS;
}
