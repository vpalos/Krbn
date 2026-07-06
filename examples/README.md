# Examples

Runnable demos that render Krbn scenes to SVG. All output is deterministic
(wobble is seeded, no randomness), so the SVGs are stable and diffable.

## Gallery

Run with:

```bash
bun run examples/gallery.ts
```

### 01 · Exact hidden-line visibility (stage 2)

![hidden lines](gallery/01-hidden-lines.svg)

The cylinder's far rim halves are **dashed** (self-occlusion); the sphere's
silhouette is **solid where it juts past** the cylinder and **dashed where
hidden** behind it; the rod is dashed only where it passes through the body.

### 02 · Hatching + tonal shading (stage 4)

![hatching](gallery/02-hatching.svg)

Three spheres — **1 / 2 / 3 layers** (single / cross / triple) — each shading
**light→dark** from a highlight into the shadow; the flat quad hatches
**uniformly** (constant normal).

### 03 · Hatching with depth + intersection curve

![depth hatching](gallery/03-depth-hatching.svg)

A ball half-submerged through a plane: the exact **waterline** (sphere ∩ plane)
is bold and **dashed on its hidden back arc**; the plane's hatch **stops where
the ball occludes it** (gaps reveal depth); hatch tone is quantized.

### 04 · Seeded coherent wobble

![wobble sweep](gallery/04-wobble.svg)

The same cone at wobble `0 → 1` (ruler → hand-drawn). At every amount the **apex
stays a single clean point** and rulings meet the rim exactly — the offset is a
seeded field keyed on the 3-D point, so strokes sharing a vertex join.

### 05 · Surface hatching on all quadric solids

![solid shading](gallery/05-solid-shading.svg)

A 3×3 grid: **rows** are 1 / 2 / 3 layers (single / cross / triple), **columns**
are cone / cylinder / sphere. Each is surface-hatched and shaded **light→dark** —
adding layers deepens the tone. This is the **straight-parallel** baseline
(`hatch.field: false`); the curved direction field gets its own showcase in
[demo 12](#12--curved-hatch-direction-fields).

### 06 · `scene.highlight` (x-ray emphasis)

![highlight](gallery/06-highlight.svg)

Two rows (**wobble off / on**). A sphere behind a cylinder, highlighted: a thin
crisp outline inside a thick **semi-transparent halo**, redrawn **on top**,
**solid where exposed** and **dashed where the cylinder hides it**.

### 07 · `Point` primitive

![points](gallery/07-points.svg)

Camera-facing marks (× crosses and a dot ring), occludable like any feature — the
one behind the sphere is ghosted away.

### 08 · Quadric ∩ quadric quartic

![quartic](gallery/08-quartic.svg)

A 2×2 grid: **rows** are wobble off / on, **columns** are wireframe / shaded. An
ellipsoid meeting a sphere; their quartic intersection is traced (plane-sweep +
conic∩conic, Newton-refined) and drawn as a bold loop, **solid where visible,
dashed where behind** the surfaces. The shaded column hatches both quadrics (with
mutual occlusion) under the same intersection curve.

### 09 · Cross-primitive consolidation (off vs on)

![consolidation](gallery/09-consolidation.svg)

Three coincident wobbled rods. **Off**: different per-element seeds make them
weave into a tangle. **On**: they merge into one clean line
(`abstraction.consolidate`).

### 10 · Torus (the one non-quadric primitive)

![torus](gallery/10-torus.svg)

A 2×2 grid: **rows** are wobble off / on, **columns** are the **curved field** vs
**flat** parallel hatch. The torus silhouette is a **quartic** image curve,
extracted numerically from the implicit form as two contour loops (outer + hole).
The outer outline is solid; the hole rim is **solid on its near arc and dashed on
the far arc** where the tube hides it. Ray-torus is a genuine quartic. In the
curved column the tube is hatched along its **exact poloidal + toroidal direction
field** (§2.6) — the hatch lines are the surface's own iso-parameter circles, so
they wrap the tube and each one's hidden half drops out of the front-face +
occlusion test; the flat column (`hatch.field: false`) shows the same shading with
straight parallels for comparison.

### 11 · Two interlocking toruses

![two toruses](gallery/11-tori.svg)

Two toruses threaded through each other like chain links, each cross-hatched and
wobbled — **curved field** (left) vs **flat** parallels (right). **Mutual
occlusion** falls straight out of the visibility stage — each torus dashes the
other's hidden silhouette and stops its hatch where the other is in front — so the
compound figure reads correctly with no special handling. The curved field makes
the linked tubes read as solid form; the flat hatch reads like a decal, which is
exactly why the field matters.

### 12 · Curved hatch direction fields

![direction fields](gallery/12-direction-fields.svg)

The hatch lines are the surface's **exact iso-parameter curves**, not straight
parallels. **Left**: one family (cylinder/cone rings, torus poloidal loops).
**Right**: cross-hatch — the second family added (axial rulings, apex generators,
toroidal loops). Each curve is drawn only where it is front-facing and unoccluded,
so its hidden half drops out of the same visibility test as everything else.

## Rendering to PNG

SVGs open in any browser. To rasterize (e.g. for a README), use any SVG tool:

```bash
# ImageMagick, rsvg-convert, resvg, … — whatever you have
convert -background white -density 96 examples/gallery/03-depth-hatching.svg out.png
```
