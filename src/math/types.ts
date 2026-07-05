// Core geometric types. Implementations are the next build target — see docs/design.md §2.9.1.

/** Immutable 3-vector. */
export type Vec3 = readonly [number, number, number];

/** Immutable 2-vector (screen or plane space). */
export type Vec2 = readonly [number, number];

/** Orthonormal basis / local frame (also used to describe a plane). */
export interface Basis {
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

/** Axis-aligned bounding box. */
export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** A ray for visibility / raycast queries. `dir` is expected normalized. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** A hit returned by FeatureSource.raycast, ordered ascending by `t`. */
export interface Hit {
  t: number;
  point: Vec3;
  normal: Vec3;
  frontFacing: boolean;
}

export type Projection = 'orthographic' | 'perspective';

/**
 * Camera / view. Default projection is orthographic for technical figures,
 * where a sphere's silhouette is a true circle (docs/design.md §5).
 */
export interface Camera {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  projection: Projection;
  /** world units per pixel (ortho) or vertical fov in radians (perspective). */
  scale: number;
  viewport: { width: number; height: number };
}
