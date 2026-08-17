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

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
vi.mock("./accounts", () => ({
  default: { active: { pubkey: "a".repeat(64) }, active$: {} },
}));

const event = {
  id: "e",
  pubkey: "p",
  kind: 1,
  tags: [],
} as unknown as NostrEvent;

function giftWrap(recipient: string): NostrEvent {
  return {
    id: "w",
    pubkey: "ephemeral",
    kind: 1059,
    tags: [["p", recipient]],
    content: "ciphertext",
  } as unknown as NostrEvent;
}

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

describe("the gift-wrap guard", () => {
  it("refuses to publish someone else's wrap on the authenticated pool", async () => {
    const { publishEvent } = await import("./hub");

    // This pool is auto-authenticated by relayAuthManager, and applesauce turns
    // an `auth-required` refusal into a retry that WAITS for authentication —
    // so a wrap sent here does not fail, it succeeds while handing the relay
    // the sender's real pubkey. The only safe answer is to refuse.
    await expect(
      publishEvent(giftWrap(PEER), ["wss://peer-inbox.example/"]),
    ).rejects.toThrow(/gift wrap addressed to someone else/);
    expect(publish).not.toHaveBeenCalled();
  });

  it("allows the self-copy, which goes to our own relays", async () => {
    const { publishEvent } = await import("./hub");

    await publishEvent(giftWrap(ME), ["wss://my-inbox.example/"]);

    expect(publish).toHaveBeenCalled();
  });

  it("refuses a wrap addressed to us AND someone else", async () => {
    const { publishEvent } = await import("./hub");
    const both = {
      ...giftWrap(ME),
      tags: [
        ["p", ME],
        ["p", PEER],
      ],
    } as NostrEvent;

    await expect(publishEvent(both, ["wss://x.example/"])).rejects.toThrow();
  });
});
