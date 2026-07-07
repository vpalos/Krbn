import type { Curve, Curve2D } from "../curve/types.js";
import type { Vec2, Vec3 } from "../math/types.js";

/** Identifies the scene element that owns a feature (for importance + styling). */
export type ElementId = string;

/**
 * Stable identity of a feature *instance* across frames — the spine of temporal
 * coherence (docs/DESIGN.md §3.3.7, §4). Downstream stages key per-stroke state on
 * it (dash phase, taper direction, frame-to-frame correspondence), so it must not
 * churn under small camera motion. Sources that can anchor a view-dependent chain
 * to view-independent data supply it themselves (a mesh silhouette loop is keyed
 * on its minimal crossed mesh edge); features left without an id get a
 * deterministic `${owner}/${type}:${n}` fallback assigned in extraction order
 * (`assignDefaultFeatureIds`) — exact for view-independent analytic features.
 */
export type FeatureId = string;

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

/** Stage 1 → 2. Object space, already chained (docs/DESIGN.md §1.4). */
export interface Feature {
  type: FeatureType;
  /** carried end-to-end so importance/styling stay resolvable in stages 3–4 */
  owner: ElementId;
  /** stable per-instance identity (see `FeatureId`); filled by the pipeline when absent */
  id?: FeatureId;
  curve: Curve;
  attrs: {
    dihedral?: number;
    convex?: boolean;
    /** 0..1 confidence/salience of a thresholded feature (e.g. how far a
     *  suggestive contour's D_w κ_r clears its threshold). Styling multiplies
     *  opacity by it, so borderline features fade in/out instead of popping
     *  (temporal coherence). Absent = 1. */
    strength?: number;
  };
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
  /** 0..1 opacity multiplier assigned by stage-3 abstraction when the stroke
   *  sits inside the screen-size fade band just above the cull threshold — so
   *  zooming shrinks a feature into a fade-out, not a pop (temporal coherence).
   *  Absent = 1. */
  fade?: number;
}

export type HatchMode = "single" | "cross" | "triple";

/**
 * A surface region to be filled with hatching (docs/DESIGN.md §2.6).
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
  /**
   * Screen projection of a *view-independent* object point (e.g. the owner's
   * bounds centre). Straight hatch phases its line family through this point,
   * so panning the camera moves the hatch *with the object* instead of letting
   * it crawl past (temporal coherence; the scene fills it in when a source
   * doesn't). Without it the phase is screen-origin-anchored.
   */
  anchorPx?: Vec2;
}

/**
 * A curved hatch *direction field* (docs/DESIGN.md §2.6). Instead of straight
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
  /** stable identity of this curve across frames (temporal coherence): wobble
   *  seeds key on it, so a curve keeps its hand-drawn character as the camera
   *  moves. Static atlases (mesh streamlines) guarantee it; per-frame generators
   *  should derive it from the curve's iso-parameter, not enumeration order. */
  key?: string;
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
  /**
   * Optional per-vertex stroke width (px), same length as `path`. When present
   * (and the stroke is solid), the backend draws a filled *ribbon* of varying
   * width instead of a uniform stroke. (docs/DESIGN.md §4)
   */
  width?: readonly number[];
}

type Vec2Tuple = readonly [number, number];

export interface RenderStyle {
  weight: number;
  dash?: number[];
  color: string;
  opacity: number;
}
