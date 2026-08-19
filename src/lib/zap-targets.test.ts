/**
 * The handle a private zap window carries instead of a rumor id.
 *
 * The property under test is a privacy one: what goes in window props — and
 * therefore into any published spellbook — must be an opaque string that tells
 * a reader nothing, and must stop resolving once the session that made it is
 * gone.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetZapTargetsForTests,
  claimZapTarget,
  readZapTarget,
  releaseZapTarget,
} from "@/lib/zap-targets";

import type { ChatProtocolAdapter } from "@/lib/chat/adapters/base-adapter";
import type { Conversation } from "@/types/chat";

const RUMOR = "ab".repeat(32);
const AUTHOR = "cd".repeat(32);

function target(messageId = RUMOR) {
  return {
    conversation: { id: "community:channel" } as Conversation,
    adapter: {} as ChatProtocolAdapter,
    messageId,
    recipientPubkey: AUTHOR,
  };
}

beforeEach(() => {
  _resetZapTargetsForTests();
});

describe("zap target handles", () => {
  it("resolves a claimed target", () => {
    const handle = claimZapTarget(target());
    expect(readZapTarget(handle)?.messageId).toBe(RUMOR);
  });

  it("hands out a handle that reveals nothing about the message", () => {
    const handle = claimZapTarget(target());
    // The whole point: this string is what a shared spellbook would carry.
    expect(handle).not.toContain(RUMOR);
    expect(handle).not.toContain(AUTHOR);
    expect(handle).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives every claim its own handle", () => {
    expect(claimZapTarget(target())).not.toBe(claimZapTarget(target()));
  });

  it("resolves nothing for an unknown or absent handle", () => {
    // A window restored from a reload or a published spellbook lands here.
    expect(
      readZapTarget("00000000-0000-0000-0000-000000000000"),
    ).toBeUndefined();
    expect(readZapTarget(undefined)).toBeUndefined();
  });

  it("forgets a released handle", () => {
    const handle = claimZapTarget(target());
    releaseZapTarget(handle);
    expect(readZapTarget(handle)).toBeUndefined();
  });

  it("bounds what it keeps, oldest first", () => {
    const handles = Array.from({ length: 20 }, (_, i) =>
      claimZapTarget(target(i.toString(16).padStart(64, "0"))),
    );
    expect(readZapTarget(handles[0])).toBeUndefined();
    expect(readZapTarget(handles[19])?.messageId).toBe(
      (19).toString(16).padStart(64, "0"),
    );
  });
});
