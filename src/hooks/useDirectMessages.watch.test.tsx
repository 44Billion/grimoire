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
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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

describe("useDirectMessages: the live wire", () => {
  beforeEach(() => {
    watchDmInbox.mockClear();
    stopWatching.mockClear();
    syncDmInbox.mockClear();
    syncDmInbox.mockImplementation(async () => {});
  });

  it("watches the inbox on the relays the sync and the walk use", async () => {
    renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    expect(watchDmInbox).toHaveBeenCalledWith(VIEWER, account.signer, RELAYS);
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

  it("takes the wire down when the pane closes", async () => {
    const { unmount } = renderHook(() => useDirectMessages());
    await waitFor(() => expect(watchDmInbox).toHaveBeenCalledTimes(1));
    unmount();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it("stays inert when disabled — a NIP-29 window has no inbox", async () => {
    renderHook(() => useDirectMessages({ enabled: false }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(watchDmInbox).not.toHaveBeenCalled();
  });
});
