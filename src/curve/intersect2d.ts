// Screen-space crossing points between two projected curves. This is where QI
// interval boundaries come from (docs/DESIGN.md §2.4): every place a feature's
// image meets an occluder's apparent contour is a candidate visibility change.
// Built entirely on the exact conic kernel; segments are clipped to their extent
// so a finite ruling/edge never produces phantom crossings on its extension.

import type { Vec2 } from "../math/types.js";
import type { Curve2D, ConicParams } from "./types.js";
import { intersectLineConic, intersectConicConic, type Line2 } from "./conic.js";
import { EPS_ABS, EPS_PARAM, EPS_POINT } from "./epsilon.js";

interface Segment {
  a: Vec2;
  b: Vec2;
}

/** Break a screen curve into the pieces the pairwise intersectors understand. */
type Piece =
  | { kind: "segment"; seg: Segment }
  | { kind: "conic"; params: ConicParams };

function pieces(c: Curve2D): Piece[] {
  switch (c.kind) {
    case "line":
      return [{ kind: "segment", seg: { a: c.a, b: c.b } }];
    case "conic":
      return [{ kind: "conic", params: c.params }];
    case "arc": {
      // Treat as a full circle conic; angular clipping is not needed for the
      // closed rims we emit, and over-inclusion is harmless for QI.
      const { center, radius } = c;
      return [
        {
          kind: "conic",
          params: {
            A: 1,
            B: 0,
            C: 1,
            D: -2 * center[0],
            E: -2 * center[1],
            F: center[0] * center[0] + center[1] * center[1] - radius * radius,
          },
        },
      ];
    }
    case "polyline": {
      const out: Piece[] = [];
      for (let i = 0; i + 1 < c.pts.length; i++) out.push({ kind: "segment", seg: { a: c.pts[i]!, b: c.pts[i + 1]! } });
      return out;
    }
  }
}

const asLine = (s: Segment): Line2 => ({ point: s.a, dir: [s.b[0] - s.a[0], s.b[1] - s.a[1]] });

/** 2-D segment × segment, returning the crossing point if it lies on both. */
function segSeg(p: Segment, q: Segment): Vec2[] {
  const r: Vec2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
  const s: Vec2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) <= EPS_ABS) return []; // parallel or degenerate
  const qp: Vec2 = [q.a[0] - p.a[0], q.a[1] - p.a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
  if (t < -EPS_PARAM || t > 1 + EPS_PARAM || u < -EPS_PARAM || u > 1 + EPS_PARAM) return [];
  return [[p.a[0] + t * r[0], p.a[1] + t * r[1]]];
}

/** Segment × conic, keeping only hits within the segment extent. */
function segConic(seg: Segment, params: ConicParams): Vec2[] {
  const res = intersectLineConic(asLine(seg), params);
  const within = (t: number) => t >= -EPS_PARAM && t <= 1 + EPS_PARAM;
  switch (res.kind) {
    case "none":
    case "contained":
      return [];
    case "tangent":
      return within(res.hit.t) ? [res.hit.point] : [];
    case "one":
      return within(res.hit.t) ? [res.hit.point] : [];
    case "two":
      return res.hits.filter((h) => within(h.t)).map((h) => h.point);
  }
}

function conicConic(a: ConicParams, b: ConicParams): Vec2[] {
  const res = intersectConicConic(a, b);
  return res.kind === "points" ? res.points.map((p) => p.point) : [];
}

/** All crossing points between two screen curves (deduplicated). */
export function crossScreenCurves(a: Curve2D, b: Curve2D): Vec2[] {
  const out: Vec2[] = [];
  for (const pa of pieces(a))
    for (const pb of pieces(b)) {
      let pts: Vec2[] = [];
      if (pa.kind === "segment" && pb.kind === "segment") pts = segSeg(pa.seg, pb.seg);
      else if (pa.kind === "segment" && pb.kind === "conic") pts = segConic(pa.seg, pb.params);
      else if (pa.kind === "conic" && pb.kind === "segment") pts = segConic(pb.seg, pa.params);
      else if (pa.kind === "conic" && pb.kind === "conic") pts = conicConic(pa.params, pb.params);
      for (const p of pts) {
        if (!out.some((q) => Math.abs(q[0] - p[0]) <= EPS_POINT && Math.abs(q[1] - p[1]) <= EPS_POINT)) out.push(p);
      }
    }
  return out;
}
