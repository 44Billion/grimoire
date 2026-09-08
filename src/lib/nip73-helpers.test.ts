import { describe, it, expect } from "vitest";
import {
  getExternalIdentifierHref,
  getExternalIdentifierLabel,
  getExternalTypeLabel,
  inferExternalIdentifierType,
} from "./nip73-helpers";

// The book-catalogue prefixes NKBIP-01 publications use in their `i` tags.
describe("book catalogue identifiers", () => {
  it("infers the type from the prefix", () => {
    expect(inferExternalIdentifierType("openlibrary:OL45883W")).toBe(
      "openlibrary",
    );
    expect(inferExternalIdentifierType("gutenberg:130")).toBe("gutenberg");
    expect(inferExternalIdentifierType("wikidata:Q188371")).toBe("wikidata");
    expect(inferExternalIdentifierType("wikipedia:en:Aesop's_Fables")).toBe(
      "wikipedia",
    );
    expect(
      inferExternalIdentifierType(
        "overdrive:550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBe("overdrive");
  });

  it("labels them for humans", () => {
    expect(getExternalIdentifierLabel("openlibrary:OL45883W")).toBe(
      "Open Library OL45883W",
    );
    expect(getExternalIdentifierLabel("gutenberg:130")).toBe("Gutenberg 130");
    expect(getExternalIdentifierLabel("wikidata:Q188371")).toBe(
      "Wikidata Q188371",
    );
    expect(getExternalIdentifierLabel("wikipedia:en:Aesop's_Fables")).toBe(
      "Wikipedia Aesop's Fables (en)",
    );
  });

  it("builds catalogue URLs", () => {
    expect(getExternalIdentifierHref("openlibrary:OL45883W")).toBe(
      "https://openlibrary.org/works/OL45883W",
    );
    expect(getExternalIdentifierHref("openlibrary:OL7353617M")).toBe(
      "https://openlibrary.org/books/OL7353617M",
    );
    expect(getExternalIdentifierHref("openlibrary:OL18319A")).toBe(
      "https://openlibrary.org/authors/OL18319A",
    );
    expect(getExternalIdentifierHref("gutenberg:130")).toBe(
      "https://www.gutenberg.org/ebooks/130",
    );
    expect(getExternalIdentifierHref("wikidata:Q188371")).toBe(
      "https://www.wikidata.org/wiki/Q188371",
    );
    expect(getExternalIdentifierHref("wikipedia:en:Aesop's_Fables")).toBe(
      "https://en.wikipedia.org/wiki/Aesop's_Fables",
    );
  });

  it("has no URL for OverDrive ids", () => {
    expect(
      getExternalIdentifierHref(
        "overdrive:550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toBeUndefined();
  });

  it("prefers an explicit hint over the derived URL", () => {
    expect(
      getExternalIdentifierHref("gutenberg:130", "https://example.com/book"),
    ).toBe("https://example.com/book");
  });

  it("names the catalogue types", () => {
    expect(getExternalTypeLabel("openlibrary")).toBe("Open Library");
    expect(getExternalTypeLabel("gutenberg")).toBe("Project Gutenberg");
    expect(getExternalTypeLabel("overdrive")).toBe("OverDrive");
  });

  it("leaves the pre-existing types alone", () => {
    expect(inferExternalIdentifierType("isbn:9780765382030")).toBe("isbn");
    expect(getExternalIdentifierLabel("isbn:9780765382030")).toBe(
      "ISBN 9780765382030",
    );
    expect(getExternalTypeLabel("isbn")).toBe("Book");
  });
});

// `bitcoin:tx:<txid>` is what a kind 8333 on-chain zap carries, and what makes
// the transaction reachable from every surface that renders an `i` tag.
describe("bitcoin transaction identifiers", () => {
  const TXID =
    "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

  it("links a well-formed txid to mempool.space", () => {
    expect(getExternalIdentifierHref(`bitcoin:tx:${TXID}`)).toBe(
      `https://mempool.space/tx/${TXID}`,
    );
  });

  it("outranks a hint, which is publisher-controlled text in an href", () => {
    expect(
      getExternalIdentifierHref(
        `bitcoin:tx:${TXID}`,
        "https://evil.example/phish",
      ),
    ).toBe(`https://mempool.space/tx/${TXID}`);
  });

  it("refuses a malformed txid rather than building a URL around it", () => {
    // The spec fixes the txid at 64 LOWERCASE hex characters, so an uppercase
    // one is not merely unusual — it would not match the dedupe key either.
    expect(
      getExternalIdentifierHref(`bitcoin:tx:${TXID.toUpperCase()}`),
    ).toBeUndefined();
    expect(getExternalIdentifierHref(`bitcoin:tx:${TXID.slice(0, 63)}`)).toBe(
      undefined,
    );
    expect(getExternalIdentifierHref(`bitcoin:tx:${TXID}ff`)).toBeUndefined();
    expect(getExternalIdentifierHref("bitcoin:tx:")).toBeUndefined();
    expect(
      getExternalIdentifierHref("bitcoin:tx:../../etc/passwd"),
    ).toBeUndefined();
  });

  it("still honours the hint when the txid is unusable", () => {
    expect(
      getExternalIdentifierHref("bitcoin:tx:nope", "https://example.com/tx"),
    ).toBe("https://example.com/tx");
  });

  it("leaves other chains to their hints", () => {
    expect(getExternalIdentifierHref(`ethereum:tx:${TXID}`)).toBeUndefined();
  });

  it("keeps the type and label inference it already had", () => {
    expect(inferExternalIdentifierType(`bitcoin:tx:${TXID}`)).toBe(
      "bitcoin:tx",
    );
    expect(getExternalTypeLabel("bitcoin:tx")).toBe("Transaction");
  });
});
