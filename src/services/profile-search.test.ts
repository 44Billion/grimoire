import { describe, it, expect } from "vitest";
import profileSearch from "./profile-search";
import type { NostrEvent } from "nostr-tools";

/** kind 0 whose name is spelled entirely in NIP-30 shortcodes (Amethyst does this) */
const emojiNameProfile = {
  id: "556000463848ee8c94307b389ff903a4cfd84928476d25bb0f238d2b34526db9",
  kind: 0,
  pubkey: "d3de41d408a33090fa0c4e89093def3ae7ee86f3e3d1286beea5e53f566fff7b",
  created_at: 1786655810,
  sig: "00",
  content: JSON.stringify({ name: ":H::e::n::k::y:!!" }),
  tags: [
    ["emoji", "H", "https://example.com/h.png"],
    ["emoji", "e", "https://example.com/e.png"],
    ["emoji", "n", "https://example.com/n.png"],
    ["emoji", "k", "https://example.com/k.png"],
    ["emoji", "y", "https://example.com/y.png"],
  ],
} as NostrEvent;

describe("profileSearch", () => {
  it("finds a shortcode-spelled name by its flattened text", async () => {
    await profileSearch.addProfile(emojiNameProfile);

    const results = await profileSearch.search("henky");
    expect(results.map((r) => r.pubkey)).toContain(emojiNameProfile.pubkey);
  });

  it("still finds it by the raw shortcode string", async () => {
    await profileSearch.addProfile(emojiNameProfile);

    const results = await profileSearch.search(":h:");
    expect(results.map((r) => r.pubkey)).toContain(emojiNameProfile.pubkey);
  });
});
