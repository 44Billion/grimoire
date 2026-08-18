import { describe, expect, it, vi, beforeEach } from "vitest";
import { nip19 } from "nostr-tools";
import { EMPTY } from "rxjs";

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
  addressLoader: (...args: unknown[]) => addressLoader(...args),
  eventLoader: (...args: unknown[]) => eventLoader(...args),
}));

const eventLoader = vi.fn();

const addressLoader = vi.fn();
const accounts: { active?: { pubkey: string } } = {};
const getReplaceable = vi.fn();

vi.mock("@/services/accounts", () => ({ default: accounts }));
const spellsToArray = vi.fn();

vi.mock("@/services/db", () => ({
  default: { spells: { toArray: () => spellsToArray() } },
  // The command catalogue pulls in the man pages, which reach the relay
  // singletons; they need this at module init.
  relayLivenessStorage: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

vi.mock("@/services/event-store", () => ({
  default: {
    getReplaceable: (...args: unknown[]) => getReplaceable(...args),
    getEvent: (...args: unknown[]) => getEvent(...args),
  },
}));

const getEvent = vi.fn();

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
  getReplaceable.mockReset();
  getEvent.mockReset();
  spellsToArray.mockReset();
  spellsToArray.mockResolvedValue([]);
  addressLoader.mockReset();
  eventLoader.mockReset();
  accounts.active = undefined;
  requestEvents.mockResolvedValue([]);
  getNipText.mockResolvedValue(undefined);
});

describe("the tool surface", () => {
  it("stays small, because every name shows in the permission prompt", () => {
    expect(AI_TOOLS.map((tool) => tool.function.name)).toEqual([
      "lookup_spec",
      "query_nostr",
      "list_spells",
      "resolve",
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

  it("reads a command's manual page, flags and all", async () => {
    const result = (await executors.lookup_spec({ command: "req" })) as {
      command: { synopsis: string; options?: unknown[] };
    };
    expect(result.command.synopsis).toContain("req");
    expect(result.command.options?.length).toBeGreaterThan(0);
  });

  it("enumerates the commands, so a model cannot ask for one that is not there", () => {
    const schema = AI_TOOLS[0].function.parameters as {
      properties: { command: { enum?: string[] } };
    };
    const names = schema.properties.command.enum ?? [];
    expect(names).toContain("req");
    // The prompt's catalogue hides these, so the lookup must not offer them.
    expect(names).not.toContain("zap");
    expect(names).not.toContain("post");
    expect(names).not.toContain("wallet");
  });

  it("still answers as data when a provider ignores the enum", async () => {
    const result = (await executors.lookup_spec({ command: "frobnicate" })) as {
      command: { error: string };
    };
    expect(result.command.error).toContain("req");
  });

  it("will not read the manual of a command it may not propose", async () => {
    const result = (await executors.lookup_spec({ command: "zap" })) as {
      command: { error: string };
    };
    expect(result.command.error).toContain("No such command");
  });

  it("rejects an empty call", async () => {
    expect(await executors.lookup_spec({})).toMatchObject({
      error: expect.stringContaining("nip id"),
    });
  });
});

describe("query_nostr", () => {
  it("refuses a filter that constrains nothing", async () => {
    expect(await executors.query_nostr({ limit: 10 })).toMatchObject({
      error: expect.stringContaining("at least one"),
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

  it("passes the rest of a NIP-01 filter through", async () => {
    await executors.query_nostr({
      ids: ["d".repeat(64)],
      since: 1_700_000_000.7,
      until: 1_800_000_000,
      search: "  purple  ",
      tags: { t: ["nostr"], "#e": ["f".repeat(64)] },
    });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [
        {
          ids: ["d".repeat(64)],
          since: 1_700_000_000,
          until: 1_800_000_000,
          search: "purple",
          "#t": ["nostr"],
          "#e": ["f".repeat(64)],
          limit: 5,
        },
      ],
    );
  });

  it("rejects a tag that is not single-letter, because relays do not index it", async () => {
    expect(
      await executors.query_nostr({ kinds: [1], tags: { hashtag: ["x"] } }),
    ).toMatchObject({ error: expect.stringContaining("single-letter") });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("rejects a window that cannot contain anything", async () => {
    expect(
      await executors.query_nostr({ kinds: [1], since: 200, until: 100 }),
    ).toMatchObject({ error: expect.stringContaining("since is after until") });
  });

  it("resolves $me from the active account", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    await executors.query_nostr({ kinds: [1], authors: ["$ME"] });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], authors: ["e".repeat(64)], limit: 5 }],
    );
  });

  it("says so rather than querying when $me has no account", async () => {
    expect(
      await executors.query_nostr({ kinds: [1], authors: ["$me"] }),
    ).toMatchObject({ error: expect.stringContaining("No account") });
    expect(requestEvents).not.toHaveBeenCalled();
  });

  it("expands $contacts from the stored contact list", async () => {
    accounts.active = { pubkey: "e".repeat(64) };
    getReplaceable.mockReturnValue({
      tags: [
        ["p", "a".repeat(64)],
        ["p", "not-hex"],
        ["t", "nostr"],
      ],
    });
    await executors.query_nostr({ kinds: [1], tags: { p: ["$contacts"] } });
    expect(requestEvents).toHaveBeenCalledWith(
      ["wss://default.example"],
      [{ kinds: [1], "#p": ["a".repeat(64)], limit: 5 }],
    );
  });

  it("reports the filter it sent, so an empty answer is explainable", async () => {
    const result = (await executors.query_nostr({
      kinds: [1],
      relays: ["wss://named.example"],
    })) as { filter: unknown; relays: unknown };
    expect(result.filter).toEqual({ kinds: [1], limit: 5 });
    expect(result.relays).toEqual(["wss://named.example"]);
  });

  it("hands back bech32 the model can quote, because it invents bad ones", async () => {
    requestEvents.mockResolvedValue([eventFor("c".repeat(64))]);
    const result = (await executors.query_nostr({ kinds: [1] })) as {
      events: { npub: string; nevent: string }[];
    };
    const { npub, nevent } = result.events[0];
    expect(nip19.decode(npub).data).toBe("a".repeat(64));
    // Kind and author travel with the id, so an adapter can dispatch on them.
    expect(nip19.decode(nevent).data).toMatchObject({
      id: "c".repeat(64),
      kind: 1,
      author: "a".repeat(64),
    });
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

describe("resolve", () => {
  const PUBKEY = "a".repeat(64);
  const NPUB = nip19.npubEncode(PUBKEY);

  it("turns an npub into the person's kind 0", async () => {
    getReplaceable.mockReturnValue({
      id: "d".repeat(64),
      kind: 0,
      pubkey: PUBKEY,
      created_at: 7,
      tags: [],
      content: '{"name":"jack"}',
      sig: "x",
    });

    const result = (await executors.resolve({ entity: NPUB })) as {
      type: string;
      npub: string;
      metadata: { name: string };
    };
    expect(result.type).toBe("profile");
    expect(result.npub).toBe(NPUB);
    // Parsed, because a model reads metadata and not a JSON string.
    expect(result.metadata.name).toBe("jack");
  });

  it("turns an nevent into the event, with the bech32 rebuilt", async () => {
    const id = "c".repeat(64);
    getEvent.mockReturnValue(eventFor(id, "hello"));

    const result = (await executors.resolve({
      entity: nip19.neventEncode({ id }),
    })) as { type: string; nevent: string; event: { content: string } };

    expect(result.type).toBe("event");
    expect(result.event.content).toBe("hello");
    // Kind and author travel with the id, whatever the input carried.
    expect(nip19.decode(result.nevent).data).toMatchObject({
      id,
      kind: 1,
      author: "a".repeat(64),
    });
  });

  it("truncates a long event, same as a query", async () => {
    const id = "c".repeat(64);
    getEvent.mockReturnValue(eventFor(id, "x".repeat(9000)));
    const result = (await executors.resolve({
      entity: nip19.neventEncode({ id }),
    })) as { event: { content: string } };
    expect(result.event.content).toMatch(/\[truncated\]$/);
  });

  it("rejects something that is not an entity", async () => {
    expect(await executors.resolve({ entity: "jack" })).toMatchObject({
      error: expect.stringContaining("Not a Nostr entity"),
    });
  });

  it("says an event could not be loaded rather than letting one be invented", async () => {
    const id = "e".repeat(64);
    getEvent.mockReturnValue(undefined);
    eventLoader.mockReturnValue(EMPTY);

    expect(
      await executors.resolve({ entity: nip19.neventEncode({ id }) }),
    ).toMatchObject({ error: expect.stringContaining("no relay returned it") });
  });
});

describe("spells", () => {
  const SPELLS = [
    {
      id: "1",
      alias: "btc",
      name: "Bitcoin talk",
      command: "req -k 1 -t bitcoin -l 50",
      createdAt: 1,
      isPublished: true,
    },
    {
      id: "2",
      name: "Old one",
      command: "req -k 1 -l 5",
      createdAt: 2,
      isPublished: false,
      deletedAt: 3,
    },
  ];

  it("lists the saved ones, minus what was deleted", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await executors.list_spells({})) as {
      count?: number;
      spells: { alias?: string }[];
    };
    expect(result.spells).toEqual([
      {
        alias: "btc",
        name: "Bitcoin talk",
        command: "req -k 1 -t bitcoin -l 50",
        published: true,
      },
    ]);
  });

  it("finds one by alias, so its filter can be run rather than guessed", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await executors.list_spells({ alias: "BTC" })) as {
      command: string;
    };
    expect(result.command).toBe("req -k 1 -t bitcoin -l 50");
  });

  it("says an unknown alias is unknown rather than inventing a command", async () => {
    spellsToArray.mockResolvedValue(SPELLS);
    const result = (await executors.list_spells({ alias: "nope" })) as {
      error: string;
    };
    expect(result.error).toContain("No spell");
  });

  it("survives an unreadable store", async () => {
    spellsToArray.mockRejectedValue(new Error("dexie is upset"));
    const result = (await executors.list_spells({})) as { error: string };
    expect(result.error).toContain("Could not read");
  });
});
