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
