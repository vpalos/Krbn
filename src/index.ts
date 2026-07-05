// Krbn — a non-photorealistic, pencil-style rendering engine.
//
// Status: pre-alpha. The type spine matches the design; the math + curve kernel
// (exact conic intersection) and the first analytic primitive (Quadric/Sphere)
// are implemented. See ai/DESIGN.md for the full design and roadmap.

// --- stable contract types ---
export type * from "./math/types.js";
export type * from "./curve/types.js";
export type * from "./pipeline/types.js";
export type { FeatureSource } from "./scene/feature-source.js";

// --- core math ---
export * as vec3 from "./math/vec3.js";
export * as vec2 from "./math/vec2.js";
export * as mat3 from "./math/mat3.js";
export * as mat4 from "./math/mat4.js";
export * from "./math/basis.js";
export * from "./math/aabb.js";
export * from "./math/camera.js";

// --- the exact conic kernel (critical path, ai/DESIGN.md §2.9.1) ---
export * from "./curve/epsilon.js";
export * from "./curve/roots.js";
export * from "./curve/conic.js";

// --- analytic primitives ---
export * from "./primitives/quadric.js";
