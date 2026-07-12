// Phase-2 groundwork: the static half-edge scaffold for a triangle mesh
// (docs/DESIGN.md §3.3.1). View-independent, built once at load. It is the
// foundation the mesh `FeatureSource` will stand on: silhouette zero-sets and
// chaining (§3.3.3–4) need the twin/next adjacency; hatch fields and suggestive
// contours (§3.3.2, §3.3.5) need the normals and curvature this precomputes.
//
// Half-edge indexing is implicit: triangle f owns half-edges 3f, 3f+1, 3f+2,
// where 3f+k goes from tri[f][k] to tri[f][(k+1)%3] and `next` cycles within the
// face. Twins are matched by undirected vertex pair; an edge used once is a
// boundary, more than twice is non-manifold (flagged, paired greedily).

import type { Vec3 } from "../math/types.js";
import { add, addScaled, cross, dot, length, normalize, sub } from "../math/vec3.js";

export type Tri = readonly [number, number, number];

export interface MeshInput {
  positions: readonly Vec3[];
  /** CCW when viewed from outside, so face normals point outward */
  triangles: readonly Tri[];
}

export interface BuildOptions {
  /** dihedral above this (radians) tags an interior edge as a crease. Default 30°. */
  creaseAngle?: number;
  /** weld vertices closer than this before building topology (0 = off). */
  weldEps?: number;
}

/** One undirected edge with its adjacency and precomputed angle tags. */
export interface EdgeInfo {
  /** endpoints, v0 < v1 */
  v0: number;
  v1: number;
  /** the half-edge indices on this edge (one if boundary, two if interior) */
  halfEdges: number[];
  boundary: boolean;
  /** unsigned angle between the two adjacent face normals (radians); 0 on a
   *  boundary or between coplanar faces */
  dihedral: number;
  /** convex ridge (true) vs concave valley (false); meaningless on a boundary */
  convex: boolean;
  /** dihedral > creaseAngle and not a boundary */
  crease: boolean;
}

const DEFAULT_CREASE = Math.PI / 6; // 30°
const FLAT_COS = Math.cos(Math.PI / 180); // faces within 1° count as coplanar

/** Weld vertices within `eps` (grid-quantized) and remap the triangles. */
function weld(positions: readonly Vec3[], triangles: readonly Tri[], eps: number): MeshInput {
  const map = new Map<string, number>();
  const remap: number[] = [];
  const out: Vec3[] = [];
  const q = (x: number) => Math.round(x / eps);
  for (const p of positions) {
    const key = `${q(p[0])},${q(p[1])},${q(p[2])}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = out.length;
      map.set(key, idx);
      out.push(p);
    }
    remap.push(idx);
  }
  // Welding can merge two of a triangle's corners onto one index (near-coincident
  // scan vertices, T-junctions), collapsing it to a line or point. Such a face has
  // no orientation and no apex, so drop it — it is genuinely no longer a triangle,
  // and leaving it in would poison normals and crash the apex/dihedral tags below.
  const tris = triangles
    .map((t) => [remap[t[0]]!, remap[t[1]]!, remap[t[2]]!] as Tri)
    .filter((t) => t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]);
  return { positions: out, triangles: tris };
}

export class HalfEdgeMesh {
  readonly positions: readonly Vec3[];
  readonly triangles: readonly Tri[];

  // half-edge arrays, length 3F
  readonly heFrom: Int32Array;
  readonly heTo: Int32Array;
  readonly heNext: Int32Array;
  readonly heFace: Int32Array;
  readonly heTwin: Int32Array; // -1 for boundary

  readonly faceNormals: Vec3[];
  readonly faceAreas: number[];
  readonly vertexNormals: Vec3[];
  /** Crease-aware shading normals, one per half-edge (corner `3f+k` = the normal at
   *  vertex `tri[f][k]` as seen from face `f`). Faces joined across non-crease
   *  interior edges form a smoothing group and share a normal; a crease or boundary
   *  starts a new group, so a vertex sitting on a hard edge gets a *distinct* normal
   *  per side. This is what lets an extruded solid's flat lid shade flat while its
   *  rounded walls stay smooth — without tagging every wall facet as a drawn crease.
   *  On a mesh with no creases every corner collapses to `vertexNormals[v]`. */
  readonly cornerNormals: Vec3[];
  readonly edges: EdgeInfo[];

  readonly boundaryEdgeCount: number;
  readonly nonManifoldEdgeCount: number;
  /** Area fraction of the largest planar smoothing group (0 = no flat facets, up to
   *  1 = a flat sheet). Distinguishes a capped/flat-faceted solid from an organic
   *  mesh; `mesh-source` thresholds it to pick the silhouette regime. */
  readonly flatFacetFraction: number;

  private constructor(init: {
    flatFacetFraction: number;
    positions: readonly Vec3[];
    triangles: readonly Tri[];
    heFrom: Int32Array;
    heTo: Int32Array;
    heNext: Int32Array;
    heFace: Int32Array;
    heTwin: Int32Array;
    faceNormals: Vec3[];
    faceAreas: number[];
    vertexNormals: Vec3[];
    cornerNormals: Vec3[];
    edges: EdgeInfo[];
    boundaryEdgeCount: number;
    nonManifoldEdgeCount: number;
  }) {
    this.positions = init.positions;
    this.triangles = init.triangles;
    this.heFrom = init.heFrom;
    this.heTo = init.heTo;
    this.heNext = init.heNext;
    this.heFace = init.heFace;
    this.heTwin = init.heTwin;
    this.faceNormals = init.faceNormals;
    this.faceAreas = init.faceAreas;
    this.vertexNormals = init.vertexNormals;
    this.cornerNormals = init.cornerNormals;
    this.edges = init.edges;
    this.boundaryEdgeCount = init.boundaryEdgeCount;
    this.nonManifoldEdgeCount = init.nonManifoldEdgeCount;
    this.flatFacetFraction = init.flatFacetFraction;
  }

  static build(input: MeshInput, opts: BuildOptions = {}): HalfEdgeMesh {
    const creaseAngle = opts.creaseAngle ?? DEFAULT_CREASE;
    const { positions, triangles } = opts.weldEps ? weld(input.positions, input.triangles, opts.weldEps) : input;

    const F = triangles.length;
    const H = 3 * F;
    const heFrom = new Int32Array(H);
    const heTo = new Int32Array(H);
    const heNext = new Int32Array(H);
    const heFace = new Int32Array(H);
    const heTwin = new Int32Array(H).fill(-1);

    for (let f = 0; f < F; f++) {
      const t = triangles[f]!;
      for (let k = 0; k < 3; k++) {
        const h = 3 * f + k;
        heFrom[h] = t[k]!;
        heTo[h] = t[(k + 1) % 3]!;
        heNext[h] = 3 * f + ((k + 1) % 3);
        heFace[h] = f;
      }
    }

    // Twin matching by undirected vertex pair.
    const byEdge = new Map<string, number[]>();
    const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    for (let h = 0; h < H; h++) {
      const k = key(heFrom[h]!, heTo[h]!);
      const list = byEdge.get(k);
      if (list) list.push(h);
      else byEdge.set(k, [h]);
    }

    // Face geometry.
    const faceNormals: Vec3[] = new Array(F);
    const faceAreas: number[] = new Array(F);
    for (let f = 0; f < F; f++) {
      const t = triangles[f]!;
      const a = positions[t[0]!]!;
      const b = positions[t[1]!]!;
      const c = positions[t[2]!]!;
      const cr = cross(sub(b, a), sub(c, a));
      const len = length(cr);
      faceAreas[f] = 0.5 * len;
      faceNormals[f] = len > 0 ? [cr[0] / len, cr[1] / len, cr[2] / len] : [0, 0, 0];
    }

    // Angle-weighted vertex normals (robust to irregular triangulation).
    const vertexNormals: Vec3[] = positions.map(() => [0, 0, 0]);
    for (let f = 0; f < F; f++) {
      const t = triangles[f]!;
      const n = faceNormals[f]!;
      for (let k = 0; k < 3; k++) {
        const vi = t[k]!;
        const p = positions[vi]!;
        const pPrev = positions[t[(k + 2) % 3]!]!;
        const pNext = positions[t[(k + 1) % 3]!]!;
        const e1 = sub(pNext, p);
        const e2 = sub(pPrev, p);
        const l1 = length(e1);
        const l2 = length(e2);
        let angle = 0;
        if (l1 > 0 && l2 > 0) angle = Math.acos(Math.max(-1, Math.min(1, dot(e1, e2) / (l1 * l2))));
        vertexNormals[vi] = addScaled(vertexNormals[vi]!, n, angle);
      }
    }
    for (let v = 0; v < vertexNormals.length; v++) {
      const nn = vertexNormals[v]!;
      vertexNormals[v] = length(nn) > 0 ? normalize(nn) : [0, 0, 0];
    }

    // Edges + twins + dihedral/crease/boundary tags.
    const edges: EdgeInfo[] = [];
    let boundaryEdgeCount = 0;
    let nonManifoldEdgeCount = 0;
    for (const hs of byEdge.values()) {
      const h0 = hs[0]!;
      const v0 = Math.min(heFrom[h0]!, heTo[h0]!);
      const v1 = Math.max(heFrom[h0]!, heTo[h0]!);

      if (hs.length === 2) {
        heTwin[hs[0]!] = hs[1]!;
        heTwin[hs[1]!] = hs[0]!;
      } else if (hs.length > 2) {
        // non-manifold: pair the first two, leave the rest as boundaries
        nonManifoldEdgeCount++;
        heTwin[hs[0]!] = hs[1]!;
        heTwin[hs[1]!] = hs[0]!;
      }

      const boundary = hs.length < 2;
      if (boundary) boundaryEdgeCount++;

      let dihedral = 0;
      let convex = false;
      if (!boundary) {
        const fA = heFace[hs[0]!]!;
        const fB = heFace[hs[1]!]!;
        const nA = faceNormals[fA]!;
        const nB = faceNormals[fB]!;
        dihedral = Math.acos(Math.max(-1, Math.min(1, dot(nA, nB))));
        // convex if the far vertex of face B lies below face A's outward plane
        const tB = triangles[fB]!;
        const apexB = tB.find((vi) => vi !== v0 && vi !== v1)!;
        convex = dot(sub(positions[apexB]!, positions[v0]!), nA) < 0;
      }

      edges.push({
        v0,
        v1,
        halfEdges: hs.length > 2 ? [hs[0]!, hs[1]!] : [...hs],
        boundary,
        dihedral,
        convex,
        crease: !boundary && dihedral > creaseAngle,
      });
    }

    // Crease-aware corner normals (smoothing groups). Union faces across every
    // *smooth* interior edge (not a crease, not a boundary); each connected
    // component is one smoothing group. A vertex's normal within a group is the
    // angle-weighted average of that group's faces at the vertex, so a vertex on a
    // crease carries one normal per side. Smooth meshes (no creases) fall into a
    // single group and reproduce `vertexNormals` exactly. (docs/DESIGN.md §3.3.2)
    const parent = new Int32Array(F);
    for (let f = 0; f < F; f++) parent[f] = f;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    };
    for (const e of edges) {
      if (e.boundary || e.crease || e.halfEdges.length < 2) continue;
      const ra = find(heFace[e.halfEdges[0]!]!);
      const rb = find(heFace[e.halfEdges[1]!]!);
      if (ra !== rb) parent[ra] = rb;
    }
    const cornerAngle = (f: number, k: number): number => {
      const t = triangles[f]!;
      const p = positions[t[k]!]!;
      const eNext = sub(positions[t[(k + 1) % 3]!]!, p);
      const ePrev = sub(positions[t[(k + 2) % 3]!]!, p);
      const l1 = length(eNext);
      const l2 = length(ePrev);
      return l1 > 0 && l2 > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(eNext, ePrev) / (l1 * l2)))) : 0;
    };
    // Accumulate per (vertex, group) angle-weighted normals, then read back per corner.
    const groupAccum = new Map<number, Vec3>();
    const gkey = (v: number, g: number) => v * F + g; // F ≥ any group id ⇒ unique
    for (let f = 0; f < F; f++) {
      const t = triangles[f]!;
      const g = find(f);
      const n = faceNormals[f]!;
      for (let k = 0; k < 3; k++) {
        const key = gkey(t[k]!, g);
        groupAccum.set(key, addScaled(groupAccum.get(key) ?? [0, 0, 0], n, cornerAngle(f, k)));
      }
    }
    const cornerNormals: Vec3[] = new Array(H);
    for (let f = 0; f < F; f++) {
      const t = triangles[f]!;
      const g = find(f);
      for (let k = 0; k < 3; k++) {
        const acc = groupAccum.get(gkey(t[k]!, g))!;
        cornerNormals[3 * f + k] = length(acc) > 0 ? normalize(acc) : faceNormals[f]!;
      }
    }

    // Largest *flat* smoothing group as a fraction of surface area. A group is flat
    // when all its faces share one normal (a planar facet: an extrusion's lid, a box
    // face); an organic surface has none. This is how a caller tells a capped solid
    // (flat lids meeting curved walls at creases) from a fully smooth mesh — the
    // interpolated silhouette wanders across exactly these flat facets, so a mesh
    // with a big one wants the exact face-based contour instead. (docs/DESIGN.md §3.3)
    let totalArea = 0;
    for (let f = 0; f < F; f++) totalArea += faceAreas[f]!;
    const groupArea = new Map<number, number>();
    const groupRef = new Map<number, Vec3>();
    const groupFlat = new Map<number, boolean>();
    for (let f = 0; f < F; f++) {
      const g = find(f);
      const n = faceNormals[f]!;
      groupArea.set(g, (groupArea.get(g) ?? 0) + faceAreas[f]!);
      const ref = groupRef.get(g);
      if (!ref) groupRef.set(g, n);
      else if (groupFlat.get(g) !== false && dot(ref, n) < FLAT_COS) groupFlat.set(g, false);
      if (!groupFlat.has(g)) groupFlat.set(g, true);
    }
    let flatFacetFraction = 0;
    if (totalArea > 0) for (const [g, area] of groupArea) if (groupFlat.get(g)) flatFacetFraction = Math.max(flatFacetFraction, area / totalArea);

    return new HalfEdgeMesh({
      flatFacetFraction,
      positions,
      triangles,
      heFrom,
      heTo,
      heNext,
      heFace,
      heTwin,
      faceNormals,
      faceAreas,
      vertexNormals,
      cornerNormals,
      edges,
      boundaryEdgeCount,
      nonManifoldEdgeCount,
    });
  }

  get vertexCount(): number {
    return this.positions.length;
  }
  get faceCount(): number {
    return this.triangles.length;
  }
  get edgeCount(): number {
    return this.edges.length;
  }

  private _meanEdge = -1;
  /** Mean edge length — the natural length scale of the tessellation (used e.g.
   *  to size the self-occlusion tolerance for grazing mesh silhouettes). */
  get meanEdgeLength(): number {
    if (this._meanEdge < 0) {
      let sum = 0;
      for (const e of this.edges) sum += length(sub(this.positions[e.v0]!, this.positions[e.v1]!));
      this._meanEdge = this.edges.length ? sum / this.edges.length : 0;
    }
    return this._meanEdge;
  }

  /** V − E + F (2 for a closed genus-0 surface). */
  eulerCharacteristic(): number {
    return this.vertexCount - this.edgeCount + this.faceCount;
  }

  /** Watertight ⇔ every edge has two adjacent faces. */
  get isClosed(): boolean {
    return this.boundaryEdgeCount === 0;
  }

  creases(): EdgeInfo[] {
    return this.edges.filter((e) => e.crease);
  }
  boundaries(): EdgeInfo[] {
    return this.edges.filter((e) => e.boundary);
  }

  /** Centroid of a face (handy for outward-normal checks / seeding). */
  faceCentroid(f: number): Vec3 {
    const t = this.triangles[f]!;
    const s = add(add(this.positions[t[0]!]!, this.positions[t[1]!]!), this.positions[t[2]!]!);
    return [s[0] / 3, s[1] / 3, s[2] / 3];
  }
}
