# Krbn

**Carbon, with the vowels sketched out.** A web engine for non-photorealistic,
pencil-style rendering of abstract and technical scenes — math and physics
constructions today, medical/organic illustration on the roadmap.

Krbn does not "render surfaces." It derives, classifies, and styles **strokes**
and **hatch regions** from geometry, so a scene reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

![a ball half-submerged through a hatched plane](examples/gallery/03-depth-hatching.svg)

_More in the [example gallery](examples/README.md)._

> **Status & roadmap** live in one place, not here: **[`ai/ROADMAP.md`](ai/ROADMAP.md)**
> holds the annotated build status and polish backlog, and
> **[`ai/DESIGN.md`](ai/DESIGN.md)** holds the design, the implementation-status
> breakdown, and the hard-parts registry. This README stays high-level.

## Features

- **Analytic primitives.** Sphere, ellipsoid, cylinder, cone (quadric
  configurations with exact conic silhouettes), plane / polygon, line, parametric
  curve (Bézier / helix / function plot), a camera-facing point, and a torus (the
  one non-quadric — quartic silhouette + real quartic ray solve). All behind one
  `FeatureSource` seam.
- **Exact hidden-line visibility.** Appel-style quantitative invisibility splits
  every curve into visible / hidden intervals from analytic silhouette crossings +
  closed-form depth; hidden runs are ghosted / dashed, and even points are occludable.
- **Intersection curves.** First-class "waterline" features — quadric ∩ plane
  (conic), sphere ∩ sphere (circle), plane ∩ plane (line), and quadric ∩ quadric
  (quartic) — flowing through visibility and styling like any other stroke.
- **Hatching & tonal shading.** One / two / three families (single / cross /
  triple), tonally layered so curved surfaces shade **light→dark** while flat faces
  stay uniform; density follows tone.
- **Curved hatch direction fields.** Each primitive can hatch along its own **exact
  iso-parameter curves** — cylinder rings + rulings, cone rings + generators, torus
  poloidal + toroidal, sphere / ellipsoid principal cross-sections — with a
  straight-parallel fallback, toggled per element.
- **Hand-drawn wobble.** A seeded, coherence-preserving 3-D noise field bends
  outlines **and** hatch from a single per-element knob; strokes sharing a vertex
  still meet, and output stays deterministic.
- **Variable stroke width.** Solid strokes render as filled ribbons whose width
  combines emphasis (role / importance × camera depth — nearer is bolder), a
  calligraphic end taper, and seeded pencil pressure (taper + pressure ride the same
  wobble knob).
- **Abstraction.** Importance-scaled screen-size thresholding, tone quantization,
  and cross-primitive consolidation of coincident lines.
- **Emphasis & highlight.** Role / importance-driven weights and `scene.highlight`
  for x-ray emphasis — a crisp on-top outline inside a semi-transparent halo, dashed
  where hidden.
- **Deterministic SVG output.** A pure SVG backend; seeded wobble keeps files stable
  and diffable.

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
4. **Styling** — weight, seeded wobble (lines + hatch), variable stroke width,
   dash, ghost, hatch density.
5. **Emit** — sample analytic curves and hand to the backend (SVG first).

Full detail, contracts, and the mesh/organ roadmap live in
[`ai/DESIGN.md`](ai/DESIGN.md). A short phase view is in [`ai/ROADMAP.md`](ai/ROADMAP.md).

## Project layout

```
src/
  math/        vectors, Mat3/Mat4, Basis, AABB, Camera + projection/unproject
  curve/       Curve / Curve2D carriers + exact conic kernel, root solvers, sampler
  pipeline/    contract types, visibility, styling (wobble/width/hatch), emit, render
  scene/       the FeatureSource seam + Scene / element / importance model
  primitives/  analytic primitives (Quadric→Sphere/Ellipsoid/Cylinder/Cone, Plane,
               Polygon, Line, ParametricCurve, Point, Torus)
  backend/     renderers — SVG (implemented)
  mesh/        deferred organ/mesh regime — see ai/DESIGN.md §3
examples/    runnable demos → *.svg (demo, styled, waterline)
ai/DESIGN.md the full design & roadmap
```

## Development

```bash
bun install
bun run typecheck
bun run build
bun test
```

## License

MIT — see [`LICENSE`](LICENSE). Update the copyright holder to your name/org.
