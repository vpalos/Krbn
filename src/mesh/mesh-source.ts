// Phase-2 step 4: the mesh `FeatureSource` (docs/DESIGN.md §3.1–3.2).
//
// This is the payoff of the shared seam: a triangle mesh is *one more*
// implementation of the same interface the analytic primitives use. Because
// everything from the stage-2 contract onward (visibility, abstraction, styling,
// backend) is generic over `raycast` + `projectedSilhouettes`, a mesh that
// supplies those renders through the existing pipeline — hidden-line visibility
// included — with no fork.
//
// Features produced: the view-dependent **silhouette** (interpolated zero-set,
// chained) plus the view-independent **creases** (sharp dihedral edges) and
// **boundaries** (open edges), each as chained polyline `Curve`s.

import type { AABB, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { cross, dot, normalize, sub } from "../math/vec3.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { HalfEdgeMesh, type BuildOptions, type MeshInput } from "./halfedge.js";
import { chainVertexEdges, facetedSilhouetteLoops, silhouetteChains, silhouetteLoops } from "./silhouette.js";
import { computeCurvature, type CurvatureField } from "./curvature.js";
import { StreamlineAtlas } from "./mesh-hatch.js";
import { suggestiveContourChains } from "./suggestive.js";
import { autoName } from "../scene/auto-id.js";
import { EPS_ABS } from "../curve/epsilon.js";

export interface MeshOptions extends BuildOptions {
  /** draw suggestive contours (needs the curvature precompute; off by default).
   *  `true` uses the default threshold; an object sets threshold and the fade
   *  band (`fade`: contours fade in over that D_w κ_r margin instead of popping
   *  at the threshold). (docs/DESIGN.md §3.3.5, §3.3.7) */
  suggestive?: boolean | { threshold?: number; fade?: number };
}

export class Mesh implements FeatureSource {
  readonly kind = "mesh";
  id: ElementId;
  autoNamed: boolean;
  readonly he: HalfEdgeMesh;
  private readonly aabb: AABB;
  private readonly suggestiveOpt: false | { threshold?: number; fade?: number };
  private _curv?: CurvatureField;
  /**
   * A *faceted* mesh — a hard-edged polyhedron (cube, gem, low-poly), where most
   * interior edges are creases. Its silhouette is the exact face-based contour
   * (not the smooth interpolated zero-set, which wanders across flat faces) and it
   * shades flat per face. A predominantly smooth mesh (sphere, torus, knot, the
   * gravity sheet — few or no creases) keeps the interpolated path unchanged.
   */
  private readonly faceted: boolean;

  constructor(input: MeshInput, opts: MeshOptions = {}, id?: ElementId) {
    this.autoNamed = id === undefined;
    this.id = id ?? autoName(this.kind);
    this.he = HalfEdgeMesh.build(input, opts);
    this.aabb = boundsOf(this.he.positions);
    this.suggestiveOpt = opts.suggestive ? (opts.suggestive === true ? {} : opts.suggestive) : false;
    const interior = this.he.edges.filter((e) => !e.boundary).length;
    const creases = this.he.creases().length;
    this.faceted = creases > 0 && creases >= 0.5 * interior;
  }

  /** Curvature precompute, lazily (only when suggestive contours are requested). */
  curvature(): CurvatureField {
    return (this._curv ??= computeCurvature(this.he));
  }

  bounds(): AABB {
    return this.aabb;
  }

  /** Self-occlusion depth tolerance for the exact depth-buffer QI (docs/DESIGN.md
   *  §3.3.6). A *smooth* mesh's silhouette is the interpolated zero-set, which
   *  floats off the flat facets by up to a facet's chord-sagitta, so a self-hit
   *  only counts as a genuine (separate-sheet) occlusion beyond ~an edge length.
   *  A *faceted* mesh has exactly-flat faces and its crease/silhouette points lie
   *  exactly on those facets — the raycast is exact — so it needs no such slack;
   *  the base analytic floor alone keeps the visible/hidden boundary crisp instead
   *  of smeared across a whole face. */
  selfNudge(): number {
    return this.faceted ? 0 : 0.75 * this.he.meanEdgeLength;
  }

  extractFeatures(cam: Camera): Feature[] {
    const feats: Feature[] = [];
    const P = this.he.positions;
    const asPolyline = (idxs: number[]): Vec3[] => idxs.map((v) => P[v]!);

    // A faceted mesh's silhouette edges are all creases (a facing flip needs an
    // angle between the faces), so the crease features below already draw the whole
    // outline — emitting a separate silhouette would double it. A smooth mesh has
    // no such edges, so its silhouette is the interpolated zero-set.
    //
    // Every feature carries a stable `id` (temporal coherence): view-independent
    // chains (creases/boundaries) are keyed on their minimal vertex index — fully
    // stable; view-dependent chains (silhouette/suggestive) on their minimal
    // crossed mesh edge — stable for as long as that edge stays crossed.
    if (!this.faceted) {
      for (const c of silhouetteChains(this.he, cam)) {
        if (c.pts.length >= 2) feats.push({ type: "silhouette", owner: this.id, id: `${this.id}/silhouette:${c.key}`, curve: { kind: "polyline", pts: c.pts }, attrs: {} });
      }
    }
    for (const c of chainVertexEdges(this.he.creases().map((e) => [e.v0, e.v1] as const))) {
      if (c.vertices.length >= 2) feats.push({ type: "crease", owner: this.id, id: `${this.id}/crease:${c.key}`, curve: { kind: "polyline", pts: asPolyline(c.vertices) }, attrs: {} });
    }
    for (const c of chainVertexEdges(this.he.boundaries().map((e) => [e.v0, e.v1] as const))) {
      if (c.vertices.length >= 2) feats.push({ type: "boundary", owner: this.id, id: `${this.id}/boundary:${c.key}`, curve: { kind: "polyline", pts: asPolyline(c.vertices) }, attrs: {} });
    }
    if (this.suggestiveOpt) {
      for (const c of suggestiveContourChains(this.he, cam, this.curvature(), this.suggestiveOpt)) {
        if (c.pts.length >= 2)
          feats.push({
            type: "suggestive",
            owner: this.id,
            id: `${this.id}/suggestive:${c.key}`,
            curve: { kind: "polyline", pts: c.pts },
            attrs: c.strength < 1 ? { strength: c.strength } : {},
          });
      }
    }
    return feats;
  }

  /** The apparent contour used to seed QI crossings and bound hatch: the exact
   *  face-based outline for a faceted mesh, the interpolated zero-set otherwise. */
  private silhouetteWorld(cam: Camera): Vec3[][] {
    return this.faceted ? facetedSilhouetteLoops(this.he, cam) : silhouetteLoops(this.he, cam);
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    return this.silhouetteWorld(cam)
      .filter((loop) => loop.length >= 2)
      .map((loop) => ({ kind: "polyline", pts: loop.map((p) => projectPoint(P, p).point) }));
  }

  /** The fillable region(s): closed silhouette loops. The scene's per-sample clip
   *  carves the visible surface and shades it via this source's `raycast` normals. */
  hatchRegions(cam: Camera, _light: Light): HatchRegion[] {
    const Pm = projectionMatrix(cam);
    const out: HatchRegion[] = [];
    for (const loop of this.silhouetteWorld(cam)) {
      if (loop.length < 4) continue;
      const a = loop[0]!;
      const b = loop[loop.length - 1]!;
      const closed = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9;
      if (!closed) continue; // only closed contours are fillable
      out.push({
        owner: this.id,
        outline: { kind: "polyline", pts: loop.map((p) => projectPoint(Pm, p).point) },
        mode: "single",
        angle: 0,
        tone: 0.5,
      });
    }
    return out;
  }

  /** Curvature-driven hatch: streamlines of the principal-direction field (dir1
   *  for family 0, dir2 for family 1). Returns `[]` on isotropic surfaces (e.g. a
   *  sphere), so the scene falls back to straight parallel hatch. (docs/DESIGN.md §2.6)
   *
   *  Temporal coherence: streamlines come from a static object-space
   *  `StreamlineAtlas` (traced once per density level, cached on the source —
   *  intrinsic geometry, like the curvature field). The camera only picks the
   *  atlas *level*; it never re-seeds, so lines cannot drift or pop under
   *  camera motion except at discrete level switches, which purely add or
   *  remove the finest level. */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const desired = this.screenToWorldSpacing(cam, opts.spacingPx);
    const curv = this.curvature();
    const atlas = (f: 0 | 1) => (this._atlas[f] ??= new StreamlineAtlas(this.he, curv, this.atlasBaseSpacing(), f));
    const f0 = atlas(0).curvesFor(desired);
    if (f0.length === 0) return [];
    const families: HatchFamily[] = [{ curves: f0 }];
    if (opts.maxFamilies >= 2) {
      const f1 = atlas(1).curvesFor(desired);
      if (f1.length) families.push({ curves: f1 });
    }
    return families;
  }

  private readonly _atlas: (StreamlineAtlas | undefined)[] = [];

  /** Level-0 (coarsest) atlas spacing: a quarter of the bounds diagonal — a
   *  view-independent reference density the LOD ladder halves from. */
  private atlasBaseSpacing(): number {
    const b = this.aabb;
    return 0.25 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  }

  /** Convert a desired on-screen hatch spacing (px) to a world-space separation,
   *  by measuring screen pixels per world unit at the object centre. The probe
   *  runs along the camera's *right* axis, so the estimate is exact for ortho
   *  and, for perspective, depends only on the distance to the object — not on
   *  the view direction. That matters for the discrete atlas level: an orbit at
   *  constant distance must not jitter the demand across a level boundary. */
  private screenToWorldSpacing(cam: Camera, spacingPx: number): number {
    const P = projectionMatrix(cam);
    const b = this.aabb;
    const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const sc = projectPoint(P, c).point;
    const r = cameraFrame(cam).right;
    const q = projectPoint(P, [c[0] + r[0], c[1] + r[1], c[2] + r[2]]).point;
    const pxPerWorld = Math.hypot(q[0] - sc[0], q[1] - sc[1]);
    return spacingPx / (pxPerWorld || 1);
  }

  /** Möller–Trumbore ray–triangle intersection over all faces; interpolated
   *  (smooth) normals for shading, face normal for the front/back flag. */
  raycast(ray: Ray): Hit[] {
    const { origin: o, dir: d } = ray;
    const P = this.he.positions;
    const VN = this.he.vertexNormals;
    const hits: Hit[] = [];
    for (let f = 0; f < this.he.faceCount; f++) {
      const t = this.he.triangles[f]!;
      const p0 = P[t[0]]!;
      const p1 = P[t[1]]!;
      const p2 = P[t[2]]!;
      const e1 = sub(p1, p0);
      const e2 = sub(p2, p0);
      const h = cross(d, e2);
      const a = dot(e1, h);
      if (Math.abs(a) < EPS_ABS) continue; // ray parallel to the triangle
      const inv = 1 / a;
      const s = sub(o, p0);
      const u = inv * dot(s, h);
      if (u < 0 || u > 1) continue;
      const q = cross(s, e1);
      const v = inv * dot(d, q);
      if (v < 0 || u + v > 1) continue;
      const tHit = inv * dot(e2, q);
      const point: Vec3 = [o[0] + d[0] * tHit, o[1] + d[1] * tHit, o[2] + d[2] * tHit];
      // A faceted mesh shades flat: return the face normal so each facet reads as a
      // single uniform tone. A smooth mesh interpolates the vertex normals so it
      // shades continuously light→dark.
      const fn = this.he.faceNormals[f]!;
      let normal: Vec3;
      if (this.faceted) {
        normal = fn;
      } else {
        const w0 = 1 - u - v;
        const n0 = VN[t[0]]!;
        const n1 = VN[t[1]]!;
        const n2 = VN[t[2]]!;
        normal = normalize([
          w0 * n0[0] + u * n1[0] + v * n2[0],
          w0 * n0[1] + u * n1[1] + v * n2[1],
          w0 * n0[2] + u * n1[2] + v * n2[2],
        ]);
      }
      const frontFacing = dot(fn, d) < 0;
      hits.push({ t: tHit, point, normal, frontFacing });
    }
    return hits.sort((p, q) => p.t - q.t);
  }
}

function boundsOf(positions: readonly Vec3[]): AABB {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  }
  return { min: [min[0]!, min[1]!, min[2]!], max: [max[0]!, max[1]!, max[2]!] };
}
