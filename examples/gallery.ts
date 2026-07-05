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

// Defaults next to this file; overridable so a compiled copy can still target
// the repo (KRBN_GALLERY_OUT). Normal `bun run` users need not set it.
const OUT = process.env.KRBN_GALLERY_OUT ?? join(dirname(fileURLToPath(import.meta.url)), "gallery");
mkdirSync(OUT, { recursive: true });
const BG = "#faf9f5";

function save(name: string, svg: string): void {
  writeFileSync(join(OUT, `${name}.svg`), svg);
  console.log(`wrote gallery/${name}.svg`);
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
  const scene = new Scene({ light: { direction: [-0.6, -0.5, -0.65] }, svg: { background: BG } });
  const r = 0.85;
  scene.add(sphere([-2.9, 0, 0], r)).style({ wobble: 0.25, hatch: { mode: "single", angle: 20 } });
  scene.add(sphere([-0.9, 0, 0], r)).style({ wobble: 0.25, hatch: { mode: "cross", angle: 20 } });
  scene.add(sphere([1.1, 0, 0], r)).style({ wobble: 0.25, hatch: { mode: "triple", angle: 20 } });
  // a flat quad (seen face-on so it fills), single-hatched → uniform tone
  scene.add(
    new Polygon([
      [2.7, -0.9, 0],
      [3.9, -0.9, 0],
      [3.9, 0.9, 0],
      [2.7, 0.9, 0],
    ]),
  ).style({ wobble: 0.2, hatch: { mode: "single", angle: 45 } });
  save("02-hatching", scene.toSVG(cam));
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
    .style({ wobble: 0.35, hatch: { mode: "cross", angle: 25 } });
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
  const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
  const modes = ["single", "cross", "triple"] as const;
  const makers = [
    (x: number, z: number) => new Cone([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
    (x: number, z: number) => new Cylinder([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
    (x: number, z: number) => sphere([x, 0, z], 0.7),
  ];
  modes.forEach((mode, r) => {
    const z = 2.3 - r * 2.3; // top row single, then cross, then triple
    makers.forEach((make, c) => {
      const x = -2.9 + c * 2.9;
      scene.add(make(x, z)).style({ wobble: 0.18, hatch: { mode, angle: 15 } });
    });
  });
  save("05-solid-shading", scene.render(cam).svg);
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
  const scene = new Scene({ svg: { background: BG } });
  scene.add(new Cylinder([0, 0, -1.1], [0, 0, 2.2], 0.9)).setImportance(0.3, { role: "context" });
  const ball = scene.add(sphere([-1.75, -0.2, 0.5], 0.85)); // behind + beside: partly exposed
  // crisp outline on top + a thick, semi-transparent marker halo around it
  scene.highlight(ball, { weight: 1.8, dashWhenHidden: true, halo: { weight: 12, opacity: 0.28 } });
  save("06-highlight", scene.render(cam).svg);
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
//    where it passes behind the surfaces.
// ---------------------------------------------------------------------------
function quarticDemo(): void {
  const cam: Camera = {
    eye: [3.4, 2.6, 2.1],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 640, height: 480 },
  };
  const scene = new Scene({ svg: { background: BG } });
  const a = scene.add(ellipsoid([-0.55, 0, 0], [1.3, 0.8, 0.85])).setImportance(0.3, { role: "context" });
  const b = scene.add(sphere([0.7, 0.1, 0.15], 0.9)).setImportance(0.3, { role: "context" });
  scene.intersect(a, b, { emphasis: "bold" }).style({ wobble: 0.15 });
  save("08-quartic", scene.render(cam).svg);
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
    const scene = new Scene({ svg: { background: BG }, abstraction: { consolidate } });
    // three rods along the same 3-D line; strong wobble so different seeds diverge
    scene.add(new Line([-2.1, 0, 0], [2.1, 0, 0])).style({ wobble: 1.5, weight: 1.8 });
    scene.add(new Line([-2.1, 0, 0], [2.1, 0, 0])).style({ wobble: 1.5, weight: 1.8 });
    scene.add(new Line([-1.1, 0, 0], [1.4, 0, 0])).style({ wobble: 1.5, weight: 1.8 });
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

hiddenLines();
hatching();
depthHatching();
wobbleSweep();
solidShading();
highlightDemo();
pointsDemo();
quarticDemo();
consolidationDemo();
console.log("gallery complete");
