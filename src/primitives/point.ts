// A point, rendered as a small camera-facing mark (docs/DESIGN.md §2.3). The mark
// is emitted as short 3-D segments at the point's depth, so ordinary QI decides
// its visibility (a single depth test in effect) and the styling/emit stages need
// no special case. Like a Line, a point has no area and does not occlude.

import type { AABB, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { addScaled } from "../math/vec3.js";
import { autoName } from "../scene/auto-id.js";
import { EPS_ABS } from "../curve/epsilon.js";

export type PointMark = "cross" | "plus" | "dot";

export interface PointOptions {
  /** mark glyph (default 'cross' = ×) */
  mark?: PointMark;
  /** mark size in px (default 7) */
  sizePx?: number;
}

export class Point implements FeatureSource {
  readonly position: Vec3;
  readonly kind = "point";
  id: ElementId;
  autoNamed: boolean;
  private readonly mark: PointMark;
  private readonly sizePx: number;

  constructor(position: Vec3, opts: PointOptions = {}, id?: ElementId) {
    this.position = position;
    this.autoNamed = id === undefined;
    this.id = id ?? autoName(this.kind);
    this.mark = opts.mark ?? "cross";
    this.sizePx = opts.sizePx ?? 7;
  }

  bounds(): AABB {
    // a tiny box, so the point contributes a sane (non-zero) scene extent
    const p = this.position;
    const e = 1e-3;
    return { min: [p[0] - e, p[1] - e, p[2] - e], max: [p[0] + e, p[1] + e, p[2] + e] };
  }

  extractFeatures(cam: Camera): Feature[] {
    const half = this.worldPerPx(cam) * (this.sizePx / 2);
    if (!(half > 0)) return [];
    const { right, up } = cameraFrame(cam);
    const p = this.position;
    const seg = (dir: Vec3): Feature => ({
      type: "boundary",
      owner: this.id,
      curve: { kind: "line", a: addScaled(p, dir, -half), b: addScaled(p, dir, half) },
      attrs: {},
    });

    if (this.mark === "dot") {
      // a tiny ring (arc); no fill in the SVG backend, so a small circle outline
      return [
        {
          type: "boundary",
          owner: this.id,
          curve: {
            kind: "arc",
            center: p,
            radius: half,
            plane: { origin: p, x: right, y: up, z: cameraFrame(cam).forward },
            a0: 0,
            a1: 2 * Math.PI,
          },
          attrs: {},
        },
      ];
    }

    if (this.mark === "plus") {
      return [seg(right), seg(up)];
    }
    // 'cross' = × : two diagonals
    const inv = 1 / Math.SQRT2;
    const d1: Vec3 = [ (right[0] + up[0]) * inv, (right[1] + up[1]) * inv, (right[2] + up[2]) * inv ];
    const d2: Vec3 = [ (right[0] - up[0]) * inv, (right[1] - up[1]) * inv, (right[2] - up[2]) * inv ];
    return [seg(d1), seg(d2)];
  }

  hatchRegions(_cam: Camera, _light: Light): HatchRegion[] {
    return [];
  }
  raycast(_ray: Ray): Hit[] {
    return [];
  }
  projectedSilhouettes(_cam: Camera): Curve2D[] {
    return [];
  }

  /** World units per screen pixel at the point's depth (ortho + perspective). */
  private worldPerPx(cam: Camera): number {
    const P = projectionMatrix(cam);
    const { right } = cameraFrame(cam);
    const delta = 0.01;
    const a = projectPoint(P, this.position).point;
    const b = projectPoint(P, addScaled(this.position, right, delta)).point;
    const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return px > EPS_ABS ? delta / px : 0;
  }
}
