import { describe, expect, it } from "vitest";
import { partMatrix } from "@/lib/sno-geometry";
import { validateSno, type SnoObject } from "@/lib/sno-parser";
import { buffersFor, eventRefKey, placementNodes, refKey } from "./parts";

const TILE_ADDRESS = "33331:" + "ab".repeat(32) + ":tile";

function object(over: Record<string, unknown>): SnoObject {
  return validateSno({
    v: 2,
    name: "t",
    unit: 2,
    mode: "solid",
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    colors: [238, 235, 239],
    faces: [[0, 1, 2]],
    ...over,
  });
}

const PARENT = object({
  refs: [["a", TILE_ADDRESS]],
  parts: [
    [0, 120, 0, 0, 0, 90, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1],
  ],
});

describe("placementNodes (§1.10)", () => {
  it("places a resolved object at its matrix with its own mode and children", () => {
    const tile = object({ unit: 3, mode: "lines" });
    const resolved = new Map([[0, { object: tile, children: [] }]]);
    const nodes = placementNodes(PARENT, resolved, buffersFor);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].buffers).not.toBeNull();
    expect(nodes[0].mode).toBe("lines");
    expect(nodes[0].matrix).toEqual(partMatrix(PARENT.parts[0], 2, 3));
    // Built once per object.
    expect(nodes[0].buffers).toBe(nodes[1].buffers);
  });

  it("draws a placeholder at the placement for a ref that did not resolve", () => {
    const nodes = placementNodes(PARENT, new Map([[0, null]]), buffersFor);
    expect(nodes[0].buffers).toBeNull();
    expect(nodes[0].children).toEqual([]);
    // Placed where the part stands, at the parent's own scale.
    expect(nodes[0].matrix).toEqual(
      partMatrix({ ...PARENT.parts[0], step: 0 }, 2, 2),
    );
    // Not yet fetched is the same as missing.
    expect(placementNodes(PARENT, new Map(), buffersFor)[1].buffers).toBeNull();
  });

  it("draws a placeholder when the scale step leaves 0..84", () => {
    const huge = object({ unit: 84 });
    const resolved = new Map([[0, { object: huge, children: [] }]]);
    const nodes = placementNodes(PARENT, resolved, buffersFor);
    expect(nodes[0].buffers).not.toBeNull(); // step 0: unit 84 stays in range
    expect(nodes[1].buffers).toBeNull(); // step 1: unit 85 is out
  });
});

describe("ref keys", () => {
  it("names an object by its event id and, for kind 33331, its address", () => {
    expect(refKey(["a", TILE_ADDRESS])).toBe("a:" + TILE_ADDRESS);
    expect(refKey(["e", "cd".repeat(32), "wss://x"])).toBe(
      "e:" + "cd".repeat(32),
    );
    const keys = eventRefKey({
      id: "ef".repeat(32),
      pubkey: "ab".repeat(32),
      kind: 33331,
      created_at: 0,
      tags: [["d", "tile"]],
      content: "",
      sig: "",
    });
    expect(keys).toEqual(["e:" + "ef".repeat(32), "a:" + TILE_ADDRESS]);
  });
});

describe("cycle keys", () => {
  it("an object placed by address and re-entered by id is the same object", () => {
    const event = {
      id: "ef".repeat(32),
      pubkey: "ab".repeat(32),
      kind: 33331,
      created_at: 0,
      tags: [["d", "tile"]],
      content: "",
      sig: "",
    };
    const chain = new Set([refKey(["a", TILE_ADDRESS]), ...eventRefKey(event)]);
    expect(chain.has(refKey(["e", "ef".repeat(32)]))).toBe(true);
  });
});
