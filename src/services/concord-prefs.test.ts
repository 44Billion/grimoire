import { beforeEach, describe, expect, it } from "vitest";
import { firstValueFrom } from "rxjs";
import { take, toArray } from "rxjs/operators";

import {
  CHAT_PREFS_STORAGE_KEY,
  channelPrefKey,
  concordPrefsManager,
  containerPrefKey,
  isCategoryCollapsed,
  isChannelMuted,
  isChannelPinned,
  isMutedFor,
  isPinnedFor,
  loadPrefs,
  resetConcordPrefs,
} from "./concord-prefs";

const COMMUNITY = "a".repeat(64);
const OTHER_COMMUNITY = "b".repeat(64);
const CHANNEL = "c".repeat(64);

const stored = () =>
  JSON.parse(localStorage.getItem(CHAT_PREFS_STORAGE_KEY) ?? "null");

beforeEach(() => {
  localStorage.removeItem(CHAT_PREFS_STORAGE_KEY);
  resetConcordPrefs();
});

describe("key shape", () => {
  it("qualifies a container with its protocol", () => {
    expect(containerPrefKey("concord", COMMUNITY)).toBe(`concord|${COMMUNITY}`);
    expect(containerPrefKey("nip-29", "wss://Relay.example/")).toBe(
      "nip-29|wss://relay.example/",
    );
  });

  it("separates the channel rung with the same pipe", () => {
    expect(channelPrefKey("concord", COMMUNITY, CHANNEL)).toBe(
      `concord|${COMMUNITY}|${CHANNEL}`,
    );
  });

  it("keeps a NIP-29 relay from colliding with a Concord community", () => {
    // The whole reason the protocol is in the key: two containers can spell the
    // same id, and only the discriminator tells the rows apart.
    expect(containerPrefKey("concord", "abc")).not.toBe(
      containerPrefKey("nip-29", "abc"),
    );
  });

  it("casefolds both id segments", () => {
    expect(channelPrefKey("concord", COMMUNITY.toUpperCase(), "AB")).toBe(
      `concord|${COMMUNITY}|ab`,
    );
  });
});

describe("pins", () => {
  it("round-trips through storage", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(isChannelPinned(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      true,
    );
    expect(stored().pinnedChannels).toEqual([
      channelPrefKey("concord", COMMUNITY, CHANNEL),
    ]);
    expect(isChannelPinned(loadPrefs(), COMMUNITY, CHANNEL)).toBe(true);
  });

  it("unpins on a second toggle", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
  });

  it("does not pin the same channel id in another community", () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    expect(
      isChannelPinned(concordPrefsManager.value, OTHER_COMMUNITY, CHANNEL),
    ).toBe(false);
  });

  it("ignores a blank id rather than storing a half key", () => {
    concordPrefsManager.togglePin("", CHANNEL);
    concordPrefsManager.togglePin(COMMUNITY, "");
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
  });
});

describe("mutes", () => {
  it("round-trips through storage", () => {
    concordPrefsManager.toggleMute(COMMUNITY, CHANNEL);
    expect(isChannelMuted(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      true,
    );
    expect(isChannelMuted(loadPrefs(), COMMUNITY, CHANNEL)).toBe(true);
  });

  it("is independent of the pin", () => {
    // Both are arrangement and neither implies the other: a pinned row can be
    // silent, and muting one must not quietly unpin it.
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    concordPrefsManager.toggleMute(COMMUNITY, CHANNEL);
    expect(isChannelPinned(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      true,
    );
    concordPrefsManager.toggleMute(COMMUNITY, CHANNEL);
    expect(isChannelPinned(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      true,
    );
    expect(isChannelMuted(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      false,
    );
  });
});

describe("the other two families", () => {
  const RELAY = "wss://relay.example.com/";
  const CONVERSATION = `${"e".repeat(64)}:${"f".repeat(64)}`;

  it("pins a private conversation without touching a channel", () => {
    concordPrefsManager.togglePinFor("nip-17", "dm", CONVERSATION);
    expect(
      isPinnedFor(concordPrefsManager.value, "nip-17", "dm", CONVERSATION),
    ).toBe(true);
    expect(isChannelPinned(concordPrefsManager.value, COMMUNITY, CHANNEL)).toBe(
      false,
    );
  });

  it("keeps the same group id on two relays apart", () => {
    // A NIP-29 group id is only unique within its relay, which is exactly why
    // the relay is the container half of the key.
    concordPrefsManager.togglePinFor("nip-29", RELAY, "bitcoin");
    expect(
      isPinnedFor(concordPrefsManager.value, "nip-29", RELAY, "bitcoin"),
    ).toBe(true);
    expect(
      isPinnedFor(
        concordPrefsManager.value,
        "nip-29",
        "wss://other.example.com/",
        "bitcoin",
      ),
    ).toBe(false);
  });

  it("mutes a group", () => {
    concordPrefsManager.toggleMuteFor("nip-29", RELAY, "bitcoin");
    expect(
      isMutedFor(concordPrefsManager.value, "nip-29", RELAY, "bitcoin"),
    ).toBe(true);
  });

  it("wipes both at logout, like every other pin", () => {
    concordPrefsManager.togglePinFor("nip-17", "dm", CONVERSATION);
    concordPrefsManager.toggleMuteFor("nip-29", RELAY, "bitcoin");
    resetConcordPrefs();
    expect(concordPrefsManager.value.pinnedChannels).toEqual([]);
    expect(concordPrefsManager.value.mutedChannels).toEqual([]);
  });
});

describe("collapsed categories", () => {
  it("collapses and re-opens", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, COMMUNITY, "voice"),
    ).toBe(true);
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, COMMUNITY, "voice"),
    ).toBe(false);
  });

  it("leaves no empty array behind for a community with nothing collapsed", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(concordPrefsManager.value.collapsedCategories).toEqual({});
    expect(stored().collapsedCategories).toEqual({});
  });

  it("keeps two communities' folds apart", () => {
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");
    expect(
      isCategoryCollapsed(concordPrefsManager.value, OTHER_COMMUNITY, "voice"),
    ).toBe(false);
    expect(Object.keys(concordPrefsManager.value.collapsedCategories)).toEqual([
      containerPrefKey("concord", COMMUNITY),
    ]);
  });
});

describe("loading a damaged blob", () => {
  it("falls back to defaults on unparseable JSON", () => {
    localStorage.setItem(CHAT_PREFS_STORAGE_KEY, "{not json");
    expect(loadPrefs()).toEqual({
      __version: 1,
      pinnedChannels: [],
      mutedChannels: [],
      collapsedCategories: {},
    });
  });

  it("keeps the fields it can still read", () => {
    localStorage.setItem(
      CHAT_PREFS_STORAGE_KEY,
      JSON.stringify({
        __version: 1,
        pinnedChannels: [channelPrefKey("concord", COMMUNITY, CHANNEL), 7],
        collapsedCategories: "nonsense",
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.pinnedChannels).toEqual([
      channelPrefKey("concord", COMMUNITY, CHANNEL),
    ]);
    expect(prefs.collapsedCategories).toEqual({});
  });
});

describe("reset", () => {
  it("empties storage and tells its subscribers", async () => {
    concordPrefsManager.togglePin(COMMUNITY, CHANNEL);
    concordPrefsManager.toggleCategoryCollapsed(COMMUNITY, "voice");

    const emissions = firstValueFrom(
      concordPrefsManager.stream$.pipe(take(2), toArray()),
    );
    resetConcordPrefs();
    const seen = await emissions;

    expect(seen[1]).toEqual({
      __version: 1,
      pinnedChannels: [],
      mutedChannels: [],
      collapsedCategories: {},
    });
    expect(localStorage.getItem(CHAT_PREFS_STORAGE_KEY)).toBeNull();
    expect(loadPrefs().pinnedChannels).toEqual([]);
  });
});
