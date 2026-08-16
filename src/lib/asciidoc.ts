/**
 * Minimal AsciiDoc parser for the subset used by NKBIP-01 publication sections
 * (kind 30041) and NIP-54 wiki articles (kind 30818).
 *
 * Pure and dependency-free on purpose — no React, no nostr-tools, no `@/`
 * imports — so it stays testable and reusable across renderers.
 *
 * Supported: headings, paragraphs, bulleted/numbered lists with nesting,
 * `----`/`....` listing blocks with `[source,lang]`, `____` quote blocks,
 * `'''` breaks, `image::`, links (`url[text]`, `link:url[text]`, bare),
 * `*bold*` `_italic_` `` `mono` ``, `[[wikilinks]]`, `nostr:` references,
 * `//` line comments and `:attribute:` lines. Also recognises the
 * `{{name:target|label}}` macro some publishing clients emit — parsed
 * generically, since only the renderer knows what a given name points at.
 *
 * Not supported (rendered as plain text if present): tables (`|===`),
 * admonitions, `include::`, footnotes, `<<xref>>` and anchors — `[[x]]` is
 * claimed for wikilinks, an intentional NKBIP-01/NIP-54 bias over AsciiDoc's
 * anchor semantics — `{attribute}` substitution, list continuation `+`,
 * description lists, inline `image:url[]`, block ids/roles, open `--`, example
 * `====`, sidebar `****`, passthrough `++++`, `////` comment blocks, callouts,
 * `^sup^`/`~sub~`/`#mark#`, trailing `+` hard breaks, `.Block title` lines and
 * `ifdef::` conditionals.
 */

export type AsciiDocInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: AsciiDocInline[] }
  | { type: "em"; children: AsciiDocInline[] }
  | { type: "code"; value: string }
  | { type: "link"; url: string; text: string }
  | { type: "wikilink"; target: string; label: string }
  /** bech32 identifier without the "nostr:" prefix */
  | { type: "nostr"; encoded: string }
  /**
   * `{{name:target|label}}` — a publishing-client extension, not AsciiDoc.
   * Parsed generically; what a given name means is the renderer's business.
   */
  | { type: "macro"; name: string; target: string; label: string };

export interface AsciiDocListItem {
  inlines: AsciiDocInline[];
  children?: AsciiDocListBlock;
}

export interface AsciiDocListBlock {
  type: "list";
  ordered: boolean;
  items: AsciiDocListItem[];
}

export type AsciiDocBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: AsciiDocInline[] }
  | { type: "paragraph"; inlines: AsciiDocInline[] }
  | AsciiDocListBlock
  | { type: "listing"; language?: string; text: string }
  | { type: "quote"; blocks: AsciiDocBlock[] }
  | { type: "image"; url: string; alt: string }
  | { type: "break" };

export interface AsciiDocDocument {
  /** `:name: value` lines — collected, never rendered */
  attributes: Record<string, string>;
  blocks: AsciiDocBlock[];
}

// --- block-level patterns ---------------------------------------------------

const COMMENT_RE = /^\/\/(?!\/)/;
const ATTRIBUTE_RE = /^:([A-Za-z0-9_!-]+):\s*(.*)$/;
const BLOCK_ATTR_RE = /^\[([^\]]*)\]\s*$/;
const LISTING_RE = /^(-{4,}|\.{4,})\s*$/;
const QUOTE_RE = /^_{4,}\s*$/;
const BREAK_RE = /^'{3,}\s*$/;
const HEADING_RE = /^(={1,6})\s+(\S.*)$/;
const IMAGE_RE = /^image::(\S+?)\[(.*)\]\s*$/;
const LIST_ITEM_RE = /^([*.]{1,5}|-)\s+(\S.*)$/;
const SOURCE_ATTR_RE = /^source(?:\s*,\s*([\w+-]+))?$/i;

// --- inline-level patterns (all anchored) -----------------------------------

const IN_MACRO = /^\{\{([a-z][\w-]*):([^}|\n]+?)(?:\|([^}\n]*))?\}\}/;
const IN_WIKILINK = /^\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/;
const IN_NOSTR =
  /^nostr:((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]{6,})/;
const IN_LINK_MACRO = /^link:(\S+?)\[([^\]\n]*)\]/;
const IN_URL_TEXT = /^(https?:\/\/[^\s[\]]+)\[([^\]\n]*)\]/;
const IN_URL_BARE = /^https?:\/\/[^\s<>"[\]]+/;
const IN_CODE = /^`([^`\n]+)`/;
const IN_STRONG = /^\*([^*\n]+)\*/;
const IN_EM = /^_([^_\n]+)_/;

/** Trailing characters that read as sentence punctuation, not part of a URL */
const URL_TRAILING = /[.,;:!?)]+$/;

interface ListFrame {
  depth: number;
  list: AsciiDocListBlock;
}

/**
 * Parse an AsciiDoc source string into a block tree.
 */
export function parseAsciiDoc(source: string): AsciiDocDocument {
  const attributes: Record<string, string> = {};
  const blocks = parseBlocks(source.split(/\r?\n/), attributes);
  return { attributes, blocks };
}

function parseBlocks(
  lines: string[],
  attributes: Record<string, string>,
): AsciiDocBlock[] {
  const blocks: AsciiDocBlock[] = [];
  const paragraph: string[] = [];
  const stack: ListFrame[] = [];
  let pendingAttrs: string | null = null;
  // Raw text of the list item currently accepting continuation lines
  let openItem: { raws: string[]; node: AsciiDocListItem } | null = null;

  function finalizeItem() {
    if (!openItem) return;
    openItem.node.inlines = parseAsciiDocInlines(openItem.raws.join(" "));
    openItem = null;
  }

  function closeList() {
    finalizeItem();
    stack.length = 0;
  }

  function flushParagraph() {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph.length = 0;
    if (text)
      blocks.push({ type: "paragraph", inlines: parseAsciiDocInlines(text) });
  }

  /** Where a new block goes: nested inside the open list item, or top level */
  function pushBlock(block: AsciiDocBlock) {
    blocks.push(block);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. line comments
    if (COMMENT_RE.test(line)) continue;

    // 2. document attributes
    const attr = ATTRIBUTE_RE.exec(line);
    if (attr) {
      attributes[attr[1]] = attr[2].trim();
      continue;
    }

    // 3. block attribute line, consumed by the next delimited block
    const blockAttr = BLOCK_ATTR_RE.exec(line);
    if (blockAttr) {
      pendingAttrs = blockAttr[1];
      continue;
    }

    // 4. listing / literal blocks
    const listing = LISTING_RE.exec(line);
    if (listing) {
      flushParagraph();
      closeList();
      const delimiter = listing[1];
      const isSource = delimiter.startsWith("-");
      const collected: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        if (lines[i].trimEnd() === delimiter) break;
        collected.push(lines[i]);
      }
      const language = isSource ? languageFromAttrs(pendingAttrs) : undefined;
      pendingAttrs = null;
      pushBlock({
        type: "listing",
        ...(language ? { language } : {}),
        text: collected.join("\n"),
      });
      continue;
    }

    // 5. quote blocks
    if (QUOTE_RE.test(line)) {
      flushParagraph();
      closeList();
      pendingAttrs = null;
      const collected: string[] = [];
      i++;
      for (; i < lines.length; i++) {
        if (QUOTE_RE.test(lines[i])) break;
        collected.push(lines[i]);
      }
      pushBlock({ type: "quote", blocks: parseBlocks(collected, attributes) });
      continue;
    }

    // 6. thematic break
    if (BREAK_RE.test(line)) {
      flushParagraph();
      closeList();
      pendingAttrs = null;
      pushBlock({ type: "break" });
      continue;
    }

    // 7. headings
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      pendingAttrs = null;
      pushBlock({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        inlines: parseAsciiDocInlines(heading[2].trim()),
      });
      continue;
    }

    // 8. block images
    const image = IMAGE_RE.exec(line);
    if (image) {
      flushParagraph();
      closeList();
      pendingAttrs = null;
      pushBlock({ type: "image", url: image[1], alt: image[2].trim() });
      continue;
    }

    // 9. list items
    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      flushParagraph();
      pendingAttrs = null;
      const marker = item[1];
      const ordered = marker.startsWith(".");
      const depth = marker === "-" ? 1 : marker.length;
      finalizeItem();

      while (stack.length > 0 && stack[stack.length - 1].depth > depth) {
        stack.pop();
      }

      let top = stack[stack.length - 1];
      if (top && top.depth === depth && top.list.ordered !== ordered) {
        stack.pop();
        top = stack[stack.length - 1];
      }

      if (!top || top.depth < depth) {
        const list: AsciiDocListBlock = { type: "list", ordered, items: [] };
        if (!top) {
          pushBlock(list);
        } else {
          const parentItem = top.list.items[top.list.items.length - 1];
          if (parentItem) parentItem.children = list;
          else pushBlock(list);
        }
        stack.push({ depth, list });
        top = stack[stack.length - 1];
      }

      const node: AsciiDocListItem = { inlines: [] };
      top.list.items.push(node);
      openItem = { raws: [item[2]], node };
      continue;
    }

    // 10. blank line closes the paragraph and any open list
    if (line.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    // 11. continuation of the current list item
    if (openItem) {
      openItem.raws.push(line.trim());
      continue;
    }

    // 12. paragraph text
    pendingAttrs = null;
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return blocks;
}

function languageFromAttrs(attrs: string | null): string | undefined {
  if (!attrs) return undefined;
  const match = SOURCE_ATTR_RE.exec(attrs.trim());
  return match?.[1];
}

/**
 * Parse inline markup. Exported for tests and for reuse by callers that already
 * have a single line of text.
 */
export function parseAsciiDocInlines(source: string): AsciiDocInline[] {
  const out: AsciiDocInline[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      out.push({ type: "text", value: buffer });
      buffer = "";
    }
  };
  const push = (node: AsciiDocInline) => {
    flush();
    out.push(node);
  };

  while (i < source.length) {
    const rest = source.slice(i);

    const braceMacro = IN_MACRO.exec(rest);
    if (braceMacro) {
      const target = braceMacro[2].trim();
      push({
        type: "macro",
        name: braceMacro[1],
        target,
        label: braceMacro[3]?.trim() || target,
      });
      i += braceMacro[0].length;
      continue;
    }

    const wiki = IN_WIKILINK.exec(rest);
    if (wiki) {
      const target = wiki[1].trim();
      push({ type: "wikilink", target, label: (wiki[2] ?? target).trim() });
      i += wiki[0].length;
      continue;
    }

    const nostr = IN_NOSTR.exec(rest);
    if (nostr) {
      push({ type: "nostr", encoded: nostr[1] });
      i += nostr[0].length;
      continue;
    }

    const macro = IN_LINK_MACRO.exec(rest);
    if (macro) {
      push({ type: "link", url: macro[1], text: macro[2] || macro[1] });
      i += macro[0].length;
      continue;
    }

    const urlText = IN_URL_TEXT.exec(rest);
    if (urlText) {
      push({ type: "link", url: urlText[1], text: urlText[2] || urlText[1] });
      i += urlText[0].length;
      continue;
    }

    const bare = IN_URL_BARE.exec(rest);
    if (bare) {
      const url = bare[0].replace(URL_TRAILING, "");
      if (url) {
        push({ type: "link", url, text: url });
        i += url.length;
        continue;
      }
    }

    const code = IN_CODE.exec(rest);
    if (code) {
      push({ type: "code", value: code[1] });
      i += code[0].length;
      continue;
    }

    const strong = IN_STRONG.exec(rest);
    if (strong && isConstrained(source, i, strong[0], strong[1])) {
      push({ type: "strong", children: parseAsciiDocInlines(strong[1]) });
      i += strong[0].length;
      continue;
    }

    const em = IN_EM.exec(rest);
    if (em && isConstrained(source, i, em[0], em[1])) {
      push({ type: "em", children: parseAsciiDocInlines(em[1]) });
      i += em[0].length;
      continue;
    }

    buffer += source[i];
    i++;
  }

  flush();
  return out;
}

/**
 * AsciiDoc "constrained" formatting: the marker must sit on a word boundary and
 * the content must not be padded. Without this, `snake_case_name` and `2*3*4`
 * get mangled into emphasis.
 */
function isConstrained(
  source: string,
  index: number,
  matched: string,
  content: string,
): boolean {
  if (content !== content.trim()) return false;
  const before = index > 0 ? source[index - 1] : "";
  if (before && /[\w\\]/.test(before)) return false;
  const after = source[index + matched.length] ?? "";
  if (after && /\w/.test(after)) return false;
  return true;
}
