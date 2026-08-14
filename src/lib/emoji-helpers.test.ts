import { describe, it, expect } from "vitest";
import {
  emojiShortcodesToPlainText,
  parseEmojiSegments,
  type EmojiTag,
} from "./emoji-helpers";

const emojis: EmojiTag[] = [
  { shortcode: "H", url: "https://example.com/h.png" },
  { shortcode: "e", url: "https://example.com/e.png" },
];

describe("parseEmojiSegments", () => {
  it("substitutes adjacent shortcodes and keeps trailing text", () => {
    expect(parseEmojiSegments(":H::e:!!", emojis)).toEqual([
      { type: "emoji", shortcode: "H", url: "https://example.com/h.png" },
      { type: "emoji", shortcode: "e", url: "https://example.com/e.png" },
      { type: "text", value: "!!" },
    ]);
  });

  it("keeps unknown shortcodes as literal text", () => {
    expect(parseEmojiSegments("hi :nope: :H:", emojis)).toEqual([
      { type: "text", value: "hi :nope: " },
      { type: "emoji", shortcode: "H", url: "https://example.com/h.png" },
    ]);
  });

  it("returns a single text segment when there is nothing to substitute", () => {
    expect(parseEmojiSegments("plain name", emojis)).toEqual([
      { type: "text", value: "plain name" },
    ]);
  });

  it("short-circuits without emoji tags", () => {
    expect(parseEmojiSegments(":H:")).toEqual([{ type: "text", value: ":H:" }]);
    expect(parseEmojiSegments(":H:", [])).toEqual([
      { type: "text", value: ":H:" },
    ]);
  });

  it("returns nothing for empty text", () => {
    expect(parseEmojiSegments("", emojis)).toEqual([]);
  });
});

describe("emojiShortcodesToPlainText", () => {
  it("flattens adjacent shortcodes into the bare codes", () => {
    expect(emojiShortcodesToPlainText(":H::e:!!", emojis)).toBe("He!!");
  });

  it("leaves unknown shortcodes and plain text alone", () => {
    expect(emojiShortcodesToPlainText("hi :nope: :H:", emojis)).toBe(
      "hi :nope: H",
    );
    expect(emojiShortcodesToPlainText("plain name", emojis)).toBe("plain name");
    expect(emojiShortcodesToPlainText(":H:")).toBe(":H:");
  });
});
