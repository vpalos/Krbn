// Axis-aligned bounding box helpers. `AABB` is view-independent (static scaffold,
// ai/DESIGN.md §0.4) — computed once per element.

import type { AABB, Vec3 } from "./types.js";

export function aabbFromCenterRadius(center: Vec3, radius: number): AABB {
  return {
    min: [center[0] - radius, center[1] - radius, center[2] - radius],
    max: [center[0] + radius, center[1] + radius, center[2] + radius],
  };
}

export function aabbFromPoints(points: readonly Vec3[]): AABB {
  if (points.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function aabbCenter(b: AABB): Vec3 {
  return [
    (b.min[0] + b.max[0]) * 0.5,
    (b.min[1] + b.max[1]) * 0.5,
    (b.min[2] + b.max[2]) * 0.5,
  ];
}

export function aabbUnion(a: AABB, b: AABB): AABB {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}
