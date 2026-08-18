import { describe, it, expect, beforeEach } from "vitest";
import {
  windowCursor,
  setWindowCursor,
  clearWindowCursors,
} from "./window-cursor";

const COMMUNITY = "aa".repeat(32);
const OTHER_COMMUNITY = "bb".repeat(32);
const CHANNEL = "cc".repeat(32);
const OTHER_CHANNEL = "dd".repeat(32);

describe("window cursor", () => {
  beforeEach(() => clearWindowCursors());

  it("keeps two windows in two channels of one community", () => {
    // The whole point. A device-wide cursor made the second window's pick the
    // first window's pick, which is what a window is not for.
    setWindowCursor("win-1", COMMUNITY, CHANNEL);
    setWindowCursor("win-2", COMMUNITY, OTHER_CHANNEL);
    expect(windowCursor("win-1", COMMUNITY)).toBe(CHANNEL);
    expect(windowCursor("win-2", COMMUNITY)).toBe(OTHER_CHANNEL);
  });

  it("remembers a window's place per community", () => {
    setWindowCursor("win-1", COMMUNITY, CHANNEL);
    setWindowCursor("win-1", OTHER_COMMUNITY, OTHER_CHANNEL);
    expect(windowCursor("win-1", COMMUNITY)).toBe(CHANNEL);
    expect(windowCursor("win-1", OTHER_COMMUNITY)).toBe(OTHER_CHANNEL);
  });

  it("does not answer for a window that has never been clicked in", () => {
    setWindowCursor("win-1", COMMUNITY, CHANNEL);
    expect(windowCursor("win-2", COMMUNITY)).toBeUndefined();
  });

  it("matches a community id whatever its case", () => {
    setWindowCursor("win-1", COMMUNITY.toUpperCase(), CHANNEL);
    expect(windowCursor("win-1", COMMUNITY)).toBe(CHANNEL);
  });

  it("stays silent outside the window system", () => {
    // ConcordViewer renders without a windowId on the preview routes.
    setWindowCursor(undefined, COMMUNITY, CHANNEL);
    expect(windowCursor(undefined, COMMUNITY)).toBeUndefined();
    expect(windowCursor("win-1", undefined)).toBeUndefined();
  });
});
