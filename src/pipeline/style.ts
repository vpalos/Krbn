// Stage 4 — styling. Resolves a per-element `StyleSpec` (weight, colour, wobble,
// dash/ghost, hatch) and emits a classified `Stroke` as styled `RenderStroke`s:
// one run per visibility interval, visible solid / hidden ghosted, with seeded
// wobble applied to the sampled polyline (ai/DESIGN.md §2.8, §4).
//
// `importance`/`role` do not set style directly (that is the abstraction stage's
// job, §2.8); but `role` still supplies sensible styling defaults now — a
// `context` element is drawn lighter and more ghosted than a `subject`.

import type { Camera } from "../math/types.js";
import type { HatchMode, RenderStroke, RenderStyle, Stroke } from "./types.js";
import { buildFeatureModel } from "./feature-curve.js";
import { projectionMatrix } from "../math/camera.js";
import { sampleInterval } from "./emit.js";
import { defaultWobble, hashSeed, type WobbleStrategy } from "./wobble.js";
import { defaultWidth, type WidthStrategy } from "./width.js";
import { DEFAULT_SAMPLE, type SampleOptions } from "../curve/sample.js";

export interface HatchSpec {
  mode: HatchMode;
  /** hatch angle in degrees */
  angle: number;
  /** line spacing in px; if omitted, derived from the region tone */
  spacingPx?: number;
  /**
   * Use the primitive's exact curved direction field (rings/rulings/poloidal…)
   * when it offers one. Defaults to `true`; set `false` to force straight
   * parallel hatch even on a cylinder/cone/torus. (ai/DESIGN.md §2.6)
   */
  field?: boolean;
}

export interface StyleSpec {
  weight: number;
  color: string;
  /** 0 = ruler, ~1 = hero sketchy */
  wobble: number;
  /** how hidden runs are drawn */
  hidden: "ghost" | "drop";
  ghostOpacity: number;
  hiddenDash: number[];
  visibleDash?: number[];
  hatch: HatchSpec | null;
  /** stroke weight of hatch lines */
  hatchWeight: number;
  /** opacity of hatch lines (kept < 1 so cross-hatch layers read as tone) */
  hatchOpacity: number;
}

export type StyleOverride = Partial<StyleSpec>;
export type Role = "subject" | "context" | "default";

/** Engine defaults (a restrained technical-drawing look). */
export const BASE_STYLE: StyleSpec = {
  weight: 1.5,
  color: "#1a1a1a",
  wobble: 0,
  hidden: "ghost",
  ghostOpacity: 0.32,
  hiddenDash: [4, 3],
  hatch: null,
  hatchWeight: 0.7,
  hatchOpacity: 0.55,
};

/** Role-driven default overrides (§2.8: context is quieter, subject is bolder). */
export const ROLE_STYLE: Record<Role, StyleOverride> = {
  subject: { weight: 1.7 },
  context: { weight: 1.0, ghostOpacity: 0.2 },
  default: {},
};

/** Merge style layers over the base (later layers win). */
export function resolveStyle(...layers: readonly (StyleOverride | undefined)[]): StyleSpec {
  let out: StyleSpec = { ...BASE_STYLE };
  for (const layer of layers) if (layer) out = { ...out, ...layer };
  return out;
}

export interface IntervalStyles {
  visible: RenderStyle;
  hidden: RenderStyle | null;
}

/** Turn a resolved spec into the two concrete render styles (visible / hidden). */
export function toRenderStyles(spec: StyleSpec): IntervalStyles {
  const visible: RenderStyle = { weight: spec.weight, color: spec.color, opacity: 1 };
  if (spec.visibleDash) visible.dash = spec.visibleDash;
  const hidden: RenderStyle | null =
    spec.hidden === "drop"
      ? null
      : { weight: spec.weight * 0.9, color: spec.color, opacity: spec.ghostOpacity, dash: spec.hiddenDash };
  return { visible, hidden };
}

/** Emit a classified stroke as styled, wobbled render strokes. */
export function emitStyledStroke(
  stroke: Stroke,
  cam: Camera,
  spec: StyleSpec,
  opts: SampleOptions = DEFAULT_SAMPLE,
  wobble: WobbleStrategy = defaultWobble,
  width: WidthStrategy = defaultWidth,
): RenderStroke[] {
  const model = buildFeatureModel(stroke.feature.curve, cam);
  const P = projectionMatrix(cam);
  const styles = toRenderStyles(spec);
  // Seed per element (owner), NOT per feature type — so an element's silhouette,
  // rims, generators, etc. share one field and join at their common vertices.
  const seed = hashSeed(stroke.feature.owner);

  const out: RenderStroke[] = [];
  for (const iv of stroke.intervals) {
    const style = iv.visible ? styles.visible : styles.hidden;
    if (!style) continue;
    const sampled = sampleInterval(model, iv.t0, iv.t1, P, opts);
    if (sampled.path.length < 2) continue;
    const path = wobble.apply({ path: sampled.path, points3: sampled.points3, seed, amount: spec.wobble });
    if (path.length < 2) continue;
    // Variable width rides the same hand knob and only the solid, non-dashed runs
    // (a filled ribbon can't be dashed); hidden/ghost runs stay uniform strokes.
    const w =
      spec.wobble > 0 && iv.visible && !style.dash
        ? width.widths({ path, seed, baseWidth: style.weight, amount: spec.wobble })
        : undefined;
    out.push(w ? { path, style, width: w } : { path, style });
  }
  return out;
}
