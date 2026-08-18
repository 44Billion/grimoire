/**
 * The join between stamps and messages, driven through a render.
 *
 * Worth a test rather than trusting the pieces because the two halves are keyed
 * DIFFERENTLY on purpose: the stamps are rows under a normalized relay URL, the
 * message windows are keyed by the raw URL out of the kind-10009 tag. Every bug
 * this file guards is a lookup that misses — a badge that will not clear, or one
 * that never appears.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@/services/accounts", async () => {
  const { BehaviorSubject } = await import("rxjs");
  return {
    default: { active$: new BehaviorSubject({ pubkey: "aa".repeat(32) }) },
  };
});

import db from "@/services/db";
import { markGroupRead } from "@/services/nip29-reads";
import { useNip29Unread } from "./useNip29Unread";
import type { NostrEvent } from "@/types/nostr";

const ME = "aa".repeat(32);
const THEM = "bb".repeat(32);

/** The sidebar's spelling: `new URL().toString()` appends the slash. */
const SIDEBAR_RELAY = "wss://relay.example.com/";
/** The pane's spelling: `parseIdentifier` only prefixes the scheme. */
const PANE_RELAY = "wss://relay.example.com";
const GROUP = "bitcoin";
const KEY = `${SIDEBAR_RELAY}'${GROUP}`;

const entries = [{ groupId: GROUP, relayUrl: SIDEBAR_RELAY }];

function msg(
  created_at: number,
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: overrides.id ?? `e${created_at}`,
    pubkey: THEM,
    created_at,
    kind: 9,
    content: "hi",
    tags: [["h", GROUP]],
    sig: "",
    ...overrides,
  } as NostrEvent;
}

const now = Math.floor(Date.now() / 1000);

function windows(events: NostrEvent[]): Map<string, NostrEvent[]> {
  return new Map([[KEY, events]]);
}

beforeEach(async () => {
  await db.chatReads.clear();
});

describe("useNip29Unread", () => {
  it("counts everything in a group nobody has opened", async () => {
    const { result } = renderHook(() =>
      useNip29Unread(entries, windows([msg(now - 10), msg(now - 20)])),
    );
    await waitFor(() => expect(result.current.get(KEY)?.count).toBe(2));
    expect(result.current.get(KEY)?.latest).toBe(now - 10);
  });

  it("clears when the stamp was written with the pane's spelling of the relay", async () => {
    // The whole point. The stamp goes in as the adapter writes it; the lookup
    // comes out keyed as the sidebar has it.
    await markGroupRead(ME, PANE_RELAY, GROUP, now - 5);
    const { result } = renderHook(() =>
      useNip29Unread(entries, windows([msg(now - 10), msg(now - 20)])),
    );
    await waitFor(() => expect(result.current.has(KEY)).toBe(false));
  });

  it("counts only what arrived after the stamp", async () => {
    await markGroupRead(ME, PANE_RELAY, GROUP, now - 15);
    const { result } = renderHook(() =>
      useNip29Unread(entries, windows([msg(now - 10), msg(now - 20)])),
    );
    await waitFor(() => expect(result.current.get(KEY)?.count).toBe(1));
  });

  it("never counts the reader's own messages", async () => {
    const { result } = renderHook(() =>
      useNip29Unread(
        entries,
        windows([msg(now - 10, { pubkey: ME, id: "mine" })]),
      ),
    );
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it("flags a mention of the reader", async () => {
    const { result } = renderHook(() =>
      useNip29Unread(
        entries,
        windows([
          msg(now - 10, {
            tags: [
              ["h", GROUP],
              ["p", ME],
            ],
          }),
        ]),
      ),
    );
    await waitFor(() => expect(result.current.get(KEY)?.mention).toBe(true));
  });

  it("reports nothing for a group whose window has not landed yet", async () => {
    const { result } = renderHook(() => useNip29Unread(entries, new Map()));
    await waitFor(() => expect(result.current.size).toBe(0));
  });
});
