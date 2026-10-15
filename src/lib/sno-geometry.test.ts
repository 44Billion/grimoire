import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyMatrix,
  buildSnoBuffers,
  partMatrix,
  turnMatrix,
  uniqueEdges,
} from "./sno-geometry";
import { validateSno } from "./sno-parser";

const TETRA = validateSno({
  v: 2,
  name: "tetra",
  unit: 0,
  mode: "solid",
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [1, 0, 2],
    [1, 2, 1],
  ],
  colors: [238, 235, 239, 225],
  faces: [
    [0, 1, 2],
    [0, 3, 1],
    [1, 3, 2],
    [0, 2, 3],
  ],
});

describe("buildSnoBuffers", () => {
  it("emits three corners per face, non-indexed", () => {
    const b = buildSnoBuffers(TETRA);
    expect(b.trianglePositions).toHaveLength(4 * 3 * 3);
    expect(b.triangleColors).toHaveLength(4 * 3 * 3);
    // Face 0 corner 1 is vertex 1 at [2,0,0], pure green.
    expect(Array.from(b.trianglePositions.slice(3, 6))).toEqual([2, 0, 0]);
    expect(Array.from(b.triangleColors.slice(3, 6))).toEqual([0, 1, 0]);
    expect(b.pointPositions).toHaveLength(12);
    expect(b.bounds).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
  });

  it("a face colour fills the whole face flat and leaves points alone", () => {
    const flat = validateSno({
      ...JSON.parse(
        JSON.stringify({
          v: 2,
          name: "t",
          unit: 0,
          mode: "solid",
          vertices: TETRA.vertices,
          colors: [238, 235, 239, 225],
          faces: TETRA.faces,
        }),
      ),
      facecolors: [239, -3],
    });
    const b = buildSnoBuffers(flat);
    for (let corner = 0; corner < 12; corner++) {
      expect(
        Array.from(b.triangleColors.slice(corner * 3, corner * 3 + 3)),
      ).toEqual([0, 0, 1]);
    }
    expect(Array.from(b.pointColors.slice(0, 3))).toEqual([1, 0, 0]);
  });

  it("negates Z for a v1 object", () => {
    const v1 = validateSno({
      v: 1,
      name: "t",
      unit: 0,
      mode: "points",
      vertices: [[1, 2, 3]],
      colors: [[1, 1, 1]],
      faces: [],
    });
    const b = buildSnoBuffers(v1);
    expect(Array.from(b.pointPositions)).toEqual([1, 2, -3]);
  });

  it("an object with no vertices has no bounds", () => {
    const empty = validateSno({
      v: 2,
      name: "",
      unit: 0,
      mode: "solid",
      vertices: [],
      colors: [],
      faces: [],
    });
    expect(buildSnoBuffers(empty).bounds).toBeNull();
  });
});

describe("uniqueEdges", () => {
  it("draws each edge of a tetrahedron once", () => {
    expect(uniqueEdges(TETRA.faces, 4)).toHaveLength(6);
  });

  it("is a polyline when there are no faces", () => {
    expect(uniqueEdges([], 4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(uniqueEdges([], 1)).toEqual([]);
  });
});

describe("partMatrix", () => {
  it("identity placement moves nothing", () => {
    const m = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 },
      0,
      0,
    );
    expect(applyMatrix(m, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("translates in ticks, 120 to a unit", () => {
    const m = partMatrix(
      { ref: 0, at: [240, 0, -60], turn: [0, 0, 0], step: 0 },
      0,
      0,
    );
    expect(applyMatrix(m, [0, 0, 0])).toEqual([2, 0, -0.5]);
  });

  it("a quarter turn keeps the lattice exact", () => {
    // 90 about Y: +X goes to -Z in a right-handed frame.
    const m = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 90, 0], step: 0 },
      0,
      0,
    );
    expect(applyMatrix(m, [1, 0, 0])).toEqual([0, 0, -1]);
    // 90 about Z: +X goes to +Y.
    const z = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 90], step: 0 },
      0,
      0,
    );
    expect(applyMatrix(z, [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it("turns about the parent's X, then Y, then Z (Rz·Ry·Rx)", () => {
    // Rx(90) sends +Y to +Z; then Rz(90) about the fixed Z leaves +Z alone.
    const r = turnMatrix([90, 0, 90]);
    const m = [
      r[0],
      r[3],
      r[6],
      0,
      r[1],
      r[4],
      r[7],
      0,
      r[2],
      r[5],
      r[8],
      0,
      0,
      0,
      0,
      1,
    ];
    expect(applyMatrix(m, [0, 1, 0])).toEqual([0, 0, 1]);
    // Were it intrinsic (Rx·Rz), +Y would first go to -X then stay at -X under Rx.
  });

  it("scales by a power of two relative to the parent", () => {
    const double = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 1 },
      0,
      0,
    );
    expect(applyMatrix(double, [1, 1, 1])).toEqual([2, 2, 2]);
    // A placed object built on a coarser lattice is bigger in the parent's units.
    const coarse = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 },
      2,
      4,
    );
    expect(applyMatrix(coarse, [1, 0, 0])).toEqual([4, 0, 0]);
    const half = partMatrix(
      { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: -1 },
      0,
      0,
    );
    expect(applyMatrix(half, [1, 0, 0])).toEqual([0.5, 0, 0]);
  });
});

describe("cross-checks", () => {
  it("turnMatrix agrees with three's extrinsic XYZ (Euler order ZYX)", () => {
    for (const turn of [
      [30, 0, 0],
      [0, 45, 0],
      [0, 0, 60],
      [30, 45, 60],
      [90, 90, 0],
    ] as [number, number, number][]) {
      const ours = turnMatrix(turn);
      const euler = new THREE.Euler(
        (turn[0] * Math.PI) / 180,
        (turn[1] * Math.PI) / 180,
        (turn[2] * Math.PI) / 180,
        "ZYX",
      );
      const m = new THREE.Matrix4().makeRotationFromEuler(euler);
      const e = m.elements; // column-major
      const theirs = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
      theirs.forEach((v, i) => expect(ours[i]).toBeCloseTo(v, 10));
    }
  });

  it("a v1 object keeps its face order and flips only Z", () => {
    const v1 = validateSno({
      v: 1,
      name: "t",
      unit: 0,
      mode: "solid",
      vertices: [
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1],
      ],
      colors: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      faces: [[0, 1, 2]],
    });
    const b = buildSnoBuffers(v1);
    expect(Array.from(b.trianglePositions)).toEqual([
      0, 0, -1, 1, 0, -1, 0, 1, -1,
    ]);
    expect(b.bounds).toEqual({ min: [0, 0, -1], max: [1, 1, -1] });
  });
});
