// 2-D convex hull (Andrew's monotone chain). Used to turn a primitive's
// projected silhouette samples into a polygon outline for its hatch region — the
// hull is the exact screen footprint of a convex silhouette (cylinder, cone,
// quadric), and the per-sample surface clip then carves the actual surface.

import type { Vec2 } from "./types.js";

const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull of a point set, counter-clockwise, without the closing repeat. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = points.map((p): Vec2 => [p[0], p[1]]).sort((p, q) => (p[0] === q[0] ? p[1] - q[1] : p[0] - q[0]));
  if (pts.length < 3) return pts;

  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
