import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NostrEvent } from "nostr-tools";

const get = vi.fn();
const toArray = vi.fn();
const add = vi.fn();

vi.mock("./db", () => ({
  default: {
    aiConversations: {
      get: (...args: unknown[]) => get(...args),
      orderBy: () => ({ reverse: () => ({ toArray }) }),
    },
  },
}));

vi.mock("./event-store", () => ({
  default: {
    add: (...args: unknown[]) => add(...args),
  },
}));

const { listConversations, loadStoredConversation } =
  await import("./ai-conversations");

const PUBKEY = "a".repeat(64);

function profileEvent(): NostrEvent {
  return {
    id: "b".repeat(64),
    kind: 0,
    pubkey: PUBKEY,
    created_at: 1,
    tags: [],
    content: '{"name":"jack"}',
    sig: "x",
  };
}

function row() {
  return {
    windowId: "w1",
    updatedAt: 2,
    turns: [
      {
        role: "user" as const,
        content: `who is nostr:npub1${"q".repeat(58)}?`,
        mentions: { events: [profileEvent()], pubkeys: [PUBKEY] },
      },
      { role: "assistant" as const, content: "someone" },
    ],
  };
}

beforeEach(() => {
  get.mockReset();
  toArray.mockReset();
  add.mockReset();
});

describe("stored mentions", () => {
  it("puts a turn's referenced events back in the EventStore", async () => {
    // The store is memory and a conversation outlives it: without this, a
    // reopened transcript renders a person as a stub.
    get.mockResolvedValue(row());
    const loaded = await loadStoredConversation("w1");
    expect(loaded.turns).toHaveLength(2);
    expect(add).toHaveBeenCalledTimes(1);
    expect((add.mock.calls[0][0] as NostrEvent).pubkey).toBe(PUBKEY);
  });

  it("hydrates the index too, since its titles render mentions", async () => {
    toArray.mockResolvedValue([row()]);
    const summaries = await listConversations();
    expect(summaries[0].windowId).toBe("w1");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("survives a stored event the store rejects", async () => {
    add.mockImplementation(() => {
      throw new Error("bad event");
    });
    get.mockResolvedValue(row());
    // A malformed row must leave an empty-ish window, never a broken one.
    await expect(loadStoredConversation("w1")).resolves.toMatchObject({
      turns: expect.any(Array),
    });
  });

  it("loads a conversation stored before mentions were kept", async () => {
    get.mockResolvedValue({
      windowId: "w1",
      updatedAt: 1,
      turns: [{ role: "user", content: "what is a relay?" }],
    });
    const loaded = await loadStoredConversation("w1");
    expect(loaded.turns).toHaveLength(1);
    expect(add).not.toHaveBeenCalled();
  });
});
