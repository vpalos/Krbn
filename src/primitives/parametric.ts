// Parametric curves: Bézier (exact carrier) and general function-defined curves
// (helix, function plot). A general parametric curve has no closed-form feature
// carrier, so it is the one primitive where per-frame, screen-adaptive sampling
// is legitimate (ai/DESIGN.md §2.3). Like a Line, a 1-D curve does not occlude.

import type { AABB, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { aabbFromPoints } from "../math/aabb.js";
import { projectionMatrix, projectPoint } from "../math/camera.js";
import { adaptiveSample, deCasteljau, DEFAULT_SAMPLE, type SampleOptions } from "../curve/sample.js";

let autoId = 0;
const nextId = (prefix: string): ElementId => `${prefix}-${autoId++}`;

/** A curve x = f(t), t ∈ [t0, t1], sampled adaptively to a polyline per frame. */
export class ParametricCurve implements FeatureSource {
  readonly f: (t: number) => Vec3;
  readonly t0: number;
  readonly t1: number;
  readonly id: ElementId;
  private readonly opts: SampleOptions;

  constructor(
    f: (t: number) => Vec3,
    t0: number,
    t1: number,
    id: ElementId = nextId("param"),
    opts: SampleOptions = DEFAULT_SAMPLE,
  ) {
    this.f = f;
    this.t0 = t0;
    this.t1 = t1;
    this.id = id;
    this.opts = opts;
  }

  bounds(): AABB {
    // Coarse fixed sampling is enough for a conservative static bound.
    const n = 64;
    const pts: Vec3[] = [];
    for (let i = 0; i <= n; i++) pts.push(this.f(this.t0 + ((this.t1 - this.t0) * i) / n));
    return aabbFromPoints(pts);
  }

  extractFeatures(cam: Camera): Feature[] {
    const P = projectionMatrix(cam);
    const { points } = adaptiveSample(this.f, this.t0, this.t1, (p) => projectPoint(P, p).point, this.opts);
    return [
      {
        type: "boundary",
        owner: this.id,
        curve: { kind: "polyline", pts: points },
        attrs: {},
      },
    ];
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
}

/**
 * A Bézier curve carried *exactly* as control points (analytic until emit).
 * Sampling happens in the emit stage; extractFeatures hands over the `bezier`
 * carrier untouched.
 */
export class BezierCurve implements FeatureSource {
  readonly control: readonly Vec3[];
  readonly id: ElementId;

  constructor(control: readonly Vec3[], id: ElementId = nextId("bezier")) {
    if (control.length < 2) throw new Error("Bézier needs at least 2 control points");
    this.control = control;
    this.id = id;
  }

  bounds(): AABB {
    // The curve lies within the convex hull of its control points.
    return aabbFromPoints(this.control);
  }

  extractFeatures(_cam: Camera): Feature[] {
    return [
      {
        type: "boundary",
        owner: this.id,
        curve: { kind: "bezier", pts: [...this.control] },
        attrs: {},
      },
    ];
  }

  eval(t: number): Vec3 {
    return deCasteljau(this.control, t);
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
}

// --- convenience constructors ----------------------------------------------

/** A helix around `axis` through `center`, given radius, pitch (rise/turn), turns. */
export function helix(
  center: Vec3,
  radius: number,
  pitch: number,
  turns: number,
  id?: ElementId,
): ParametricCurve {
  // Axis-aligned to +z for simplicity; compose with a transform upstream if needed.
  const f = (t: number): Vec3 => [
    center[0] + radius * Math.cos(t),
    center[1] + radius * Math.sin(t),
    center[2] + (pitch * t) / (2 * Math.PI),
  ];
  return new ParametricCurve(f, 0, turns * 2 * Math.PI, id ?? nextId("helix"));
}

/** A function plot y = g(x) in the z = 0 plane over [x0, x1]. */
export function functionPlot(
  g: (x: number) => number,
  x0: number,
  x1: number,
  id?: ElementId,
): ParametricCurve {
  const f = (x: number): Vec3 => [x, g(x), 0];
  return new ParametricCurve(f, x0, x1, id ?? nextId("plot"));
}
