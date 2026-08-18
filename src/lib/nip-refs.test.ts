import { describe, expect, it } from "vitest";

import { splitNipRefs } from "./nip-refs";

describe("splitNipRefs", () => {
  it("splits a reference out of its sentence", () => {
    expect(splitNipRefs("see NIP-01 for the basics")).toEqual([
      { text: "see " },
      { text: "NIP-01", number: "01" },
      { text: " for the basics" },
    ]);
  });

  it("normalises the id the way the content transformer does", () => {
    // Both open the same window, so both must agree on the id.
    expect(splitNipRefs("NIP-9")[0].number).toBe("09");
    expect(splitNipRefs("nip-c7")[0].number).toBe("C7");
    expect(splitNipRefs("NIP-100")[0].number).toBe("100");
  });

  it("finds every reference, not only the first", () => {
    const numbers = splitNipRefs("NIP-10 and NIP-22 disagree")
      .map((segment) => segment.number)
      .filter(Boolean);
    expect(numbers).toEqual(["10", "22"]);
  });

  it("does not match a longer word that starts the same way", () => {
    expect(splitNipRefs("NIP-01234").some((s) => s.number)).toBe(false);
    expect(splitNipRefs("SNIP-01").some((s) => s.number)).toBe(false);
  });

  it("returns plain text as one segment", () => {
    expect(splitNipRefs("nothing here")).toEqual([{ text: "nothing here" }]);
    expect(splitNipRefs("")).toEqual([{ text: "" }]);
  });

  it("keeps working across calls", () => {
    // A module-level `lastIndex` on a global regex would drop this one.
    expect(splitNipRefs("NIP-01")[0].number).toBe("01");
    expect(splitNipRefs("NIP-01")[0].number).toBe("01");
  });
});
