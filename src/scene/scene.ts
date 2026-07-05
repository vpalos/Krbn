// The Scene: the authoring model and the one place the full styled pipeline runs
// (ai/DESIGN.md §2.8). It holds elements (FeatureSource + semantics), resolves a
// per-element style, and renders: classify → styled/wobbled emit → hatch (clipped
// to the visible surface) → SVG.
//
// Deferred (need intersection curves / more machinery, §2.5): `scene.intersect`
// and `scene.highlight` from the design sketch are not implemented yet.

import type { Camera, Hit, Vec2, Vec3 } from "../math/types.js";
import type { ElementId, Light, RenderStroke, Stroke } from "../pipeline/types.js";
import type { FeatureSource } from "./feature-source.js";
import type { SampleOptions } from "../curve/sample.js";
import type { SvgOptions } from "../backend/svg.js";
import type { RenderResult } from "../pipeline/render.js";
import type { StyleOverride, StyleSpec } from "../pipeline/style.js";
import { Element, type ElementOptions } from "./element.js";
import { Quadric } from "../primitives/quadric.js";
import { Polygon } from "../primitives/polygon.js";
import {
  IntersectionCurve,
  intersectPlanes,
  intersectQuadricPlane,
  intersectSpheres,
  type Section,
} from "../primitives/intersection.js";
import { classifyScene, isOccluded, sceneScale } from "../pipeline/visibility.js";
import { emitStyledStroke, resolveStyle, ROLE_STYLE } from "../pipeline/style.js";
import { defaultHatch, hatchAngles, type HatchStrategy } from "../pipeline/hatch.js";
import { defaultWobble, type WobbleStrategy } from "../pipeline/wobble.js";
import { applyAbstraction, quantizeTone } from "../pipeline/abstract.js";
import { renderStrokesSVG } from "../backend/svg.js";
import { unproject } from "../math/camera.js";
import { distance, normalize } from "../math/vec3.js";
import { EPS_DEPTH_REL } from "../curve/epsilon.js";

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
  /** stage-3 abstraction (off by default) */
  abstraction?: AbstractionSettings;
}

export interface AbstractionSettings {
  /** drop features whose projected extent < this many px (importance-scaled); 0 = off */
  minFeaturePx?: number;
  /** snap hatch tone to this many discrete levels; 0/undefined = off */
  toneLevels?: number;
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
  abstraction: AbstractionSettings;

  constructor(opts: SceneOptions = {}) {
    this.light = opts.light ?? { direction: normalize([-0.5, -1, -0.8]) };
    this.defaultStyle = { ...opts.style };
    this.sample = opts.sample;
    this.svgOptions = opts.svg;
    this.wobble = opts.wobble ?? defaultWobble;
    this.hatch = opts.hatch ?? defaultHatch;
    this.abstraction = opts.abstraction ?? {};
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

  /**
   * Add the intersection curve of two elements as a first-class feature
   * (ai/DESIGN.md §2.5). Supports quadric ∩ plane, sphere ∩ sphere, and
   * plane ∩ plane; other pairings (or a quadric ∩ quadric quartic) throw.
   * `emphasis: 'bold'` draws the waterline heavier.
   */
  intersect(a: Element, b: Element, opts: { emphasis?: "bold" | "normal"; style?: StyleOverride } = {}): Element {
    const section = this.sectionFor(a.source, b.source);
    const source = new IntersectionCurve(section, `intersect:${a.id}∩${b.id}`);
    const emphasis: StyleOverride = opts.emphasis === "bold" ? { weight: 2.6 } : {};
    return this.add(source, { style: { ...emphasis, ...opts.style } });
  }

  private sectionFor(sa: FeatureSource, sb: FeatureSource): Section | null {
    const qA = sa instanceof Quadric;
    const qB = sb instanceof Quadric;
    const pA = sa instanceof Polygon;
    const pB = sb instanceof Polygon;
    if (qA && pB) return intersectQuadricPlane(sa.Q, sb.vertices[0]!, sb.normal);
    if (pA && qB) return intersectQuadricPlane(sb.Q, sa.vertices[0]!, sa.normal);
    if (qA && qB) return intersectSpheres(sa.Q, sb.Q);
    if (pA && pB) {
      const ba = sa.bounds();
      const bb = sb.bounds();
      const extent = Math.max(distance(ba.min, ba.max), distance(bb.min, bb.max));
      return intersectPlanes(sa.vertices[0]!, sa.normal, sb.vertices[0]!, sb.normal, extent);
    }
    throw new Error(`scene.intersect: unsupported pair ${sa.constructor.name} ∩ ${sb.constructor.name}`);
  }

  /** Fully-resolved style for an owner: base ← role ← scene default ← element. */
  resolveSpec(owner: ElementId): StyleSpec {
    const el = this.byId.get(owner);
    return resolveStyle(el ? ROLE_STYLE[el.role] : undefined, this.defaultStyle, el?.styleOverride);
  }

  /** Run the whole pipeline and return strokes, render strokes, and SVG. */
  render(cam: Camera): RenderResult {
    const sources = this.sources();
    const classified = classifyScene(sources, cam);
    const scale = sceneScale(sources);

    // Stage 3: importance-scaled screen-size thresholding.
    const strokes = applyAbstraction(classified, {
      minFeaturePx: this.abstraction.minFeaturePx ?? 0,
      importanceOf: (owner) => this.byId.get(owner)?.importance ?? 0.5,
    });

    const outlineStrokes: RenderStroke[] = [];
    for (const st of strokes) {
      outlineStrokes.push(...emitStyledStroke(st, cam, this.resolveSpec(st.feature.owner), this.sample, this.wobble));
    }

    const hatchStrokes: RenderStroke[] = [];
    const lightDir = normalize(this.light.direction);
    for (const el of this.elements) {
      const spec = this.resolveSpec(el.id);
      if (!spec.hatch) continue;
      const levels = this.abstraction.toneLevels ?? 0;
      const hstyle = { weight: spec.hatchWeight, color: spec.color, opacity: spec.hatchOpacity };
      for (const region of el.source.hatchRegions(cam, this.light)) {
        const tone = levels > 0 ? quantizeTone(region.tone, levels) : region.tone;
        const spacingOpts = spec.hatch.spacingPx != null ? { spacingPx: spec.hatch.spacingPx } : {};
        // Tonal layering: draw one angle set per layer, each clipped to the part
        // of the surface dark enough for that layer, so curved surfaces shade
        // light→dark (flat faces get a uniform number of layers). §2.6
        const angles = hatchAngles(spec.hatch.mode, spec.hatch.angle);
        for (let layer = 0; layer < angles.length; layer++) {
          const maxDiffuse = layerBrightness(layer, angles.length);
          const single = { ...region, mode: "single" as const, angle: angles[layer]!, tone };
          for (const seg of this.hatch.generate(single, spacingOpts)) {
            for (const run of clipHatchTonal(seg, el.source, cam, sources, scale, lightDir, maxDiffuse)) {
              hatchStrokes.push({ path: run, style: { ...hstyle } });
            }
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

/** The front surface hit (point + normal) seen at a pixel on the owner source,
 *  or null. The depth floor is relative to scene scale (matches the QI self-hit
 *  skip). */
function surfaceHit(source: FeatureSource, cam: Camera, pt: Vec2, scale: number): Hit | null {
  const hits = source.raycast(unproject(cam, pt));
  const floor = EPS_DEPTH_REL * scale;
  for (const h of hits) if (h.t > floor) return h;
  return null;
}

/** Brightness ceiling for tonal layer `i` of `n`: layer 0 covers all but the
 *  brightest highlight, deeper layers only progressively darker surface. */
function layerBrightness(i: number, n: number): number {
  return 0.95 * ((n - i) / n);
}

/**
 * Split a hatch segment into the runs that survive both tests, sampled along the
 * segment: (1) visible — on the owner's front surface and not occluded by
 * anything nearer (gaps reveal what is behind, §2.6); (2) dark enough — the local
 * Lambert term N·L is below `maxDiffuse`, which is what shades curved surfaces
 * light→dark across the tonal layers.
 */
function clipHatchTonal(
  seg: readonly [Vec2, Vec2],
  owner: FeatureSource,
  cam: Camera,
  sources: readonly FeatureSource[],
  scale: number,
  lightDir: Vec3,
  maxDiffuse: number,
): Vec2[][] {
  const [a, b] = seg;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const k = Math.max(2, Math.ceil(len / HATCH_STEP_PX));
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const pt: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const hit = surfaceHit(owner, cam, pt, scale);
    let keep = false;
    if (hit && !isOccluded(hit.point, cam, sources, scale)) {
      const diffuse = Math.max(0, -(hit.normal[0] * lightDir[0] + hit.normal[1] * lightDir[1] + hit.normal[2] * lightDir[2]));
      keep = diffuse < maxDiffuse;
    }
    if (keep) run.push(pt);
    else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}
