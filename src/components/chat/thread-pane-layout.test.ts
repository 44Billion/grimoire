/**
 * `layoutThreadPane`'s job is to never let its own floor (`MIN_WIDTH`) and its
 * ceiling fight over the same width and hand the pane more than the window
 * can actually spare — see the file's own header for the bug this replaced.
 */

import { describe, expect, it } from "vitest";

import {
  layoutThreadPane,
  MIN_CONVERSATION_WIDTH,
  MIN_WIDTH,
} from "./thread-pane-layout";

describe("layoutThreadPane", () => {
  it("trusts the requested width before the window is measured", () => {
    expect(layoutThreadPane(undefined, 352)).toEqual({
      width: 352,
      collapsed: false,
    });
  });

  it("still floors an unmeasured request at MIN_WIDTH", () => {
    expect(layoutThreadPane(undefined, 50)).toEqual({
      width: MIN_WIDTH,
      collapsed: false,
    });
  });

  it("gives the pane its requested width on an ordinary desktop window", () => {
    expect(layoutThreadPane(1200, 352)).toEqual({
      width: 352,
      collapsed: false,
    });
  });

  it("clamps to a share of the window when the request is too wide for it", () => {
    // 900 * 0.6 = 540, well inside 900 - MIN_CONVERSATION_WIDTH (660).
    expect(layoutThreadPane(900, 800)).toEqual({
      width: 540,
      collapsed: false,
    });
  });

  it("never lets MIN_WIDTH win a floor-vs-floor fight against the conversation's own minimum", () => {
    // A 400px window: MIN_WIDTH (220) + MIN_CONVERSATION_WIDTH (240) = 460,
    // so 400 is below the combined minimum and the pane must collapse rather
    // than claim 220px of a 400px window and leave the conversation 180px —
    // the old `Math.max(MIN_WIDTH, windowWidth * MAX_SHARE)` ceiling would
    // have handed it exactly that 220px floor regardless.
    const result = layoutThreadPane(400, 352);
    expect(result.collapsed).toBe(true);
  });

  it("collapses to the full window width on a phone-sized window", () => {
    expect(layoutThreadPane(360, 352)).toEqual({
      width: 360,
      collapsed: true,
    });
  });

  it("stays a column right at the combined minimum, leaving the conversation exactly its floor", () => {
    const windowWidth = MIN_WIDTH + MIN_CONVERSATION_WIDTH; // 460
    const result = layoutThreadPane(windowWidth, 352);
    expect(result.collapsed).toBe(false);
    expect(result.width).toBe(MIN_WIDTH);
    expect(windowWidth - result.width).toBe(MIN_CONVERSATION_WIDTH);
  });

  it("collapses one pixel below the combined minimum", () => {
    const result = layoutThreadPane(
      MIN_WIDTH + MIN_CONVERSATION_WIDTH - 1,
      352,
    );
    expect(result.collapsed).toBe(true);
  });

  it("never returns a width the conversation would have to shrink below its own floor to make room for", () => {
    for (const windowWidth of [460, 500, 600, 800, 1000, 1400]) {
      const { width, collapsed } = layoutThreadPane(windowWidth, 900);
      if (!collapsed) {
        expect(windowWidth - width).toBeGreaterThanOrEqual(
          MIN_CONVERSATION_WIDTH,
        );
      }
    }
  });
});
