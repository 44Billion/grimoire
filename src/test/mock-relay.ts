import { WebSocketServer } from "ws";
import type { NostrEvent } from "nostr-tools";

/**
 * Minimal in-process relay for tests.
 *
 * Exists because the relay behaviours that break clients are the awkward ones —
 * a relay that connects and then says nothing, or refuses a REQ with
 * `auth-required`, or closes a subscription right after EOSE. Those are hard to
 * find in the wild and impossible to rely on in CI, but each has caused a real
 * hang or request flood in this codebase.
 */
export type MockRelayBehaviour =
  /** Serve `events`, then EOSE. The well-behaved case. */
  | { kind: "normal"; events?: NostrEvent[] }
  /** Refuse every REQ with `auth-required` and never send an AUTH frame. */
  | { kind: "auth-required" }
  /** Accept the REQ and then say nothing at all. */
  | { kind: "silent" }
  /** EOSE, then an unprefixed CLOSED — what triggers resubscribe. */
  | { kind: "close-after-eose"; events?: NostrEvent[] };

export interface MockRelay {
  url: string;
  /** REQ frames received, for asserting a client isn't flooding. */
  reqCount: () => number;
  close: () => Promise<void>;
}

/** Start a mock relay on an ephemeral port. Always `await relay.close()`. */
export async function startMockRelay(
  behaviour: MockRelayBehaviour,
): Promise<MockRelay> {
  const server = new WebSocketServer({ port: 0 });
  let reqs = 0;

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(message) || message[0] !== "REQ") return;

      reqs++;
      const subId = message[1];

      switch (behaviour.kind) {
        case "normal":
        case "close-after-eose":
          for (const event of behaviour.events ?? []) {
            socket.send(JSON.stringify(["EVENT", subId, event]));
          }
          socket.send(JSON.stringify(["EOSE", subId]));
          if (behaviour.kind === "close-after-eose") {
            socket.send(JSON.stringify(["CLOSED", subId, ""]));
          }
          break;

        case "auth-required":
          socket.send(
            JSON.stringify(["CLOSED", subId, "auth-required: need auth"]),
          );
          break;

        case "silent":
          break;
      }
    });
  });

  return {
    url: `ws://localhost:${port}`,
    reqCount: () => reqs,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of server.clients) client.terminate();
        server.close(() => resolve());
      }),
  };
}

/** An unsigned-but-shaped event, good enough for relay plumbing tests. */
export function fakeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  const id = (overrides.id ?? "").padEnd(64, "a").slice(0, 64);
  return {
    id: id || "a".repeat(64),
    kind: 1,
    pubkey: "b".repeat(64),
    created_at: 1_700_000_000,
    content: "test",
    tags: [],
    sig: "c".repeat(128),
    ...overrides,
  } as NostrEvent;
}
