// SVG backend (ai/DESIGN.md §4: "SVG first — exact, resolution-independent vector
// output"). Pure: it only turns `RenderStroke`s into an SVG string and knows
// nothing about geometry, cameras, or the pipeline upstream of the emit contract.

import type { RenderStroke } from "../pipeline/types.js";

export interface SvgOptions {
  /** background fill; null/undefined → transparent */
  background?: string | null;
  /** decimal places for coordinates (smaller files vs. precision) */
  precision?: number;
}

function fmt(n: number, prec: number): string {
  // fixed then trim trailing zeros / dot
  return n.toFixed(prec).replace(/\.?0+$/, "");
}

/**
 * A group of strokes composited together at a single opacity. SVG flattens the
 * group before applying `opacity`, so semi-transparent members that overlap do
 * NOT compound (used for the highlight halo — see scene.ts §2.8).
 */
export interface SvgGroup {
  opacity: number;
  strokes: readonly RenderStroke[];
}

export type SvgItem = RenderStroke | SvgGroup;

const isGroup = (i: SvgItem): i is SvgGroup => (i as SvgGroup).strokes !== undefined;

function polyline(s: RenderStroke, prec: number, indent: string): string {
  const pts = s.path.map((p) => `${fmt(p[0], prec)},${fmt(p[1], prec)}`).join(" ");
  const st = s.style;
  const attrs = [
    `points="${pts}"`,
    `fill="none"`,
    `stroke="${st.color}"`,
    `stroke-width="${fmt(st.weight, 3)}"`,
    st.opacity !== 1 ? `stroke-opacity="${fmt(st.opacity, 3)}"` : "",
    st.dash && st.dash.length ? `stroke-dasharray="${st.dash.map((d) => fmt(d, 3)).join(",")}"` : "",
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
  ].filter(Boolean);
  return `${indent}<polyline ${attrs.join(" ")} />`;
}

/** Render styled strokes (and opacity groups) to a standalone SVG document. */
export function renderItemsSVG(
  items: readonly SvgItem[],
  viewport: { width: number; height: number },
  opts: SvgOptions = {},
): string {
  const prec = opts.precision ?? 2;
  const { width, height } = viewport;
  const body: string[] = [];
  body.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  if (opts.background) body.push(`  <rect width="${width}" height="${height}" fill="${opts.background}" />`);
  for (const item of items) {
    if (isGroup(item)) {
      const members = item.strokes.filter((s) => s.path.length >= 2);
      if (members.length === 0) continue;
      body.push(`  <g opacity="${fmt(item.opacity, 3)}">`);
      for (const s of members) body.push(polyline(s, prec, "    "));
      body.push(`  </g>`);
    } else if (item.path.length >= 2) {
      body.push(polyline(item, prec, "  "));
    }
  }
  body.push(`</svg>`);
  return body.join("\n");
}

/** Render styled strokes to a standalone SVG document string. */
export function renderStrokesSVG(
  strokes: readonly RenderStroke[],
  viewport: { width: number; height: number },
  opts: SvgOptions = {},
): string {
  return renderItemsSVG(strokes, viewport, opts);
}
