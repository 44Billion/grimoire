/**
 * The pipeline is the only thing that reads the gift-wrap stream, so what it
 * has to get right is arithmetic on other people's expectations: one read for N
 * askers, one relay set for every reader, a wire that comes back when it drops,
 * and a start that a bad moment does not kill for the session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const VIEWER = "aa".repeat(32);
const RELAYS = ["wss://inbox.example", "wss://second.example"];

const mocks = vi.hoisted(() => ({
  syncDmInbox: vi.fn(async () => ({ written: 0, failed: 0, fetched: 0 })),
  backfillDmHistory: vi.fn(async () => ({
    pages: 0,
    fetched: 0,
    written: 0,
    exhausted: true,
  })),
  isHistoryExhausted: vi.fn(async () => true),
  stopWatching: vi.fn(),
  watchDmInbox: vi.fn(
    (
      _viewer: string,
      _signer: unknown,
      _relays: string[],
      options?: { onClosed?: (reason: "error" | "complete") => void },
    ) => {
      lastWatch.onClosed = options?.onClosed;
      return mocks.stopWatching;
    },
  ),
  ownDmReadRelays: vi.fn(async () => RELAYS),
  followedPubkeys: vi.fn(async () => []),
  hasImportedLegacyDms: vi.fn(async () => true),
  importLegacyDms: vi.fn(async () => {}),
}));

const lastWatch: { onClosed?: (reason: "error" | "complete") => void } = {};

vi.mock("./dm-inbox", () => ({
  syncDmInbox: mocks.syncDmInbox,
  backfillDmHistory: mocks.backfillDmHistory,
  isHistoryExhausted: mocks.isHistoryExhausted,
  watchDmInbox: mocks.watchDmInbox,
}));

vi.mock("./dm-legacy-inbox", () => ({
  hasImportedLegacyDms: mocks.hasImportedLegacyDms,
  importLegacyDms: mocks.importLegacyDms,
}));

vi.mock("@/lib/dm/relays", () => ({
  ownDmReadRelays: mocks.ownDmReadRelays,
  followedPubkeys: mocks.followedPubkeys,
}));

const {
  joinDmInbox,
  topUpDmInbox,
  pageDmInboxBefore,
  restartDmInbox,
  resetDmPipelines,
  TEARDOWN_GRACE_MS,
} = await import("./dm-pipeline");

const signer = { nip44: {} } as never;

/** Let every already-resolved promise in the chain run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("dm pipeline", () => {
  beforeEach(() => {
    resetDmPipelines();
    lastWatch.onClosed = undefined;
    vi.clearAllMocks();
    mocks.ownDmReadRelays.mockImplementation(async () => RELAYS);
    mocks.syncDmInbox.mockImplementation(async () => ({
      written: 0,
      failed: 0,
      fetched: 0,
    }));
  });

  afterEach(() => {
    resetDmPipelines();
    vi.useRealTimers();
  });

  describe("one pipeline for every pane", () => {
    it("starts once and watches once, however many joined", async () => {
      const releases = [
        joinDmInbox(VIEWER, signer),
        joinDmInbox(VIEWER, signer),
        joinDmInbox(VIEWER, signer),
      ];
      await settle();
      expect(mocks.ownDmReadRelays).toHaveBeenCalledTimes(1);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);
      expect(mocks.syncDmInbox).toHaveBeenCalledTimes(1);
      releases.forEach((release) => release());
    });

    it("ignores a release called twice, which a React cleanup can do", async () => {
      const first = joinDmInbox(VIEWER, signer);
      const second = joinDmInbox(VIEWER, signer);
      await settle();
      first();
      first();
      // The second pane is still holding it, so the double release must not
      // have counted its reference away.
      expect(mocks.stopWatching).not.toHaveBeenCalled();
      second();
    });

    it("keeps the wire up through the grace period and drops it after", async () => {
      vi.useFakeTimers();
      const release = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      release();
      expect(mocks.stopWatching).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(TEARDOWN_GRACE_MS + 1);
      expect(mocks.stopWatching).toHaveBeenCalledTimes(1);
    });
  });

  describe("reads a conversation asks for", () => {
    it("hands concurrent askers the one read", async () => {
      const release = joinDmInbox(VIEWER, signer);
      await settle();
      mocks.syncDmInbox.mockClear();

      let resolveSync: (() => void) | undefined;
      mocks.syncDmInbox.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSync = () =>
              resolve({ written: 0, failed: 0, fetched: 0 } as never);
          }) as never,
      );

      const a = topUpDmInbox(VIEWER);
      const b = topUpDmInbox(VIEWER);
      const c = topUpDmInbox(VIEWER);
      await settle();
      expect(mocks.syncDmInbox).toHaveBeenCalledTimes(1);

      resolveSync?.();
      await Promise.all([a, b, c]);
      release();
    });

    it("asks again once the shared read has finished", async () => {
      const release = joinDmInbox(VIEWER, signer);
      await settle();
      mocks.syncDmInbox.mockClear();

      await topUpDmInbox(VIEWER);
      await topUpDmInbox(VIEWER);
      expect(mocks.syncDmInbox).toHaveBeenCalledTimes(2);
      release();
    });

    it("reads on the relay set the standing subscription is on", async () => {
      const release = joinDmInbox(VIEWER, signer);
      await settle();
      mocks.ownDmReadRelays.mockClear();

      await topUpDmInbox(VIEWER);
      // The whole point of sharing it: a second resolution can disagree, and a
      // wrap on a relay only one reader was watching is a message that never
      // arrives.
      expect(mocks.ownDmReadRelays).not.toHaveBeenCalled();
      expect(mocks.syncDmInbox).toHaveBeenLastCalledWith(
        VIEWER,
        signer,
        expect.objectContaining({ relays: RELAYS }),
      );
      release();
    });

    it("pages back once per boundary, and separately per boundary", async () => {
      const release = joinDmInbox(VIEWER, signer);
      await settle();
      mocks.syncDmInbox.mockClear();

      let pending: Array<() => void> = [];
      mocks.syncDmInbox.mockImplementation(
        () =>
          new Promise((resolve) => {
            pending.push(() =>
              resolve({ written: 0, failed: 0, fetched: 0 } as never),
            );
          }) as never,
      );

      const first = pageDmInboxBefore(VIEWER, 1000);
      const same = pageDmInboxBefore(VIEWER, 1000);
      const other = pageDmInboxBefore(VIEWER, 900);
      await settle();
      expect(mocks.syncDmInbox).toHaveBeenCalledTimes(2);

      pending.forEach((resolve) => resolve());
      pending = [];
      await Promise.all([first, same, other]);
      release();
    });

    it("still reads with no pane holding the inbox open", async () => {
      // The adapter runs outside the window system too — a preview route, a
      // conversation opened before the list has mounted anywhere.
      await topUpDmInbox(VIEWER, signer);
      expect(mocks.ownDmReadRelays).toHaveBeenCalledTimes(1);
      expect(mocks.syncDmInbox).toHaveBeenCalledTimes(1);
    });

    it("says nothing and reads nothing with no signer anywhere", async () => {
      await topUpDmInbox(VIEWER);
      await pageDmInboxBefore(VIEWER, 1000);
      expect(mocks.syncDmInbox).not.toHaveBeenCalled();
    });
  });

  describe("a wire that drops", () => {
    it("comes back, after a wait", async () => {
      vi.useFakeTimers();
      const release = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);

      lastWatch.onClosed?.("error");
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(2);
      release();
    });

    it("waits longer each time it drops straight back", async () => {
      vi.useFakeTimers();
      const release = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);
      await settle();

      lastWatch.onClosed?.("error");
      await vi.advanceTimersByTimeAsync(5_001);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(2);

      lastWatch.onClosed?.("error");
      await vi.advanceTimersByTimeAsync(5_001);
      // Still waiting: the second delay is longer than the first.
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(3);
      release();
    });

    it("does not come back when it was told to stop", async () => {
      vi.useFakeTimers();
      const release = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);
      await settle();
      release();
      await vi.advanceTimersByTimeAsync(TEARDOWN_GRACE_MS + 1);
      expect(mocks.stopWatching).toHaveBeenCalledTimes(1);

      // Whatever the stream says on its way out, nothing is watching any more.
      lastWatch.onClosed?.("complete");
      await vi.advanceTimersByTimeAsync(120_001);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);
    });
  });

  describe("a start that could not begin", () => {
    it("keeps trying before it gives up", async () => {
      vi.useFakeTimers();
      mocks.ownDmReadRelays.mockImplementation(async () => []);
      const release = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);

      // A relay list that has not synced yet is the ordinary case at load, and
      // one empty answer must not cost the session its inbox.
      expect(mocks.ownDmReadRelays).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mocks.ownDmReadRelays).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10_001);
      expect(mocks.ownDmReadRelays).toHaveBeenCalledTimes(3);
      expect(mocks.watchDmInbox).not.toHaveBeenCalled();
      release();
    });

    it("is tried again by the next pane rather than lost for the session", async () => {
      vi.useFakeTimers();
      mocks.ownDmReadRelays.mockImplementation(async () => []);
      const first = joinDmInbox(VIEWER, signer);
      // Out the far side of every attempt: the start has given up.
      await vi.advanceTimersByTimeAsync(30_001);
      expect(mocks.watchDmInbox).not.toHaveBeenCalled();

      mocks.ownDmReadRelays.mockImplementation(async () => RELAYS);
      const second = joinDmInbox(VIEWER, signer);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);
      first();
      second();
    });
  });

  describe("restart", () => {
    it("reopens the wire and walks again", async () => {
      const release = joinDmInbox(VIEWER, signer);
      await settle();
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(1);

      restartDmInbox(VIEWER);
      await settle();
      expect(mocks.stopWatching).toHaveBeenCalledTimes(1);
      expect(mocks.watchDmInbox).toHaveBeenCalledTimes(2);
      release();
    });

    it("does nothing when nothing is watching", async () => {
      restartDmInbox(VIEWER);
      await settle();
      expect(mocks.watchDmInbox).not.toHaveBeenCalled();
    });
  });
});
