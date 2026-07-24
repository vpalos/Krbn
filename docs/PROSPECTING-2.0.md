# Krbn 2.0 — a prospecting study

**Subject:** where the current pipeline spends its time, which stages can be optimized and how, and what WebAssembly, WebGL, and WebGPU can realistically contribute toward real-time animation.
**Basis:** full read of the Krbn source tree as of 2026-07-24 (src/, docs/, examples/, scripts/), plus a survey of the mid-2026 state of the relevant web platform features.
**Status:** prospecting notes, not a roadmap — nothing here is a commitment. Ideas that graduate move to [`ROADMAP.md`](ROADMAP.md), per the convention in [`IDEAS.md`](IDEAS.md).

---

## 1. The short version

The architecture is not the obstacle. The five-stage pass, the `FeatureSource` seam, and the "static scaffold, per-frame probe" discipline are exactly the shapes a fast engine wants; nothing needs to be re-architected to go fast. What needs to change is *how the probes are executed*: today every visibility question is asked one point at a time, through a call path that rebuilds per-frame constants on every call, recomputes whole silhouettes per feature, allocates on every ray, and never early-exits. The single function `isOccluded` (src/pipeline/visibility.ts) is, directly or indirectly, where almost the entire frame goes.

Three consequences follow. First, there is roughly an order of magnitude of speedup available in plain TypeScript, byte-identical, before any exotic technology enters the picture — the same kind of win the BVH already was. Second, WebAssembly is the right tool for the next constant factor because WASM float math is deterministic, so it can serve the project's exactness ethos; the GPU is not, so WebGL/WebGPU belong to a separately-defined *interactive regime* rather than to the archival renderer. Third, real-time is genuinely reachable: the analytic scenes are already within a stone's throw of 30 fps after the CPU work alone, and mesh scenes get there once occlusion queries are answered by a GPU depth/ID oracle instead of per-sample raycasts. Animated SVG, meanwhile, is best understood not as the real-time vehicle but as a premium *export format* — and the `FrameSession` persistent-identity machinery you already built is precisely the prerequisite it needs.

The one framing decision that unlocks everything cleanly: declare **two regimes** — *archival* (bit-exact, CPU/WASM, the diffable SVG that is the project's signature) and *interactive* (frame-budget-bound, GPU-assisted, allowed to diverge within a stated tolerance) — and let them share the entire pipeline except the occlusion oracle and the backend. This is the `bvhMode` idea ("on"/"off"/"verify") promoted from a switch into a design principle.

---

## 2. Where a frame actually goes — a cost model

### 2.1 The universal sink: `isOccluded`

Every stage that decides anything about visibility funnels into `isOccluded(p, cam, sources, scale)`, which casts the primary ray from the eye through the point's pixel and asks every source for *all* hits. Counting its call sites in a single `Scene.render`:

| Caller | Calls per frame (order of magnitude) |
|---|---|
| Grazing/cusp scan in `classifyFeature` | up to `min(4096, screenLen/4px)` per feature (`SCAN_STEP_PX = 4`, `SCAN_MAX = 4096`) |
| Bisection of each occlusion flip | ×26 per flip (`BISECT_ITERS = 26`) |
| Interval midpoint decisions | one per sub-interval |
| Straight-hatch clipping (`clipHatchTonal`) | one per 4 px of every hatch line of every tonal layer — plus a full owner `raycast` per sample for the surface hit |
| Field-hatch clipping (`clipHatchField`) | one per sample of every iso-curve of every family |
| Consolidation re-classification | a full `classifyFeature` per merged segment |
| Highlights | a full re-extract + re-classify per highlighted element |

For a moderately hatched 640×480 frame this is easily **tens of thousands of occlusion queries**, each of which loops over all sources and, for a mesh, walks the BVH, runs Möller–Trumbore on the candidates, allocates a `Hit` object per intersection, and sorts the hits — only for the caller to reduce all of that to a single boolean.

Per-call overheads compound it: each `isOccluded` call rebuilds `projectionMatrix(cam)`, calls `unproject`, and — as `docs/ROADMAP.md` already flags — re-unions every source's AABB via `sceneSphere(sources)` on *every single call*, a pure function of the static scaffold.

### 2.2 The quiet quadratic: per-feature silhouette recomputation

`classifyFeature` iterates `for (const s of sources) for (const sil of s.projectedSilhouettes(cam))` — inside the per-feature loop of `classifyScene`. For a mesh source, `projectedSilhouettes` runs the full interpolated zero-set extraction (`silhouetteLoops`, an O(faces) sweep) *every time it is asked*. A frame with one 18k-triangle mesh and forty features therefore extracts that mesh's silhouette forty-plus times — and then `hatchRegions` runs `silhouetteWorld` again, and the hatch clip's owner raycasts run beside it. This is almost certainly the second-largest cost in mesh scenes after raw ray counts, and it is pure recomputation of a value that is constant for the frame.

### 2.3 What is already cheap

Styling (wobble, width), emit sampling, and SVG string assembly are minor next to the above. The static scaffold (half-edge build, curvature, streamline atlas, BVH build) is paid once and amortizes exactly as designed. The temporal-coherence machinery (`FrameSession.reconcile`) is linear in feature count and negligible. In other words: stages 1–2 and the per-sample halves of stage 4 are the whole game; stages 3 and 5 are fine.

### 2.4 The measured baseline

From `README.md` / `bench:bvh` (post-BVH, full scene render including hidden lines + cross hatch): sphere 5.5k tris ≈ 0.09 s, torus 10.8k ≈ 0.29 s, heart 13k ≈ 1.3 s, fist 18.5k ≈ 3.2 s. Real time at 30 fps means a 33 ms budget: the sphere needs ~3×, the torus ~9×, the fist ~100×. Those are the numbers the tiers below should be read against. (And the docs' own caveat stands: the post-BVH residual k = 0.5–0.95 growth with density is algorithmic — feature count and silhouette length grow with tessellation — so constant-factor work moves the curve down, not flat.)

---

## 3. The constraint that shapes every choice: determinism

"The same scene always emits the same, byte-identical, diffable SVG" is a project value, and the BVH set the precedent for how performance work must behave: pure culling in front of an unchanged kernel, candidate order preserved, a `verify` mode that runs both paths and throws on divergence, and a zero-diff gallery regeneration as the acceptance gate.

Every technology on your list can be classified by what it does to that value:

| Approach | Determinism | Fit |
|---|---|---|
| JS constant-factor work (caching, any-hit, SoA) | bit-exact, provably | archival |
| Web Workers across independent work items | bit-exact if results are assembled in fixed index order | archival |
| WebAssembly (core spec, f64) | IEEE-754-deterministic by spec — same inputs, same op order, same bits, on every engine | archival (as a new fixed reference) |
| WASM *relaxed-SIMD* | explicitly non-deterministic (that is the proposal's whole point) | avoid |
| GPU rasterization / WebGL / WebGPU compute | f32 only, results vary across GPUs and drivers; no f64 in WGSL | interactive regime, or conservative-oracle pattern |

Hence the two-regime proposal. **Archival mode** is today's contract: CPU/WASM, f64, byte-diffable, the mode the gallery and pen plotters use. **Interactive mode** is a new contract: a frame budget, GPU assistance permitted, output required to agree with archival only within a stated screen-space tolerance (say, interval boundaries within the same ~4 px the cusp scan already concedes). Both regimes run the same five stages, the same styling, the same identity machinery; they differ only in *who answers the occlusion queries* and *who draws the strokes*. This keeps the soul of the project intact while giving animation a place to be fast.

---

## 4. Tier 0 — pay down the constant factor (plain TypeScript, byte-identical)

These require no new technology, cannot change output, and in aggregate are likely worth 3–10× on real scenes — more where mesh silhouette recomputation currently dominates.

**A per-frame cache of view-dependent products.** Introduce a small `FrameCtx` object created once per `Scene.render` and threaded through classification: it memoizes `projectionMatrix(cam)`, `sceneSphere(sources)`, `sceneScale`, and — critically — each source's `projectedSilhouettes(cam)`, world silhouette loops, and extracted features for the frame. This collapses the §2.2 quadratic to one extraction per source per frame. It is the largest single win available and it is pure bookkeeping. (The roadmap's "memoize `sceneSphere`" item is a special case of this.)

**An any-hit occlusion query.** `isOccluded` needs a boolean, but `raycast` delivers all hits, sorted, as freshly allocated objects. Add an optional `FeatureSource.occludes(ray, tMin, tMax): boolean` fast path: BVH traversal with early termination on the first accepting triangle in range, no `Hit` allocation, no sort. The boolean is order-independent, so early exit is *provably* byte-identical — this is the rare optimization that needs no ulp caution at all. Analytic sources get the same treatment trivially (a root in range, yes/no). Expect a large constant factor on exactly the hottest path; in classic ray tracers the any-hit/closest-hit split is worth several× on shadow-ray-heavy workloads, and Krbn's occlusion queries are precisely shadow rays.

**Scene-level pruning per ray.** The roadmap's scene-BVH-over-sources item — even a flat AABB slab test per source per ray prunes most sources in multi-object scenes. Combines multiplicatively with the any-hit path.

**Allocation discipline in the ray kernel.** `sub`/`cross` in Möller–Trumbore allocate ~6 tuples per candidate triangle per ray; hits allocate objects; `unproject` allocates. Rewriting the kernel over scalar locals and reusing a per-frame scratch is mechanical. The roadmap's caution is right — float op *order* must not change — but scalarizing tuple allocations does not reorder arithmetic, so this can be done bit-safely. This is also the necessary preparation for Tier 2: a struct-of-arrays core (positions already live in typed-array-friendly form in the BVH) is what a WASM port will want to share.

**Cheaper scans where the budget allows.** `BISECT_ITERS = 26` refines an occlusion flip to ~1.5e-8 of the parameter span; the interactive regime can run 10–12 iterations (sub-pixel at screen scale) and keep 26 for archival. Similarly the cusp scan can, under a `FrameSession`, seed itself from the previous frame's event set and scan finely only near previously-found boundaries — the events move continuously under camera motion, which is exactly what the coherence machinery guarantees. (This one *can* change output if done naively, so it belongs behind the regime switch, or must be made conservatively two-sided.)

---

## 5. Tier 1 — parallelism you already own: Web Workers

The per-frame work is an embarrassingly parallel bag of independent items: each feature's classification is independent of every other; each hatch line's clipping is independent of every other. A worker pool that partitions features (and hatch lines) by index and reassembles results in index order is **deterministic by construction** — scheduling cannot affect output because no item reads another's result. With `SharedArrayBuffer` + typed arrays for the static scaffold (positions, BVH arrays, curvature), the workers share memory rather than cloning meshes; that requires COOP/COEP headers in the browser but nothing at all under Bun for the CLI.

On a typical 8-core machine this is a further ~5–7× on the dominant stages. And for offline film rendering there is an even simpler axis: frames are independent given the session's reconcile order — a two-pass scheme (extract + reconcile serially, which is cheap; classify + style in parallel across frames) parallelizes the 60-frame orbit almost perfectly.

Taken together, Tiers 0+1 plausibly bring the torus scene (0.29 s) into the 5–15 ms range and the fist (3.2 s) into the 100–300 ms range — the analytic gallery becomes real-time outright, heavy meshes become "responsive scrubbing" but not yet 30 fps.

---

## 6. Tier 2 — WebAssembly: the deterministic constant factor

The key fact, and it is worth stating precisely because it decides the architecture: **core WebAssembly floating-point is fully deterministic** — f64 add/mul/div/sqrt are IEEE-754-exact, and the fixed-width SIMD proposal was deliberately specified to keep that property (the later *relaxed-SIMD* proposal exists precisely to trade it away; Krbn should simply not use relaxed ops). A WASM kernel therefore produces the same bits on every engine, every platform — something JS JITs also do in practice for this kind of code, but WASM makes it a spec guarantee and, more importantly, makes the *same binary* the reference for web, Bun, and Node alike.

The honest caveat: a WASM port will not be bit-identical *to the current JS* unless every operation order is preserved, which is an unreasonable constraint to carry. The right move mirrors what a compiler upgrade would force anyway: land the kernel behind a `verify`-style parity mode, regenerate the gallery once, review the visual diff (it will be invisible — same algorithms, same f64), and declare the WASM path the new archival reference.

What belongs in the kernel, in order of value: the any-hit and closest-hit ray casts (BVH traversal + Möller–Trumbore over SoA buffers, batched — accept a few thousand rays per call to amortize the JS↔WASM boundary, which is the classic mistake to avoid); the polynomial solvers (`curve/roots.ts` — quartics for the torus are hot in `isOccluded`); the conic–conic/line–conic intersector; and the mesh zero-set extraction (a per-face independent sweep, very SIMD-friendly). Language-wise Rust or C both serve; the deciding factor is comfort, since the kernels are small, allocation-free, and interface over flat `Float64Array`s either way. Realistic expectation on top of Tier 0/1: another 2–4× on the kernels' share, with SIMD doing the heavy lifting on batched slab tests and triangle tests.

---

## 7. Tier 3 — the GPU as a conservative oracle (the BVH move, generalized)

Here is the deepest way to think about your WebGL/WebGPU question. The BVH succeeded because it was *culling in front of an unchanged exact test* — over-inclusion cost time, never correctness. There is a GPU strategy with the same moral shape.

Once per frame, rasterize the whole scene into an offscreen **depth + source-ID buffer** (analytic surfaces tessellated at a bounded-sagitta resolution; meshes are their own exact geometry). Then every occlusion query becomes: project the point, read the depth texel, and compare. Three outcomes: *clearly visible* (point depth well in front of the buffer value, margin exceeding the tessellation-error + f32 bound), *clearly hidden* (well behind), or *ambiguous* (within the band — near silhouettes, creases, grazing contacts). The clear cases are answered by the lookup; the ambiguous band — a few percent of queries, concentrated exactly where the interesting boundaries are — falls back to the exact CPU/WASM raycast. Bisection refinement lands in the band by definition, so the exact kernel still owns every boundary that ends up in the output.

If the conservative bands are honored, the *decisions* are identical and the output remains byte-identical — Claim A again, over-inclusion (falling back too often) costs only time. The engineering caution is that proving the band across GPU drivers, f32 depth precision, and tessellation error takes real care; the pragmatic sequencing is to ship it in the interactive regime first, with a `verify` sweep (run oracle and exact side by side, log disagreements) as the promotion gate to archival, exactly as `setBvhMode("verify")` did.

The same buffer solves the hatch problem wholesale, and hatch is where hatched scenes spend most of their rays: one rasterization delivers, at every hatch sample, the owner-surface hit (ID + depth), the interpolated normal (a normal G-buffer), hence `N·L`, front-facing, and occlusion — the entire per-sample body of `clipHatchTonal`/`clipHatchField` collapses into texture reads, or moves onto the GPU entirely as a compute pass over sample buffers. This is the single biggest lever for the fist-class scenes: it is precisely the triangles × rays product the README names, with the rays term removed from the CPU.

WebGL2 suffices for the raster oracle (depth + MRT ID/normal targets, readback via PBO); WebGPU does it more comfortably (storage buffers, compute for the band classification, no readback stalls with proper pipelining). Given it is 2026 and WebGPU has shipped across Chrome/Edge (since 2023), Firefox (2025), and Safari (2025), starting WebGPU-first with a WebGL2 fallback is defensible; for an offline CLI under Bun, the oracle is optional and the WASM path carries archival rendering regardless.

---

## 8. Tier 4 — WebGPU compute end-to-end (the interactive frontier)

Beyond the oracle pattern, WebGPU compute can absorb whole stages in the interactive regime: batched ray wavefronts against the BVH (the BVH arrays are already flat typed arrays — they upload as-is), the silhouette zero-set as a per-face kernel with stream compaction, suggestive-contour tests, hatch-sample shading, even the bisection loops as data-parallel binary searches over event buckets. This is where "hardware acceleration" pays fully: tens of millions of ray-box/ray-triangle tests per frame are routine on integrated GPUs.

Two hard limits keep this out of the archival path, and they are worth internalizing rather than fighting. **WGSL has no f64** — f32 everywhere, optionally f16; double-precision emulation (two-float tricks) costs 5–20× and defeats the purpose. At Krbn's scene scales (units-sized geometry, ~1e2 px viewports) f32 is comfortably sufficient for *display*, but it is not the archival contract. **GPU results are not reproducible across vendors/drivers** — op fusion, reduction order, and transcendental implementations vary. So: Tier 4 is the 60 fps orbit viewer, the live authoring preview, the embedded interactive figure — while the exact CPU/WASM pipeline remains the thing that writes the SVG file.

On the output side the same regime wants a **stroke renderer**: strokes as instanced ribbon/quad strips (the `ribbon()` offsetting moved to a vertex shader), width and dash and opacity as per-instance attributes, wobble optionally evaluated in-shader from the same seeds. 10⁵ strokes at 60 fps is trivial for this kind of renderer. Importantly, this slots in *behind the existing emit contract* — `RenderStroke` is already backend-agnostic, and DESIGN §4 anticipated exactly this ("Canvas/WebGL later for high stroke counts").

---

## 9. Real-time animation: the budget, honestly

Putting the tiers against the measured baseline (single frame, full pipeline, rough multipliers, not additive marketing math — the tiers overlap):

| Scene | Today | Tier 0+1 (CPU) | + Tier 2 (WASM) | + Tier 3 (GPU oracle) |
|---|---|---|---|---|
| analytic gallery scenes | ~10–100 ms | real-time | comfortably real-time | — |
| torus 10.8k | 290 ms | ~20–50 ms | ~10–25 ms | 60 fps class |
| fist 18.5k, hatched | 3 200 ms | ~300–600 ms | ~150–300 ms | ~30–60 ms plausible |

The second lever real-time animation gets for free is **temporal amortization**, and Krbn is unusually well positioned for it because `FrameSession` already maintains stroke identity: visibility events, silhouette chains, and hatch clip runs all move continuously under camera motion, so each frame can start from the previous frame's answers and refine, rather than recompute from silence. (Warm-started scans, event tracking, incremental interval updates — all natural extensions of the reconcile seam, all interactive-regime material initially.)

And a caution the docs already articulate: the residual growth with mesh density is algorithmic. If organic scenes get much denser, the research-grade fix is sublinear silhouette *extraction* — normal-cone hierarchies over the mesh (a spatialized bound on where `n·v` can change sign) prune the zero-set sweep the way the BVH pruned rays. That is the one genuinely new data structure Krbn 2.0 might eventually want; everything else in this document is reorganization and porting.

One thing real-time explicitly should *not* use: per-frame SVG. Rebuilding thousands of DOM nodes at 60 fps is a DOM benchmark, not a renderer. Live output goes to Canvas2D (adequate to a few thousand strokes) or the Tier-4 WebGL/WebGPU stroke renderer; SVG remains what it is best at — the exact, archival, printable artifact.

---

## 10. Animated SVG — the right role for it

Animated SVG is worth building, but as an **export format for offline renders**, not as the real-time engine. The decisive observation is that the hard prerequisite — knowing *which stroke in frame k+1 is the same stroke as in frame k* — is exactly what `FrameSession` already computes and tests (zero id churn across the orbit, per `animation-coherence.test.ts`). No other NPR system I know of hands its exporter that gift; for most, stroke correspondence is the research problem.

The mechanics: group each persistent id's per-frame polylines into a track; resample every frame of a track to a common vertex count (required — SMIL/CSS `d` interpolation only works across paths with identical command structure); emit one `<path>` per track with a `<animate attributeName="d" values="…" keyTimes="…">` (SMIL — undeprecated, supported in all current engines) or a CSS `@keyframes { d: path(…) }` equivalent; births and deaths ride opacity keyframes, which is aesthetically exactly the threshold-fade behavior the pipeline already prefers over popping. Dash phase and width tracks can animate the same way where needed.

Size is the real constraint. The current 60-frame orbit is ~124 KB × 60 ≈ 7.4 MB of frame SVGs; a track-based file de-duplicates all styling and structure but keeps the coordinate streams, so expect low single-digit MB raw, likely well under 1 MB gzipped after precision trimming (2 decimals), fixed-count resampling, and keyframe thinning (animate at 6–8 keyframes/s with SMIL's built-in interpolation, not 30). That is: viable and attractive for a hero loop embedded in a page or a README — self-contained, resolution-independent, no JS — and not the format for minutes of content or for interactivity. A useful intermediate is SVG + a 20-line JS scrubber swapping `d` values from a JSON of tracks, which drops SMIL's constraints while keeping vector crispness.

For completeness, the export ladder is: frame PNGs → GIF/WebM (works today), flipbook HTML (works today), animated SVG (new, premium, needs the track exporter), interactive canvas embed (Tier 4's little sibling — ship the strokes as JSON tracks and draw on canvas).

---

## 11. What these technologies will not give you

A candid list, so prospecting stays honest. No GPU path gives you f64 or cross-device reproducibility — the archival renderer stays on CPU/WASM forever, and that is a feature, not a defeat. No amount of constant-factor work removes the density residual — silhouette length and feature count grow with tessellation; only smarter extraction (normal cones) or decimation addresses that. Animated SVG will not scale to long or dense sequences — file size is linear in strokes × keyframes, full stop. WASM will not magically beat the JIT on this codebase without the SoA/batching refactor — the boundary-crossing tax is real, and small chatty calls are slower than JS. And workers buy nothing until the per-call recomputation of Tier 0 is fixed — parallelizing redundant work just heats more cores.

---

## 12. A suggested shape for Krbn 2.0

Phased so that every step has a measurable gate in the project's own style (byte-compare, verify sweeps, the bench harness):

**Phase A — the free lunch (archival, byte-identical).** Frame-context caching of per-frame constants and per-source silhouettes; any-hit occlusion query with BVH early-out; scene-level AABB pruning; allocation-free ray kernel. Gate: `bench:bvh` extended into `bench:frame` (per-stage timers), gallery + animation byte-identical. Expected: ~3–10× on mesh scenes.

**Phase B — parallel archival.** SoA scaffold shared via `SharedArrayBuffer`; worker pool over features and hatch lines with index-ordered assembly; frame-parallel film rendering in the CLI. Gate: byte-identical, near-linear scaling on the film render. Expected: ~cores× on top.

**Phase C — the WASM kernel.** Batched ray casts, root solvers, conic intersector, zero-set sweep; parity mode against JS during bring-up; then the WASM path becomes the archival reference (one deliberate gallery regeneration). Gate: verify-mode clean across gallery + 121 frames; same binary under Bun and browser.

**Phase D — the interactive regime (the headline of 2.0).** The regime switch itself (budgeted scan/bisection settings); the WebGPU/WebGL2 depth+ID oracle with conservative bands and exact fallback; the canvas/WebGPU stroke renderer behind the emit contract; live orbit viewer as the demo. Gate: 30 fps on the torus scene on an integrated GPU; oracle `verify` sweep logging zero decision flips outside the declared band.

**Phase E — the animated-SVG exporter.** Track builder over `FrameSession` output, fixed-count resampling, SMIL + CSS emitters, size budget tooling. Gate: the README orbit as one self-contained SVG under ~1 MB gzipped, visually indistinguishable from the flipbook.

**Phase F — research reserve.** Normal-cone hierarchy for sublinear silhouettes; temporal warm-starting of visibility events; WebGPU compute wavefronts if Phase D's oracle proves insufficient for the densest organics.

Phases A–C never leave the project's current values; Phase D is where "Krbn 2.0" earns the version bump by *adding a second contract* rather than bending the first.

---

## Sources

Code and documents referenced (this repository):
[`README.md`](../README.md) · [`docs/DESIGN.md`](DESIGN.md) · [`docs/ROADMAP.md`](ROADMAP.md) · [`docs/IDEAS.md`](IDEAS.md) · [`src/pipeline/visibility.ts`](../src/pipeline/visibility.ts) · [`src/scene/scene.ts`](../src/scene/scene.ts) · [`src/mesh/bvh.ts`](../src/mesh/bvh.ts) · [`src/mesh/mesh-source.ts`](../src/mesh/mesh-source.ts) · [`src/backend/svg.ts`](../src/backend/svg.ts) · [`src/pipeline/emit.ts`](../src/pipeline/emit.ts) · [`examples/animation.krbn.ts`](../examples/animation.krbn.ts)

Web (platform status, July 2026):
[WebGPU is now supported in major browsers — web.dev](https://web.dev/blog/webgpu-supported-major-browsers) · [WebGPU browser support in 2026 — webo360solutions](https://webo360solutions.com/blog/webgpu-browser-support/) · [Double-precision floats in WGSL — gpuweb issue #2805](https://github.com/gpuweb/gpuweb/issues/2805) · [Intent to Ship: WebGPU f16 — blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/AsKn-UwMYAE) · [WebAssembly SIMD proposal (deterministic semantics)](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md) · [WebAssembly relaxed-simd (the non-deterministic variant to avoid)](https://github.com/WebAssembly/relaxed-simd) · [SVG animation with SMIL — MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_animation_with_SMIL) · [Guide to SVG SMIL animations — CSS-Tricks](https://css-tricks.com/guide-svg-animations-smil/)
