# Mesh / organ regime (Phase 2 — underway)

The mesh-based `FeatureSource` for organic/scanned geometry. Because everything
from the stage-2 contract onward is shared with the analytic path, adding it means
implementing one interface (`FeatureSource`) plus the numerical machinery behind
it. See **ai/DESIGN.md §3** for the phased plan and hard-parts registry.

## Here now

- **`halfedge.ts` — the static scaffold (§3.3.1).** `HalfEdgeMesh.build` turns an
  indexed triangle mesh into half-edge topology (implicit `3f+k` indexing;
  twin/next/face adjacency; boundary + non-manifold detection; optional vertex
  weld at load), and precomputes face normals + areas, angle-weighted vertex
  normals, per-edge dihedral angle with a convex/concave sign, and crease
  (dihedral > θ) / boundary tags. View-independent, paid once.
- **`curvature.ts` — curvature precompute (§3.3.2).** `computeCurvature` runs the
  Rusinkiewicz per-face least-squares fit of the second (and third) fundamental
  form from vertex-normal variation, transports it into each vertex's tangent
  frame, and mixed-Voronoi-area-averages. Returns per-vertex principal curvatures
  κ1/κ2 + directions and the derivative tensor `dcurv` (for suggestive contours).
  Static, paid once. Validated against plane / sphere / cylinder.
- **`silhouette.ts` — silhouette zero-set + chaining (§3.3.3–4).**
  `silhouetteLoops(mesh, cam)` defines g(v)=n(v)·toEye (interpolated normals), takes
  the zero crossing *through* each face (Hertzmann–Zorin — continuous under camera
  motion), and chains the per-face segments through shared crossed-edge nodes into
  ordered polyline loops/paths. Validated on sphere and open tube.
- **`shapes.ts`** — indexed `tetrahedron` / `cube` / `grid` / `uvSphere` / `tube`
  meshes (CCW-outward) for tests and demos.

## Next (not yet built)

The `Mesh` `FeatureSource` (`extractFeatures` = silhouette + creases + boundaries;
`projectedSilhouettes`; `raycast` via triangle intersection) so a mesh renders
through the existing pipeline → suggestive contours → hybrid→analytic visibility →
temporal coherence.
