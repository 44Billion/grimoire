// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaintedContainer } from "./use-painted-container";

/**
 * A document that is not painting runs no animation frames — measured on a
 * backgrounded tab: zero callbacks in twenty-five seconds. These tests stand in
 * for that by holding the queued callbacks and releasing them on demand.
 */
let queue: FrameRequestCallback[] = [];

function paintOneFrame() {
  const due = queue;
  queue = [];
  act(() => {
    for (const cb of due) cb(0);
  });
}

beforeEach(() => {
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => vi.unstubAllGlobals());

/** A container with a height, as an ordinary laid-out pane has. */
function sized(result: { current: { ref: { current: HTMLElement | null } } }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
  result.current.ref.current = el;
}

describe("usePaintedContainer", () => {
  it("stays shut while no frame is painted", () => {
    const { result } = renderHook(() => usePaintedContainer<HTMLElement>("a"));
    sized(result);
    expect(result.current.painted).toBe(false);
  });

  it("opens on the first painted frame", () => {
    const { result } = renderHook(() => usePaintedContainer<HTMLElement>("a"));
    sized(result);
    paintOneFrame();
    expect(result.current.painted).toBe(true);
  });

  it("keeps waiting while the container has no height", () => {
    const { result } = renderHook(() => usePaintedContainer<HTMLElement>("a"));
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    result.current.ref.current = el;
    paintOneFrame();
    expect(result.current.painted).toBe(false);
    // Still polling, so it opens as soon as the pane is sized.
    el.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    paintOneFrame();
    expect(result.current.painted).toBe(true);
  });

  it("re-arms for the next mount", () => {
    // The whole point of the key: the list unmounts on every channel switch,
    // and a gate that opened once would let the next one mount unpainted.
    const { result, rerender } = renderHook(
      ({ key }) => usePaintedContainer<HTMLElement>(key),
      { initialProps: { key: "a" } },
    );
    sized(result);
    paintOneFrame();
    expect(result.current.painted).toBe(true);

    rerender({ key: "b" });
    expect(result.current.painted).toBe(false);
    paintOneFrame();
    expect(result.current.painted).toBe(true);
  });
});
