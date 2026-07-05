# Krbn

**Carbon, with the vowels sketched out.** A web engine for non-photorealistic,
pencil-style rendering of abstract and technical scenes — math and physics
constructions today, medical/organic illustration on the roadmap.

Krbn does not "render surfaces." It derives, classifies, and styles **strokes**
and **hatch regions** from geometry, so a scene reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

> **Status: pre-alpha scaffold.** The typed spine (the `FeatureSource` seam and the
> inter-stage contract) is in place and matches the design. Implementations land
> next, starting with the math + curve kernel.

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
  math/        core geometric types (Vec3, Basis, Camera, Ray, …)
  curve/       Curve / Curve2D carriers (analytic until emit) + conic params
  pipeline/    inter-stage contract: Feature, Stroke, HatchRegion, RenderStroke
  scene/       the FeatureSource seam (+ Scene / element model, coming next)
  primitives/  analytic primitives (Quadric, Sphere, Cylinder, Cone, Plane, …)
  backend/     renderers (SVG first)
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

The exact **conic intersection kernel** (`curve/` — line–conic and conic–conic,
robust at near-tangent and coincident cases). Exact visibility rests on it, so it
is the first thing to implement and the first thing to test to death.

## License

MIT — see [`LICENSE`](LICENSE). Update the copyright holder to your name/org.
