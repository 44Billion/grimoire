import { describe, expect, it, vi, beforeEach } from "vitest";
import { of } from "rxjs";

const signEvent = vi.fn();
const publishWithUpdates = vi.fn();
const selectRelaysForPublish = vi.fn();
const accounts: { active?: unknown } = {};

vi.mock("@/services/accounts", () => ({
  default: {
    get active() {
      return accounts.active;
    },
  },
}));

vi.mock("@/services/publish-service", () => ({
  default: {
    publishWithUpdates: (...args: unknown[]) => publishWithUpdates(...args),
  },
}));

vi.mock("@/services/relay-selection", () => ({
  selectRelaysForPublish: (...args: unknown[]) =>
    selectRelaysForPublish(...args),
}));

vi.mock("@/services/settings", () => ({
  settingsManager: { getSetting: () => false },
}));

const { publishDraft } = await import("./publish-draft");

const PUBKEY = "a".repeat(64);

beforeEach(() => {
  signEvent.mockReset();
  publishWithUpdates.mockReset();
  selectRelaysForPublish.mockReset();
  accounts.active = { pubkey: PUBKEY, signer: { signEvent } };
  signEvent.mockImplementation(async (draft: Record<string, unknown>) => ({
    ...draft,
    id: "b".repeat(64),
    pubkey: PUBKEY,
    sig: "x",
  }));
  selectRelaysForPublish.mockResolvedValue(["wss://write.example"]);
  publishWithUpdates.mockReturnValue({
    publishId: "1",
    updates$: of({ relay: "wss://write.example", status: "success" }),
    result: Promise.resolve({ ok: true, failed: [] }),
  });
});

describe("publishDraft", () => {
  it("signs and publishes to the selected relays", async () => {
    const statuses: string[] = [];
    const result = await publishDraft(
      { kind: 1, content: "gm", tags: [["t", "nostr"]] },
      {
        relays: ["wss://chosen.example"],
        onStatus: (relay, status) => statuses.push(`${relay}:${status}`),
      },
    );
    expect(result.relays).toEqual(["wss://chosen.example"]);
    expect(selectRelaysForPublish).not.toHaveBeenCalled();
    expect(statuses).toEqual(["wss://write.example:success"]);
  });

  it("falls back to the account's outbox when no relay was chosen", async () => {
    const result = await publishDraft({ kind: 1, content: "gm", tags: [] });
    expect(result.relays).toEqual(["wss://write.example"]);
  });

  it("refuses a state-replacing kind, because this is the function that signs", async () => {
    // The tool checks too, but a check that only runs there is one an edit can
    // route around — and nothing else stands between a click and a rewritten
    // follow list.
    for (const kind of [0, 3, 10002, 30000]) {
      await expect(
        publishDraft({ kind, content: "x", tags: [] }),
      ).rejects.toThrow();
    }
    expect(signEvent).not.toHaveBeenCalled();
  });

  it("reports a publish no relay accepted", async () => {
    publishWithUpdates.mockReturnValue({
      publishId: "1",
      updates$: of({
        relay: "wss://write.example",
        status: "error",
        error: "blocked",
      }),
      result: Promise.resolve({
        ok: false,
        failed: [{ relay: "wss://write.example", error: "blocked" }],
      }),
    });
    await expect(
      publishDraft({ kind: 1, content: "gm", tags: [] }),
    ).rejects.toThrow(/blocked/);
  });

  it("will not sign without a signer", async () => {
    accounts.active = { pubkey: PUBKEY };
    await expect(
      publishDraft({ kind: 1, content: "gm", tags: [] }),
    ).rejects.toThrow(/cannot sign/);
  });
});
