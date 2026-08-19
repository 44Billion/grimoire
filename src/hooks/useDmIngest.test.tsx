// @vitest-environment jsdom
/**
 * The ingester runs because an account is signed in, not because a window is
 * open.
 *
 * This is the bug the hook exists to close: the inbox pipeline is refcounted by
 * panes, so with no DM window open nothing held it and nothing arrived. An agent
 * transcript published in that window went to a relay and stayed there — the
 * backward walk is marked exhausted, so no later load asks again.
 *
 * Everything under the hook is mocked. This tests only that the reference is
 * taken, held, topped up on the healing triggers, and released with the account.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";

const VIEWER = "aa".repeat(32);

const account$ = new BehaviorSubject<{
  pubkey: string;
  signer: { nip44?: object };
} | null>({ pubkey: VIEWER, signer: { nip44: {} } });

vi.mock("@/services/accounts", () => ({
  default: { active$: account$ },
}));

const release = vi.fn();
const joinDmInbox = vi.fn((...args: unknown[]) => {
  void args;
  return release;
});
const topUpDmInbox = vi.fn(() => Promise.resolve());
const hasDecryptConsent = vi.fn(async () => true);

vi.mock("@/services/dm-pipeline", () => ({
  joinDmInbox: (...args: unknown[]) =>
    (joinDmInbox as unknown as (...a: unknown[]) => () => void)(...args),
  topUpDmInbox: (...args: unknown[]) =>
    (topUpDmInbox as unknown as (...a: unknown[]) => Promise<void>)(...args),
}));

vi.mock("@/services/dm-inbox", () => ({
  hasDecryptConsent: (...args: unknown[]) =>
    (hasDecryptConsent as unknown as (...a: unknown[]) => Promise<boolean>)(
      ...args,
    ),
}));

const { useDmIngest } = await import("./useDmIngest");

describe("useDmIngest", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    release.mockClear();
    joinDmInbox.mockClear();
    topUpDmInbox.mockClear();
    hasDecryptConsent.mockClear();
    hasDecryptConsent.mockImplementation(async () => true);
    account$.next({ pubkey: VIEWER, signer: { nip44: {} } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("joins the inbox with no window asking it to", async () => {
    renderHook(() => useDmIngest());
    await waitFor(() => expect(joinDmInbox).toHaveBeenCalledTimes(1));
    expect(joinDmInbox.mock.calls[0]?.[0]).toBe(VIEWER);
    // And asks for anything missed straight away, rather than waiting out the
    // first interval — the gap this closes is exactly the one where a wrap
    // arrived while nothing was listening.
    await waitFor(() => expect(topUpDmInbox).toHaveBeenCalled());
  });

  it("tops up on the timer, on focus and on reconnect", async () => {
    renderHook(() => useDmIngest());
    await waitFor(() => expect(topUpDmInbox).toHaveBeenCalled());
    const initial = topUpDmInbox.mock.calls.length;

    vi.advanceTimersByTime(120_000);
    expect(topUpDmInbox.mock.calls.length).toBe(initial + 1);

    // A wedged socket does not announce itself, so returning to the tab is one
    // of the three moments worth asking again.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(topUpDmInbox.mock.calls.length).toBe(initial + 2);

    window.dispatchEvent(new Event("online"));
    expect(topUpDmInbox.mock.calls.length).toBe(initial + 3);
  });

  it("stays inert without consent, leaving the signer alone", async () => {
    hasDecryptConsent.mockImplementation(async () => false);
    renderHook(() => useDmIngest());
    // Give the async gate a turn to resolve before asserting a negative.
    await vi.waitFor(() => expect(hasDecryptConsent).toHaveBeenCalled());
    expect(joinDmInbox).not.toHaveBeenCalled();
  });

  it("stays inert without a nip44 signer, which is what a read-only account is", async () => {
    account$.next({ pubkey: VIEWER, signer: {} });
    renderHook(() => useDmIngest());
    await Promise.resolve();
    expect(joinDmInbox).not.toHaveBeenCalled();
  });

  it("releases the reference when the account goes away", async () => {
    const { unmount } = renderHook(() => useDmIngest());
    await waitFor(() => expect(joinDmInbox).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
});
