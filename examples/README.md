# Examples

Runnable demos that render Krbn scenes to SVG. All output is deterministic
(wobble is seeded, no randomness), so the SVGs are stable and diffable.

## Gallery

One script renders the feature gallery:

```bash
bun run examples/gallery.ts
```

It writes to `examples/gallery/`:

| File | Feature | What to look for |
|------|---------|------------------|
| `01-hidden-lines.svg` | Exact hidden-line visibility (stage 2) | The cylinder's far rim halves are **dashed** (self-occlusion); the sphere's silhouette is **solid where it juts past** the cylinder and **dashed where hidden** behind it; the rod is dashed only where it passes through the body. |
| `02-hatching.svg` | Hatching + tonal shading (stage 4) | Three spheres — single / cross / triple — each shading **light→dark** from a highlight into the shadow; the flat quad hatches **uniformly** (constant normal). |
| `03-depth-hatching.svg` | Hatching with depth + intersection curve | A ball half-submerged through a plane: the exact **waterline** (sphere ∩ plane) is bold and **dashed on its hidden back arc**; the plane's hatch **stops where the ball occludes it** (gaps reveal depth); hatch tone is quantized. |
| `04-wobble.svg` | Seeded coherent wobble | The same cone at wobble `0 → 1` (ruler → hand-drawn). At every amount the **apex stays a single clean point** and rulings meet the rim exactly — the offset is a seeded field keyed on the 3-D point, so strokes sharing a vertex join. |
| `05-solid-shading.svg` | Surface hatching on all quadric solids | A 3×3 grid: **rows** are single / cross / triple hatch (1 / 2 / 3 tonal layers, top→bottom), **columns** are cone / cylinder / sphere. Each is surface-hatched and shaded **light→dark** — adding layers deepens the tone. |
| `06-highlight.svg` | `scene.highlight` (x-ray emphasis) | A sphere behind a cylinder, highlighted: a thin crisp outline inside a thick **semi-transparent halo**, redrawn **on top**, **solid where exposed** and **dashed where the cylinder hides it**. |
| `07-points.svg` | `Point` primitive | Camera-facing marks (× crosses and a dot ring), occludable like any feature — the one behind the sphere is ghosted away. |
| `08-quartic.svg` | Quadric ∩ quadric quartic | An ellipsoid meeting a sphere; their quartic intersection is traced (plane-sweep + conic∩conic) and drawn as a bold loop, **solid where visible, dashed where behind** the surfaces. |
| `09-consolidation.svg` | Cross-primitive consolidation (off vs on) | Three coincident wobbled rods. **Off**: different per-element seeds make them weave into a tangle. **On**: they merge into one clean line (`abstraction.consolidate`). |

## Rendering to PNG

SVGs open in any browser. To rasterize (e.g. for a README), use any SVG tool:

```bash
# ImageMagick, rsvg-convert, resvg, … — whatever you have
convert -background white -density 96 examples/gallery/03-depth-hatching.svg out.png
```
