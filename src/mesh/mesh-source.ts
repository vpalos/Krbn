// Phase-2 step 4: the mesh `FeatureSource` (ai/DESIGN.md §3.1–3.2).
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
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { cross, dot, normalize, sub } from "../math/vec3.js";
import { projectionMatrix, projectPoint } from "../math/camera.js";
import { HalfEdgeMesh, type BuildOptions, type MeshInput } from "./halfedge.js";
import { silhouetteLoops } from "./silhouette.js";
import { computeCurvature, type CurvatureField } from "./curvature.js";
import { suggestiveContours } from "./suggestive.js";
import { EPS_ABS } from "../curve/epsilon.js";

export interface MeshOptions extends BuildOptions {
  /** draw suggestive contours (needs the curvature precompute; off by default).
   *  `true` uses the default threshold; an object sets it. (ai/DESIGN.md §3.3.5) */
  suggestive?: boolean | { threshold?: number };
}

let autoId = 0;
const nextId = (): ElementId => `mesh-${autoId++}`;

/** Chain a set of undirected vertex-index edges into ordered vertex sequences,
 *  breaking at endpoints and junctions (degree ≠ 2) so each chain is a simple arc
 *  or loop — the ordered chains consolidation / wobble want. */
function chainEdges(edges: readonly (readonly [number, number])[]): number[][] {
  const incident = new Map<number, number[]>();
  const push = (v: number, e: number) => {
    const l = incident.get(v);
    if (l) l.push(e);
    else incident.set(v, [e]);
  };
  edges.forEach((e, i) => {
    push(e[0], i);
    push(e[1], i);
  });
  const degree = (v: number) => (incident.get(v) ?? []).length;
  const used = new Array<boolean>(edges.length).fill(false);
  const other = (e: number, v: number) => (edges[e]![0] === v ? edges[e]![1] : edges[e]![0]);

  const walk = (startV: number, startE: number): number[] => {
    const chain = [startV];
    let v = startV;
    let e = startE;
    for (;;) {
      used[e] = true;
      v = other(e, v);
      chain.push(v);
      if (degree(v) !== 2) break; // stop at a junction or endpoint
      const next = (incident.get(v) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      e = next;
    }
    return chain;
  };

  const chains: number[][] = [];
  // arcs: start at endpoints / junctions
  for (const [v, segs] of incident) {
    if (degree(v) === 2) continue;
    for (const e of segs) if (!used[e]) chains.push(walk(v, e));
  }
  // remaining pure cycles
  for (let e = 0; e < edges.length; e++) if (!used[e]) chains.push(walk(edges[e]![0], e));
  return chains;
}

export class Mesh implements FeatureSource {
  readonly id: ElementId;
  readonly he: HalfEdgeMesh;
  private readonly aabb: AABB;
  private readonly suggestiveOpt: false | { threshold?: number };
  private _curv?: CurvatureField;

  constructor(input: MeshInput, opts: MeshOptions = {}, id: ElementId = nextId()) {
    this.id = id;
    this.he = HalfEdgeMesh.build(input, opts);
    this.aabb = boundsOf(this.he.positions);
    this.suggestiveOpt = opts.suggestive ? (opts.suggestive === true ? {} : opts.suggestive) : false;
  }

  /** Curvature precompute, lazily (only when suggestive contours are requested). */
  curvature(): CurvatureField {
    return (this._curv ??= computeCurvature(this.he));
  }

  bounds(): AABB {
    return this.aabb;
  }

  /** A grazing mesh silhouette point sits on a triangle edge; step off by ~1.5
   *  edge lengths so the occlusion ray clears the neighbouring facets, while
   *  genuine self-occlusion (a nearer part of the surface) is much farther and
   *  still caught. (ai/DESIGN.md §3.3.6) */
  selfNudge(): number {
    return 1.5 * this.he.meanEdgeLength;
  }

  extractFeatures(cam: Camera): Feature[] {
    const feats: Feature[] = [];
    const P = this.he.positions;
    const asPolyline = (idxs: number[]): Vec3[] => idxs.map((v) => P[v]!);

    for (const loop of silhouetteLoops(this.he, cam)) {
      if (loop.length >= 2) feats.push({ type: "silhouette", owner: this.id, curve: { kind: "polyline", pts: loop }, attrs: {} });
    }
    for (const chain of chainEdges(this.he.creases().map((e) => [e.v0, e.v1] as const))) {
      if (chain.length >= 2) feats.push({ type: "crease", owner: this.id, curve: { kind: "polyline", pts: asPolyline(chain) }, attrs: {} });
    }
    for (const chain of chainEdges(this.he.boundaries().map((e) => [e.v0, e.v1] as const))) {
      if (chain.length >= 2) feats.push({ type: "boundary", owner: this.id, curve: { kind: "polyline", pts: asPolyline(chain) }, attrs: {} });
    }
    if (this.suggestiveOpt) {
      for (const loop of suggestiveContours(this.he, cam, this.curvature(), this.suggestiveOpt)) {
        if (loop.length >= 2) feats.push({ type: "suggestive", owner: this.id, curve: { kind: "polyline", pts: loop }, attrs: {} });
      }
    }
    return feats;
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    return silhouetteLoops(this.he, cam)
      .filter((loop) => loop.length >= 2)
      .map((loop) => ({ kind: "polyline", pts: loop.map((p) => projectPoint(P, p).point) }));
  }

  /** The fillable region(s): closed silhouette loops. The scene's per-sample clip
   *  carves the visible surface and shades it via this source's `raycast` normals. */
  hatchRegions(cam: Camera, _light: Light): HatchRegion[] {
    const Pm = projectionMatrix(cam);
    const out: HatchRegion[] = [];
    for (const loop of silhouetteLoops(this.he, cam)) {
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
      const w0 = 1 - u - v;
      const n0 = VN[t[0]]!;
      const n1 = VN[t[1]]!;
      const n2 = VN[t[2]]!;
      const normal = normalize([
        w0 * n0[0] + u * n1[0] + v * n2[0],
        w0 * n0[1] + u * n1[1] + v * n2[1],
        w0 * n0[2] + u * n1[2] + v * n2[2],
      ]);
      const frontFacing = dot(this.he.faceNormals[f]!, d) < 0;
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
