// @vitest-environment jsdom
/**
 * The one thing the inbox hook must do no matter what else fails: put the live
 * wire up and leave it up.
 *
 * Everything below the hook is mocked. This is not a test of syncing, of
 * decryption or of the store — it is a test of ORDER, because the standing
 * subscription used to be started after a catch-up that could throw, and a
 * session that lost it looked perfectly healthy while never receiving another
 * message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";

const VIEWER = "aa".repeat(32);
const RELAYS = ["wss://inbox.example"];

const account = {
  pubkey: VIEWER,
  signer: { nip44: {}, nip04: undefined },
};

vi.mock("@/services/accounts", () => ({
  default: { active$: new BehaviorSubject(account) },
}));

const stopWatching = vi.fn();
const watchDmInbox = vi.fn(() => stopWatching);
const syncDmInbox = vi.fn(async () => {});

vi.mock("@/services/dm-inbox", () => ({
  watchDmInbox: (...args: unknown[]) =>
    (watchDmInbox as unknown as (...a: unknown[]) => () => void)(...args),
  syncDmInbox: (...args: unknown[]) =>
    (syncDmInbox as unknown as (...a: unknown[]) => Promise<void>)(...args),
  backfillDmHistory: vi.fn(async () => {}),
  grantDecryptConsent: vi.fn(async () => {}),
  hasDecryptConsent: vi.fn(async () => true),
  isHistoryExhausted: vi.fn(async () => true),
  resetHistoryWalk: vi.fn(async () => {}),
}));

vi.mock("@/services/dm-store", () => ({
  listDmConversations: vi.fn(async () => []),
  dmUnreadSummary: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("@/services/dm-reads", () => ({
  markAllDmsRead: vi.fn(async () => {}),
  readDmLastRead: vi.fn(async () => 0),
}));

vi.mock("@/lib/dm/relays", () => ({
  ownDmReadRelays: vi.fn(async () => RELAYS),
  followedPubkeys: vi.fn(async () => []),
}));

vi.mock("@/services/dm-legacy-inbox", () => ({
  hasImportedLegacyDms: vi.fn(async () => true),
  importLegacyDms: vi.fn(async () => {}),
  resetLegacyImport: vi.fn(async () => {}),
}));

vi.mock("@/services/dm-bus", () => ({
  DM_LIST_SCOPE: "dm:list",
  onDmScope: vi.fn(() => () => {}),
}));

const { useDirectMessages } = await import("./useDirectMessages");
const { resetDmPipelines, TEARDOWN_GRACE_MS } =
  await import("@/services/dm-pipeline");

describe("useDirectMessages: the live wire", () => {
  beforeEach(() => {
    resetDmPipelines();
    watchDmInbox.mockClear();
    stopWatching.mockClear();
    syncDmInbox.mockClear();
    syncDmInbox.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDmPipelines();
  });

  it("watches the inbox on the relays the sync and the walk use", async () => {
    renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    expect(watchDmInbox).toHaveBeenCalledWith(
      VIEWER,
      account.signer,
      RELAYS,
      expect.anything(),
    );
  });

  it("still watches when the catch-up sync throws", async () => {
    // The regression. One relay erroring during the catch-up used to take the
    // standing subscription with it for the rest of the session.
    syncDmInbox.mockImplementation(async () => {
      throw new Error("a relay refused the page");
    });
    renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
  });

  it("opens ONE wire for however many panes are watching", async () => {
    // Three panes is an ordinary session — a chat browser, a second window, a
    // NIP-17 conversation — and each used to run the whole pipeline itself.
    const panes = [
      renderHook(() => useDirectMessages()),
      renderHook(() => useDirectMessages()),
      renderHook(() => useDirectMessages()),
    ];
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    expect(syncDmInbox).toHaveBeenCalledTimes(1);
    panes.forEach((pane) => pane.unmount());
  });

  it("keeps the wire up while any pane is still open", async () => {
    const first = renderHook(() => useDirectMessages());
    const second = renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    first.unmount();
    expect(stopWatching).not.toHaveBeenCalled();
    second.unmount();
  });

  it("takes the wire down once the last pane has been gone a while", async () => {
    // The grace period is what makes a re-render cheap: the hook releases and
    // rejoins on every list refresh, and tearing the walk down each time would
    // be worse than the duplication the pipeline removes.
    const { unmount } = renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();
    unmount();
    expect(stopWatching).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(TEARDOWN_GRACE_MS + 1));
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it("stays inert when disabled — a NIP-29 window has no inbox", async () => {
    renderHook(() => useDirectMessages({ enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watchDmInbox).not.toHaveBeenCalled();
  });
});
