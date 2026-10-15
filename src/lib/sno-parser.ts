/**
 * DECK-0003: SNO (Simple Nostr Objects).
 *
 * A port of `decks/sno-reference.py` from arkin0x/cyberspace, the normative
 * validation of §1.9 plus the position expansion of §1.2. The reference file
 * is the arbiter when this port and the spec disagree; its self-test table is
 * reproduced in `sno-parser.test.ts`.
 *
 * Section numbers in comments refer to
 * https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0003-sno.md
 */
import { getOrComputeCachedValue } from "applesauce-core/helpers";
import type { NostrEvent } from "nostr-tools";
import builtInPalette from "@/constants/sno-palette.json";

// §1.8. There is no ceiling on vertices or faces: the event's size is the
// relay's concern, as it is for every other kind.
export const MIN_EXTENT = 1;
export const MAX_EXTENT = 64;
export const DEFAULT_EXTENT = 8;
export const MAX_UNIT = 84;
export const MAX_NAME = 64;

/** §1.2. One model unit is this many ticks. */
export const TICKS_PER_UNIT = 120;

/** §1.10. The 64-unit position bound of §1.8, in ticks. */
export const PART_REACH = 64 * TICKS_PER_UNIT;

/** §1.10. How far a reader follows placements. */
export const MAX_PART_DEPTH = 4;

export const SNO_MODES = ["solid", "points", "lines"] as const;
export type SnoMode = (typeof SNO_MODES)[number];

/** Kinds that carry an SNO payload in `content` (§3). */
export const SNO_OBJECT_KIND = 33331;
export const SNO_SHARD_KIND = 3330;
export const SNO_AVATAR_KIND = 11333;

export const BUILT_IN_PALETTE_NAME = "cyberspace-neon-256";

export type Rgb = [number, number, number];
export type Int3 = [number, number, number];

export type SnoRef = ["e" | "a", string] | ["e" | "a", string, string];

/** §1.10. One placement, eight integers. */
export interface SnoPart {
  ref: number;
  /** Where the origin stands, in the parent's ticks. */
  at: Int3;
  /** Whole degrees about the parent's X, then Y, then Z. */
  turn: Int3;
  /** Scale step: drawn at 2^(its unit + step). */
  step: number;
}

/** A validated object (§1.9), with every run-length field expanded. */
export interface SnoObject {
  v: 1 | 2;
  name: string;
  unit: number;
  /** Repaired (§1.8): never absent, never out of range, contains every vertex. */
  extent: number;
  /** The `extent` as written, when it was a usable integer in 1..64. */
  declaredExtent?: number;
  mode: SnoMode;
  /** Whole-unit part of each position, as written. */
  vertices: Int3[];
  /** Expanded remainders, one per vertex, each component 0..119. */
  ticks: Int3[];
  /**
   * One color per vertex, resolved to 0..255 channels. A v2 index is looked
   * up in the palette; a v1 literal 0..1 triple is clamped and scaled.
   */
  colors: Rgb[];
  /** Palette indices as written (v2) or `undefined` for v1. */
  colorIndices?: number[];
  faces: Int3[];
  /** Expanded, one resolved color per face, or undefined when faces interpolate. */
  faceColors?: Rgb[];
  /** The palette the indices name, as 0..255 channels. */
  palette: Rgb[];
  /** Where the palette came from. */
  paletteSource:
    | { kind: "built-in" }
    | { kind: "inline" }
    | { kind: "reference"; ref: string; resolved: boolean };
  up: boolean;
  spin: number;
  refs: SnoRef[];
  parts: SnoPart[];
}

export class SnoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnoError";
  }
}

export type SnoResult =
  { ok: true; object: SnoObject } | { ok: false; error: string };

type Json = unknown;

/**
 * An integer this reader can hold exactly. `Number.isInteger(1e300)` is
 * true, and a vertex there would hand the renderer a grid of 1e300 cells;
 * the reference parses that literal as a float and rejects it, so the safe
 * range is the faithful reading of "integer".
 */
function isInt(x: Json): x is number {
  return typeof x === "number" && Number.isSafeInteger(x);
}

function isNum(x: Json): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function isRecord(x: Json): x is Record<string, Json> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** §1.2: the run-length encoded remainders, one triple per vertex. */
export function expandTicks(ticks: Json, count: number): Int3[] {
  if (ticks === undefined || ticks === null) {
    return Array.from({ length: count }, () => [0, 0, 0]);
  }
  if (!Array.isArray(ticks))
    throw new SnoError("rule 7: ticks is not an array");
  const out: Int3[] = [];
  for (const entry of ticks) {
    if (isInt(entry)) {
      if (entry >= 0) {
        throw new SnoError("rule 7: a run-length entry must be negative");
      }
      // §6: a run is a length field. Check it against what is left before
      // allocating, or a stranger's `[-1e9]` is a tab crash before rule 7.
      if (-entry > count - out.length) {
        throw new SnoError(
          `rule 7: ticks expand past the ${count} vertices they describe`,
        );
      }
      for (let i = 0; i < -entry; i++) out.push([0, 0, 0]);
    } else if (Array.isArray(entry) && entry.length === 3) {
      if (!entry.every((c) => isInt(c) && c >= 0 && c <= TICKS_PER_UNIT - 1)) {
        throw new SnoError(
          "rule 7: a tick component is not an integer in 0..119",
        );
      }
      out.push([entry[0], entry[1], entry[2]] as Int3);
    } else {
      throw new SnoError(
        "rule 7: a ticks entry is neither a triple nor a negative integer",
      );
    }
    if (out.length > count) break;
  }
  if (out.length !== count) {
    throw new SnoError(
      `rule 7: ticks expand to ${out.length} remainders for ${count} vertices`,
    );
  }
  return out;
}

/**
 * §1.4a: the run-length encoded face colours, one palette index per face.
 * Absent means every face interpolates its vertices, so the caller
 * distinguishes undefined from an array.
 */
export function expandFaceColors(
  entries: Json,
  count: number,
  paletteLength: number,
): number[] {
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) {
    throw new SnoError("rule 8c: facecolors is not an array");
  }
  const out: number[] = [];
  for (const entry of entries) {
    if (!isInt(entry)) {
      throw new SnoError("rule 8c: a facecolors entry is not an integer");
    }
    if (entry < 0) {
      if (out.length === 0) {
        throw new SnoError(
          "rule 8c: the first entry must be an index, not a run",
        );
      }
      if (-entry > count - out.length) {
        throw new SnoError(
          `rule 8c: facecolors expand past the ${count} faces they describe`,
        );
      }
      const last = out[out.length - 1];
      for (let i = 0; i < -entry; i++) out.push(last);
    } else {
      if (entry >= paletteLength) {
        throw new SnoError(
          `rule 8c: face colour ${entry} is outside the palette of ${paletteLength}`,
        );
      }
      out.push(entry);
    }
    if (out.length > count) break;
  }
  if (out.length !== count) {
    throw new SnoError(
      `rule 8c: facecolors expand to ${out.length} colours for ${count} faces`,
    );
  }
  return out;
}

/** §1.8: the bounding hint, corrected against the data. */
export function repairedExtent(
  declared: Json,
  vertices: Int3[],
  ticks: Int3[],
): number {
  let extent =
    isInt(declared) && declared >= MIN_EXTENT && declared <= MAX_EXTENT
      ? declared
      : DEFAULT_EXTENT;
  for (let i = 0; i < vertices.length; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const total = Math.abs(
        vertices[i][axis] * TICKS_PER_UNIT + ticks[i][axis],
      );
      const need = Math.ceil(total / TICKS_PER_UNIT);
      if (need > extent) extent = need;
    }
  }
  return extent;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const ADDRESS_RE = /^33331:[0-9a-f]{64}:/;
/** §1.3a. A palette carried by an event rather than by the object. */
const PALETTE_REF_RE =
  /^(nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]{20,}$/;

export function isPaletteReference(value: string): boolean {
  return PALETTE_REF_RE.test(value);
}

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function isRgbEntry(entry: Json): entry is Rgb {
  return (
    Array.isArray(entry) &&
    entry.length === 3 &&
    entry.every((c) => isInt(c) && c >= 0 && c <= 255)
  );
}

let builtInCache: Rgb[] | undefined;

/** The 256 colours of `cyberspace-neon-256` (§1.3a, Appendix C). */
export function builtInPaletteColors(): Rgb[] {
  if (!builtInCache) {
    builtInCache = (builtInPalette.colors as string[]).map(hexToRgb);
  }
  return builtInCache;
}

/** §1.3b step 2: the legacy palette in an event's `content`, or null. */
export function parsePaletteContent(text: string): Rgb[] | null {
  let raw: Json;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 256) return null;
  const out: Rgb[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && HEX_RE.test(entry)) {
      out.push(hexToRgb(entry));
    } else if (isRgbEntry(entry)) {
      out.push([entry[0], entry[1], entry[2]]);
    } else {
      return null;
    }
  }
  return out;
}

/**
 * §1.3b: the palette an event carries, or null when it carries none.
 * `c` tags first, in document order; `content` only as the legacy form.
 * Accepts a full event, a loose `{ tags, content }` shape, or a bare content
 * string for a caller that has nothing else.
 */
export function parsePaletteEvent(event: Json): Rgb[] | null {
  if (typeof event === "string") return parsePaletteContent(event);
  if (!isRecord(event)) return null;

  const tags = event.tags;
  const marked = Array.isArray(tags)
    ? tags.filter((t) => Array.isArray(t) && t.length > 0 && t[0] === "c")
    : [];
  if (marked.length >= 2 && marked.length <= 256) {
    let out: Rgb[] | null = [];
    for (const tag of marked) {
      // One malformed value fails the whole tag path rather than being
      // skipped: every index after a hole would shift.
      const value = (tag as Json[])[1];
      if (typeof value !== "string" || !HEX_RE.test(value)) {
        out = null;
        break;
      }
      out.push(hexToRgb(value));
    }
    if (out) return out;
  }

  const content = event.content;
  return typeof content === "string" ? parsePaletteContent(content) : null;
}

/**
 * §1.3a and §1.3b: the colours an object's indices name.
 * `fetched` is the referenced palette event if the caller managed to get it;
 * an unresolved reference is the built-in and never a rejection.
 */
export function resolvePalette(
  field: Json,
  fetched?: Json,
): { palette: Rgb[]; source: SnoObject["paletteSource"] } {
  if (field === undefined || field === null) {
    return { palette: builtInPaletteColors(), source: { kind: "built-in" } };
  }
  if (typeof field === "string") {
    if (field === BUILT_IN_PALETTE_NAME) {
      return { palette: builtInPaletteColors(), source: { kind: "built-in" } };
    }
    if (PALETTE_REF_RE.test(field)) {
      const parsed =
        fetched === undefined || fetched === null
          ? null
          : parsePaletteEvent(fetched);
      return parsed
        ? {
            palette: parsed,
            source: { kind: "reference", ref: field, resolved: true },
          }
        : {
            palette: builtInPaletteColors(),
            source: { kind: "reference", ref: field, resolved: false },
          };
    }
    throw new SnoError(`rule 8a: unknown palette ${JSON.stringify(field)}`);
  }
  if (!Array.isArray(field)) {
    throw new SnoError(
      "rule 8a: palette is neither a name, a reference, nor an array",
    );
  }
  if (field.length < 2 || field.length > 256) {
    throw new SnoError(
      `rule 8a: a palette carries 2 to 256 colours, not ${field.length}`,
    );
  }
  const out: Rgb[] = [];
  for (const entry of field) {
    if (!isRgbEntry(entry)) {
      throw new SnoError(
        "rule 8a: a palette entry is not three integers in 0..255",
      );
    }
    out.push([entry[0], entry[1], entry[2]]);
  }
  return { palette: out, source: { kind: "inline" } };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * §1.9, in order. Throws `SnoError` naming the rule, or returns the object
 * with every run-length field expanded and the extent repaired.
 *
 * A payload is accepted whole or not at all: a face index past the end of the
 * vertex list is undefined behaviour inside most graphics libraries, so there
 * is no partial render to degrade to.
 */
export function validateSno(payload: Json, fetchedPalette?: Json): SnoObject {
  if (!isRecord(payload)) {
    throw new SnoError("rule 1: payload is not a JSON object");
  }

  // 1. version. §1.1a: a `type` field is ignored wherever it appears.
  const v = payload.v;
  if (v !== 1 && v !== 2) throw new SnoError("rule 1: v must be 1 or 2");

  // 2. the three arrays, and vertices parallel to colors
  for (const key of ["vertices", "colors", "faces"] as const) {
    if (!Array.isArray(payload[key])) {
      throw new SnoError(`rule 2: ${key} is not an array`);
    }
  }
  const vertices = payload.vertices as Json[];
  const colors = payload.colors as Json[];
  const faces = payload.faces as Json[];
  if (vertices.length !== colors.length) {
    throw new SnoError(
      `rule 2: ${vertices.length} vertices but ${colors.length} colors`,
    );
  }

  // 3. no bound on the counts (§1.8).

  // 4. mode
  const mode = payload.mode;
  if (
    typeof mode !== "string" ||
    !(SNO_MODES as readonly string[]).includes(mode)
  ) {
    throw new SnoError(`rule 4: mode must be one of ${SNO_MODES.join(", ")}`);
  }

  // 5. unit
  const unit = payload.unit;
  if (!isInt(unit) || unit < 0 || unit > MAX_UNIT) {
    throw new SnoError(`rule 5: unit must be an integer in 0..${MAX_UNIT}`);
  }

  // 6. the triples themselves
  const vertexTriples: Int3[] = [];
  for (const vertex of vertices) {
    if (!(
      Array.isArray(vertex) &&
      vertex.length === 3 &&
      vertex.every(isInt)
    )) {
      throw new SnoError("rule 6: a vertex is not three integers");
    }
    vertexTriples.push([vertex[0], vertex[1], vertex[2]] as Int3);
  }

  // 7. ticks
  const ticks = expandTicks(payload.ticks, vertices.length);

  // 8a. the palette, and 8b the colours read against it
  const { palette, source } = resolvePalette(payload.palette, fetchedPalette);
  const resolvedColors: Rgb[] = [];
  let colorIndices: number[] | undefined;
  if (v === 1) {
    // §1.3: version 1 carries literal triples, taken as written, never snapped.
    for (const c of colors) {
      if (!(Array.isArray(c) && c.length === 3 && c.every(isNum))) {
        throw new SnoError("rule 8b: a v1 colour is not three numbers");
      }
      resolvedColors.push([
        Math.round(clamp01(c[0]) * 255),
        Math.round(clamp01(c[1]) * 255),
        Math.round(clamp01(c[2]) * 255),
      ]);
    }
  } else if (
    colors.length > 0 &&
    colors.every((c) => Array.isArray(c) && c.length === 3 && c.every(isNum))
  ) {
    // §5: a v2 payload written before 2026-09-16 carries triples. The spec
    // lets a reader reject or read them literally, and the one live avatar
    // on the network is one, so this reader is the generous kind. This is a
    // deliberate divergence from sno-reference.py, which rejects under 8b.
    // All or nothing: a mix of triples and indices is not that payload.
    for (const c of colors as number[][]) {
      resolvedColors.push([
        Math.round(clamp01(c[0]) * 255),
        Math.round(clamp01(c[1]) * 255),
        Math.round(clamp01(c[2]) * 255),
      ]);
    }
  } else {
    colorIndices = [];
    for (const c of colors) {
      if (!isInt(c) || c < 0 || c >= palette.length) {
        throw new SnoError(
          `rule 8b: a colour index is not an integer in 0..${palette.length - 1}`,
        );
      }
      colorIndices.push(c);
      resolvedColors.push(palette[c]);
    }
  }

  // 8. faces
  const n = vertices.length;
  const faceTriples: Int3[] = [];
  for (const f of faces) {
    if (!(Array.isArray(f) && f.length === 3 && f.every(isInt))) {
      throw new SnoError("rule 8: a face is not three integers");
    }
    if (!f.every((i) => i >= 0 && i < n)) {
      throw new SnoError(`rule 8: a face indexes a vertex outside 0..${n - 1}`);
    }
    if (new Set(f).size !== 3) {
      throw new SnoError("rule 8: a face repeats a vertex");
    }
    faceTriples.push([f[0], f[1], f[2]] as Int3);
  }

  // 8c. face colours, when the object carries any
  let faceColors: Rgb[] | undefined;
  if (payload.facecolors !== undefined && payload.facecolors !== null) {
    faceColors = expandFaceColors(
      payload.facecolors,
      faces.length,
      palette.length,
    ).map((i) => palette[i]);
  }

  // 9. extent is repaired, never validated (§1.8).
  const extent = repairedExtent(payload.extent, vertexTriples, ticks);
  const declaredExtent =
    isInt(payload.extent) &&
    payload.extent >= MIN_EXTENT &&
    payload.extent <= MAX_EXTENT
      ? payload.extent
      : undefined;

  // 10. standing on Earth.
  if (
    "up" in payload &&
    payload.up !== undefined &&
    typeof payload.up !== "boolean"
  ) {
    throw new SnoError("rule 10: up, when present, must be a boolean");
  }
  let spin = 0;
  if ("spin" in payload && payload.spin !== undefined) {
    const s = payload.spin;
    if (!isInt(s) || s < 0 || s > 359) {
      throw new SnoError("rule 10: spin must be an integer in 0..359");
    }
    spin = s;
  }
  const up = payload.up === true;

  // 11. refs
  const refsRaw = payload.refs ?? [];
  if (!Array.isArray(refsRaw))
    throw new SnoError("rule 11: refs is not an array");
  const refs: SnoRef[] = [];
  for (const r of refsRaw) {
    if (
      !Array.isArray(r) ||
      r.length < 2 ||
      r.length > 3 ||
      !r.every((x) => typeof x === "string")
    ) {
      throw new SnoError(
        "rule 11: a refs entry is not a tag of two or three strings",
      );
    }
    const [kind, value] = r as string[];
    if (!(
      (kind === "e" && HEX64_RE.test(value)) ||
      (kind === "a" && ADDRESS_RE.test(value))
    )) {
      throw new SnoError(
        "rule 11: a refs entry is neither an e nor an a reference",
      );
    }
    refs.push(r as SnoRef);
  }

  // 12. parts
  const partsRaw = payload.parts ?? [];
  if (!Array.isArray(partsRaw)) {
    throw new SnoError("rule 12: parts is not an array");
  }
  const parts: SnoPart[] = [];
  for (const p of partsRaw) {
    if (!(Array.isArray(p) && p.length === 8 && p.every(isInt))) {
      throw new SnoError("rule 12: a placement is not eight integers");
    }
    const q = p as number[];
    if (!(q[0] >= 0 && q[0] < refs.length)) {
      throw new SnoError("rule 12: a placement names no refs entry");
    }
    if (!q.slice(1, 4).every((x) => x >= -PART_REACH && x <= PART_REACH)) {
      throw new SnoError("rule 12: a placement stands past the 64-unit bound");
    }
    if (!q.slice(4, 7).every((x) => x >= 0 && x <= 359)) {
      throw new SnoError("rule 12: a turn is not whole degrees 0..359");
    }
    parts.push({
      ref: q[0],
      at: [q[1], q[2], q[3]],
      turn: [q[4], q[5], q[6]],
      step: q[7],
    });
  }

  // 13. Nothing to check: an object may be only the arrangement of others.

  const name =
    typeof payload.name === "string" ? payload.name.slice(0, MAX_NAME) : "";

  return {
    v,
    name,
    unit,
    extent,
    declaredExtent,
    mode: mode as SnoMode,
    vertices: vertexTriples,
    ticks,
    colors: resolvedColors,
    colorIndices,
    faces: faceTriples,
    faceColors,
    palette,
    paletteSource: source,
    up,
    spin,
    refs,
    parts,
  };
}

/** `validateSno` as a result rather than a throw. */
export function parseSno(payload: Json, fetchedPalette?: Json): SnoResult {
  try {
    return { ok: true, object: validateSno(payload, fetchedPalette) };
  } catch (e) {
    if (e instanceof SnoError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Parse a JSON string into a result; bad JSON is a rule-1 failure. */
export function parseSnoContent(
  content: string,
  fetchedPalette?: Json,
): SnoResult {
  let payload: Json;
  try {
    payload = JSON.parse(content);
  } catch {
    return { ok: false, error: "rule 1: content is not JSON" };
  }
  return parseSno(payload, fetchedPalette);
}

/**
 * §1.2 and §2: positions in model units as floats, with the version applied.
 * A v1 object's Z is negated so it renders as its author built it. For
 * drawing only: equality and welding belong on the integer pair.
 */
export function positions(object: SnoObject): [number, number, number][] {
  const flip = object.v === 1 ? -1 : 1;
  return object.vertices.map((v, i) => {
    const t = object.ticks[i];
    return [
      v[0] + t[0] / TICKS_PER_UNIT,
      v[1] + t[1] / TICKS_PER_UNIT,
      (v[2] + t[2] / TICKS_PER_UNIT) * flip,
    ];
  });
}

/** §1.3a: the raw `palette` field of a payload, without validating the rest. */
export function getSnoPaletteField(event: NostrEvent): unknown {
  try {
    const raw = JSON.parse(event.content);
    return isRecord(raw) ? raw.palette : undefined;
  } catch {
    return undefined;
  }
}

const SnoObjectSymbol = Symbol("snoObject");

/**
 * The validated object an event carries, cached on the event. Uses the
 * built-in for an unresolved palette reference; a caller that fetched the
 * palette event re-parses with `parseSnoContent(event.content, fetched)`.
 */
export function getSnoObject(event: NostrEvent): SnoResult {
  return getOrComputeCachedValue(event, SnoObjectSymbol, () =>
    parseSnoContent(event.content),
  );
}

/** §3.4: a hidden object carried as its own event has an `encrypted` tag. */
export function getSnoEncryptedTag(event: NostrEvent): string[] | undefined {
  return event.tags.find((t) => t[0] === "encrypted");
}

/** §3.5: the `q` tag crediting the object this one was copied from. */
export function getSnoCreditAddress(event: NostrEvent): string | undefined {
  const q = event.tags.find((t) => t[0] === "q" && t[1]?.startsWith("33331:"));
  return q?.[1];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
