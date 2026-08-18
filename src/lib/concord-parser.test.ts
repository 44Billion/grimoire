/**
 * Resolving a community the way a person names one.
 *
 * `resolveStoredCommunity` exists so `chat` can share its single argument with
 * every NIP-19 identifier there is: it must answer "this is a community I hold"
 * or nothing at all, never "probably". `parseConcordCommand` is the lenient one
 * — `concord` has no other meaning for its argument, so an unresolved query is
 * carried through as a prefix rather than refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BehaviorSubject } from "rxjs";

const VIEWER = "aa".repeat(32);
const BUILDERS = "3fa2c1" + "0".repeat(58);
const BAKERY = "77ee55" + "1".repeat(58);

const active$ = new BehaviorSubject<{ pubkey: string } | undefined>({
  pubkey: VIEWER,
});

vi.mock("@/services/accounts", () => ({
  default: {
    get active$() {
      return active$;
    },
  },
}));

const communities = [
  { idHex: BUILDERS, name: "Bitcoin Builders" },
  { idHex: BAKERY, name: "Bakery" },
];

vi.mock("@/services/concord-communities", () => ({
  loadStoredCommunities: vi.fn(async () => communities),
}));

vi.mock("@/services/concord-state", () => ({
  readStoredState: vi.fn(async () => undefined),
}));

const { resolveStoredCommunity, parseConcordCommand } =
  await import("./concord-parser");

describe("resolveStoredCommunity", () => {
  beforeEach(() => active$.next({ pubkey: VIEWER }));

  it("matches a name, whatever its case", async () => {
    await expect(resolveStoredCommunity("bitcoin builders")).resolves.toEqual({
      communityId: BUILDERS,
      dynamicTitle: "Bitcoin Builders",
    });
  });

  it("matches a name prefix", async () => {
    const hit = await resolveStoredCommunity("bak");
    expect(hit?.communityId).toBe(BAKERY);
  });

  it("matches an id prefix", async () => {
    const hit = await resolveStoredCommunity("3fa2c1");
    expect(hit?.communityId).toBe(BUILDERS);
  });

  it("answers nothing for a community this account does not hold", async () => {
    // The whole point: `chat` reads this as "not a community, try the
    // identifiers" — an npub, an nevent and a relay'group all arrive here too.
    await expect(resolveStoredCommunity("nostrica")).resolves.toBeUndefined();
  });

  it("answers nothing with no account, having no list to match against", async () => {
    active$.next(undefined);
    await expect(
      resolveStoredCommunity("Bitcoin Builders"),
    ).resolves.toBeUndefined();
  });

  it("answers nothing for an empty query", async () => {
    await expect(resolveStoredCommunity("   ")).resolves.toBeUndefined();
  });
});

describe("parseConcordCommand", () => {
  beforeEach(() => active$.next({ pubkey: VIEWER }));

  it("resolves a hit to its full id and a title", async () => {
    await expect(parseConcordCommand(["Bitcoin", "Builders"])).resolves.toEqual(
      {
        communityId: BUILDERS,
        dynamicTitle: "Bitcoin Builders",
      },
    );
  });

  it("carries a miss through as a prefix — the vault may not have synced", async () => {
    await expect(parseConcordCommand(["nostrica"])).resolves.toEqual({
      communityId: "nostrica",
    });
  });

  it("opens the whole list with no argument", async () => {
    await expect(parseConcordCommand([])).resolves.toEqual({});
  });
});
