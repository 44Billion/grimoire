import { describe, expect, it, vi, beforeEach } from "vitest";

const requestEvents = vi.fn();
const getNipText = vi.fn();

vi.mock("./relay-subscription", () => ({
  requestEvents: (...args: unknown[]) => requestEvents(...args),
}));

vi.mock("@/services/nip-text", () => ({
  getNipText: (...args: unknown[]) => getNipText(...args),
}));

vi.mock("@/services/loaders", () => ({
  AGGREGATOR_RELAYS: ["wss://default.example"],
}));

const { AI_TOOLS, createToolExecutors, refuseIfNeeded } =
  await import("./ai-tools");

function eventFor(id: string, content = "hello") {
  return {
    id,
    kind: 1,
    pubkey: "a".repeat(64),
    created_at: 1,
    tags: [],
    content,
    sig: "x",
  };
}

const openWindow = vi.fn();
const executors = createToolExecutors(openWindow);

beforeEach(() => {
  requestEvents.mockReset();
  getNipText.mockReset();
  openWindow.mockReset();
  requestEvents.mockResolvedValue([]);
  getNipText.mockResolvedValue(undefined);
});

describe("the tool surface", () => {
  it("stays small, because every name shows in the permission prompt", () => {
    expect(AI_TOOLS.map((tool) => tool.function.name)).toEqual([
      "lookup_spec",
      "query_nostr",
      "open_window",
    ]);
  });

  it("exposes nothing that signs, publishes, or spends", () => {
    const described = JSON.stringify(AI_TOOLS).toLowerCase();
    for (const forbidden of ["publish", "sign", "zap", "send", "delete"]) {
      expect(described).not.toContain(`"${forbidden}`);
    }
  });
});

describe("lookup_spec", () => {
  it("answers from the kind registry", async () => {
    const result = (await executors.lookup_spec({ kind: 1 })) as {
      kind: { name: string };
    };
    expect(result.kind.name).toBeTruthy();
  });

  it("follows a kind to the NIP that defines it", async () => {
    getNipText.mockResolvedValue("# NIP-01 text");
    const result = (await executors.lookup_spec({ kind: 1 })) as {
      nip: { text: string };
    };
    expect(result.nip.text).toContain("NIP-01 text");
  });

  it("normalises a nip id", async () => {
    getNipText.mockResolvedValue("text");
    await executors.lookup_spec({ nip: "nip-9" });
    expect(getNipText).toHaveBeenCalledWith("09");
  });

  it("says so when the text will not load, rather than inventing", async () => {
    const result = (await executors.lookup_spec({ nip: "65" })) as {
      nip: { error: string };
    };
    expect(result.nip.error).toMatch(/Could not load/);
  });

  it("rejects an empty call", async () => {
    expect(await executors.lookup_spec({})).toMatchObject({
      error: expect.stringContaining("nip id"),
    });
  });
});

describe("query_nostr", () => {
  it("requires kinds", async () => {
    expect(await executors.query_nostr({})).toMatchObject({
      error: expect.stringContaining("kinds"),
    });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("caps the limit a model asks for", async () => {
    await executors.query_nostr({ kinds: [1], limit: 5000 });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], limit: 20 }],
    );
  });

  it("drops authors that are not hex pubkeys", async () => {
    await executors.query_nostr({
      kinds: [0],
      authors: ["npub1whatever", "b".repeat(64)],
    });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [0], authors: ["b".repeat(64)], limit: 5 }],
    );
  });

  it("truncates content so one long article cannot fill the window", async () => {
    requestEvents.mockResolvedValue([
      eventFor("c".repeat(64), "x".repeat(9000)),
    ]);
    const result = (await executors.query_nostr({ kinds: [30023] })) as {
      events: { content: string }[];
    };
    expect(result.events[0].content).toMatch(/\[truncated\]$/);
    expect(result.events[0].content.length).toBeLessThan(2_100);
  });
});

describe("open_window", () => {
  it("refuses a command that acts on the user's behalf", () => {
    expect(refuseIfNeeded("post gm")).toMatch(/run it yourself/);
    expect(refuseIfNeeded("zap alice 100")).toBeTruthy();
  });

  it("refuses anything that is not a grimoire command", () => {
    expect(refuseIfNeeded("curl evil.example")).toMatch(/Not a grimoire/);
  });

  it("permits a read-only command", () => {
    expect(refuseIfNeeded("nip 65")).toBeUndefined();
  });
});
