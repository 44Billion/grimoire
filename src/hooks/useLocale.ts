import { useMemo } from "react";

export interface LocaleConfig {
  /** Browser's detected locale (e.g., 'en-US', 'pt-BR', 'ja-JP') */
  locale: string;
  /** Language code (e.g., 'en', 'pt', 'ja') */
  language: string;
  /** Region code (e.g., 'US', 'BR', 'JP') */
  region?: string;
  /** Timezone (e.g., 'America/New_York') */
  timezone: string;
  /** 12h or 24h time preference */
  timeFormat: "12h" | "24h";
}

/**
 * Hook to get user's locale preferences from browser
 * Falls back to en-US if detection fails
 */
export function useLocale(): LocaleConfig {
  return useMemo(() => {
    // Get browser locale
    const browserLocale =
      navigator.language || navigator.languages?.[0] || "en-US";

    // Parse locale into language and region
    const [language, region] = browserLocale.split("-");

    // Detect timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Detect 12h vs 24h preference by formatting a test date
    const testDate = new Date(2000, 0, 1, 13, 0); // 1PM
    const formatted = testDate.toLocaleTimeString(browserLocale, {
      hour: "numeric",
    });
    const timeFormat =
      formatted.includes("PM") || formatted.includes("AM") ? "12h" : "24h";

    return {
      locale: browserLocale,
      language,
      region,
      timezone,
      timeFormat,
    };
  }, []);
}

/**
 * Format a timestamp according to locale preferences
 * @param timestamp - Unix timestamp in seconds
 * @param style - 'relative' for "2h ago", 'absolute' for full date/time, 'date' for date only,
 *                'long' for full readable date (e.g., "January 15, 2025"), 'time' for time only,
 *                'datetime' for date with time (e.g., "January 15, 2025, 2:30 PM")
 * @param locale - Optional locale override (defaults to browser locale)
 */
export function formatTimestamp(
  timestamp: number,
  style:
    | "relative"
    | "absolute"
    | "date"
    | "long"
    | "time"
    | "datetime" = "relative",
  locale?: string,
): string {
  const browserLocale = locale || navigator.language || "en-US";
  const date = new Date(timestamp * 1000);

  if (style === "relative") {
    const now = Date.now();
    const diff = now - timestamp * 1000;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4 || months == 0) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    return `${years}y ago`;
  }

  if (style === "absolute") {
    // ISO-8601 style: 2025-12-10 23:42
    return date
      .toLocaleString(browserLocale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(",", "");
  }

  if (style === "date") {
    return date.toLocaleDateString(browserLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  if (style === "long") {
    // Human-readable long format: "January 15, 2025"
    return date.toLocaleDateString(browserLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (style === "datetime") {
    // Full date with time: "January 15, 2025, 2:30 PM"
    return date.toLocaleString(browserLocale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (style === "time") {
    return date.toLocaleTimeString(browserLocale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return date.toLocaleString(browserLocale);
}

/**
 * A token count, short.
 *
 * `1,048,576` is nine characters of mostly-noise on a row that also has to hold
 * a name, a model, a cost and a time — and nobody reading a transcript needs
 * the exact figure, only its size. The full number stays in the `title`, which
 * is where a reader who does want it looks.
 *
 * Locale-aware, so a German reader gets `1,0 Mio.` rather than an English
 * abbreviation with a comma in the wrong place.
 */
export function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** The exact figure, for the tooltip the compact one hides it behind. */
export function formatExact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Money, at two decimals, in the reader's own locale.
 *
 * Two decimals because a currency has two and a column of `0.200693` is a
 * column nobody can compare at a glance. The exception is an amount that is not
 * zero but rounds to it: `$0.00` on a session that cost something is a lie a
 * reader cannot detect, so it renders as `<$0.01` instead. The exact figure is
 * always in the `title`.
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  const money = (value: number, digits = 2) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);

  if (amount > 0 && amount < 0.005) return `<${money(0.01)}`;
  return money(amount);
}
