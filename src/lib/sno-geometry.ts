/**
 * DECK-0003 §1.4, §1.5, §1.10 and §4: the flat buffers a renderer draws an
 * object with, and the matrix a placement stands at. Pure: no three.js here,
 * so it is unit-testable and the canvas module stays the only one that
 * imports the library.
 */
import {
  positions,
  TICKS_PER_UNIT,
  type Int3,
  type Rgb,
  type SnoObject,
  type SnoPart,
} from "./sno-parser";

export interface SnoBuffers {
  /** Non-indexed triangle corners, xyz per corner, three corners per face. */
  trianglePositions: Float32Array;
  /** 0..1 rgb per corner. A face with its own color fills flat (§1.4a). */
  triangleColors: Float32Array;
  /** Line segments, xyz per endpoint, two per segment. Each edge drawn once. */
  linePositions: Float32Array;
  /** 0..1 rgb per endpoint, the vertex's own color (§1.5). */
  lineColors: Float32Array;
  /** Every vertex, xyz. */
  pointPositions: Float32Array;
  pointColors: Float32Array;
  /** Axis-aligned bounds of the vertices in model units, or null when empty. */
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
}

function pushRgb(out: number[], [r, g, b]: Rgb) {
  out.push(r / 255, g / 255, b / 255);
}

/**
 * §1.5: the edges of the faces, each drawn once, deduplicated on the
 * integer index pair; with no faces, one polyline through the vertices in
 * order. Pairs are returned with the smaller index first.
 */
export function uniqueEdges(
  faces: Int3[],
  vertexCount: number,
): [number, number][] {
  if (faces.length === 0) {
    const out: [number, number][] = [];
    for (let i = 1; i < vertexCount; i++) out.push([i - 1, i]);
    return out;
  }
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const [a, b, c] of faces) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const lo = p < q ? p : q;
      const hi = p < q ? q : p;
      const key = lo * vertexCount + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lo, hi]);
    }
  }
  return out;
}

/** Build every buffer a renderer needs from a validated object. */
export function buildSnoBuffers(object: SnoObject): SnoBuffers {
  const pos = positions(object);

  const tri: number[] = [];
  const triColor: number[] = [];
  object.faces.forEach((face, fi) => {
    const flat = object.faceColors?.[fi];
    for (const vi of face) {
      const p = pos[vi];
      tri.push(p[0], p[1], p[2]);
      pushRgb(triColor, flat ?? object.colors[vi]);
    }
  });

  const line: number[] = [];
  const lineColor: number[] = [];
  for (const [a, b] of uniqueEdges(object.faces, pos.length)) {
    line.push(...pos[a], ...pos[b]);
    pushRgb(lineColor, object.colors[a]);
    pushRgb(lineColor, object.colors[b]);
  }

  const point: number[] = [];
  const pointColor: number[] = [];
  pos.forEach((p, i) => {
    point.push(p[0], p[1], p[2]);
    pushRgb(pointColor, object.colors[i]);
  });

  let bounds: SnoBuffers["bounds"] = null;
  if (pos.length > 0) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const p of pos) {
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
    }
    bounds = { min, max };
  }

  return {
    trianglePositions: new Float32Array(tri),
    triangleColors: new Float32Array(triColor),
    linePositions: new Float32Array(line),
    lineColors: new Float32Array(lineColor),
    pointPositions: new Float32Array(point),
    pointColors: new Float32Array(pointColor),
    bounds,
  };
}

/** Cosine and sine of whole degrees, exact at the quarter turns so a 90 keeps a part on the lattice. */
function cs(deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [1, 0];
  if (d === 90) return [0, 1];
  if (d === 180) return [-1, 0];
  if (d === 270) return [0, -1];
  const r = (d * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** A row-major 3x3. */
export type M3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

/**
 * §1.10: the rotation a turn names, about the parent's X, then Y, then Z,
 * all fixed axes, so `Rz · Ry · Rx`. Matches sno-core's `turnMatrix`.
 */
export function turnMatrix(t: Int3): M3 {
  const [ca, sa] = cs(t[0]);
  const [cb, sb] = cs(t[1]);
  const [cc, sc] = cs(t[2]);
  const rx: M3 = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
  const ry: M3 = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
  const rz: M3 = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
  return mul(rz, mul(ry, rx));
}

/**
 * §1.10: where a placed object stands, as a 4x4 in column-major order (what
 * three's `Matrix4.fromArray` takes), carrying a point in the placed
 * object's model units into the parent's model units. The scale is
 * `2^(its unit + step - the parent's unit)`; the translation is the
 * placement's ticks as whole units.
 */
export function partMatrix(
  part: SnoPart,
  parentUnit: number,
  placedUnit: number,
): number[] {
  const r = turnMatrix(part.turn);
  const s = 2 ** (placedUnit + part.step - parentUnit);
  const [tx, ty, tz] = part.at.map((v) => v / TICKS_PER_UNIT);
  return [
    r[0] * s,
    r[3] * s,
    r[6] * s,
    0,
    r[1] * s,
    r[4] * s,
    r[7] * s,
    0,
    r[2] * s,
    r[5] * s,
    r[8] * s,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/** Apply a column-major 4x4 to a point. */
export function applyMatrix(
  m: number[],
  p: [number, number, number],
): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}
