/**
 * How wide `ThreadPane` should draw, and whether the window it lives in is
 * too narrow for a column at all.
 *
 * Pure, and kept out of `ThreadPane.tsx` itself so `ChatViewer` can hide the
 * conversation on exactly the threshold the pane uses for its own width —
 * one number, not two guesses that can drift apart — without pulling in a
 * component file for a calculation.
 *
 * The bug this replaces: a floor on the pane's own minimum (`MIN_WIDTH`) and
 * a floor baked into its ceiling (`Math.max(MIN_WIDTH, windowWidth *
 * MAX_SHARE)`) fight over the SAME width, and the floor always wins,
 * regardless of how little the window actually holds. On a real phone —
 * 320-390px in portrait — that handed the pane at least 220px no matter what,
 * leaving the conversation a sliver with nowhere for its own header buttons,
 * avatar and timestamp to lay out but on top of each other. What reads as the
 * thread "overlapping" the chat is that: two floors, one width, and the
 * conversation's own minimum never in the equation at all.
 */

/** Column width bounds. The ceiling is a share of the window, not a constant. */
export const MIN_WIDTH = 220;
export const MAX_SHARE = 0.6;

/**
 * The conversation's own floor once a thread opens beside it: a header's
 * icons, a message's avatar and text, the composer's toolbar. Below this many
 * pixels those stop fitting on one line.
 */
export const MIN_CONVERSATION_WIDTH = 240;

export interface ThreadPaneLayout {
  /** The pane's width, in pixels. */
  width: number;
  /**
   * True when the window cannot fit a column beside a legible conversation.
   * The pane should take the window's full width and the conversation should
   * hide (not unmount) rather than draw at an unusable width.
   */
  collapsed: boolean;
}

export function layoutThreadPane(
  windowWidth: number | undefined,
  requested: number,
): ThreadPaneLayout {
  if (windowWidth === undefined) {
    // Not measured yet. Trust the requested/remembered width rather than
    // flashing a fallback size for one frame — floored, since a drag that
    // pushed the stored width below MIN_WIDTH should not survive a remount.
    return { width: Math.max(requested, MIN_WIDTH), collapsed: false };
  }
  if (windowWidth < MIN_WIDTH + MIN_CONVERSATION_WIDTH) {
    return { width: windowWidth, collapsed: true };
  }
  // The conversation's minimum comes OUT of what the pane may claim, rather
  // than flooring the ceiling itself at MIN_WIDTH — a floor on both sides of
  // the same clamp defeats the clamp on any window narrower than
  // MIN_WIDTH / MAX_SHARE.
  const ceiling = Math.min(
    windowWidth * MAX_SHARE,
    windowWidth - MIN_CONVERSATION_WIDTH,
  );
  return {
    width: Math.min(Math.max(requested, MIN_WIDTH), ceiling),
    collapsed: false,
  };
}
