// Orchestration facade: scene → classified strokes → emitted render strokes →
// SVG. This is the one place the whole Phase-1 pipeline is wired end to end
// (extract → visibility → emit → backend); keeping it here leaves the backend
// pure (docs/DESIGN.md §4).

import type { Camera } from "../math/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import type { RenderStroke, Stroke } from "./types.js";
import type { SampleOptions } from "../curve/sample.js";
import { classifyScene } from "./visibility.js";
import { emitScene, DEFAULT_EMIT_STYLE, type EmitStyle } from "./emit.js";
import { renderStrokesSVG, type SvgOptions } from "../backend/svg.js";

export interface RenderOptions {
  style?: EmitStyle;
  sample?: SampleOptions;
  svg?: SvgOptions;
}

/** Full pipeline result, so callers can inspect intermediate stages. */
export interface RenderResult {
  strokes: Stroke[];
  renderStrokes: RenderStroke[];
  svg: string;
}

export function renderScene(sources: readonly FeatureSource[], cam: Camera, opts: RenderOptions = {}): RenderResult {
  const strokes = classifyScene(sources, cam);
  const style = opts.style ?? DEFAULT_EMIT_STYLE;
  const renderStrokes = emitScene(strokes, cam, style, opts.sample);
  const svg = renderStrokesSVG(renderStrokes, cam.viewport, opts.svg);
  return { strokes, renderStrokes, svg };
}

/** Convenience: scene → SVG string. */
export function renderSceneSVG(sources: readonly FeatureSource[], cam: Camera, opts: RenderOptions = {}): string {
  return renderScene(sources, cam, opts).svg;
}
