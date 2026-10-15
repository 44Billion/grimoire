import { describe, expect, it } from "vitest";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import type { NostrEvent } from "@/types/nostr";
import {
  getSemanticAuthor,
  getSemanticContentEvent,
  getZapSats,
} from "./semantic-author";

// `getZapRequest` verifies the embedded request's signature, so the zapper
// needs a real key.
const ZAPPER_SECRET = new Uint8Array(32).fill(7);
const ZAPPER = getPublicKey(ZAPPER_SECRET);
const PROVIDER = "c".repeat(64);
const ALICE = "b".repeat(64);

function event(partial: Partial<NostrEvent>): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: PROVIDER,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "",
    sig: "0".repeat(128),
    ...partial,
  };
}

const request = finalizeEvent(
  {
    kind: 9734,
    created_at: 1_700_000_000,
    content: "great post",
    tags: [
      ["p", ALICE],
      ["amount", "21000"],
      ["relays", "wss://relay.example.com"],
    ],
  },
  ZAPPER_SECRET,
);

const receipt = event({
  kind: 9735,
  tags: [
    ["p", ALICE],
    ["P", ZAPPER],
    ["description", JSON.stringify(request)],
  ],
});

describe("zap receipt previews", () => {
  it("name the zapper and render the zap request", () => {
    expect(getSemanticAuthor(receipt)).toBe(ZAPPER);
    expect(getSemanticContentEvent(receipt).content).toBe("great post");
  });

  it("fall back to the receipt when the request is unreadable", () => {
    const broken = event({
      kind: 9735,
      tags: [
        ["p", ALICE],
        ["description", "not json"],
      ],
    });
    expect(getSemanticAuthor(broken)).toBe(PROVIDER);
    expect(getSemanticContentEvent(broken)).toBe(broken);
    expect(getZapSats(broken)).toBeUndefined();
  });

  it("leave ordinary events alone", () => {
    const note = event({ pubkey: ALICE, content: "hi" });
    expect(getSemanticAuthor(note)).toBe(ALICE);
    expect(getSemanticContentEvent(note)).toBe(note);
    expect(getZapSats(note)).toBeUndefined();
  });
});
