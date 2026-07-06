// Public entry for the built-in mesh shape generators — imported as `krbn/shapes`.
//
// These are convenience / starter geometry (cube, uvSphere, torusMesh, gravitySheet,
// knotTube, …) plus the `translate`/`rotate` transforms. They are deliberately kept
// OUT of the core `krbn` API: the stable spine is the `FeatureSource` seam and the
// `MeshInput` contract, not this grab-bag of fixtures. Real scenes bring their own
// geometry as `MeshInput` (from a loader, CAD, or procedural code); these exist for
// demos and tests, and may churn as the mesh regime evolves.
export * from "./mesh/shapes.js";
