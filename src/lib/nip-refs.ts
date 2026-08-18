/**
 * `NIP-01` in plain prose, as something clickable.
 *
 * `nipReferences()` already does this inside applesauce's content pipeline, which
 * is what `RichText` renders. A model's reply is markdown, not a Nostr event, so
 * it never passes through that pipeline — and a NIP number is the most common
 * reference in an answer about the protocol. Same pattern, deliberately: the two
 * must agree on what counts as a NIP.
 */

/** Decimal (`NIP-01`, `NIP-100`) and hex (`NIP-C7`) alike. */
const NIP_PATTERN = /\bNIP-([0-9A-Fa-f]{1,3})\b/gi;

export interface NipSegment {
  text: string;
  /** Normalized id — decimal padded to two digits, hex uppercased. */
  number?: string;
}

/** Normalize as `nip-transformer` does, so both open the same window. */
function normalize(nip: string): string {
  return /^\d+$/.test(nip) ? nip.padStart(2, "0") : nip.toUpperCase();
}

/** Split text into plain runs and NIP references, in order. */
export function splitNipRefs(text: string): NipSegment[] {
  const segments: NipSegment[] = [];
  let last = 0;
  // Fresh matcher per call: a module-level `lastIndex` on a global regex leaks
  // between calls and drops matches.
  const pattern = new RegExp(NIP_PATTERN);
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({ text: match[0], number: normalize(match[1]) });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length > 0 ? segments : [{ text }];
}
