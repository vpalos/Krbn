# Roadmap

Detail, contracts, and the hard-parts registry live in [`ai/DESIGN.md`](ai/DESIGN.md).
This is the short view.

**Status legend:** ✅ done · 🚧 partial · ⬜ not started. Progress reflects the
tree as of 2026-07-05; see DESIGN.md §"Implementation status" for module-level
detail. Everything below is verified by `bun test` (unit + property + degeneracy
suites) and `bun run build`.

## Phase 1 — Analytic primitives (current)

Real-world value for technical figures, and the regime where the hardest module
(hidden-line visibility) is exact.

1. ✅ **Core math kernel** — `Vec3`/`Vec2`, `Basis`, `AABB`, `Camera` (ortho +
   perspective projection), `Ray`, and the `Curve`/`Curve2D` carriers, plus the
   **exact conic intersector** (line–conic; conic–conic via the pencil /
   degenerate-line-pair split) and robust real root solvers. The critical path,
   and the most heavily tested part of the engine. _(design.md §2.9.1)_
2. 🚧 **`FeatureSource` seam + `Scene` / element + importance model.** The
   interface exists and every primitive implements it directly. The `Scene`
   graph, element wrapper, and importance/role API _(design.md §2.8)_ are **not
   built yet** — primitives are currently constructed and queried standalone.
3. ✅ **Primitive catalog.** `Quadric` with exact silhouette conic (screen-space
   dual-quadric outline + object-space polar-plane contour), configured as
   `Sphere` / `Ellipsoid` / `Cylinder` / `Cone`; plus `Plane` / `Polygon`
   (occluder + hatch region), `Line`, and `ParametricCurve` (`Bézier`, `helix`,
   `functionPlot`). All expose closed-form `raycast` and `projectedSilhouettes`.
4. ⬜ Stage 1: a runnable pass that emits raw un-styled features (verify by eye).
   Primitives already produce `Feature`s; the pass that collects and draws them
   does not exist yet.
5. ⬜ Stage 2: exact quantitative-invisibility → visible/hidden intervals.
   **Next build target** — its inputs (`projectedSilhouettes` crossing curves,
   `raycast` reference test) are now in place across all primitives.
6. ⬜ Intersection-curve features (sphere ∩ plane = circle, …).
7. ⬜ Stage 4: styling (weight/dash/ghost/seeded-wobble) + hatch generation.
8. ⬜ Stage 3: abstraction (screen-size threshold, tone quantization, importance).
9. ⬜ Stage 5: SVG backend with adaptive sampling of analytic curves. (The
   adaptive screen-flatness sampler itself already exists in `curve/sample.ts`.)

## Phase 2 — Mesh / organ regime (deferred, not lost)

One more `FeatureSource` implementation + the numerical machinery behind it;
everything from the stage-2 contract onward is reused. All ⬜.

1. Static scaffold — half-edge, normals, dihedral, crease/boundary tagging.
2. Curvature precompute (principal curvatures + derivative).
3. Silhouette as interpolated zero-set + chaining.
4. Suggestive contours.
5. Visibility — hybrid (depth-buffer-seeded) → fully analytic QI.
6. Temporal coherence for animation.

## Cross-cutting

Seeded/deterministic wobble ⬜, temporal-coherence discipline (starts in Phase 1)
⬜, SVG-first backend ⬜, optional alpha as a pure drawing op ⬜, and a declarative
authoring language that later deserializes into the same `Scene` model ⬜. The
adaptive analytic-curve sampler this all leans on is ✅ (`curve/sample.ts`).
