// The deliverable / figure-composition layer.
//
// A shippable scene file (`*.krbn.ts`) default-exports a `Drawing`: anything with
// `.toSvg(): string`. The render CLI turns any such file into an SVG next to it.
//
// `view()` binds a single 3-D `Scene` to a camera; `grid()` / `stack()` compose a
// sheet of rendered panels; `raw()` wraps a pre-built SVG string. The label
// helpers (`textAt`, `withLabels`, `label`, `labelC`) and `stripSvg` are the 2-D
// annotation overlay — they sit *above* the pipeline and only ever touch strings.
//
// These composition helpers were promoted verbatim from the previous monolithic
// gallery harness, so existing figures render the same way.
import type { Camera, Vec3 } from "../math/types.js";
import type { Scene } from "../scene/scene.js";
import { projectionMatrix, projectPoint } from "../math/camera.js";

/** The one thing every shippable scene file exports: it can produce an SVG. */
export interface Drawing {
  toSvg(): string;
}

/** Wrap a pre-built SVG string as a Drawing. */
export const raw = (svg: string): Drawing => ({ toSvg: () => svg });

/** Ship a single 3-D scene: bind it to a camera. */
export const view = (scene: Scene, cam: Camera): Drawing => ({
  toSvg: () => scene.toSVG(cam),
});

// ---------------------------------------------------------------------------
// 2-D annotation overlay (labels).
// ---------------------------------------------------------------------------

/** A `<text>` label anchored at the screen projection of a world point. */
export function textAt(
  cam: Camera,
  world: Vec3,
  text: string,
  anchor: "start" | "middle" | "end" = "middle",
): string {
  const p = projectPoint(projectionMatrix(cam), world).point;
  return `<text x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="${anchor}" font-family="sans-serif" font-size="14" fill="#888">${text}</text>`;
}

/** Inject label `<text>` elements just before the closing tag of a rendered SVG. */
export function withLabels(svg: string, labels: readonly string[]): string {
  return svg.replace(/<\/svg>\s*$/, `${labels.join("\n")}\n</svg>`);
}

/** Strip the outer `<svg>` wrapper so a rendered panel can be re-nested. */
export function stripSvg(svg: string): string {
  return svg.replace(/^<svg[^>]*>\n?/, "").replace(/<\/svg>\s*$/, "");
}

/** A left-anchored caption `<text>`. */
export const label = (x: number, y: number, s: string): string =>
  `<text x="${x}" y="${y}" font-family="sans-serif" font-size="14" fill="#999">${s}</text>`;

/** A centered caption `<text>` (for column headers). */
export const labelC = (x: number, y: number, s: string): string =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#999">${s}</text>`;

// ---------------------------------------------------------------------------
// Panel composition (grid / stack).
// ---------------------------------------------------------------------------

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

/** Ship a composed figure: a grid of rendered panels (row/column labels). */
export function grid(
  vp: Camera["viewport"],
  rows: string[][],
  opts: { rowLabels?: string[]; colLabels?: string[] } = {},
): Drawing {
  return raw(
    gridStitch(vp.width, vp.height, rows, opts.rowLabels ?? [""], opts.colLabels),
  );
}

/** Ship a composed figure: two panels stacked vertically with captions. */
export function stack(
  top: string,
  bottom: string,
  vp: Camera["viewport"],
  labels: { top: string; bottom: string },
): Drawing {
  return raw(stackRows(top, bottom, vp.width, vp.height, labels.top, labels.bottom));
}

// ---------------------------------------------------------------------------
// Multi-figure deliverable: several independently-named stills from one file.
// ---------------------------------------------------------------------------

/** A deliverable that emits several *separate* SVGs from one scene file — each
 *  entry writes its own `<name>.svg` beside the source. Use it when one file
 *  produces a set of stills that should stay separate rather than be stitched
 *  into a single `grid`/`stack` sheet (e.g. one render per imported model). */
export interface Figures {
  readonly figures: { name: string; drawing: Drawing }[];
}

/** Ship a set of independently-named drawings (see `Figures`). */
export function figures(items: { name: string; drawing: Drawing }[]): Figures {
  return { figures: items };
}

// ---------------------------------------------------------------------------
// Animation deliverable: a sequence of frames, each an ordinary Drawing.
// ---------------------------------------------------------------------------

/** A multi-frame deliverable. Each frame is a normal rendered `Drawing`, so a
 *  frame composes with the very same `view`/`grid`/`stack`/`shapes` helpers as a
 *  still — the only thing "animation" adds is a driven sequence. The render CLI
 *  writes the frames beside the source and drops in a `flipbook()` viewer. */
export interface Film {
  /** ordered frames, already rendered to SVG (name = `frame-000.svg` …). */
  readonly frames: { name: string; svg: string }[];
  /** stage size for the flipbook viewer (defaults to 640×480). */
  readonly viewport?: Camera["viewport"];
  /** flipbook playback rate (default 12 fps). */
  readonly fps?: number;
}

/**
 * Build a `Film` from a frame function. `frame(k)` returns the `k`-th frame as a
 * `Drawing` (compose it however you like — a single `view`, a `grid`, …). Frames
 * are rendered eagerly and in order, so a stateful driver (a `FrameSession`) steps
 * correctly. This is the whole "animation" seam: successive frame generation over
 * the same static-frame machinery.
 */
export function film(
  count: number,
  frame: (k: number) => Drawing,
  opts: { viewport?: Camera["viewport"]; fps?: number; onFrame?: (k: number) => void } = {},
): Film {
  const frames: { name: string; svg: string }[] = [];
  for (let k = 0; k < count; k++) {
    frames.push({ name: `frame-${String(k).padStart(3, "0")}.svg`, svg: frame(k).toSvg() });
    // per-frame hook (progress, coherence report, …), fired after the frame renders
    opts.onFrame?.(k);
  }
  return {
    frames,
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
    ...(opts.fps !== undefined ? { fps: opts.fps } : {}),
  };
}

/** A one-file flipbook viewer that *references* the sibling `frame-###.svg` files
 *  (so the frames stay reusable on their own). Preloads them for instant scrub. */
export function flipbook(f: Film): string {
  const N = f.frames.length;
  const W = f.viewport?.width ?? 640;
  const H = f.viewport?.height ?? 480;
  const fps = f.fps ?? 12;
  return `<!doctype html>
<meta charset="utf-8">
<title>Krbn — flipbook</title>
<style>
  body { margin: 0; background: #faf9f5; font: 13px system-ui, sans-serif; color: #444;
         display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
  #stage { width: ${W}px; height: ${H}px; border: 1px solid #ddd; }
  #frame { display: block; width: 100%; height: 100%; }
  #bar { display: flex; gap: 10px; align-items: center; }
  input[type=range] { width: ${Math.max(120, W - 160)}px; }
  button { font: inherit; padding: 2px 12px; }
</style>
<div id="stage"><img id="frame" alt="frame"></div>
<div id="bar">
  <button id="play">play</button>
  <input id="scrub" type="range" min="0" max="${N - 1}" value="0" step="1">
  <span id="label">0 / ${N - 1}</span>
</div>
<script>
  const N = ${N}, FPS = ${fps};
  const src = (k) => "frame-" + String(k).padStart(3, "0") + ".svg";
  // preload so scrubbing is instant and playback doesn't flicker
  for (let k = 0; k < N; k++) { const im = new Image(); im.src = src(k); }
  const frame = document.getElementById("frame");
  const scrub = document.getElementById("scrub");
  const label = document.getElementById("label");
  const play = document.getElementById("play");
  let timer = null;
  const show = (k) => { frame.src = src(k); scrub.value = k; label.textContent = k + " / " + (N - 1); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; play.textContent = "play"; } };
  scrub.addEventListener("input", () => { stop(); show(+scrub.value); });
  play.addEventListener("click", () => {
    if (timer) return stop();
    play.textContent = "stop";
    timer = setInterval(() => show((+scrub.value + 1) % N), 1000 / FPS);
  });
  show(0);
</script>`;
}
