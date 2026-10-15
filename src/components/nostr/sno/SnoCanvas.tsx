import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MAX_EXTENT, type SnoMode } from "@/lib/sno-parser";
import { cn } from "@/lib/utils";
import type { SnoSceneNode } from "./scene";

export interface SnoCanvasProps {
  root: SnoSceneNode;
  /** Overrides the root object's own mode; placed objects keep theirs (§1.10). */
  mode?: SnoMode;
  interactive?: boolean;
  autoRotate?: boolean;
  className?: string;
  /** Read to assistive technology in place of the picture. */
  label?: string;
}

/**
 * The colors the scene borrows from the theme. Read off a hidden probe
 * element rather than parsed from the HSL triplets in the CSS variables,
 * so whatever the theme does to them, the browser has already resolved it.
 */
interface ThemeColors {
  grid: THREE.Color;
  placeholder: THREE.Color;
  /** Light themes need a denser grid or the lines vanish. */
  gridOpacity: number;
}

function readThemeColors(probe: HTMLElement): ThemeColors {
  const style = getComputedStyle(probe);
  const grid = new THREE.Color().setStyle(style.borderColor);
  const placeholder = new THREE.Color().setStyle(style.color);
  const background = new THREE.Color().setStyle(
    getComputedStyle(document.body).backgroundColor || "rgb(0,0,0)",
  );
  // Relative luminance picks the opacity: a pale page gets 0.6, a dark 0.35.
  const light =
    background.r * 0.2126 + background.g * 0.7152 + background.b * 0.0722;
  return { grid, placeholder, gridOpacity: light > 0.5 ? 0.6 : 0.35 };
}

/**
 * DECK-0003 §4: lit flat per face, both sides drawn, no culling, no
 * smoothing, nothing invented.
 */
function buildNode(
  node: SnoSceneNode,
  theme: ThemeColors,
  modeOverride?: SnoMode,
): THREE.Group {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.matrix.fromArray(node.matrix);

  if (node.buffers === null) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const cube = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: theme.placeholder }),
    );
    cube.name = "placeholder";
    cube.position.set(0.5, 0.5, 0.5);
    group.add(cube);
  } else {
    const b = node.buffers;
    const mode = modeOverride ?? node.mode;

    if (mode === "solid" && b.trianglePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(b.trianglePositions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(b.triangleColors, 3),
      );
      // §4: a reader that lights an object derives flat normals per face,
      // from the triangle's own corners and its winding. The geometry is
      // non-indexed, so computeVertexNormals is exactly that: no sharing,
      // no averaging across a shared vertex. DoubleSide lights a back as
      // the other side of the same face.
      geometry.computeVertexNormals();
      group.add(
        new THREE.Mesh(
          geometry,
          new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            flatShading: true,
          }),
        ),
      );
    }

    if (mode === "lines" && b.linePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(b.linePositions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(b.lineColors, 3),
      );
      group.add(
        new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({ vertexColors: true }),
        ),
      );
    }

    // §1.5 says a client SHOULD draw the vertices in every mode so a tiny
    // object stays visible; on a card-sized object the squares read as
    // noise and the reference client skips them too, so points mode only.
    if (mode === "points" && b.pointPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(b.pointPositions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(b.pointColors, 3),
      );
      group.add(
        new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            vertexColors: true,
            size: 6,
            sizeAttenuation: false,
          }),
        ),
      );
    }
  }

  for (const child of node.children) group.add(buildNode(child, theme));
  return group;
}

let webglSupported = false;

/**
 * Probed once per page, but only a positive answer is kept: a negative one
 * may be the browser's context cap at that moment rather than missing
 * support. A probe context counts against that cap (about 16 in Chrome,
 * oldest evicted first), so it is released at once.
 */
function supportsWebGL(): boolean {
  if (webglSupported) return true;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    if (gl) webglSupported = true;
    return !!gl;
  } catch {
    return false;
  }
}

function disposeTree(object: THREE.Object3D) {
  object.traverse((o) => {
    const drawable = o as THREE.Mesh;
    drawable.geometry?.dispose?.();
    const material = drawable.material as THREE.Material | undefined;
    material?.dispose?.();
  });
}

/** Everything that lives as long as the canvas does. */
interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** The current object tree and its grid, swapped when the root changes. */
  tree: THREE.Group | null;
  grid: THREE.GridHelper | null;
  /** Bounds the camera was last framed on; it re-frames only when they grow. */
  framed: THREE.Box3 | null;
  theme: ThemeColors;
  /** Set by anything that changed what is on screen; cleared by a render. */
  dirty: boolean;
}

const VIEW_DIRECTION = new THREE.Vector3(0.6, 0.45, 0.66).normalize();

/**
 * Exact fit: the distance along the view direction at which every corner
 * of the bounds lands inside both the vertical and the horizontal field of
 * view, rather than a bounding sphere that over-estimates a tall or flat
 * object.
 */
function frame(stage: Stage, bounds: THREE.Box3) {
  const { camera, controls } = stage;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  camera.far = Math.max(radius * 100, 100);
  camera.updateProjectionMatrix();

  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  camera.position.copy(center).add(VIEW_DIRECTION);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const local = new THREE.Vector3();
  let distance = radius;
  for (let i = 0; i < 8; i++) {
    local.set(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z,
    );
    local.applyMatrix4(camera.matrixWorldInverse);
    // Camera space looks down -Z; a corner at local.z needs the camera
    // (local.z + 1) further back than its reference position.
    const need =
      local.z +
      1 +
      Math.max(Math.abs(local.x) / tanH, Math.abs(local.y) / tanV);
    if (need > distance) distance = need;
  }
  camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance * 1.05);
  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
  stage.framed = bounds.clone();
  stage.dirty = true;
}

/** Replace the drawn object, keeping the camera unless the scene outgrew it. */
function swapTree(stage: Stage, root: SnoSceneNode, mode?: SnoMode) {
  if (stage.tree) {
    stage.scene.remove(stage.tree);
    disposeTree(stage.tree);
  }
  if (stage.grid) {
    stage.scene.remove(stage.grid);
    stage.grid.geometry.dispose();
    (stage.grid.material as THREE.Material).dispose();
    stage.grid = null;
  }

  const tree = buildNode(root, stage.theme, mode);
  stage.scene.add(tree);
  stage.tree = tree;

  // Placed objects carry their own matrices, so world matrices must be
  // current before the bounds are measured. Frame on what is drawn, not
  // on `extent` (§1.8).
  tree.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(tree);
  if (bounds.isEmpty()) {
    bounds.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }

  if (root.extent) {
    // A repaired extent has no ceiling (§1.8); the grid does, or a vertex
    // far out would ask for a grid of that many cells.
    const span = Math.min(root.extent, MAX_EXTENT) * 2;
    const grid = new THREE.GridHelper(
      span,
      span,
      stage.theme.grid,
      stage.theme.grid,
    );
    const material = grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = stage.theme.gridOpacity;
    grid.position.y = bounds.min.y;
    stage.scene.add(grid);
    stage.grid = grid;
  }

  if (!stage.framed || !stage.framed.containsBox(bounds)) {
    frame(stage, bounds);
  }
  stage.dirty = true;
}

/** Recolor what borrows from the theme, after a theme switch. */
function applyTheme(stage: Stage) {
  if (stage.grid) {
    const material = stage.grid.material as THREE.LineBasicMaterial;
    material.color = stage.theme.grid;
    material.opacity = stage.theme.gridOpacity;
  }
  stage.tree?.traverse((o) => {
    if (o.name === "placeholder") {
      ((o as THREE.LineSegments).material as THREE.LineBasicMaterial).color =
        stage.theme.placeholder;
    }
  });
  stage.dirty = true;
}

export function SnoCanvas({
  root,
  mode,
  interactive = true,
  autoRotate = false,
  className,
  label,
}: SnoCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [visible, setVisible] = useState(false);
  const [unsupported] = useState(() => !supportsWebGL());
  const [reducedMotion] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const spin = autoRotate && !reducedMotion;

  // A feed may hold more objects than a browser allows WebGL contexts, so a
  // canvas exists only while its container is on screen.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: "100px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The stage: renderer, camera, controls, lights, loop. Lives across root
  // changes so a part arriving mid-drag does not reset the orbit.
  useEffect(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!container || !probe || !visible || unsupported) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Mostly ambient so vertex colors read as painted, with a key and a
    // fill from opposite sides so a facet shows as a step rather than a
    // shadow. Tuned by eye against the palette swatches: a white face the
    // key hits is white, a face turned away is a light grey.
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-1.5, -0.5, -1);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 0.8;
    controls.enabled = interactive;
    if (interactive) controls.listenToKeyEvents(container);

    const stage: Stage = {
      renderer,
      scene,
      camera,
      controls,
      tree: null,
      grid: null,
      framed: null,
      theme: readThemeColors(probe),
      dirty: true,
    };
    stageRef.current = stage;

    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      stage.dirty = true;
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    // Themes apply as inline custom properties on <html>; a switch re-reads
    // the probe and recolors the grid and placeholders in place.
    const themeObserver = new MutationObserver(() => {
      stage.theme = readThemeColors(probe);
      applyTheme(stage);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    // Render on demand: a frame is drawn only when the controls moved
    // (orbit, damping, auto-rotate) or something marked the stage dirty.
    const onChange = () => {
      stage.dirty = true;
    };
    controls.addEventListener("change", onChange);
    let handle = 0;
    const loop = () => {
      const moved = controls.update();
      if (moved || stage.dirty) {
        renderer.render(scene, camera);
        stage.dirty = false;
      }
      handle = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(handle);
      controls.removeEventListener("change", onChange);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [visible, unsupported, interactive, spin]);

  // The object: swapped in place whenever it or the mode changes. The stage
  // deps are repeated so a fresh stage gets the tree too.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    swapTree(stage, root, mode);
  }, [root, mode, visible, unsupported, interactive, spin]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        "relative w-full overflow-hidden rounded-md border border-border [&>canvas]:block [&>canvas]:size-full",
        interactive
          ? "cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          : "",
        className,
      )}
    >
      <span
        ref={probeRef}
        aria-hidden
        className="pointer-events-none absolute size-0 border border-solid border-border text-info opacity-0"
      />
      {unsupported && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          WebGL is not available
        </div>
      )}
    </div>
  );
}

export default SnoCanvas;
