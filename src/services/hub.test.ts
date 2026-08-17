import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "nostr-tools";

/**
 * applesauce's `PublishMethod` is `(event, relays?)`, and an action that passes
 * relays means them. A NIP-17 gift wrap goes to the RECIPIENT's inbox; outbox
 * selection answers "where does this author write", which would send a peer's
 * mail to the sender's own relays and nowhere else.
 */

const publish = vi.fn(async (_event: NostrEvent, relays: string[]) => ({
  publishId: "1",
  event: _event,
  successful: relays,
  failed: [],
  ok: true,
}));
const selectRelaysForPublish = vi.fn(async () => ["wss://outbox.example/"]);

vi.mock("./publish-service", () => ({ default: { publish } }));
vi.mock("./relay-selection", () => ({ selectRelaysForPublish }));
vi.mock("./event-store", () => ({ default: {} }));
vi.mock("./accounts", () => ({ default: { active: undefined, active$: {} } }));

const event = { id: "e", pubkey: "p" } as NostrEvent;

beforeEach(() => {
  publish.mockClear();
  selectRelaysForPublish.mockClear();
});

describe("publishEvent", () => {
  it("publishes to exactly the relays it was given", async () => {
    const { publishEvent } = await import("./hub");

    await publishEvent(event, ["wss://peer-inbox.example/"]);

    expect(publish).toHaveBeenCalledWith(event, ["wss://peer-inbox.example/"]);
    expect(selectRelaysForPublish).not.toHaveBeenCalled();
  });

  it("falls back to outbox selection when given none", async () => {
    const { publishEvent } = await import("./hub");

    await publishEvent(event);

    expect(selectRelaysForPublish).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(event, ["wss://outbox.example/"]);
  });

  it("treats an empty list as no list, rather than publishing nowhere", async () => {
    const { publishEvent } = await import("./hub");

    await publishEvent(event, []);

    expect(selectRelaysForPublish).toHaveBeenCalled();
  });
});
