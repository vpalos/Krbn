// A bare line segment / ray as a scene element. It is a drawn edge, not a
// surface: it has no silhouette and does not occlude (a 1-D set casts no area
// shadow), but it is occludABLE along its length — that visibility is resolved
// downstream by QI (ai/DESIGN.md §2.3, "Line segment / ray").

import type { AABB, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { aabbFromPoints } from "../math/aabb.js";

let autoId = 0;
const nextId = (): ElementId => `line-${autoId++}`;

export class Line implements FeatureSource {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly id: ElementId;

  constructor(a: Vec3, b: Vec3, id: ElementId = nextId()) {
    this.a = a;
    this.b = b;
    this.id = id;
  }

  bounds(): AABB {
    return aabbFromPoints([this.a, this.b]);
  }

  extractFeatures(_cam: Camera): Feature[] {
    return [
      {
        type: "boundary",
        owner: this.id,
        curve: { kind: "line", a: this.a, b: this.b },
        attrs: {},
      },
    ];
  }

  hatchRegions(_cam: Camera, _light: Light): HatchRegion[] {
    return [];
  }

  /** A 1-D segment has zero cross-section: nothing to hit, so it never occludes. */
  raycast(_ray: Ray): Hit[] {
    return [];
  }

  projectedSilhouettes(_cam: Camera): Curve2D[] {
    return [];
  }
}
