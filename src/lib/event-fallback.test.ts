import { describe, it, expect } from "vitest";
import { getEventFallbackDisplay } from "./event-fallback";
import { NostrEvent } from "@/types/nostr";

function createEvent(overrides?: Partial<NostrEvent>): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1700000000,
    kind: 16767,
    tags: [],
    content: "",
    sig: "test-sig",
    ...overrides,
  };
}

describe("getEventFallbackDisplay", () => {
  it("prefers content when present", () => {
    const event = createEvent({
      content: "hello",
      tags: [["alt", "Active profile theme"]],
    });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "content",
      text: "hello",
    });
  });

  it("preserves content verbatim, including leading whitespace", () => {
    const event = createEvent({ content: "  indented\n  block" });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "content",
      text: "  indented\n  block",
    });
  });

  it("falls back to the alt tag when content is empty", () => {
    // Real kind 16767 (Ditto active profile theme) shape: tag-only, empty content
    const event = createEvent({
      tags: [
        ["c", "#0c170e", "background"],
        ["alt", "Active profile theme"],
      ],
    });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "alt",
      text: "Active profile theme",
    });
  });

  it("falls back to the alt tag when content is only whitespace", () => {
    const event = createEvent({
      content: "   \n  ",
      tags: [["alt", "Payment targets"]],
    });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "alt",
      text: "Payment targets",
    });
  });

  it("trims the alt text", () => {
    const event = createEvent({ tags: [["alt", "  Custom profile tabs  "]] });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "alt",
      text: "Custom profile tabs",
    });
  });

  it("reports empty when neither content nor alt is usable", () => {
    expect(getEventFallbackDisplay(createEvent())).toEqual({ type: "empty" });
  });

  it("ignores a blank alt tag", () => {
    const event = createEvent({ tags: [["alt", "   "]] });
    expect(getEventFallbackDisplay(event)).toEqual({ type: "empty" });
  });

  it("ignores a valueless alt tag", () => {
    const event = createEvent({ tags: [["alt"]] });
    expect(getEventFallbackDisplay(event)).toEqual({ type: "empty" });
  });

  it("uses the first alt tag when several are present", () => {
    const event = createEvent({
      tags: [
        ["alt", "first"],
        ["alt", "second"],
      ],
    });
    expect(getEventFallbackDisplay(event)).toEqual({
      type: "alt",
      text: "first",
    });
  });
});
