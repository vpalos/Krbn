// Reproducible demo gallery. One deterministic script that renders each Phase-1
// feature to examples/gallery/*.svg. Regenerate with:
//
//     bun run examples/gallery.ts
//
// Output is deterministic (wobble is seeded, no randomness), so the SVGs are
// stable and diffable.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { sphere, ellipsoid } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Cone } from "../src/primitives/cone.js";
import { Polygon } from "../src/primitives/polygon.js";
import { Line } from "../src/primitives/line.js";
import { Point } from "../src/primitives/point.js";
import { Torus } from "../src/primitives/torus.js";
import { BezierCurve, functionPlot, helix } from "../src/primitives/parametric.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { cube, gravitySheet, knotTube, rotate, tetrahedron, torusMesh, translate, uvSphere } from "../src/mesh/shapes.js";
import type { MeshInput } from "../src/mesh/halfedge.js";
import { projectionMatrix, projectPoint } from "../src/math/camera.js";

// Defaults next to this file; overridable so a compiled copy can still target
// the repo (KRBN_GALLERY_OUT). Normal `bun run` users need not set it.
const OUT =
  process.env.KRBN_GALLERY_OUT ??
  join(dirname(fileURLToPath(import.meta.url)), "gallery");
mkdirSync(OUT, { recursive: true });
const BG = "#faf9f5";

function save(name: string, svg: string): void {
  writeFileSync(join(OUT, `${name}.svg`), svg);
  console.log(`wrote gallery/${name}.svg`);
}

/** A `<text>` label anchored at the screen projection of a world point. */
function textAt(
  cam: Camera,
  world: [number, number, number],
  text: string,
  anchor: "start" | "middle" | "end" = "middle",
): string {
  const p = projectPoint(projectionMatrix(cam), world).point;
  return `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="${anchor}" font-family="sans-serif" font-size="14" fill="#888">${text}</text>`;
}

/** Inject label `<text>` elements just before the closing tag of a rendered SVG. */
function withLabels(svg: string, labels: readonly string[]): string {
  return svg.replace(/<\/svg>\s*$/, `${labels.join("\n")}\n</svg>`);
}

// ---------------------------------------------------------------------------
// 1. Visible / hidden lines — exact quantitative invisibility.
//    A cylinder self-occludes (its far rim halves are ghosted/dashed) and a rod
//    skewers it (dashed where it passes through the body, solid outside). A far
//    sphere sits beside it, its silhouette dashed only where the cylinder hides
//    it. Wobble 0 to keep the focus on the visibility classification.
// ---------------------------------------------------------------------------
function hiddenLines(): void {
  const cam: Camera = {
    eye: [4.6, 3.2, 2.7],
    target: [0, 0, -0.1],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 720, height: 520 },
  };
  const scene = new Scene({ svg: { background: BG } });
  scene.add(new Cylinder([0, 0, -1.1], [0, 0, 2.2], 0.9));
  // sphere beside/behind the cylinder: the exposed part is solid, the part the
  // cylinder hides is dashed
  scene.add(sphere([-1.85, -0.15, 0.1], 0.9));
  scene.add(new Line([-2.4, -1.6, 0.35], [2.6, 1.5, -0.15])); // rod skewering the cylinder
  save("01-hidden-lines", scene.toSVG(cam));
}

// ---------------------------------------------------------------------------
// 2. Hatching — the three modes, tonal shading on curved surfaces, and a flat
//    face that hatches uniformly. Light from upper-right.
// ---------------------------------------------------------------------------
function hatching(): void {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.008,
    viewport: { width: 1000, height: 320 },
  };
  const scene = new Scene({
    light: { direction: [-0.6, -0.5, -0.65] },
    svg: { background: BG },
  });
  const r = 0.85;
  // field: false — this demo is the straight-hatch baseline; the sphere's own
  // iso-parameter field gets its showcase in demo 12
  scene.add(sphere([-2.9, 0, 0], r)).style({
    wobble: 0.25,
    hatch: { mode: "single", angle: 20, field: false },
  });
  scene
    .add(sphere([-0.9, 0, 0], r))
    .style({ wobble: 0.25, hatch: { mode: "cross", angle: 20, field: false } });
  scene.add(sphere([1.1, 0, 0], r)).style({
    wobble: 0.25,
    hatch: { mode: "triple", angle: 20, field: false },
  });
  // a flat quad (seen face-on so it fills), single-hatched → uniform tone
  scene
    .add(
      new Polygon([
        [2.7, -0.9, 0],
        [3.9, -0.9, 0],
        [3.9, 0.9, 0],
        [2.7, 0.9, 0],
      ]),
    )
    .style({ wobble: 0.2, hatch: { mode: "single", angle: 45 } });
  save(
    "02-hatching",
    withLabels(scene.toSVG(cam), [
      textAt(cam, [-2.9, -1.15, 0], "1 layer"),
      textAt(cam, [-0.9, -1.15, 0], "2 layers"),
      textAt(cam, [1.1, -1.15, 0], "3 layers"),
      textAt(cam, [3.3, -1.15, 0], "flat"),
    ]),
  );
}

// ---------------------------------------------------------------------------
// 3. Hatching with depth — a ball half-submerged through a plane. The exact
//    waterline (sphere ∩ plane) is bold, dashed on its hidden back arc; the
//    plane's hatch stops where the ball occludes it (gaps reveal depth); the
//    ball shades light→dark. Tone quantized (stage-3 abstraction).
// ---------------------------------------------------------------------------
function depthHatching(): void {
  const cam: Camera = {
    eye: [3.6, 2.6, 2.2],
    target: [0, 0, 0.1],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 720, height: 540 },
  };
  const scene = new Scene({
    light: { direction: [-0.5, -0.6, -0.7] },
    svg: { background: BG },
    abstraction: { toneLevels: 3 },
  });
  const ball = scene
    .add(sphere([0, 0, 0.55], 1))
    .setImportance(1, { role: "subject" })
    .style({ wobble: 0.35, hatch: { mode: "cross", angle: 25, field: false } });
  const water = scene
    .add(
      new Polygon([
        [-1.8, -1.8, 0],
        [1.8, -1.8, 0],
        [1.8, 1.8, 0],
        [-1.8, 1.8, 0],
      ]),
    )
    .setImportance(0.3, { role: "context" })
    .style({ wobble: 0.2, hatch: { mode: "single", angle: 0, spacingPx: 12 } });
  scene.intersect(ball, water, { emphasis: "bold" }).style({ wobble: 0.35 });
  save("03-depth-hatching", scene.render(cam).svg);
}

// ---------------------------------------------------------------------------
// 4. Wobble — the same cone at increasing wobble (0 → 1), showing ruler →
//    hand-drawn. Coherent joins hold at every amount (clean apex, rulings meet
//    rims), because the offset is a seeded field keyed on the 3-D point.
// ---------------------------------------------------------------------------
function wobbleSweep(): void {
  const cam: Camera = {
    eye: [0, -8, 2.6],
    target: [0, 0, -0.1],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 5,
    viewport: { width: 900, height: 300 },
  };
  const scene = new Scene({ svg: { background: BG } });
  const amounts = [0, 0.35, 0.7, 1.0];
  amounts.forEach((w, i) => {
    const x = -3.9 + i * 2.6;
    scene.add(new Cone([x, 0, 1.1], [0, 0, -2.2], 0.8)).style({ wobble: w });
  });
  save("04-wobble", scene.toSVG(cam));
}

// ---------------------------------------------------------------------------
// 5. Solid shading — a 3×3 grid: rows are single / cross / triple hatch (1 / 2 /
//    3 tonal layers), columns are cone / cylinder / sphere. Each is surface-
//    hatched and shaded light→dark, so the effect of adding layers is obvious.
// ---------------------------------------------------------------------------
function solidShading(): void {
  const cam: Camera = {
    eye: [1.4, -11, 2.2],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "orthographic",
    scale: 0.012,
    viewport: { width: 820, height: 760 },
  };
  // front-light from the upper-right (like 02) so the camera-facing surfaces get
  // a strong light→dark gradient; the camera looks roughly along +y here.
  const scene = new Scene({
    light: { direction: [-0.55, 0.6, -0.5] },
    svg: { background: BG },
  });
  const modes = ["single", "cross", "triple"] as const;
  const makers = [
    (x: number, z: number) => new Cone([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
    (x: number, z: number) => new Cylinder([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
    (x: number, z: number) => sphere([x, 0, z], 0.7),
  ];
  const rowZ = [2.3, 0, -2.3];
  const rowLabel = ["1 layer", "2 layers", "3 layers"];
  modes.forEach((mode, r) => {
    const z = rowZ[r]!;
    makers.forEach((make, c) => {
      const x = -2.9 + c * 2.9;
      // straight parallel hatch (field: false) — the flat-shading baseline;
      // the curved direction field gets its own showcase in demo 12
      scene
        .add(make(x, z))
        .style({ wobble: 0.18, hatch: { mode, angle: 15, field: false } });
    });
  });
  save(
    "05-solid-shading",
    withLabels(
      scene.render(cam).svg,
      rowZ.map((z, r) => textAt(cam, [-4.35, 0, z], rowLabel[r]!, "start")),
    ),
  );
}

// ---------------------------------------------------------------------------
// 6. Highlight — a sphere sits behind a cylinder. `scene.highlight` re-draws the
//    sphere's outline on top of everything, heavier, and dashed where the
//    cylinder hides it (an x-ray emphasis).
// ---------------------------------------------------------------------------
function highlightDemo(): void {
  const cam: Camera = {
    eye: [4.4, 3.1, 2.4],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 640, height: 480 },
  };
  const build = (wobble: number): string => {
    const scene = new Scene({ svg: { background: BG } });
    scene
      .add(new Cylinder([0, 0, -1.1], [0, 0, 2.2], 0.9))
      .setImportance(0.3, { role: "context" })
      .style({ wobble });
    const ball = scene.add(sphere([-1.75, -0.2, 0.5], 0.85)).style({ wobble }); // behind + beside: partly exposed
    // crisp outline on top + a thick, semi-transparent marker halo around it
    scene.highlight(ball, {
      weight: 1.8,
      dashWhenHidden: true,
      halo: { weight: 12, opacity: 0.28 },
    });
    return scene.render(cam).svg;
  };
  save(
    "06-highlight",
    stackRows(
      build(0),
      build(0.8),
      cam.viewport.width,
      cam.viewport.height,
      "wobble: off",
      "wobble: on",
    ),
  );
}

// ---------------------------------------------------------------------------
// 7. Points — small camera-facing marks (× crosses and a dot), occludable like
//    any feature: the one behind the sphere is ghosted (faint dashed), the rest
//    are solid.
// ---------------------------------------------------------------------------
function pointsDemo(): void {
  const cam: Camera = {
    eye: [3.6, 2.6, 2.2],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 620, height: 460 },
  };
  const scene = new Scene({ svg: { background: BG } });
  scene.add(sphere([0, 0, 0], 1)).setImportance(0.3, { role: "context" });
  const marks: [number, number, number][] = [
    [1.7, 0, 0.9],
    [-1.6, 0.2, 0.6],
    [0.2, 1.7, -0.4],
    [0.1, -0.1, -1.9], // directly behind the sphere → ghosted
  ];
  for (const m of marks) scene.add(new Point(m, { mark: "cross", sizePx: 9 }));
  scene.add(new Point([0, 0, 1.6], { mark: "dot", sizePx: 10 }));
  save("07-points", scene.render(cam).svg);
}

// ---------------------------------------------------------------------------
// 8. Quadric ∩ quadric quartic — an ellipsoid meeting a sphere. Their
//    intersection is a quartic space curve, traced via plane-sweep + the exact
//    conic∩conic kernel and drawn as a bold loop, solid where visible and dashed
//    where it passes behind the surfaces. Columns: wireframe / straight triple
//    hatch / the surfaces' own iso-parameter fields (triple: parallels +
//    meridians + the diagonal third family).
// ---------------------------------------------------------------------------
function quarticDemo(): void {
  const cam: Camera = {
    eye: [3.4, 2.6, 2.1],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.4,
    viewport: { width: 560, height: 420 },
  };
  // rows = wobble off / on; columns = wireframe / flat hatch / curved field
  type Shade = "wire" | "flat" | "field";
  const build = (wobble: number, shade: Shade): string => {
    // front-lit (from the camera side, upper) so the highlight faces the viewer
    const scene = new Scene({
      light: { direction: [-0.4, -0.45, -0.55] },
      svg: { background: BG },
    });
    const style =
      shade === "wire"
        ? { wobble }
        : {
            wobble,
            hatch: {
              mode: "triple" as const,
              angle: 20,
              spacingPx: 6,
              field: shade === "field",
            },
          };
    const a = scene
      .add(ellipsoid([-0.55, 0, 0], [1.3, 0.8, 0.85]))
      .setImportance(0.3, { role: "context" })
      .style(style);
    const b = scene
      .add(sphere([0.7, 0.1, 0.15], 0.9))
      .setImportance(0.3, { role: "context" })
      .style(style);
    scene.intersect(a, b, { emphasis: "bold" }).style({ wobble });
    return scene.render(cam).svg;
  };
  const shades: Shade[] = ["wire", "flat", "field"];
  save(
    "08-quartic",
    gridStitch(
      cam.viewport.width,
      cam.viewport.height,
      [0, 1].map((w) => shades.map((s) => build(w, s))),
      ["wobble: off", "wobble: on"],
      ["wireframe", "flat", "curved field"],
    ),
  );
}

// ---------------------------------------------------------------------------
// 9. Consolidation — off vs on. Three collinear, overlapping rods drawn by
//    different elements. With wobble on, each gets its own seeded offset, so
//    *without* consolidation they diverge into several weaving lines; *with* it
//    they merge into one clean line (re-classified for exact visibility).
// ---------------------------------------------------------------------------
function stripSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>\n?/, "").replace(/<\/svg>\s*$/, "");
}

const label = (x: number, y: number, s: string): string =>
  `<text x="${x}" y="${y}" font-family="sans-serif" font-size="14" fill="#999">${s}</text>`;

/** A centered `<text>` (for column headers). */
const labelC = (x: number, y: number, s: string): string =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#999">${s}</text>`;

/** Arrange a grid of same-size panels; row labels top-left, optional column
 *  headers centered along the top, dividers between. */
function gridStitch(
  W: number,
  H: number,
  rows: string[][],
  rowLabels: string[],
  colLabels?: string[],
): string {
  const gapX = 22;
  const gapY = 18;
  const cols = rows[0]!.length;
  const totalW = cols * W + (cols - 1) * gapX;
  const totalH = rows.length * H + (rows.length - 1) * gapY;
  // Clip each panel to its placed box so a figure that overruns its viewport can't
  // bleed into the next column. The clip rect is in absolute coordinates on an
  // *untransformed* outer group (an inner group does the positioning), which keeps
  // the clip unambiguous across renderers.
  const defs: string[] = [];
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">`,
  ];
  rows.forEach((row, r) => {
    const y = r * (H + gapY);
    row.forEach((svg, c) => {
      const x = c * (W + gapX);
      const id = `clip-${r}-${c}`;
      defs.push(
        `<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${W}" height="${H}" /></clipPath>`,
      );
      parts.push(
        `<g clip-path="url(#${id})"><g transform="translate(${x},${y})">${stripSvg(svg)}</g></g>`,
      );
    });
    parts.push(label(14, y + 26, rowLabels[r]!));
    if (r < rows.length - 1)
      parts.push(
        `<line x1="10" y1="${y + H + gapY / 2}" x2="${totalW - 10}" y2="${y + H + gapY / 2}" stroke="#ddd" stroke-width="1" />`,
      );
  });
  for (let c = 1; c < cols; c++) {
    const x = c * (W + gapX) - gapX / 2;
    parts.push(
      `<line x1="${x}" y1="8" x2="${x}" y2="${totalH - 8}" stroke="#ddd" stroke-width="1" />`,
    );
  }
  if (colLabels)
    colLabels.forEach((s, c) =>
      parts.push(labelC(c * (W + gapX) + W / 2, 20, s)),
    );
  parts.splice(1, 0, `<defs>${defs.join("")}</defs>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

/** Stack two same-size panels vertically into one SVG with a divider + labels. */
function stackRows(
  top: string,
  bottom: string,
  W: number,
  H: number,
  labelTop: string,
  labelBottom: string,
): string {
  const gap = 18;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${2 * H + gap}" width="${W}" height="${2 * H + gap}">`,
    stripSvg(top),
    `<g transform="translate(0,${H + gap})">${stripSvg(bottom)}</g>`,
    `<line x1="10" y1="${H + gap / 2}" x2="${W - 10}" y2="${H + gap / 2}" stroke="#ddd" stroke-width="1" />`,
    label(14, 26, labelTop),
    label(14, H + gap + 26, labelBottom),
    `</svg>`,
  ].join("\n");
}

function consolidationDemo(): void {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.011,
    viewport: { width: 460, height: 220 },
  };
  const build = (consolidate: boolean): string => {
    const scene = new Scene({
      svg: { background: BG },
      abstraction: { consolidate },
    });
    // three rods along the same 3-D line; strong wobble so different seeds diverge
    scene
      .add(new Line([-2.1, 0, 0], [2.1, 0, 0]))
      .style({ wobble: 1.5, weight: 1.8 });
    scene
      .add(new Line([-2.1, 0, 0], [2.1, 0, 0]))
      .style({ wobble: 1.5, weight: 1.8 });
    scene
      .add(new Line([-1.1, 0, 0], [1.4, 0, 0]))
      .style({ wobble: 1.5, weight: 1.8 });
    return scene.render(cam).svg;
  };
  const W = cam.viewport.width;
  const H = cam.viewport.height;
  const gap = 24;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${2 * W + gap} ${H}" width="${2 * W + gap}" height="${H}">`,
    stripSvg(build(false)),
    `<g transform="translate(${W + gap},0)">${stripSvg(build(true))}</g>`,
    `<line x1="${W + gap / 2}" y1="8" x2="${W + gap / 2}" y2="${H - 8}" stroke="#ddd" stroke-width="1" />`,
    `<text x="14" y="26" font-family="sans-serif" font-size="14" fill="#888">consolidate: off</text>`,
    `<text x="${W + gap + 14}" y="26" font-family="sans-serif" font-size="14" fill="#888">consolidate: on</text>`,
    `</svg>`,
  ].join("\n");
  save("09-consolidation", svg);
}

// ---------------------------------------------------------------------------
// 10. Torus — the one non-quadric primitive. Its silhouette is a *quartic* image
//     curve, extracted numerically from the implicit form as two contour loops
//     (outer + hole) and hidden-line classified: the near arcs are solid, the far
//     arcs (behind the tube) dashed. Two rows (wobble off / on).
// ---------------------------------------------------------------------------
function torusDemo(): void {
  const cam: Camera = {
    eye: [4.0, 3.0, 2.7],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.6,
    viewport: { width: 620, height: 400 },
  };
  const build = (wobble: number, field: boolean): string => {
    const scene = new Scene({
      light: { direction: [-0.55, 0.5, -0.55] },
      svg: { background: BG },
    });
    scene
      .add(new Torus([0, 0, 0], [0, 0, 1], 1.5, 0.6))
      .style({ wobble, hatch: { mode: "cross", angle: 20, field } });
    return scene.render(cam).svg;
  };
  // rows = wobble off / on; columns = curved poloidal/toroidal field vs flat parallels
  save(
    "10-torus",
    gridStitch(
      cam.viewport.width,
      cam.viewport.height,
      [
        [build(0, false), build(0, true)],
        [build(0.6, false), build(0.6, true)],
      ],
      ["wobble: off", "wobble: on"],
      ["flat", "curved field"],
    ),
  );
}

// ---------------------------------------------------------------------------
// 11. Two interlocking toruses (chain links) passing through each other, each
//     cross-hatched and wobbled. Mutual occlusion falls out of the visibility
//     stage — each torus dashes the other's hidden silhouette and stops its hatch
//     where the other is in front.
// ---------------------------------------------------------------------------
function toriDemo(): void {
  const cam: Camera = {
    eye: [4.4, 3.2, 3.4],
    target: [0.7, 0, 0.1],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 6,
    viewport: { width: 680, height: 680 },
  };
  const build = (mode: "single" | "cross", field: boolean): string => {
    const scene = new Scene({
      light: { direction: [-0.55, 0.5, -0.55] },
      svg: { background: BG },
    });
    scene
      .add(new Torus([0, 0, 0], [0, 0, 1], 1.3, 0.42))
      .style({ wobble: 0.7, hatch: { mode, angle: 22, field } });
    scene
      .add(new Torus([1.4, 0, 0], [0, 1, 0], 1.5, 0.42))
      .style({ wobble: 0.7, hatch: { mode, angle: -22, field } });
    return scene.render(cam).svg;
  };
  // columns = curved poloidal/toroidal field vs flat parallel hatch
  save(
    "11-tori",
    gridStitch(
      cam.viewport.width,
      cam.viewport.height,
      [
        [build("single", true), build("single", false)],
        [build("cross", true), build("cross", false)],
      ],
      [""],
      ["curved field", "flat"],
    ),
  );
}

// ---------------------------------------------------------------------------
// 12. Curved hatch direction fields — the hatch lines are the surface's *exact*
//     iso-parameter curves, not straight parallels. Columns add families: one
//     (cylinder/cone rings, torus poloidal loops, sphere parallels), cross-hatch
//     (axial rulings / apex generators / toroidal loops / meridians), triple —
//     the diagonal third family (45° helices / spiral generators / (1,1) loops /
//     tilted-axis circles) as the darkest tonal band. Each curve's hidden half is
//     dropped by the same front-face + occlusion test.
// ---------------------------------------------------------------------------
function directionFieldsDemo(): void {
  const cam: Camera = {
    eye: [3.6, 2.7, 2.2],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.4,
    viewport: { width: 360, height: 320 },
  };
  const light = { direction: [-0.4, -0.45, -0.55] as [number, number, number] };
  type Mode = "single" | "cross" | "triple";
  type Add = (s: Scene, mode: Mode) => void;
  const panel = (add: Add, mode: Mode): string => {
    const scene = new Scene({ light, svg: { background: BG } });
    add(scene, mode);
    return scene.render(cam).svg;
  };
  const style = (mode: Mode) => ({
    wobble: 0.35,
    hatch: { mode, angle: 0, spacingPx: 10 },
  });
  const cyl: Add = (s, mode) =>
    void s.add(new Cylinder([0, 0, -1], [0, 0, 2], 0.9)).style(style(mode));
  const con: Add = (s, mode) =>
    void s.add(new Cone([0, 0, 1.1], [0, 0, -2.2], 0.95)).style(style(mode));
  const tor: Add = (s, mode) =>
    void s.add(new Torus([0, 0, 0], [0, 0, 1], 1.2, 0.42)).style(style(mode));
  const sph: Add = (s, mode) =>
    void s.add(sphere([0, 0, 0], 1.25)).style(style(mode));
  const rows = [cyl, con, tor, sph];
  const modes: Mode[] = ["single", "cross", "triple"];
  save(
    "12-direction-fields",
    gridStitch(
      cam.viewport.width,
      cam.viewport.height,
      rows.map((add) => modes.map((mode) => panel(add, mode))),
      ["cylinder", "cone", "torus", "sphere"],
      ["one family", "cross-hatch", "triple"],
    ),
  );
}

// ---------------------------------------------------------------------------
// 13. Mesh regime (Phase 2). A triangle mesh is just another `FeatureSource`, so
//     it renders through the same pipeline. Left: a smooth mesh sphere — its
//     silhouette is an interpolated zero-set and it shades from the interpolated
//     vertex normals. Right: a mesh torus — the silhouette's near arcs are solid
//     and the arcs behind the tube are dashed, hidden-line falling straight out of
//     the shared visibility stage (raycast + projected silhouettes). Wobbled and
//     variable-width like everything else.
// ---------------------------------------------------------------------------
function meshDemo(): void {
  const cam: Camera = {
    eye: [3.4, 2.6, 2.3],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.4,
    viewport: { width: 430, height: 380 },
  };
  const sphere = (): string => {
    const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
    scene.add(new Mesh(uvSphere(1.25, 32, 22))).style({ wobble: 0.4, hatch: { mode: "cross", angle: 20 } });
    return scene.render(cam).svg;
  };
  const torus = (): string => {
    const scene = new Scene({ light: { direction: [-0.55, 0.5, -0.55] }, svg: { background: BG } });
    // contours only, to show hidden-line on a mesh cleanly (near arcs solid, far dashed)
    scene.add(new Mesh(torusMesh(1.3, 0.5, 44, 22))).style({ wobble: 0.4 });
    return scene.render(cam).svg;
  };
  save("13-mesh", gridStitch(cam.viewport.width, cam.viewport.height, [[sphere(), torus()]], [""], ["mesh sphere (shaded)", "mesh torus (hidden-line)"]));
}

// ---------------------------------------------------------------------------
// 14. Suggestive contours (Phase 2, §3.3.5). The extra lines an artist draws
//     where the surface *almost* turns away — zeros of radial curvature on the
//     front-facing surface, increasing in the view direction (DeCarlo et al.).
//     They extend the true silhouette into the concave regions a plain contour
//     leaves blank. Left: silhouette only. Right: with suggestive contours (the
//     lighter form lines). From the mesh's curvature precompute.
// ---------------------------------------------------------------------------
function suggestiveDemo(): void {
  const cam: Camera = {
    eye: [3.2, 2.4, 1.7],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.6,
    viewport: { width: 430, height: 360 },
  };
  const build = (suggestive: boolean): string => {
    const scene = new Scene({ light: { direction: [-0.5, -0.4, -0.6] }, svg: { background: BG } });
    scene.add(new Mesh(torusMesh(1.3, 0.52, 72, 36), { suggestive: suggestive ? { threshold: 0 } : false })).style({ wobble: 0.3 });
    return scene.render(cam).svg;
  };
  save("14-suggestive", gridStitch(cam.viewport.width, cam.viewport.height, [[build(false), build(true)]], [""], ["silhouette only", "+ suggestive contours"]));
}

hiddenLines();
hatching();
depthHatching();
wobbleSweep();
solidShading();
highlightDemo();
pointsDemo();
quarticDemo();
consolidationDemo();
torusDemo();
toriDemo();
// ---------------------------------------------------------------------------
// 15. Mesh showcase (Phase 2). Two trefoil-knot tubes threaded through each
//     other — arbitrary organic geometry, not a primitive. Each tube is engraved
//     with its **curvature-driven hatch** (streamlines of the principal-direction
//     field wrapping the tube), and **mutual occlusion** falls out of the shared
//     visibility stage: where one tube passes behind the other its contour ghosts
//     away. Wobble + variable-width ribbons throughout.
// ---------------------------------------------------------------------------
function meshShowcaseDemo(): void {
  const cam: Camera = {
    eye: [3.9, 3.0, 2.4],
    target: [0.7, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.0,
    viewport: { width: 520, height: 440 },
  };
  const knotA = () => knotTube(0.3, 150, 20, 0.5);
  const knotB = () => translate(rotate(knotTube(0.26, 130, 18, 0.42), [0, 1, 0], Math.PI / 2), [1.9, 0.2, 0.1]);
  // left = curvature-driven hatch (streamlines wrap the tubes); right = flat parallels
  const build = (field: boolean): string => {
    const scene = new Scene({ light: { direction: [-0.55, -0.4, -0.55] }, svg: { background: BG } });
    const style = { wobble: 0.25, ghostOpacity: 0.16, hatch: { mode: "single" as const, angle: field ? 0 : 28, spacingPx: 7, field } };
    scene.add(new Mesh(knotA())).style(style);
    scene.add(new Mesh(knotB())).style(style);
    return scene.render(cam).svg;
  };
  save(
    "15-mesh-showcase",
    gridStitch(cam.viewport.width, cam.viewport.height, [[build(true), build(false)]], [""], ["curvature hatch", "flat hatch"]),
  );
}

// ---------------------------------------------------------------------------
// 16. Gravity well. A heavy sphere resting in a "rubber-sheet" plane, dipped into
//     a funnel — the usual way spacetime curvature is drawn. The sheet is a warped
//     mesh; its **curvature-driven hatch** fans out as radial + concentric lines
//     (the funnel's principal directions), concentrated where the mass warps it
//     and fading on the flat outskirts. The sphere sits in the dip and occludes
//     the well behind it — mixing an analytic primitive with a mesh in one scene.
// ---------------------------------------------------------------------------
function gravityWellDemo(): void {
  const cam: Camera = {
    eye: [4.2, 4.6, 2.7],
    target: [0, 0, -0.85],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.5,
    viewport: { width: 700, height: 520 },
  };
  const scene = new Scene({ light: { direction: [-0.4, -0.5, -0.7] }, svg: { background: BG } });
  scene.add(new Mesh(gravitySheet(3, 72, 2.0, 0.72))).style({ wobble: 0.13, hatch: { mode: "cross", angle: 0, spacingPx: 8 } });
  scene.add(sphere([0, 0, -0.85], 0.82)).style({ wobble: 0.13, hatch: { mode: "cross", angle: 20 } });
  save("16-gravity-well", scene.render(cam).svg);
}

// ---------------------------------------------------------------------------
// 17. Parametric curves — the free-form primitive that has no closed-form feature
//     carrier, so it is the one place per-frame screen-adaptive sampling is
//     legitimate (§2.3). A 1-D curve does not occlude, but it *is* occludable.
//     Left: a helix wound just outside a cylinder — the back of every turn is
//     dashed where the cylinder hides it, so the coil reads in depth. Middle: a
//     cubic Bézier carried *exactly* as its control points (the faint dashed
//     control polygon + dots) and sampled only at emit. Right: a function plot
//     y = g(x), a damped sine over an axis cross. Wobble makes each hand-drawn.
// ---------------------------------------------------------------------------
function parametricDemo(): void {
  const W = 380;
  const H = 360;

  // A — helix wrapping a cylinder (hidden-line on a parametric curve)
  const helixPanel = (): string => {
    const cam: Camera = {
      eye: [4.2, 3.0, 2.2],
      target: [0, 0, 0],
      up: [0, 0, 1],
      projection: "perspective",
      scale: Math.PI / 4.4,
      viewport: { width: W, height: H },
    };
    const scene = new Scene({ svg: { background: BG } });
    scene
      .add(new Cylinder([0, 0, -1.5], [0, 0, 3], 0.8))
      .setImportance(0.3, { role: "context" })
      .style({ wobble: 0.2 });
    // radius just outside the cylinder so the coil sits on the surface; 5 turns
    // rising the full height ⇒ pitch = 3 / 5
    scene
      .add(helix([0, 0, -1.5], 0.82, 3 / 5, 5))
      .setImportance(1, { role: "subject" })
      .style({ wobble: 0.3, weight: 1.4 });
    return scene.render(cam).svg;
  };

  // B — exact cubic Bézier + its control polygon, viewed face-on
  const bezierPanel = (): string => {
    const cam: Camera = {
      eye: [0, 0, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      projection: "orthographic",
      scale: 0.02,
      viewport: { width: W, height: H },
    };
    const scene = new Scene({ svg: { background: BG } });
    // crossed handles ⇒ a pronounced S the straight control polygon can't fake
    const ctrl: [number, number, number][] = [
      [-2.4, -1.7, 0],
      [2.6, -1.5, 0],
      [-2.6, 1.5, 0],
      [2.4, 1.7, 0],
    ];
    // faint control polygon (thin segments) + control-point dots
    for (let i = 0; i + 1 < ctrl.length; i++) {
      scene
        .add(new Line(ctrl[i]!, ctrl[i + 1]!))
        .setImportance(0.2, { role: "context" })
        .style({ wobble: 0, weight: 0.5 });
    }
    for (const c of ctrl) scene.add(new Point(c, { mark: "dot", sizePx: 7 }));
    scene
      .add(new BezierCurve(ctrl))
      .setImportance(1, { role: "subject" })
      .style({ wobble: 0.3, weight: 1.4 });
    return scene.render(cam).svg;
  };

  // C — function plot y = g(x) with an axis cross
  const plotPanel = (): string => {
    const cam: Camera = {
      eye: [0, 0, 10],
      target: [0, 0, 0],
      up: [0, 1, 0],
      projection: "orthographic",
      scale: 0.02,
      viewport: { width: W, height: H },
    };
    const scene = new Scene({ svg: { background: BG } });
    scene.add(new Line([-3.4, 0, 0], [3.4, 0, 0])).setImportance(0.2, { role: "context" }).style({ wobble: 0, weight: 0.5 });
    scene.add(new Line([0, -2.2, 0], [0, 2.2, 0])).setImportance(0.2, { role: "context" }).style({ wobble: 0, weight: 0.5 });
    const g = (x: number) => 1.9 * Math.exp(-0.16 * x * x) * Math.sin(3.0 * x);
    scene
      .add(functionPlot(g, -3.3, 3.3))
      .setImportance(1, { role: "subject" })
      .style({ wobble: 0.3, weight: 1.4 });
    return scene.render(cam).svg;
  };

  save(
    "17-parametric-curves",
    gridStitch(W, H, [[helixPanel(), bezierPanel(), plotPanel()]], [""], ["helix (hidden-line)", "Bézier (exact carrier)", "function plot"]),
  );
}

// ---------------------------------------------------------------------------
// 18. Mesh creases — sharp dihedral edges. Where two facets meet above the crease
//     angle the edge is a permanent, view-independent feature (unlike the moving
//     silhouette). A faceted cube + tetrahedron: every box/tet edge is a 90°/70°
//     ridge, so the whole wireframe is creases. Left: creases + silhouette with
//     hidden-line — the near edges solid, the three edges hiding behind each solid
//     dashed. Right: the same solids flat-shaded — each facet hatches to a uniform
//     tone by its own orientation to the light, reading as faceted planes.
// ---------------------------------------------------------------------------
function creasesDemo(): void {
  const cam: Camera = {
    eye: [3.8, 3.0, 2.5],
    target: [0.2, 0, 0.1],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 5.0,
    viewport: { width: 430, height: 380 },
  };
  const scaled = (mi: MeshInput, s: number): MeshInput => ({
    positions: mi.positions.map((p) => [p[0] * s, p[1] * s, p[2] * s] as [number, number, number]),
    triangles: mi.triangles,
  });
  // a box (all 90° creases) and a tetrahedron (all ~70.5° creases), tilted off
  // axis so the 3/4 view shows three faces of each and the hidden back edges
  const boxMesh = () => translate(rotate(scaled(cube(), 0.7), [0, 0, 1], 0.5), [-1.05, -0.15, 0.2]);
  const tetMesh = () => translate(rotate(scaled(tetrahedron(), 0.72), [0, 0, 1], -0.3), [1.4, 0.3, 0.4]);
  const build = (shade: boolean): string => {
    const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
    const style = shade ? { wobble: 0.25, hatch: { mode: "single" as const, angle: 18, spacingPx: 8, field: false } } : { wobble: 0.25 };
    scene.add(new Mesh(boxMesh())).style(style);
    scene.add(new Mesh(tetMesh())).style(style);
    return scene.render(cam).svg;
  };
  save(
    "18-creases",
    gridStitch(cam.viewport.width, cam.viewport.height, [[build(false), build(true)]], [""], ["creases (hidden-line)", "faceted shading"]),
  );
}

directionFieldsDemo();
meshDemo();
suggestiveDemo();
meshShowcaseDemo();
gravityWellDemo();
parametricDemo();
creasesDemo();
console.log("gallery complete");
