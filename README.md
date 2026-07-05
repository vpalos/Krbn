# Krbn

**Carbon, with the vowels sketched out.** A web engine for non-photorealistic,
pencil-style rendering of abstract and technical scenes — math and physics
constructions today, medical/organic illustration on the roadmap.

Krbn does not "render surfaces." It derives, classifies, and styles **strokes**
and **hatch regions** from geometry, so a scene reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

> **Status: pre-alpha, actively building (updated 2026-07-05).** The math kernel,
> the **exact conic intersection kernel**, the full analytic **primitive catalog**
> (Quadric → Sphere/Ellipsoid/Cylinder/Cone, Plane/Polygon, Line, ParametricCurve),
> **stage 2 — exact hidden-line visibility**, **stage 4 — styling** (seeded
> wobble, ghosted hidden lines, hatching), the **`Scene` / importance model**, and
> an **SVG backend** are implemented and tested — see
> [`examples/styled.svg`](examples/styled.svg). Still to come: intersection-curve
> features and stage-3 abstraction. See [`ai/ROADMAP.md`](ai/ROADMAP.md) for the
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
  math/        vectors, Mat3/Mat4, Basis, AABB, Camera + projection/unproject
  curve/       Curve / Curve2D carriers + exact conic kernel, root solvers, sampler
  pipeline/    contract types, visibility, styling (wobble/hatch), emit, render
  scene/       the FeatureSource seam + Scene / element / importance model
  primitives/  analytic primitives (Quadric, Sphere, Cylinder, Cone, Plane, Line, …)
  backend/     renderers — SVG (implemented)
  mesh/        deferred organ/mesh regime — see ai/DESIGN.md §3
examples/    runnable demo scene → demo.svg
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

**Intersection-curve features** (sphere ∩ plane = circle, quadric ∩ quadric =
quartic) — first-class `Feature`s that flow straight into the visibility
classifier and styling — and **stage-3 abstraction** (screen-size thresholding,
tone quantization, importance-driven level of detail), which makes `importance`
fully live.

## License

MIT — see [`LICENSE`](LICENSE). Update the copyright holder to your name/org.
