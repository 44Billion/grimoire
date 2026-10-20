import { describe, expect, it } from "vitest";
import {
  builtInPaletteColors,
  expandFaceColors,
  parsePaletteEvent,
  parseSno,
  parseSnoContent,
  positions,
  resolvePalette,
  SnoError,
  validateSno,
} from "./sno-parser";

/** Appendix A: a four-vertex tetrahedron, one color per corner. */
const APPENDIX_A = {
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
  // 238 pure red, 235 pure green, 239 pure blue, 225 white, in the built-in.
  colors: [238, 235, 239, 225],
  faces: [
    [0, 1, 2],
    [0, 3, 1],
    [1, 3, 2],
    [0, 2, 3],
  ],
};

const AS_V1 = {
  ...APPENDIX_A,
  v: 1,
  colors: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 1],
  ],
};

const NEVENT =
  "nevent1qqsfktxwwrls0r3e465nl47z7x3p9zsj8gqye7w5lhpakewwzw9r44cpp4mhxue69uhkummn9ekx7mqwz8u63";
const NADDR = "naddr1qqxnzdenxvmnxdfhxg6rwwfjqy88wumn8ghj7mn0wvhxcmmv";

/** The reference implementation's rejection table: one case per rule. */
const REJECTIONS: [string, Record<string, unknown>][] = [
  ["rule 1", { v: 3 }],
  ["rule 1", { v: 0 }],
  ["rule 2", { colors: [238] }],
  ["rule 4", { mode: "wireframe" }],
  ["rule 5", { unit: 85 }],
  ["rule 5", { unit: 1.5 }],
  [
    "rule 6",
    {
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [1, 0, 2],
        [1, 2, 1.5],
      ],
    },
  ],
  ["rule 7", { ticks: [-3] }],
  ["rule 7", { ticks: [[0, 0, 120], -3] }],
  ["rule 7", { ticks: [4] }],
  ["rule 8", { faces: [[0, 1, 9]] }],
  ["rule 8", { faces: [[0, 1, 1]] }],
  ["rule 8a", { palette: [[255, 0, 0]] }],
  [
    "rule 8a",
    {
      palette: [
        [255, 0, 0, 0],
        [0, 0, 0],
      ],
    },
  ],
  ["rule 8b", { colors: [0, 1, 2, 256] }],
  ["rule 8b", { colors: [0, 1, 2, -1] }],
  ["rule 8b", { colors: [0, 1, 2, 1.5] }],
  ["rule 8c", { facecolors: [238] }],
  ["rule 8c", { facecolors: [238, -4] }],
  ["rule 8c", { facecolors: [-4] }],
  ["rule 8c", { facecolors: [238, 256, -2] }],
  ["rule 10", { up: "yes" }],
  ["rule 10", { up: true, spin: 360 }],
  ["rule 10", { spin: 360 }],
  ["rule 11", { refs: "x" }],
  ["rule 11", { refs: null }],
  ["rule 11", { refs: [["a", "33331:" + "AB".repeat(32) + ":d"]] }],
  ["rule 11", { refs: [["a", "30023:" + "ab".repeat(32) + ":d"]] }],
  ["rule 11", { refs: [["e", "cd".repeat(31)]] }],
  ["rule 11", { refs: [["p", "ab".repeat(32)]] }],
  ["rule 11", { refs: [["e", "cd".repeat(32), "wss://x", "extra"]] }],
  ["rule 12", { parts: [[0, 0, 0, 0, 0, 0, 0, 0]] }],
  ["rule 12", { parts: null }],
  [
    "rule 12",
    { refs: [["e", "cd".repeat(32)]], parts: [[1, 0, 0, 0, 0, 0, 0, 0]] },
  ],
  [
    "rule 12",
    { refs: [["e", "cd".repeat(32)]], parts: [[0, 7681, 0, 0, 0, 0, 0, 0]] },
  ],
  [
    "rule 12",
    { refs: [["e", "cd".repeat(32)]], parts: [[0, 0, 0, 0, 360, 0, 0, 0]] },
  ],
  [
    "rule 12",
    { refs: [["e", "cd".repeat(32)]], parts: [[0, 0, 0, 0, 0, 0, 0]] },
  ],
];

function expectRule(payload: unknown, rule: string, fetched?: unknown) {
  const result = parseSno(payload, fetched);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.startsWith(rule)).toBe(true);
}

describe("validateSno", () => {
  it("accepts Appendix A", () => {
    const object = validateSno(APPENDIX_A);
    expect(object.v).toBe(2);
    expect(object.name).toBe("tetra");
    expect(object.extent).toBe(8);
    expect(object.ticks).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(object.colors[0]).toEqual([255, 0, 0]);
    expect(object.colors[3]).toEqual([255, 255, 255]);
    expect(object.faceColors).toBeUndefined();
    expect(object.paletteSource).toEqual({ kind: "built-in" });
    expect(positions(object)[3]).toEqual([1, 2, 1]);
  });

  it("rejects what the reference table rejects, naming the same rule", () => {
    for (const [rule, over] of REJECTIONS) {
      expectRule({ ...APPENDIX_A, ...over }, rule);
    }
  });

  it("rejects a payload that is not an object", () => {
    expectRule(null, "rule 1");
    expectRule([], "rule 1");
    expectRule("tetra", "rule 1");
  });

  it("ignores `type` wherever it appears (§1.1a)", () => {
    expect(validateSno({ ...AS_V1, type: "shard" }).v).toBe(1);
    expect(validateSno({ ...APPENDIX_A, type: "shard" }).v).toBe(2);
    expect(validateSno({ ...APPENDIX_A, type: "anything at all" }).v).toBe(2);
    expect(validateSno({ ...APPENDIX_A, type: 17 }).v).toBe(2);
  });

  it("ignores unknown fields (§5)", () => {
    expect(validateSno({ ...APPENDIX_A, future: { x: 1 } }).v).toBe(2);
  });

  it("v1 differs in Z and in how a colour is written, and in nothing else", () => {
    const v2 = positions(validateSno(APPENDIX_A));
    const v1 = positions(validateSno(AS_V1));
    expect(v1.map((p) => p[2])).toEqual(v2.map((p) => -p[2]));
    expect(v1.map((p) => [p[0], p[1]])).toEqual(v2.map((p) => [p[0], p[1]]));
  });

  it("v1 colours are literal, taken as written, and indices are rejected", () => {
    const object = validateSno(AS_V1);
    expect(object.colors[0]).toEqual([255, 0, 0]);
    expect(object.colorIndices).toBeUndefined();
    expectRule({ ...AS_V1, colors: [238, 235, 239, 225] }, "rule 8b");
    // Clamped on read.
    const hot = validateSno({
      ...AS_V1,
      colors: [
        [2, -1, 0.5],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    expect(hot.colors[0]).toEqual([255, 0, 128]);
  });

  it("rejects a run longer than the data before allocating it (§6)", () => {
    const t0 = performance.now();
    expectRule({ ...APPENDIX_A, ticks: [-1e9] }, "rule 7");
    expectRule({ ...APPENDIX_A, ticks: [[0, 0, 0], -1e9] }, "rule 7");
    expectRule({ ...APPENDIX_A, facecolors: [238, -1e9] }, "rule 8c");
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("rejects a coordinate outside the safe integer range", () => {
    expectRule(
      {
        ...APPENDIX_A,
        vertices: [
          [1e300, 0, 0],
          [2, 0, 0],
          [1, 0, 2],
          [1, 2, 1],
        ],
      },
      "rule 6",
    );
    expectRule({ ...APPENDIX_A, unit: 2 ** 60 }, "rule 5");
  });

  it("treats facecolors: null as absent", () => {
    expect(
      validateSno({ ...APPENDIX_A, facecolors: null }).faceColors,
    ).toBeUndefined();
  });

  it("keeps the declared extent apart from the repaired one", () => {
    expect(validateSno(APPENDIX_A).declaredExtent).toBeUndefined();
    expect(validateSno({ ...APPENDIX_A, extent: 4 }).declaredExtent).toBe(4);
    expect(
      validateSno({ ...APPENDIX_A, extent: 0 }).declaredExtent,
    ).toBeUndefined();
  });

  it("reads a pre-palette v2 payload's triples literally (§5)", () => {
    const legacy = validateSno({ ...APPENDIX_A, colors: AS_V1.colors });
    expect(legacy.v).toBe(2);
    expect(legacy.colors[0]).toEqual([255, 0, 0]);
    expect(legacy.colorIndices).toBeUndefined();
    // Z is not flipped: the version still decides the frame.
    expect(positions(legacy)[2]).toEqual([1, 0, 2]);
    // A mix is neither kind of payload.
    expectRule(
      { ...APPENDIX_A, colors: [[1, 0, 0], 235, 239, 225] },
      "rule 8b",
    );
  });

  it("accepts the equivalent spellings a publisher must not write (§1.2)", () => {
    const canonical = validateSno(APPENDIX_A);
    const spelled = validateSno({ ...APPENDIX_A, ticks: [-4], extent: 8 });
    expect(spelled.ticks).toEqual(canonical.ticks);
    expect(spelled.extent).toBe(canonical.extent);
    const triples = validateSno({
      ...APPENDIX_A,
      ticks: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    expect(triples.ticks).toEqual(canonical.ticks);
  });

  it("positions are exact fractions of 120", () => {
    const third = validateSno({ ...APPENDIX_A, ticks: [[40, 0, 0], -3] });
    expect(third.ticks[0]).toEqual([40, 0, 0]);
    expect(positions(third)[0][0]).toBeCloseTo(1 / 3, 12);
  });

  it("repairs the extent rather than rejecting (§1.8)", () => {
    const grown = validateSno({
      ...APPENDIX_A,
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [1, 0, 2],
        [9, 2, 1],
      ],
    });
    expect(grown.extent).toBe(9);
    expect(validateSno({ ...APPENDIX_A, extent: 0 }).extent).toBe(8);
    expect(validateSno({ ...APPENDIX_A, extent: "big" }).extent).toBe(8);
    expect(validateSno({ ...APPENDIX_A, extent: 12 }).extent).toBe(12);
    // A tick past a whole unit needs the next unit.
    const ticked = validateSno({
      ...APPENDIX_A,
      ticks: [[0, 0, 1], -3],
      extent: 1,
    });
    expect(ticked.extent).toBe(2);
  });

  it("reads up and spin", () => {
    expect(validateSno({ ...APPENDIX_A, up: false }).up).toBe(false);
    const oriented = validateSno({ ...APPENDIX_A, up: true, spin: 90 });
    expect(oriented.up).toBe(true);
    expect(oriented.spin).toBe(90);
    // Spin is checked even where it is unused.
    expectRule({ ...APPENDIX_A, spin: -1 }, "rule 10");
  });

  it("truncates the name to 64 characters", () => {
    const long = validateSno({ ...APPENDIX_A, name: "x".repeat(100) });
    expect(long.name).toHaveLength(64);
  });

  it("an object of 129 placements and no vertices of its own validates (§1.10)", () => {
    const parts: number[][] = [];
    for (let x = -64; x <= 64; x++) parts.push([0, x * 120, 0, 0, 0, 90, 0, 0]);
    const floor = validateSno({
      ...APPENDIX_A,
      vertices: [],
      colors: [],
      faces: [],
      ticks: [],
      refs: [
        ["a", "33331:" + "ab".repeat(32) + ":tile", "wss://relay.example"],
      ],
      parts,
    });
    expect(floor.parts).toHaveLength(129);
    expect(floor.parts[0]).toEqual({
      ref: 0,
      at: [-7680, 0, 0],
      turn: [0, 90, 0],
      step: 0,
    });
    expect(floor.refs[0][0]).toBe("a");
  });

  it("face colours: an index or a run, absent is not colour 0 (§1.4a)", () => {
    const solid = validateSno({ ...APPENDIX_A, facecolors: [238, -3] });
    expect(solid.faceColors).toEqual([
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
      [255, 0, 0],
    ]);
    const mixed = validateSno({
      ...APPENDIX_A,
      facecolors: [238, 235, -1, 239],
    });
    expect(mixed.faceColors?.map((c) => c.join())).toEqual([
      "255,0,0",
      "0,255,0",
      "0,255,0",
      "0,0,255",
    ]);
    expect(expandFaceColors(undefined, 4, 256)).toEqual([]);
    for (const bad of [[-1, 238], [238, -9], [238], [238, 1.5], [256, -3]]) {
      expectRule({ ...APPENDIX_A, facecolors: bad }, "rule 8c");
    }
  });
});

describe("palettes", () => {
  const builtIn = builtInPaletteColors();

  it("the built-in has 256 entries laid out arithmetically", () => {
    expect(builtIn).toHaveLength(256);
    expect(resolvePalette("cyberspace-neon-256").palette).toBe(builtIn);
    expect(builtIn[238]).toEqual([255, 0, 0]);
    expect(builtIn[225]).toEqual([255, 255, 255]);
    // Step 7 is the brightest of a hue.
    const sum = (c: number[]) => c[0] + c[1] + c[2];
    expect(sum(builtIn[7])).toBeGreaterThan(sum(builtIn[0]));
  });

  it("a carried palette may be short, and an index past it is a defect", () => {
    const four = {
      ...APPENDIX_A,
      palette: [
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 255],
      ],
      colors: [0, 1, 2, 3],
    };
    const object = validateSno(four);
    expect(object.palette).toHaveLength(4);
    expect(object.paletteSource).toEqual({ kind: "inline" });
    expectRule({ ...four, colors: [0, 1, 2, 4] }, "rule 8b");
    expectRule({ ...APPENDIX_A, palette: [[255, 0, 0]] }, "rule 8a");
    expectRule(
      { ...APPENDIX_A, palette: Array(257).fill([255, 0, 0]) },
      "rule 8a",
    );
    expectRule({ ...APPENDIX_A, palette: "no-such-palette" }, "rule 8a");
    expectRule(
      {
        ...APPENDIX_A,
        palette: [
          [255, 0, 300],
          [0, 0, 0],
        ],
      },
      "rule 8a",
    );
  });

  it("a reference is never load-bearing (§1.3b)", () => {
    for (const ref of [NEVENT, NADDR]) {
      const unresolved = resolvePalette(ref);
      expect(unresolved.palette).toBe(builtIn);
      expect(unresolved.source).toEqual({
        kind: "reference",
        ref,
        resolved: false,
      });
      expect(validateSno({ ...APPENDIX_A, palette: ref }).v).toBe(2);
      expect(resolvePalette(ref, '["#ff0000","#00ff00"]').palette).toEqual([
        [255, 0, 0],
        [0, 255, 0],
      ]);
      expect(resolvePalette(ref, "[[255,0,0],[0,255,0]]").palette).toEqual([
        [255, 0, 0],
        [0, 255, 0],
      ]);
    }
    // Junk that is not a palette is a failed fetch, which is the built-in.
    for (const junk of [
      "not json",
      "{}",
      "[]",
      '["#ff00"]',
      "[[300,0,0],[0,0,0]]",
      JSON.stringify(Array(257).fill([0, 0, 0])),
    ]) {
      expect(resolvePalette(NEVENT, junk).palette).toBe(builtIn);
    }
    // An index valid against the built-in but past a shorter fetched palette
    // is still a rejection.
    expectRule(
      { ...APPENDIX_A, palette: NEVENT },
      "rule 8b",
      '["#ff0000","#00ff00"]',
    );
  });

  it("reads a real kind 3367 event from its c tags", () => {
    const espy = {
      kind: 3367,
      tags: [
        ["c", "#B4B4AF"],
        ["c", "#FC4755"],
        ["c", "#D1242B"],
        ["c", "#694F34"],
        ["c", "#A1785D"],
        ["c", "#01AE85"],
        ["layout", "horizontal"],
        ["alt", "Color moment"],
      ],
      content: "🏰",
    };
    const expected = [
      [180, 180, 175],
      [252, 71, 85],
      [209, 36, 43],
      [105, 79, 52],
      [161, 120, 93],
      [1, 174, 133],
    ];
    expect(parsePaletteEvent(espy)).toEqual(expected);
    expect(resolvePalette(NEVENT, espy).palette).toEqual(expected);
    // Document order is the index.
    expect(
      parsePaletteEvent({
        content: "",
        tags: [
          ["c", "#00ff00"],
          ["c", "#ff0000"],
        ],
      }),
    ).toEqual([
      [0, 255, 0],
      [255, 0, 0],
    ]);
    // Tags win over a content that also parses.
    const both = {
      ...espy,
      content: JSON.stringify(["#000000", "#111111", "#222222"]),
    };
    expect(parsePaletteEvent(both)).toEqual(expected);
    // The legacy content form, on an event whose tags carry no palette.
    const legacy = {
      content: JSON.stringify(["#000000", "#111111", "#222222"]),
      tags: [["name", "three greys"]],
    };
    expect(parsePaletteEvent(legacy)).toEqual([
      [0, 0, 0],
      [17, 17, 17],
      [34, 34, 34],
    ]);
    // Tags that do not parse fall through to the content.
    expect(
      parsePaletteEvent({ ...legacy, tags: [["c", "not a colour"]] }),
    ).toEqual([
      [0, 0, 0],
      [17, 17, 17],
      [34, 34, 34],
    ]);
  });

  it("an event with neither form is not a palette", () => {
    for (const empty of [
      { content: "🎨", tags: [] },
      { content: "", tags: [["c", "#ff0000"]] },
      {
        content: "",
        tags: [
          ["c", "#ff0000"],
          ["c", "ff0000"],
        ],
      },
      { content: "", tags: [["c", "#ff0000"], ["c"]] },
      { content: "", tags: Array(257).fill(["c", "#ff0000"]) },
      { content: "not json", tags: "not tags" },
      {},
      [],
      null,
    ]) {
      expect(parsePaletteEvent(empty)).toBeNull();
      expect(resolvePalette(NEVENT, empty).palette).toBe(builtIn);
    }
  });
});

describe("parseSnoContent", () => {
  it("treats bad JSON as a rule-1 failure", () => {
    const result = parseSnoContent("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith("rule 1")).toBe(true);
  });

  it("parses the Appendix A string", () => {
    const result = parseSnoContent(JSON.stringify(APPENDIX_A));
    expect(result.ok).toBe(true);
  });

  it("validateSno throws SnoError", () => {
    expect(() => validateSno({ ...APPENDIX_A, v: 3 })).toThrow(SnoError);
  });
});
