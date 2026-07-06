import type { AABB, Camera, Ray, Hit } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";

/**
 * The seam of the engine (ai/DESIGN.md §1.1).
 *
 * Analytic primitives and triangle meshes both implement this interface;
 * nothing downstream of stage 1 knows which kind produced its input. Adding the
 * mesh/organ regime later is essentially implementing this one interface.
 */
export interface FeatureSource {
  /** stable identity; features carry it as `owner`, and wobble seeds on it. Set
   *  explicitly by the author, else assigned scene-locally by `Scene.add`. */
  id: ElementId;

  /** source-kind tag (`"quadric"`, `"mesh"`, …) used to name auto ids. */
  readonly kind?: string;

  /** true when `id` was auto-assigned (no author id), so a Scene may relabel it. */
  autoNamed?: boolean;

  /** view-independent bounds */
  bounds(): AABB;

  /** per-frame: classified feature curves (silhouette, crease, boundary, …) */
  extractFeatures(cam: Camera): Feature[];

  /** per-frame: fillable surface regions */
  hatchRegions(cam: Camera, light: Light): HatchRegion[];

  /**
   * Optional: an *exact curved direction field* for hatching — the surface's
   * iso-parameter curves (rings/rulings/poloidal circles) as world-space samples
   * with normals, ordered families first. Sources with a natural parametrization
   * (cylinder, cone, torus) provide it; the rest omit it and the scene falls back
   * to straight parallel hatch over `hatchRegions`. (ai/DESIGN.md §2.6)
   */
  hatchField?(cam: Camera, opts: HatchFieldOptions): HatchFamily[];

  /** exact where possible; used by the visibility reference-point test */
  raycast(ray: Ray): Hit[];

  /** projected silhouettes, used to place QI crossing events */
  projectedSilhouettes(cam: Camera): Curve2D[];

  /**
   * Optional depth tolerance (world units) within which *this* source's own hits
   * count as "self" rather than occlusion, in the exact depth-buffer visibility
   * test. A smooth analytic surface omits it (its silhouette lies exactly on the
   * surface); a faceted mesh returns ≈ its edge length, since a silhouette point on
   * one facet can be a chord-sagitta nearer than an adjacent facet — a tolerance
   * inherent to discrete surfaces. (ai/DESIGN.md §3.3.6)
   */
  selfNudge?(): number;
}
