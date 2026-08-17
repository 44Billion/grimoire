import { describe, expect, it } from "vitest";
import { timelineSignature } from "./timeline-signature";
import type { Message } from "@/types/chat";
import type { NostrEvent } from "@/types/nostr";

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: "concord:c:ch",
    author: "aa".repeat(32),
    content: "hi",
    timestamp: 1000,
    type: "user",
    protocol: "concord",
    ...overrides,
  } as Message;
}

function reaction(id: string, content = "+"): NostrEvent {
  return {
    id,
    pubkey: "bb".repeat(32),
    kind: 7,
    content,
    tags: [["e", "m1"]],
    created_at: 0,
    sig: "",
  } as NostrEvent;
}

describe("timelineSignature", () => {
  it("is stable across identical re-reads", () => {
    const read = () => [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r1")] },
      }),
      message("m2"),
    ];
    expect(timelineSignature(read())).toBe(timelineSignature(read()));
  });

  it("changes when a reaction is added", () => {
    const before = [message("m1")];
    const after = [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r1")] },
      }),
    ];
    expect(timelineSignature(after)).not.toBe(timelineSignature(before));
  });

  it("changes when a reaction is removed", () => {
    const before = [
      message("m1", {
        metadata: {
          encrypted: true,
          reactions: [reaction("r1"), reaction("r2", "🔥")],
        },
      }),
    ];
    const after = [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r1")] },
      }),
    ];
    expect(timelineSignature(after)).not.toBe(timelineSignature(before));
  });

  it("changes when one reactor swaps for another at the same count", () => {
    const before = [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r1")] },
      }),
    ];
    const after = [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r2")] },
      }),
    ];
    expect(timelineSignature(after)).not.toBe(timelineSignature(before));
  });

  it("still tracks delivery and tombstones", () => {
    const queued = [message("m1", { delivery: "sending" })];
    const failed = [message("m1", { delivery: "failed" })];
    const removed = [
      message("m1", { metadata: { encrypted: true, deleted: true } }),
    ];
    expect(timelineSignature(failed)).not.toBe(timelineSignature(queued));
    expect(timelineSignature(removed)).not.toBe(
      timelineSignature([message("m1")]),
    );
  });

  it("does not blur a reaction id into the next message's fields", () => {
    const one = [
      message("m1", {
        metadata: { encrypted: true, reactions: [reaction("r1")] },
      }),
    ];
    const two = [message("m1"), message("r1")];
    expect(timelineSignature(one)).not.toBe(timelineSignature(two));
  });
});
