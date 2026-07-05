import type { Curve, Curve2D } from "../curve/types.js";
import type { Vec3 } from "../math/types.js";

/** Identifies the scene element that owns a feature (for importance + styling). */
export type ElementId = string;

export interface Light {
  /** normalized, world space */
  direction: Vec3;
}

export type FeatureType =
  | "silhouette"
  | "crease"
  | "boundary"
  | "suggestive"
  | "intersection";

/** Stage 1 → 2. Object space, already chained (ai/DESIGN.md §1.4). */
export interface Feature {
  type: FeatureType;
  /** carried end-to-end so importance/styling stay resolvable in stages 3–4 */
  owner: ElementId;
  curve: Curve;
  attrs: { dihedral?: number; convex?: boolean };
}

/** A visible/hidden run along a stroke's parameter range. */
export interface VisibilityInterval {
  t0: number;
  t1: number;
  visible: boolean;
}

/** Stage 2 → 3. Projected + visibility-classified. */
export interface Stroke {
  feature: Feature;
  screen: Curve2D;
  intervals: VisibilityInterval[];
}

export type HatchMode = "single" | "cross" | "triple";

/**
 * A surface region to be filled with hatching (ai/DESIGN.md §2.6).
 * Its outline is clipped to the visible portion so gaps reveal what is behind
 * (alpha-free transparency).
 */
export interface HatchRegion {
  owner: ElementId;
  outline: Curve2D;
  /** optional holes (e.g. a torus's hole) — clipped out via the even–odd rule */
  holes?: Curve2D[];
  mode: HatchMode;
  /** hatch angle in degrees, within the region's direction field */
  angle: number;
  /** 0..1, drives hatch density */
  tone: number;
}

/**
 * A curved hatch *direction field* (ai/DESIGN.md §2.6). Instead of straight
 * parallel screen lines, a primitive can emit its exact iso-parameter curves
 * (a cylinder's rings + rulings, a torus's poloidal/toroidal circles) as
 * world-space samples carrying the surface normal. The scene projects each
 * sample, keeps the runs that are front-facing, unoccluded, and dark enough for
 * the tonal layer — so the field follows curvature and its hidden half falls out
 * of the same visibility test as everything else.
 */
export interface HatchSample {
  /** point on the surface, world space */
  p: Vec3;
  /** unit outward surface normal at `p` */
  n: Vec3;
}

/** One iso-parameter curve of a direction field (already chained). */
export interface HatchFieldCurve {
  samples: HatchSample[];
}

/** One direction family; ordered families become successive cross-hatch layers
 *  (family 0 is drawn for `single`, 0+1 for `cross`). */
export interface HatchFamily {
  curves: HatchFieldCurve[];
}

/** What the scene asks a source's `hatchField` for. */
export interface HatchFieldOptions {
  /** desired screen spacing between adjacent iso-curves, px */
  spacingPx: number;
  /** how many families the current hatch mode wants (1 single, 2 cross, 3 triple) */
  maxFamilies: number;
}

/** Stage 4 → 5. Ready for the backend. */
export interface RenderStroke {
  /** sampled, simplified, optionally wobbled */
  path: readonly Vec2Tuple[];
  style: RenderStyle;
}

type Vec2Tuple = readonly [number, number];

export interface RenderStyle {
  weight: number;
  dash?: number[];
  color: string;
  opacity: number;
}
