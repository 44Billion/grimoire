import { describe, it, expect, vi, beforeEach } from "vitest";
import { of } from "rxjs";
import { finalizeEvent, generateSecretKey, kinds } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";

/**
 * Which relay list answers is not cosmetic. "This peer publishes no DM inbox"
 * is a thing the sender has to be told BEFORE the wrap goes out, because the
 * alternative — quietly spraying their outbox — puts private mail on relays
 * they never nominated to hold it.
 */

const replaceable = vi.fn();
vi.mock("@/services/event-store", () => ({ default: { replaceable } }));

const stateRelays: Array<{ url: string; read: boolean; write: boolean }> = [];
vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  getDefaultStore: () => ({
    get: () => ({ activeAccount: { relays: stateRelays } }),
  }),
}));

const SELF = "a".repeat(64);
const PEER = "b".repeat(64);

/** Build the replaceable lookup table a test wants, keyed `kind:pubkey`. */
function serve(events: Record<string, NostrEvent | undefined>) {
  replaceable.mockImplementation(
    ({ kind, pubkey }: { kind: number; pubkey: string }) =>
      of(events[`${kind}:${pubkey}`]),
  );
}

/** A relay list event, signed by a throwaway key but attributed to `pubkey`. */
function relayList(kind: number, pubkey: string, tags: string[][]): NostrEvent {
  const signed = finalizeEvent(
    { kind, created_at: 1, tags, content: "" },
    generateSecretKey(),
  );
  return { ...signed, pubkey };
}

beforeEach(() => {
  vi.resetModules();
  replaceable.mockReset();
  stateRelays.length = 0;
});

describe("resolveDmRelays", () => {
  it("prefers the kind 10050 DM inbox", async () => {
    serve({
      [`${kinds.DirectMessageRelaysList}:${PEER}`]: relayList(
        kinds.DirectMessageRelaysList,
        PEER,
        [["relay", "wss://dm.example.com"]],
      ),
      [`${kinds.RelayList}:${PEER}`]: relayList(kinds.RelayList, PEER, [
        ["r", "wss://mailbox.example.com", "read"],
      ]),
    });
    const { resolveDmRelays } = await import("./relays");

    const result = await resolveDmRelays(PEER, 50);

    expect(result.source).toBe("dm-relays");
    expect(result.relays).toEqual(["wss://dm.example.com/"]);
  });

  it("falls back to the NIP-65 inbox and says so", async () => {
    serve({
      [`${kinds.RelayList}:${PEER}`]: relayList(kinds.RelayList, PEER, [
        ["r", "wss://mailbox.example.com", "read"],
        ["r", "wss://outbox.example.com", "write"],
      ]),
    });
    const { resolveDmRelays } = await import("./relays");

    const result = await resolveDmRelays(PEER, 50);

    expect(result.source).toBe("inboxes");
    // The write-only relay is not an inbox — a wrap left there is mail
    // delivered to an outgoing tray.
    expect(result.relays).toEqual(["wss://mailbox.example.com/"]);
  });

  it("reports none rather than inventing somewhere to send", async () => {
    serve({});
    const { resolveDmRelays } = await import("./relays");

    const result = await resolveDmRelays(PEER, 50);

    expect(result).toEqual({ relays: [], source: "none" });
  });
});

describe("ownDmReadRelays", () => {
  it("unions every list, because old mail sits on the old inbox", async () => {
    stateRelays.push({
      url: "wss://configured.example.com/",
      read: true,
      write: false,
    });
    serve({
      [`${kinds.DirectMessageRelaysList}:${SELF}`]: relayList(
        kinds.DirectMessageRelaysList,
        SELF,
        [["relay", "wss://dm.example.com"]],
      ),
      [`${kinds.RelayList}:${SELF}`]: relayList(kinds.RelayList, SELF, [
        ["r", "wss://mailbox.example.com", "read"],
      ]),
    });
    const { ownDmReadRelays } = await import("./relays");

    const relays = await ownDmReadRelays(SELF, 50);

    expect(new Set(relays)).toEqual(
      new Set([
        "wss://dm.example.com/",
        "wss://mailbox.example.com/",
        "wss://configured.example.com/",
      ]),
    );
  });
});

describe("hasOwnDmRelayList", () => {
  it("is false when the list exists but nominates nothing", async () => {
    serve({
      [`${kinds.DirectMessageRelaysList}:${SELF}`]: relayList(
        kinds.DirectMessageRelaysList,
        SELF,
        [],
      ),
    });
    const { hasOwnDmRelayList } = await import("./relays");

    expect(await hasOwnDmRelayList(SELF, 50)).toBe(false);
  });
});
