# Roadmap

Detail, contracts, and the hard-parts registry live in [`ai/DESIGN.md`](ai/DESIGN.md).
This is the short view.

## Phase 1 — Analytic primitives (current)

Real-world value for technical figures, and the regime where the hardest module
(hidden-line visibility) is exact.

1. Core math kernel — `Vec3`, `Basis`, `Camera`, `Ray`, `Curve`, `Curve2D`
   with an **exact conic intersector** (the critical path). _(design.md §2.9.1)_
2. `FeatureSource` interface + `Scene` / element + importance model.
3. `Quadric` with exact silhouette conic; `Sphere` / `Cylinder` / `Cone` as
   configurations. `Plane` / `Polygon`, `Line`, `ParametricCurve`.
4. Stage 1: emit raw un-styled features (verify by eye).
5. Stage 2: exact quantitative-invisibility → visible/hidden intervals.
6. Intersection-curve features (sphere ∩ plane = circle, …).
7. Stage 4: styling (weight/dash/ghost/seeded-wobble) + hatch generation.
8. Stage 3: abstraction (screen-size threshold, tone quantization, importance).
9. Stage 5: SVG backend with adaptive sampling of analytic curves.

## Phase 2 — Mesh / organ regime (deferred, not lost)

One more `FeatureSource` implementation + the numerical machinery behind it;
everything from the stage-2 contract onward is reused.

1. Static scaffold — half-edge, normals, dihedral, crease/boundary tagging.
2. Curvature precompute (principal curvatures + derivative).
3. Silhouette as interpolated zero-set + chaining.
4. Suggestive contours.
5. Visibility — hybrid (depth-buffer-seeded) → fully analytic QI.
6. Temporal coherence for animation.

## Cross-cutting

Seeded/deterministic wobble, temporal-coherence discipline (starts in Phase 1),
SVG-first backend, optional alpha as a pure drawing op, and a declarative
authoring language that later deserializes into the same `Scene` model.
