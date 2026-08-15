/** Split of a NIP-84 `context` string around the highlighted portion. */
export interface HighlightContextSplit {
  before: string;
  match: string;
  after: string;
}

/** Collapse runs of whitespace, keeping a map from collapsed index -> original index. */
function collapse(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let inSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/\s/.test(char)) {
      if (inSpace) continue;
      inSpace = true;
      out += " ";
      map.push(i);
    } else {
      inSpace = false;
      out += char;
      map.push(i);
    }
  }

  return { text: out, map };
}

/**
 * Locate `highlight` inside `context` and split the context around it.
 * Falls back to whitespace-insensitive matching, mapping back to the original
 * indices so the context's own text is rendered verbatim.
 * Returns null when the highlight isn't present.
 */
export function splitHighlightContext(
  context: string | undefined,
  highlight: string | undefined,
): HighlightContextSplit | null {
  if (!context || !highlight) return null;

  const exact = context.indexOf(highlight);
  if (exact !== -1) {
    return {
      before: context.slice(0, exact),
      match: context.slice(exact, exact + highlight.length),
      after: context.slice(exact + highlight.length),
    };
  }

  const haystack = collapse(context);
  const needle = collapse(highlight).text.trim();
  if (!needle) return null;

  const found = haystack.text.indexOf(needle);
  if (found === -1) return null;

  const start = haystack.map[found];
  const lastIndex = haystack.map[found + needle.length - 1];
  // The mapped index points at the first char of the collapsed run; extend the
  // end past the full original character.
  const end = lastIndex + 1;

  return {
    before: context.slice(0, start),
    match: context.slice(start, end),
    after: context.slice(end),
  };
}
