/**
 * NIP-73 External Content IDs
 * Utility functions for parsing and displaying NIP-73 external identifiers
 *
 * External identifiers (i-tags) reference content outside Nostr:
 * URLs, books (ISBN), podcasts, movies (ISAN), papers (DOI), geohashes,
 * countries (ISO-3166), hashtags, and blockchain transactions/addresses.
 *
 * Used by:
 * - NIP-22 comments (kind 1111) referencing external content
 * - NIP-85 trusted assertions (kind 30385) rating external content
 */

import type { LucideIcon } from "lucide-react";
import {
  Globe,
  Podcast,
  BookOpen,
  FileText,
  MapPin,
  Hash,
  Coins,
  Film,
  Flag,
  ExternalLink,
  Library,
} from "lucide-react";

/**
 * Map a NIP-73 external identifier type (K/k value) to an appropriate icon.
 */
export function getExternalIdentifierIcon(kValue: string): LucideIcon {
  if (kValue === "web") return Globe;
  if (kValue.startsWith("podcast")) return Podcast;
  if (kValue === "isbn") return BookOpen;
  // Book catalogues used by NKBIP-01 publications
  if (
    kValue === "openlibrary" ||
    kValue === "gutenberg" ||
    kValue === "overdrive"
  )
    return Library;
  if (kValue === "wikidata" || kValue === "wikipedia") return Globe;
  if (kValue === "doi") return FileText;
  if (kValue === "geo") return MapPin;
  if (kValue === "iso3166") return Flag;
  if (kValue === "#" || kValue === "hashtag") return Hash;
  if (kValue === "isan") return Film;
  // Blockchain types: "bitcoin:tx", "ethereum:1:address", etc.
  if (kValue.includes(":tx") || kValue.includes(":address")) return Coins;
  return ExternalLink;
}

/**
 * Get a human-friendly label for an external identifier value.
 */
export function getExternalIdentifierLabel(
  iValue: string,
  kValue?: string,
): string {
  // URLs - show truncated
  if (
    kValue === "web" ||
    iValue.startsWith("http://") ||
    iValue.startsWith("https://")
  ) {
    try {
      const url = new URL(iValue);
      const path = url.pathname === "/" ? "" : url.pathname;
      return `${url.hostname}${path}`;
    } catch {
      return iValue;
    }
  }

  // Podcast types
  if (iValue.startsWith("podcast:item:guid:")) return "Podcast Episode";
  if (iValue.startsWith("podcast:publisher:guid:")) return "Podcast Publisher";
  if (iValue.startsWith("podcast:guid:")) return "Podcast Feed";

  // ISBN
  if (iValue.startsWith("isbn:")) return `ISBN ${iValue.slice(5)}`;

  // DOI
  if (iValue.startsWith("doi:")) return `DOI ${iValue.slice(4)}`;

  // Book catalogues (NKBIP-01 publication identifiers)
  if (iValue.startsWith("openlibrary:"))
    return `Open Library ${iValue.slice(12)}`;
  if (iValue.startsWith("gutenberg:")) return `Gutenberg ${iValue.slice(10)}`;
  if (iValue.startsWith("wikidata:")) return `Wikidata ${iValue.slice(9)}`;
  if (iValue.startsWith("overdrive:")) return `OverDrive ${iValue.slice(10)}`;
  if (iValue.startsWith("wikipedia:")) {
    // "wikipedia:en:Aesop's_Fables"
    const [lang, ...title] = iValue.slice(10).split(":");
    return title.length > 0
      ? `Wikipedia ${title.join(":").replace(/_/g, " ")} (${lang})`
      : `Wikipedia ${lang.replace(/_/g, " ")}`;
  }

  // Geohash
  if (kValue === "geo") return `Location ${iValue}`;

  // ISO 3166 country/region codes
  if (kValue === "iso3166" || iValue.startsWith("iso3166:")) {
    const code = iValue.startsWith("iso3166:")
      ? iValue.slice(8).toUpperCase()
      : iValue.toUpperCase();
    return getRegionDisplayName(code);
  }

  // Hashtag (NIP-73 format: "#bitcoin" or legacy "hashtag:bitcoin")
  if (kValue === "#" || iValue.startsWith("#")) return iValue;
  if (iValue.startsWith("hashtag:")) return `#${iValue.slice(8)}`;

  // Blockchain
  if (iValue.includes(":tx:"))
    return `Transaction ${iValue.split(":tx:")[1]?.slice(0, 12)}...`;
  if (iValue.includes(":address:"))
    return `Address ${iValue.split(":address:")[1]?.slice(0, 12)}...`;

  return iValue;
}

/**
 * Infer a NIP-73 k-tag value from an i-tag value when no k-tag is present.
 * Useful for contexts where only the identifier is available.
 */
export function inferExternalIdentifierType(iValue: string): string {
  if (iValue.startsWith("http://") || iValue.startsWith("https://"))
    return "web";
  if (iValue.startsWith("podcast:")) {
    if (iValue.startsWith("podcast:item:guid:")) return "podcast:item:guid";
    if (iValue.startsWith("podcast:publisher:guid:"))
      return "podcast:publisher:guid";
    return "podcast:guid";
  }
  if (iValue.startsWith("isbn:")) return "isbn";
  if (iValue.startsWith("openlibrary:")) return "openlibrary";
  if (iValue.startsWith("gutenberg:")) return "gutenberg";
  if (iValue.startsWith("wikidata:")) return "wikidata";
  if (iValue.startsWith("wikipedia:")) return "wikipedia";
  if (iValue.startsWith("overdrive:")) return "overdrive";
  if (iValue.startsWith("doi:")) return "doi";
  if (iValue.startsWith("geo:")) return "geo";
  if (iValue.startsWith("iso3166:")) return "iso3166";
  if (iValue.startsWith("#")) return "#";
  if (iValue.startsWith("isan:")) return "isan";
  if (iValue.includes(":tx:")) {
    const chain = iValue.split(":")[0];
    return `${chain}:tx`;
  }
  if (iValue.includes(":address:")) {
    const chain = iValue.split(":")[0];
    return `${chain}:address`;
  }
  return "web";
}

/**
 * Resolve the best href for an external identifier.
 * Uses the hint if available, otherwise the raw value if it's a URL.
 */
export function getExternalIdentifierHref(
  iValue: string,
  hint?: string,
): string | undefined {
  if (hint) return hint;
  if (iValue.startsWith("http://") || iValue.startsWith("https://"))
    return iValue;

  // Book catalogues carry no hint of their own but have stable URL schemes
  if (iValue.startsWith("openlibrary:")) {
    const id = iValue.slice(12);
    // OL…W works, OL…M editions, OL…A authors
    const path = id.endsWith("M")
      ? "books"
      : id.endsWith("A")
        ? "authors"
        : "works";
    return `https://openlibrary.org/${path}/${id}`;
  }
  if (iValue.startsWith("gutenberg:"))
    return `https://www.gutenberg.org/ebooks/${iValue.slice(10)}`;
  if (iValue.startsWith("wikidata:"))
    return `https://www.wikidata.org/wiki/${iValue.slice(9)}`;
  if (iValue.startsWith("wikipedia:")) {
    const [lang, ...title] = iValue.slice(10).split(":");
    if (title.length === 0) return undefined;
    return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.join(":"))}`;
  }

  return undefined;
}

/**
 * Get a human-friendly type label for a NIP-73 k-tag value.
 * Maps protocol-level k-values to user-facing names.
 */
export function getExternalTypeLabel(kValue: string): string {
  if (kValue === "web") return "Website";
  if (kValue === "podcast:item:guid") return "Podcast Episode";
  if (kValue === "podcast:publisher:guid") return "Podcast Publisher";
  if (kValue === "podcast:guid" || kValue.startsWith("podcast"))
    return "Podcast";
  if (kValue === "isbn") return "Book";
  if (kValue === "openlibrary") return "Open Library";
  if (kValue === "gutenberg") return "Project Gutenberg";
  if (kValue === "wikidata") return "Wikidata";
  if (kValue === "wikipedia") return "Wikipedia";
  if (kValue === "overdrive") return "OverDrive";
  if (kValue === "doi") return "Paper";
  if (kValue === "geo") return "Location";
  if (kValue === "iso3166") return "Country / Region";
  if (kValue === "#") return "Hashtag";
  if (kValue === "isan") return "Film";
  if (kValue.includes(":tx")) return "Transaction";
  if (kValue.includes(":address")) return "Address";
  return kValue;
}

/**
 * Get a localized display name for an ISO 3166 region code.
 * Uses Intl.DisplayNames for locale-aware country/region names.
 * Supports ISO 3166-1 alpha-2 (ES, BY) and ISO 3166-2 subdivisions (ES-CT).
 *
 * Returns the emoji flag + localized name when possible, falls back to code.
 */
export function getRegionDisplayName(code: string): string {
  const upper = code.toUpperCase();

  // ISO 3166-2 subdivision (e.g., "ES-CT" for Catalonia)
  if (upper.includes("-")) {
    const countryCode = upper.split("-")[0];
    const countryName = getLocalizedRegionName(countryCode);
    const flag = regionToEmoji(countryCode);
    return `${flag} ${countryName} — ${upper}`;
  }

  // ISO 3166-1 alpha-2 (e.g., "ES" for Spain)
  const name = getLocalizedRegionName(upper);
  const flag = regionToEmoji(upper);
  return `${flag} ${name}`;
}

/**
 * Get a localized region name using Intl.DisplayNames.
 * Accepts an explicit locale string for React components using useLocale/useGrimoire.
 */
export function getLocalizedRegionName(code: string, locale?: string): string {
  try {
    const displayNames = new Intl.DisplayNames(locale || undefined, {
      type: "region",
    });
    return displayNames.of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

/**
 * Convert an ISO 3166-1 alpha-2 code to its emoji flag.
 * Each letter maps to a Regional Indicator Symbol (U+1F1E6..U+1F1FF).
 */
export function regionToEmoji(code: string): string {
  // Only works for 2-letter codes; subdivisions (ES-CT) use the country part
  const twoLetter = code.includes("-") ? code.split("-")[0] : code;
  if (twoLetter.length !== 2) return "";
  const upper = twoLetter.toUpperCase();
  const offset = 0x1f1e6 - 65; // 'A' = 65
  return (
    String.fromCodePoint(upper.charCodeAt(0) + offset) +
    String.fromCodePoint(upper.charCodeAt(1) + offset)
  );
}
