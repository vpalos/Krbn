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

## Rendering to PNG

SVGs open in any browser. To rasterize (e.g. for a README), use any SVG tool:

```bash
# ImageMagick, rsvg-convert, resvg, … — whatever you have
convert -background white -density 96 examples/gallery/03-depth-hatching.svg out.png
```
