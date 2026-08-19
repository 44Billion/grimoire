import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";

import {
  hasEventEmbed,
  nostrRefTarget,
  splitNostrRefs,
} from "./open-nostr-ref";

// jack's npub, a well-known valid bech32.
const NPUB = "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m";

describe("nostrRefTarget", () => {
  const PUBKEY =
    "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";

  it("opens an npub as a profile, and exposes the pubkey to render", () => {
    expect(nostrRefTarget(NPUB)).toEqual({
      appId: "profile",
      props: { pubkey: PUBKEY },
      pubkey: PUBKEY,
    });
  });

  it("exposes an event pointer so a mentioned note can embed", () => {
    const id = "a".repeat(64);
    const target = nostrRefTarget(nip19.neventEncode({ id, kind: 1 }));
    expect(target?.appId).toBe("open");
    expect(target?.eventPointer).toMatchObject({ id, kind: 1 });
    expect(target?.pubkey).toBeUndefined();
  });

  it("exposes an address pointer for an naddr", () => {
    const target = nostrRefTarget(
      nip19.naddrEncode({ kind: 30023, pubkey: PUBKEY, identifier: "post" }),
    );
    expect(target?.addressPointer).toMatchObject({
      kind: 30023,
      pubkey: PUBKEY,
      identifier: "post",
    });
    expect(target?.eventPointer).toBeUndefined();
  });

  it("tolerates a nostr: prefix", () => {
    expect(nostrRefTarget(`nostr:${NPUB}`)?.appId).toBe("profile");
  });

  it("returns undefined for junk rather than throwing", () => {
    expect(nostrRefTarget("npub1notrealatall")).toBeUndefined();
    expect(nostrRefTarget("hello")).toBeUndefined();
  });
});

describe("splitNostrRefs", () => {
  it("leaves plain text as one segment", () => {
    expect(splitNostrRefs("no refs here")).toEqual([{ text: "no refs here" }]);
  });

  it("splits a reference out of surrounding prose", () => {
    const segments = splitNostrRefs(`ask ${NPUB} about it`);
    expect(segments.map((s) => s.text)).toEqual(["ask ", NPUB, " about it"]);
    expect(segments[1].target?.appId).toBe("profile");
    expect(segments[0].target).toBeUndefined();
  });

  it("strips the nostr: prefix from the rendered label", () => {
    const segments = splitNostrRefs(`see nostr:${NPUB}.`);
    expect(segments.map((s) => s.text)).toEqual(["see ", NPUB, "."]);
  });

  it("flags only event references as block embeds", () => {
    const nevent = nip19.neventEncode({ id: "b".repeat(64), kind: 1 });
    expect(hasEventEmbed(`see ${nevent}`)).toBe(true);
    // A person renders inline, so a paragraph holding one stays a paragraph.
    expect(hasEventEmbed(`ask ${NPUB}`)).toBe(false);
    expect(hasEventEmbed("nothing here")).toBe(false);
  });

  it("keeps an undecodable lookalike as plain text", () => {
    const fake = `npub1${"q".repeat(58)}`;
    expect(splitNostrRefs(`bad ${fake}`).every((s) => !s.target)).toBe(true);
  });
});
