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
