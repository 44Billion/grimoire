import { describe, it, expect } from "vitest";
import {
  getAspectRatioFromDimensions,
  mediaTypeOf,
  type ImetaEntry,
} from "./imeta";

describe("getAspectRatioFromDimensions", () => {
  it("should parse valid dimension string", () => {
    expect(getAspectRatioFromDimensions("1920x1080")).toBe("1920/1080");
    expect(getAspectRatioFromDimensions("800x600")).toBe("800/600");
    expect(getAspectRatioFromDimensions("1x1")).toBe("1/1");
  });

  it("should return undefined for invalid formats", () => {
    expect(getAspectRatioFromDimensions("1920")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920 x 1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920:1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("abc x def")).toBe(undefined);
  });

  it("should return undefined for invalid dimensions", () => {
    expect(getAspectRatioFromDimensions("0x1080")).toBe(undefined);
    expect(getAspectRatioFromDimensions("1920x0")).toBe(undefined);
    expect(getAspectRatioFromDimensions("-1920x1080")).toBe(undefined);
  });

  it("should return undefined for empty or missing input", () => {
    expect(getAspectRatioFromDimensions("")).toBe(undefined);
    expect(getAspectRatioFromDimensions(undefined)).toBe(undefined);
  });
});

describe("mediaTypeOf", () => {
  it("names an image whose URL cannot say it is one", () => {
    /**
     * The bug this closes rendered every encrypted attachment as a line of blue
     * text. A Blossom URL is `https://host/<sha256>` with no extension, and the
     * extension is what `isImageURL` reads — so a screenshot that decrypted
     * correctly and verified against its hash was then shown as a plain link.
     *
     * For an encrypted blob `m` is the ONLY statement of what the bytes are:
     * the URL serves ciphertext, so sniffing the response says
     * `application/octet-stream` whatever is inside.
     */
    expect(
      mediaTypeOf({
        url: "https://blossom.ditto.pub/ee30bd262620710ad5cbb7b3c89c4c8022030049b4935a93454e3c3784ca8362",
        m: "image/png",
      } as ImetaEntry),
    ).toBe("image");
  });

  it("reads video and audio the same way", () => {
    expect(mediaTypeOf({ url: "u", m: "video/mp4" } as ImetaEntry)).toBe(
      "video",
    );
    expect(mediaTypeOf({ url: "u", m: "audio/ogg" } as ImetaEntry)).toBe(
      "audio",
    );
  });

  it("says nothing when the sender said nothing", () => {
    // No `m` and no imeta both mean "fall back to the URL", which is what the
    // caller does — a guess here would override a correct extension.
    expect(mediaTypeOf({ url: "u" } as ImetaEntry)).toBeUndefined();
    expect(mediaTypeOf(undefined)).toBeUndefined();
    expect(
      mediaTypeOf({ url: "u", m: "application/pdf" } as ImetaEntry),
    ).toBeUndefined();
  });
});
