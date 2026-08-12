import { describe, it, expect } from "vitest";
import {
  getLooseCommentRoot,
  withRootScopeTags,
} from "./comment-root-fallback";
import { getCommentRootPointer } from "applesauce-common/helpers/comment";
import type { NostrEvent } from "@/types/nostr";

const base = {
  kind: 1111,
  id: "648f176719e4b7c4f06f6edcd0b39ce948d5c9aa5564b60877ff9082f12106f6",
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  created_at: 1786561410,
  content: "",
  sig: "",
};

const event = (tags: string[][]): NostrEvent => ({ ...base, tags });

describe("getLooseCommentRoot", () => {
  it("recovers an event root from E alone (no K tag)", () => {
    const root = getLooseCommentRoot(
      event([
        [
          "E",
          "89c68a1accc3ea348825f62fe8ce23efcb7ac4c9015d6ae4e57b1ab54041ee73",
        ],
        [
          "e",
          "147a9de4800af1e65df3fde20aa24c53f2fa2a24b32084f253c74ec215e3544d",
        ],
        ["k", "1"],
      ]),
    );

    expect(root).toEqual({
      type: "event",
      id: "89c68a1accc3ea348825f62fe8ce23efcb7ac4c9015d6ae4e57b1ab54041ee73",
      relay: undefined,
      pubkey: undefined,
    });
  });

  it("takes the relay and pubkey hints off the E tag", () => {
    const root = getLooseCommentRoot(
      event([
        ["E", "root-id", "wss://relay.example/inbox", "author-pubkey"],
        ["P", "other-pubkey"],
      ]),
    );

    expect(root).toEqual({
      type: "event",
      id: "root-id",
      relay: "wss://relay.example/inbox",
      pubkey: "author-pubkey",
    });
  });

  it("falls back to the P tag when the E tag carries no author", () => {
    const root = getLooseCommentRoot(
      event([
        ["E", "root-id"],
        ["P", "root-pubkey"],
      ]),
    );

    expect(root).toMatchObject({ type: "event", pubkey: "root-pubkey" });
  });

  it("prefers an A root and keeps its relay hint", () => {
    const root = getLooseCommentRoot(
      event([
        ["A", `30023:${base.pubkey}:my-article`, "wss://relay.example"],
        ["E", "root-id"],
      ]),
    );

    expect(root).toMatchObject({
      type: "address",
      address: {
        kind: 30023,
        pubkey: base.pubkey,
        identifier: "my-article",
      },
    });
  });

  it("recovers an external root from I alone", () => {
    const root = getLooseCommentRoot(
      event([["I", "https://example.com/post"]]),
    );

    expect(root).toEqual({
      type: "external",
      identifier: "https://example.com/post",
    });
  });

  it("returns null when no root scope tag is present", () => {
    expect(
      getLooseCommentRoot(
        event([
          ["e", "parent-id"],
          ["k", "1"],
        ]),
      ),
    ).toBe(null);
  });
});

describe("withRootScopeTags", () => {
  it("makes a K-less comment readable by getCommentRootPointer", () => {
    const broken = event([
      ["E", "89c68a1accc3ea348825f62fe8ce23efcb7ac4c9015d6ae4e57b1ab54041ee73"],
      ["e", "147a9de4800af1e65df3fde20aa24c53f2fa2a24b32084f253c74ec215e3544d"],
      ["k", "1"],
    ]);
    expect(getCommentRootPointer(broken)).toBe(null);

    const patched = withRootScopeTags(broken, "1");

    expect(getCommentRootPointer(patched)).toMatchObject({
      type: "event",
      id: "89c68a1accc3ea348825f62fe8ce23efcb7ac4c9015d6ae4e57b1ab54041ee73",
      kind: 1,
    });
    expect(broken.tags).not.toContainEqual(["K", "1"]);
  });

  it("takes the kind from the A tag without needing a hint", () => {
    const patched = withRootScopeTags(
      event([["A", `30023:${base.pubkey}:my-article`]]),
    );

    expect(getCommentRootPointer(patched)).toMatchObject({
      type: "address",
      kind: 30023,
      identifier: "my-article",
    });
  });

  it("leaves well-formed comments untouched", () => {
    const valid = event([
      ["E", "root-id"],
      ["K", "1"],
      ["e", "parent-id"],
      ["k", "1"],
    ]);

    expect(withRootScopeTags(valid, "9999")).toBe(valid);
  });

  it("returns the event unchanged when no kind can be determined", () => {
    const broken = event([["E", "root-id"]]);

    expect(withRootScopeTags(broken)).toBe(broken);
  });
});
