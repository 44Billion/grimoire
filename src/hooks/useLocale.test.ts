import { describe, it, expect } from "vitest";
import { formatCompact, formatExact, formatMoney } from "./useLocale";


describe("formatCompact / formatMoney", () => {
  it("shortens a token count and keeps the exact one for the tooltip", () => {
    // `1,048,576` is nine characters of mostly-noise on a row that also holds a
    // name, a model, a cost and a time.
    expect(formatCompact(1_048_576, "en-US")).toBe("1M");
    expect(formatCompact(21_400, "en-US")).toBe("21.4K");
    expect(formatExact(1_048_576, "en-US")).toBe("1,048,576");
  });

  it("gives money two decimals, and never rounds a real cost to nothing", () => {
    /**
     * `$0.00` on a session that cost something is a lie a reader cannot detect.
     * Two decimals everywhere else, because a column of `0.200693` is a column
     * nobody can compare at a glance.
     */
    expect(formatMoney(0.200693, "USD", "en-US")).toBe("$0.20");
    expect(formatMoney(12, "USD", "en-US")).toBe("$12.00");
    expect(formatMoney(0.0004, "USD", "en-US")).toBe("<$0.01");
    // Actually zero is zero, and says so.
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
  });
});

