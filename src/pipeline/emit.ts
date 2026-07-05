// Stage 5 (emit), first half: turn visibility-classified `Stroke`s into
// backend-ready `RenderStroke`s by sampling each visible/hidden interval to a
// screen polyline (ai/DESIGN.md §1.2 stage 5). Analytic curves stay analytic
// until exactly here — sampling is adaptive in screen space (`curve/sample.ts`).
//
// Styling proper is stage 4 (not built yet). Until then this module applies a
// minimal *default* policy so the engine's signature output — ghosted hidden
// lines — is already visible: solid for visible runs, faint dashed for hidden.

import type { Camera, Vec2 } from "../math/types.js";
import type { RenderStroke, RenderStyle, Stroke } from "./types.js";
import { buildFeatureModel } from "./feature-curve.js";
import { projectionMatrix, projectPoint } from "../math/camera.js";
import { adaptiveSample, DEFAULT_SAMPLE, type SampleOptions } from "../curve/sample.js";

export interface EmitStyle {
  visible: RenderStyle;
  /** null → hidden runs are dropped entirely instead of ghosted */
  hidden: RenderStyle | null;
}

/** A restrained default: solid dark for visible, faint dashed for hidden. */
export const DEFAULT_EMIT_STYLE: EmitStyle = {
  visible: { weight: 1.5, color: "#1a1a1a", opacity: 1 },
  hidden: { weight: 1, color: "#1a1a1a", opacity: 0.32, dash: [4, 3] },
};

/** Emit one classified stroke as one render stroke per (styled) interval. */
export function emitStroke(
  stroke: Stroke,
  cam: Camera,
  style: EmitStyle = DEFAULT_EMIT_STYLE,
  opts: SampleOptions = DEFAULT_SAMPLE,
): RenderStroke[] {
  const model = buildFeatureModel(stroke.feature.curve, cam);
  const P = projectionMatrix(cam);
  const project = (p: readonly [number, number, number]): Vec2 => projectPoint(P, p).point;

  const out: RenderStroke[] = [];
  for (const iv of stroke.intervals) {
    const s = iv.visible ? style.visible : style.hidden;
    if (!s) continue;
    const { points } = adaptiveSample((t) => model.point3(t), iv.t0, iv.t1, project, opts);
    const path = points.map(project);
    if (path.length >= 2) out.push({ path, style: s });
  }
  return out;
}

/** Emit a whole classified scene (flattened). */
export function emitScene(
  strokes: readonly Stroke[],
  cam: Camera,
  style: EmitStyle = DEFAULT_EMIT_STYLE,
  opts: SampleOptions = DEFAULT_SAMPLE,
): RenderStroke[] {
  const out: RenderStroke[] = [];
  for (const st of strokes) out.push(...emitStroke(st, cam, style, opts));
  return out;
}
