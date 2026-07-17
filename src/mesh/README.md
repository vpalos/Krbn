# Mesh / organ regime (Phase 2 — underway)

The mesh-based `FeatureSource` for organic/scanned geometry. Because everything
from the stage-2 contract onward is shared with the analytic path, adding it means
implementing one interface (`FeatureSource`) plus the numerical machinery behind
it. See **docs/DESIGN.md §3** for the phased plan and hard-parts registry.

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
- **`mesh-source.ts` — the `Mesh` `FeatureSource` (§3.1–3.2).** Wraps the above so a
  triangle mesh renders through the *same* pipeline as the analytic primitives:
  `extractFeatures` (silhouette loops + chained creases + boundaries),
  `projectedSilhouettes` (for the QI crossing events), and Möller–Trumbore
  `raycast` (interpolated normals for shading, face normal for the front/back
  flag). Hidden-line visibility, wobble, variable width, and shading all come for
  free from the shared stage-2+ machinery (`examples/gallery/13-mesh.svg`).
- **`bvh.ts` — the raycast acceleration structure.** A lazily-built, binned-SAH
  bounding-volume hierarchy over the triangles, consumed by `Mesh.raycast`
  (17–21× on real models). It is **pure culling in front of an unchanged
  Möller–Trumbore** — it never decides what a hit *is*, only which triangles get
  asked — and rests on two claims: every face MT would accept is in the candidate
  set, and candidates arrive in **ascending face index**, so the array reaching
  the final sort is element-wise identical to a full scan's. **Over-inclusion
  costs only time; under-inclusion is the only possible bug.** Read the header
  before touching it: a *tight* triangle box is not a safe filter (MT's rounded
  barycentrics accept lines that exactly miss the box — hence the pad), and the
  textbook `1/dir` slab test has a NaN false-miss that the well-known
  operand-ordering fix only half-repairs. `new Mesh(input, { bvh: false })`
  linear-scans; `setBvhMode("verify")` runs both paths and throws on divergence.
- **`shapes.ts`** — indexed `tetrahedron` / `cube` / `grid` / `uvSphere` / `tube` /
  `torusMesh` / `bumpyBlob` / `knotTube` (parallel-transport-framed) / `gravitySheet`
  generators, plus `translate` / `rotate` for composing scenes. All CCW-outward. The
  two knotted tubes of `gallery/15` and the warped sheet of `gallery/16` use these.

**Visibility (§3.3.6) is an exact depth-buffer test:** the shared
`pipeline/visibility.ts` `isOccluded` casts the primary ray (eye → the point's
pixel, origin re-conditioned near the scene so analytic quartics keep their roots)
and occludes iff a surface is hit strictly nearer than the point — no ray-nudge.
The only irreducible tolerance is faceting: a mesh declares `selfNudge()` (≈0.75×
edge length) as the depth within which its own hits are "self", since a silhouette
point on one triangle can be a chord-sagitta nearer than the next facet. Smooth
analytic sources declare none and compare exactly.

- **`suggestive.ts` — suggestive contours (§3.3.5).** `suggestiveContours(mesh, cam,
  curvature)` extracts the zero-set of radial curvature on the front-facing surface
  where D_w κ_r exceeds a threshold (DeCarlo et al.), via the shared `zeroSetLoops`.
  Opt-in on `Mesh` (`{ suggestive }`); drawn as lighter form lines. (`gallery/14`)
- **`mesh-hatch.ts` — curvature-driven hatch field (§2.6).** `meshHatchField` traces
  **evenly-spaced streamlines** (Jobard–Lefebvre) of the principal-curvature
  direction field across the surface — sign-consistent line-field interpolation,
  umbilic stopping, face-to-face walking, **closed-loop detection** (many
  principal lines on a tube close on themselves), and a **normal-aware** spacing
  hash so a tube crossing over itself doesn't erase its own hatch. `Mesh.hatchField`
  returns the dir1/dir2 families so the scene's `clipHatchField` gives them
  visibility, tone, wobble, and width; it returns `[]` on isotropic surfaces (e.g. a
  sphere) so the scene falls back to straight hatch.

## Next (not yet built)

Temporal coherence (§3.3.7) — stable chain identity + coherent silhouettes across
frames. (An exact *contour projection* would let the depth-buffer QI drop even the
facet self-tolerance, but that's a smooth-surface refinement, not a blocker.)
