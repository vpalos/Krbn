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

function polyline(s: RenderStroke, prec: number): string {
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
  return `  <polyline ${attrs.join(" ")} />`;
}

/** Render styled strokes to a standalone SVG document string. */
export function renderStrokesSVG(
  strokes: readonly RenderStroke[],
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
  for (const s of strokes) if (s.path.length >= 2) body.push(polyline(s, prec));
  body.push(`</svg>`);
  return body.join("\n");
}
