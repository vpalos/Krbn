# Krbn

**Carbon, with the vowels sketched out.** A web engine for non-photorealistic,
pencil-style rendering of abstract and technical scenes — math and physics
constructions today, medical/organic illustration on the roadmap.

Krbn does not "render surfaces." It derives, classifies, and styles **strokes**
and **hatch regions** from geometry, so a scene reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

> **Status: pre-alpha, actively building (updated 2026-07-05).** The math kernel,
> the **exact conic intersection kernel**, and the full analytic **primitive
> catalog** (Quadric → Sphere/Ellipsoid/Cylinder/Cone, Plane/Polygon, Line,
> ParametricCurve) are implemented and tested. Still to come: the `Scene` /
> importance model and the runnable five-stage pass + backend. Next up is stage 2,
> exact hidden-line visibility. See [`ai/ROADMAP.md`](ai/ROADMAP.md) for the
> annotated build status.

## Why it works this way

- **Strokes are the core object.** Every visual requirement is a policy over the
  stroke set, not a shading model.
- **Transparency without alpha.** Cross-hatching is inherently see-through: the
  gaps reveal the ghosted hidden edges behind. Alpha is an optional later add.
- **Analytic primitives first.** For quadrics, silhouettes are exact conics and
  hidden-line visibility is exact — the hardest module is _easier_ here, not
  skipped. Meshes come later behind the same interface.
- **Author supplies semantics, engine supplies mechanics.** The developer marks
  what matters (importance/focus); the engine draws at the right level of detail.

## Architecture at a glance

A scene is a set of `FeatureSource`s. Each frame runs a five-stage pass:

1. **Feature extraction** — silhouettes, creases, boundaries, suggestive &
   intersection curves, plus hatch regions.
2. **Visibility classification** — split each curve into visible/hidden intervals.
3. **Abstraction filter** — drop sub-threshold detail, consolidate, apply importance.
4. **Styling** — weight, seeded wobble, dash, ghost, hatch density.
5. **Emit** — sample analytic curves and hand to the backend (SVG first).

Full detail, contracts, and the mesh/organ roadmap live in
[`ai/DESIGN.md`](ai/DESIGN.md). A short phase view is in [`ai/ROADMAP.md`](ai/ROADMAP.md).

## Project layout

```
src/
  math/        vectors, Mat3/Mat4, Basis, AABB, Camera + projection
  curve/       Curve / Curve2D carriers + exact conic kernel, root solvers, sampler
  pipeline/    inter-stage contract: Feature, Stroke, HatchRegion, RenderStroke
  scene/       the FeatureSource seam (+ Scene / element model, coming next)
  primitives/  analytic primitives (Quadric, Sphere, Cylinder, Cone, Plane, Line, …)
  backend/     renderers (SVG first — not started)
  mesh/        deferred organ/mesh regime — see ai/DESIGN.md §3
ai/DESIGN.md the full design & roadmap
```

## Development

```bash
bun install
bun run typecheck
bun run build
bun test
```

## Next build target

Stage 2 — exact **hidden-line visibility** (Appel's quantitative invisibility):
walk each projected curve, flipping a visible/hidden count at silhouette
crossings, to produce visible/hidden intervals. The kernel it rests on (exact
conic crossings) and the per-primitive `projectedSilhouettes` / `raycast` inputs
are already in place. The `Scene` / element / importance model is the other open
foundation piece.

## License

MIT — see [`LICENSE`](LICENSE). Update the copyright holder to your name/org.
