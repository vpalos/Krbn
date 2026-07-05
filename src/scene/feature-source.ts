import type { AABB, Camera, Ray, Hit } from '../math/types.js';
import type { Curve2D } from '../curve/types.js';
import type { Feature, HatchRegion, Light } from '../pipeline/types.js';

/**
 * The seam of the engine (docs/design.md §1.1).
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

  /** exact where possible; used by the visibility reference-point test */
  raycast(ray: Ray): Hit[];

  /** projected silhouettes, used to place QI crossing events */
  projectedSilhouettes(cam: Camera): Curve2D[];
}
