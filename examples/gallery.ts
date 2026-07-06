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
directionFieldsDemo();
console.log("gallery complete");
