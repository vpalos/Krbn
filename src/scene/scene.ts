// The Scene: the authoring model and the one place the full styled pipeline runs
// (ai/DESIGN.md §2.8). It holds elements (FeatureSource + semantics), resolves a
// per-element style, and renders: classify → styled/wobbled emit → hatch (clipped
// to the visible surface) → SVG.
//
// Deferred (need intersection curves / more machinery, §2.5): `scene.intersect`
// and `scene.highlight` from the design sketch are not implemented yet.

import type { Camera, Vec2, Vec3 } from "../math/types.js";
import type { ElementId, Light, RenderStroke, Stroke } from "../pipeline/types.js";
import type { FeatureSource } from "./feature-source.js";
import type { SampleOptions } from "../curve/sample.js";
import type { SvgOptions } from "../backend/svg.js";
import type { RenderResult } from "../pipeline/render.js";
import type { StyleOverride, StyleSpec } from "../pipeline/style.js";
import { Element, type ElementOptions } from "./element.js";
import { classifyScene, isOccluded, sceneScale } from "../pipeline/visibility.js";
import { emitStyledStroke, resolveStyle, ROLE_STYLE } from "../pipeline/style.js";
import { defaultHatch, type HatchStrategy } from "../pipeline/hatch.js";
import { defaultWobble, type WobbleStrategy } from "../pipeline/wobble.js";
import { renderStrokesSVG } from "../backend/svg.js";
import { unproject } from "../math/camera.js";
import { normalize } from "../math/vec3.js";

const HATCH_WEIGHT = 0.7;
const HATCH_OPACITY = 0.55;
const HATCH_STEP_PX = 4; // sample spacing when clipping a hatch line to visibility

export interface SceneOptions {
  light?: Light;
  /** scene-wide default style, overridden per element */
  style?: StyleOverride;
  sample?: SampleOptions;
  svg?: SvgOptions;
  /** swappable line-perturbation algorithm (defaults to value-noise wobble) */
  wobble?: WobbleStrategy;
  /** swappable hatch-pattern generator (defaults to parallel-line hatch) */
  hatch?: HatchStrategy;
}

export class Scene {
  readonly elements: Element[] = [];
  private readonly byId = new Map<ElementId, Element>();
  light: Light;
  defaultStyle: StyleOverride;
  sample: SampleOptions | undefined;
  svgOptions: SvgOptions | undefined;
  wobble: WobbleStrategy;
  hatch: HatchStrategy;

  constructor(opts: SceneOptions = {}) {
    this.light = opts.light ?? { direction: normalize([-0.5, -1, -0.8]) };
    this.defaultStyle = { ...opts.style };
    this.sample = opts.sample;
    this.svgOptions = opts.svg;
    this.wobble = opts.wobble ?? defaultWobble;
    this.hatch = opts.hatch ?? defaultHatch;
  }

  /** Add a feature source to the scene; returns its element for configuration. */
  add(source: FeatureSource, opts?: ElementOptions): Element {
    const el = new Element(source, opts);
    this.elements.push(el);
    this.byId.set(el.id, el);
    return el;
  }

  sources(): FeatureSource[] {
    return this.elements.map((e) => e.source);
  }

  /** Fully-resolved style for an owner: base ← role ← scene default ← element. */
  resolveSpec(owner: ElementId): StyleSpec {
    const el = this.byId.get(owner);
    return resolveStyle(el ? ROLE_STYLE[el.role] : undefined, this.defaultStyle, el?.styleOverride);
  }

  /** Run the whole pipeline and return strokes, render strokes, and SVG. */
  render(cam: Camera): RenderResult {
    const sources = this.sources();
    const strokes = classifyScene(sources, cam);
    const scale = sceneScale(sources);

    const outlineStrokes: RenderStroke[] = [];
    for (const st of strokes) {
      outlineStrokes.push(...emitStyledStroke(st, cam, this.resolveSpec(st.feature.owner), this.sample, this.wobble));
    }

    const hatchStrokes: RenderStroke[] = [];
    for (const el of this.elements) {
      const spec = this.resolveSpec(el.id);
      if (!spec.hatch) continue;
      for (const region of el.source.hatchRegions(cam, this.light)) {
        const shaped = { ...region, mode: spec.hatch.mode, angle: spec.hatch.angle };
        const segs = this.hatch.generate(shaped, spec.hatch.spacingPx != null ? { spacingPx: spec.hatch.spacingPx } : {});
        for (const seg of segs) {
          for (const run of clipHatchToVisible(seg, el.source, cam, sources, scale)) {
            hatchStrokes.push({ path: run, style: { weight: HATCH_WEIGHT, color: spec.color, opacity: HATCH_OPACITY } });
          }
        }
      }
    }

    // hatch under the outlines
    const renderStrokes = [...hatchStrokes, ...outlineStrokes];
    const svg = renderStrokesSVG(renderStrokes, cam.viewport, this.svgOptions);
    return { strokes, renderStrokes, svg };
  }

  /** Convenience: render directly to an SVG string. */
  toSVG(cam: Camera): string {
    return this.render(cam).svg;
  }
}

/** The front surface point seen at a pixel on the owner source, or null. */
function surfacePoint(source: FeatureSource, cam: Camera, pt: Vec2): Vec3 | null {
  const hits = source.raycast(unproject(cam, pt));
  for (const h of hits) if (h.t > 1e-6) return h.point;
  return null;
}

/**
 * Split a hatch segment into the runs that are actually visible: on the owner's
 * front surface and not occluded by anything nearer. This is what makes hatching
 * stop at occlusion boundaries and its gaps reveal what is behind (§2.6).
 */
function clipHatchToVisible(
  seg: readonly [Vec2, Vec2],
  owner: FeatureSource,
  cam: Camera,
  sources: readonly FeatureSource[],
  scale: number,
): Vec2[][] {
  const [a, b] = seg;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const k = Math.max(2, Math.ceil(len / HATCH_STEP_PX));
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const pt: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const p3 = surfacePoint(owner, cam, pt);
    const visible = p3 !== null && !isOccluded(p3, cam, sources, scale);
    if (visible) run.push(pt);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}
