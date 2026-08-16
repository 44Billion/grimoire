import { describe, it, expect } from "vitest";
import {
  parseAsciiDoc,
  parseAsciiDocInlines,
  type AsciiDocBlock,
  type AsciiDocListBlock,
} from "./asciidoc";

function blocks(source: string): AsciiDocBlock[] {
  return parseAsciiDoc(source).blocks;
}

function text(value: string) {
  return { type: "text", value };
}

describe("parseAsciiDoc — blocks", () => {
  it("parses all heading levels", () => {
    for (let level = 1; level <= 6; level++) {
      const [block] = blocks(`${"=".repeat(level)} Title`);
      expect(block).toEqual({
        type: "heading",
        level,
        inlines: [text("Title")],
      });
    }
  });

  it("does not treat a bare delimiter row as a heading", () => {
    expect(blocks("====")).toEqual([
      { type: "paragraph", inlines: [text("====")] },
    ]);
  });

  it("separates paragraphs on blank lines and joins wrapped lines", () => {
    expect(blocks("one\ntwo\n\nthree")).toEqual([
      { type: "paragraph", inlines: [text("one\ntwo")] },
      { type: "paragraph", inlines: [text("three")] },
    ]);
  });

  it("parses bulleted and numbered lists", () => {
    expect(blocks("* a\n* b")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [{ inlines: [text("a")] }, { inlines: [text("b")] }],
      },
    ]);
    expect(blocks("- a")).toEqual([
      { type: "list", ordered: false, items: [{ inlines: [text("a")] }] },
    ]);
    expect(blocks(". a")).toEqual([
      { type: "list", ordered: true, items: [{ inlines: [text("a")] }] },
    ]);
  });

  it("nests lists two deep and pops back to a sibling", () => {
    const [list] = blocks("* a\n** a1\n** a2\n* b") as [AsciiDocListBlock];
    expect(list.items).toHaveLength(2);
    expect(list.items[0].children?.items.map((i) => i.inlines)).toEqual([
      [text("a1")],
      [text("a2")],
    ]);
    expect(list.items[1].inlines).toEqual([text("b")]);
    expect(list.items[1].children).toBeUndefined();
  });

  it("appends a wrapped list item line to the same item", () => {
    const [list] = blocks("* first part\nsecond part") as [AsciiDocListBlock];
    expect(list.items[0].inlines).toEqual([text("first part second part")]);
  });

  it("reads the language from a [source,lang] attribute line", () => {
    expect(blocks("[source,ruby]\n----\nputs 1\n----")).toEqual([
      { type: "listing", language: "ruby", text: "puts 1" },
    ]);
  });

  it("leaves a bare listing block and a literal block without a language", () => {
    expect(blocks("----\nx\n----")).toEqual([{ type: "listing", text: "x" }]);
    expect(blocks("[source,ruby]\n....\nx\n....")).toEqual([
      { type: "listing", text: "x" },
    ]);
  });

  it("parses a quote block containing a paragraph and a list", () => {
    expect(blocks("____\nquoted\n\n* item\n____")).toEqual([
      {
        type: "quote",
        blocks: [
          { type: "paragraph", inlines: [text("quoted")] },
          {
            type: "list",
            ordered: false,
            items: [{ inlines: [text("item")] }],
          },
        ],
      },
    ]);
  });

  it("parses thematic breaks and block images", () => {
    expect(blocks("'''")).toEqual([{ type: "break" }]);
    expect(blocks("image::https://x/y.png[Alt text]")).toEqual([
      { type: "image", url: "https://x/y.png", alt: "Alt text" },
    ]);
  });

  it("strips comments outside a listing but preserves them inside one", () => {
    expect(blocks("// hidden\nvisible")).toEqual([
      { type: "paragraph", inlines: [text("visible")] },
    ]);
    expect(blocks("----\n// kept\n----")).toEqual([
      { type: "listing", text: "// kept" },
    ]);
  });

  it("collects document attributes without emitting a block", () => {
    const doc = parseAsciiDoc(":author: Alice\n\nbody");
    expect(doc.attributes).toEqual({ author: "Alice" });
    expect(doc.blocks).toEqual([
      { type: "paragraph", inlines: [text("body")] },
    ]);
  });

  it("drops an orphan block attribute line", () => {
    expect(blocks("[source,ruby]\nbody")).toEqual([
      { type: "paragraph", inlines: [text("body")] },
    ]);
  });
});

describe("parseAsciiDoc — edge cases", () => {
  it("survives unterminated delimited blocks", () => {
    expect(blocks("----\nx\ny")).toEqual([{ type: "listing", text: "x\ny" }]);
    expect(blocks("____\nx")).toEqual([
      { type: "quote", blocks: [{ type: "paragraph", inlines: [text("x")] }] },
    ]);
  });

  it("returns no blocks for empty, blank or comment-only input", () => {
    expect(blocks("")).toEqual([]);
    expect(blocks("   \n\n  ")).toEqual([]);
    expect(blocks("// a\n// b")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(blocks("= Title\r\n\r\nbody")).toEqual([
      { type: "heading", level: 1, inlines: [text("Title")] },
      { type: "paragraph", inlines: [text("body")] },
    ]);
  });
});

describe("parseAsciiDocInlines", () => {
  it("parses bold, italic and monospace", () => {
    expect(parseAsciiDocInlines("*b*")).toEqual([
      { type: "strong", children: [text("b")] },
    ]);
    expect(parseAsciiDocInlines("_i_")).toEqual([
      { type: "em", children: [text("i")] },
    ]);
    expect(parseAsciiDocInlines("`m`")).toEqual([{ type: "code", value: "m" }]);
  });

  it("nests emphasis", () => {
    expect(parseAsciiDocInlines("*bold _both_*")).toEqual([
      {
        type: "strong",
        children: [text("bold "), { type: "em", children: [text("both")] }],
      },
    ]);
  });

  it("parses adjacent emphasis runs", () => {
    expect(parseAsciiDocInlines("*a**b*")).toEqual([
      { type: "strong", children: [text("a")] },
      { type: "strong", children: [text("b")] },
    ]);
  });

  it("leaves unconstrained markers alone", () => {
    expect(parseAsciiDocInlines("snake_case_word")).toEqual([
      text("snake_case_word"),
    ]);
    expect(parseAsciiDocInlines("2*3*4")).toEqual([text("2*3*4")]);
  });

  it("does not recurse into monospace content", () => {
    expect(parseAsciiDocInlines("`*x*`")).toEqual([
      { type: "code", value: "*x*" },
    ]);
  });

  it("parses all three link forms", () => {
    expect(parseAsciiDocInlines("https://x.com[Site]")).toEqual([
      { type: "link", url: "https://x.com", text: "Site" },
    ]);
    expect(parseAsciiDocInlines("link:https://x.com[Site]")).toEqual([
      { type: "link", url: "https://x.com", text: "Site" },
    ]);
    expect(parseAsciiDocInlines("https://x.com")).toEqual([
      { type: "link", url: "https://x.com", text: "https://x.com" },
    ]);
  });

  it("keeps sentence punctuation out of a bare URL", () => {
    expect(parseAsciiDocInlines("see https://x.com.")).toEqual([
      text("see "),
      { type: "link", url: "https://x.com", text: "https://x.com" },
      text("."),
    ]);
  });

  it("parses wikilinks with and without a label", () => {
    expect(parseAsciiDocInlines("[[Aesop]]")).toEqual([
      { type: "wikilink", target: "Aesop", label: "Aesop" },
    ]);
    expect(parseAsciiDocInlines("[[aesop|The Author]]")).toEqual([
      { type: "wikilink", target: "aesop", label: "The Author" },
    ]);
  });

  it("parses {{name:target|label}} macros", () => {
    expect(
      parseAsciiDocInlines(
        "see {{ref:concept-rules-in-use|Rules-in-use}} here",
      ),
    ).toEqual([
      text("see "),
      {
        type: "macro",
        name: "ref",
        target: "concept-rules-in-use",
        label: "Rules-in-use",
      },
      text(" here"),
    ]);
  });

  it("falls back to the target when a macro has no label", () => {
    expect(parseAsciiDocInlines("{{ref:src-ostrom-irc-iad}}")).toEqual([
      {
        type: "macro",
        name: "ref",
        target: "src-ostrom-irc-iad",
        label: "src-ostrom-irc-iad",
      },
    ]);
  });

  it("leaves a malformed or unterminated macro as text", () => {
    expect(parseAsciiDocInlines("{{ref:open")).toEqual([text("{{ref:open")]);
    expect(parseAsciiDocInlines("{{notamacro}}")).toEqual([
      text("{{notamacro}}"),
    ]);
  });

  it("parses nostr references", () => {
    const npub =
      "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
    expect(parseAsciiDocInlines(`hi nostr:${npub} there`)).toEqual([
      text("hi "),
      { type: "nostr", encoded: npub },
      text(" there"),
    ]);
  });

  it("merges adjacent text runs", () => {
    expect(parseAsciiDocInlines("a [ b ] c")).toEqual([text("a [ b ] c")]);
  });

  it("leaves an unterminated wikilink as text", () => {
    expect(parseAsciiDocInlines("[[open")).toEqual([text("[[open")]);
  });
});
