// @vitest-environment happy-dom
/**
 * The bug this file exists for: an embed whose event no relay holds rendered a
 * loading skeleton forever, indistinguishable from a slow load. `useNostrEvent`
 * returns `undefined` both while a load is in flight and after it has exhausted
 * every relay, so no caller could tell the two apart.
 *
 * Two invariants, neither visible to the compiler: the loader completing with
 * an empty store must surface as `"not-found"`, and `"not-found"` must not be
 * a dead end — an event arriving later from an unrelated subscription has to
 * flip it back to `"found"`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { EventStore } from "applesauce-core";
import { EventStoreProvider } from "applesauce-react/providers";
import { finalizeEvent, generateSecretKey, type NostrEvent } from "nostr-tools";
import type { PropsWithChildren } from "react";
import { Observable, Subject } from "rxjs";

/** Emissions and completion are driven per-test through this subject. */
let loaderSubject: Subject<NostrEvent>;

vi.mock("@/services/loaders", () => ({
  eventLoader: () => new Observable((s) => loaderSubject.subscribe(s)),
  addressLoader: () => new Observable((s) => loaderSubject.subscribe(s)),
  batchedAddressLoader: () => new Observable<never>((s) => s.complete()),
}));

import { useNostrEventState } from "./useNostrEvent";

function makeEvent(): NostrEvent {
  return finalizeEvent(
    { kind: 1, content: "found me", tags: [], created_at: 0 },
    generateSecretKey(),
  );
}

describe("useNostrEventState", () => {
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = new EventStore();
    loaderSubject = new Subject<NostrEvent>();
  });

  const wrapper = ({ children }: PropsWithChildren) => (
    <EventStoreProvider eventStore={eventStore}>{children}</EventStoreProvider>
  );

  it("stays loading while the loader is in flight", () => {
    const { result } = renderHook(
      () => useNostrEventState({ id: "a".repeat(64) }),
      { wrapper },
    );

    expect(result.current.status).toBe("loading");
    expect(result.current.event).toBeUndefined();
  });

  it("reports not-found once the loader completes with nothing", async () => {
    const { result } = renderHook(
      () => useNostrEventState({ id: "a".repeat(64) }),
      { wrapper },
    );

    loaderSubject.complete();

    await waitFor(() => expect(result.current.status).toBe("not-found"));
  });

  it("reports not-found when the loader errors", async () => {
    const { result } = renderHook(
      () => useNostrEventState({ id: "a".repeat(64) }),
      { wrapper },
    );

    loaderSubject.error(new Error("every relay refused"));

    await waitFor(() => expect(result.current.status).toBe("not-found"));
  });

  it("flips back to found when the event arrives after not-found", async () => {
    const event = makeEvent();
    const { result } = renderHook(() => useNostrEventState({ id: event.id }), {
      wrapper,
    });

    loaderSubject.complete();
    await waitFor(() => expect(result.current.status).toBe("not-found"));

    // A different subscription delivers it. "not-found" is a statement about
    // what the relays answered, not a decision to stop watching.
    eventStore.add(event);

    await waitFor(() => expect(result.current.status).toBe("found"));
    expect(result.current.event?.id).toBe(event.id);
  });

  it("reports found without waiting for the loader to complete", async () => {
    const event = makeEvent();
    const { result } = renderHook(() => useNostrEventState({ id: event.id }), {
      wrapper,
    });

    eventStore.add(event);

    await waitFor(() => expect(result.current.status).toBe("found"));
  });

  it("stays loading for no pointer", () => {
    const { result } = renderHook(() => useNostrEventState(undefined), {
      wrapper,
    });

    expect(result.current.status).toBe("loading");
  });
});
