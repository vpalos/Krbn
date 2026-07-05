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
export * from "./curve/sample.js";
export * from "./curve/intersect2d.js";
export * from "./math/project.js";
export * from "./math/intersect3d.js";

// --- stage 2: exact quantitative-invisibility (visible/hidden intervals) ---
export * from "./pipeline/feature-curve.js";
export * from "./pipeline/visibility.js";

// --- stage 4: styling (wobble, dash/ghost, hatch) ---
export * from "./pipeline/wobble.js";
export * from "./pipeline/style.js";
export * from "./pipeline/hatch.js";
export * from "./pipeline/abstract.js";

// --- stage 5: emit + SVG backend + render facade ---
export * from "./pipeline/emit.js";
export * from "./backend/svg.js";
export * from "./pipeline/render.js";

// --- authoring model: Scene / Element / importance ---
export * from "./scene/element.js";
export * from "./scene/scene.js";

// --- analytic primitives ---
export * from "./primitives/quadric.js";
export * from "./primitives/cylinder.js";
export * from "./primitives/cone.js";
export * from "./primitives/polygon.js";
export * from "./primitives/line.js";
export * from "./primitives/parametric.js";
export * from "./primitives/intersection.js";
