import { describe, it, expect } from "vitest";
import { isEmoji, isValidAvatarShape, getAvatarShape } from "./avatar-shape";

describe("isEmoji", () => {
  it("accepts simple and composed emoji", () => {
    expect(isEmoji("🐱")).toBe(true);
    expect(isEmoji("⭐")).toBe(true);
    expect(isEmoji("👨‍👩‍👧‍👦")).toBe(true);
    expect(isEmoji("🇪🇸")).toBe(true);
  });

  it("rejects ASCII, empty, and long strings", () => {
    expect(isEmoji("")).toBe(false);
    expect(isEmoji("circle")).toBe(false);
    expect(isEmoji(":)")).toBe(false);
    expect(isEmoji("ñ".repeat(21))).toBe(false);
  });
});

describe("isValidAvatarShape", () => {
  it("rejects non-strings", () => {
    expect(isValidAvatarShape(undefined)).toBe(false);
    expect(isValidAvatarShape(42)).toBe(false);
    expect(isValidAvatarShape({ shape: "🐱" })).toBe(false);
  });
});

describe("getAvatarShape", () => {
  it("reads the shape field from metadata", () => {
    expect(getAvatarShape({ shape: "🐱" })).toBe("🐱");
  });

  it("returns undefined when missing or invalid", () => {
    expect(getAvatarShape(undefined)).toBeUndefined();
    expect(getAvatarShape({})).toBeUndefined();
    expect(getAvatarShape({ shape: "square" })).toBeUndefined();
    expect(getAvatarShape({ shape: 5 })).toBeUndefined();
  });
});
