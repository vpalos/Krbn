import type { AABB, Camera, Ray, Hit } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";

/**
 * The seam of the engine (ai/DESIGN.md §1.1).
 *
 * Analytic primitives and triangle meshes both implement this interface;
 * nothing downstream of stage 1 knows which kind produced its input. Adding the
 * mesh/organ regime later is essentially implementing this one interface.
 */
export interface FeatureSource {
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
   * Optional: the distance to step a reference point off *this* source's surface
   * before an occlusion ray, and the radius within which the source's own hits
   * count as "self" rather than occlusion. Smooth analytic surfaces omit it (the
   * tiny default nudge suffices); a faceted mesh returns ~its edge length, so a
   * grazing silhouette point clears its neighbouring triangles while genuine
   * (far) self-occlusion is still caught. (ai/DESIGN.md §3.3.6)
   */
  selfNudge?(): number;
}
