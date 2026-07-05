# Examples

Runnable demos that render Krbn scenes to SVG. All output is deterministic
(wobble is seeded, no randomness), so the SVGs are stable and diffable.

## Gallery

Rendered by one deterministic script (wobble is seeded, so the SVGs are stable
and diffable):

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
adding layers deepens the tone.

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

Two rows (**wobble off / on**). An ellipsoid meeting a sphere; their quartic
intersection is traced (plane-sweep + conic∩conic, Newton-refined) and drawn as a
bold loop, **solid where visible, dashed where behind** the surfaces.

### 09 · Cross-primitive consolidation (off vs on)

![consolidation](gallery/09-consolidation.svg)

Three coincident wobbled rods. **Off**: different per-element seeds make them
weave into a tangle. **On**: they merge into one clean line
(`abstraction.consolidate`).

### 10 · Torus (the one non-quadric primitive)

![torus](gallery/10-torus.svg)

Two rows (**wobble off / on**). The torus silhouette is a **quartic** image curve,
extracted numerically from the implicit form as two contour loops (outer + hole).
The outer outline is solid; the hole rim is **solid on its near arc and dashed on
the far arc** where the tube hides it. Ray-torus is a genuine quartic. The tube is
surface-hatched and shaded like the spheres, with the **hole left empty** (the
hatch region is the annulus between the two loops, via an even–odd hole clip).

## Rendering to PNG

SVGs open in any browser. To rasterize (e.g. for a README), use any SVG tool:

```bash
# ImageMagick, rsvg-convert, resvg, … — whatever you have
convert -background white -density 96 examples/gallery/03-depth-hatching.svg out.png
```
