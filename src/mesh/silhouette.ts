// Phase-2 step 3: the mesh silhouette as an interpolated zero-set, chained into
// ordered polylines (docs/DESIGN.md §3.3.3–4).
//
// Define g(v) = n(v) · (direction toward the eye) at each vertex, using the
// *interpolated* vertex normal. The silhouette is the zero set of g. Interpolating
// g linearly inside each triangle and taking the zero crossing that passes
// *through* the face (Hertzmann–Zorin) gives a contour that moves continuously as
// the camera moves — unlike the per-edge "staircase" sign test.
//
// A crossed triangle contributes exactly one segment (a triangle's three vertex
// signs change an even number of times around its boundary → 0 or 2 crossed
// edges). The crossing point on a shared mesh edge is identical from both incident
// faces, so we key nodes by the undirected edge and chain the per-face segments
// through those shared nodes — the mandatory ordered-chain step consolidation and
// visibility need.

import type { Camera, Vec3 } from "../math/types.js";
import { addScaled, cross, dot, normalize, sub } from "../math/vec3.js";
import { cameraFrame } from "../math/camera.js";
import type { HalfEdgeMesh } from "./halfedge.js";

/** g(v) = n(v) · toEye(v); the silhouette is its zero set. Positive = front-facing. */
function viewSignal(mesh: HalfEdgeMesh, cam: Camera): Float64Array {
  const g = new Float64Array(mesh.vertexCount);
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];
  for (let v = 0; v < mesh.vertexCount; v++) {
    const p = mesh.positions[v]!;
    const toEye = persp ? normalize(sub(cam.eye, p)) : toEyeOrtho;
    g[v] = dot(mesh.vertexNormals[v]!, toEye);
  }
  return g;
}

/** Undirected edge key with the lower vertex index first (so both incident faces
 *  agree on the node identity and its crossing point). */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Numeric comparison of two edge keys as (lo, hi) pairs. String comparison would
 *  order "10_12" before "2_3"; canonicalization needs the topological order. */
function cmpEdgeKey(a: string, b: string): number {
  const ia = a.indexOf("_");
  const ib = b.indexOf("_");
  const lo = +a.slice(0, ia) - +b.slice(0, ib);
  return lo !== 0 ? lo : +a.slice(ia + 1) - +b.slice(ib + 1);
}

/**
 * A chained zero-set contour in **canonical orientation** with a per-frame
 * identity anchor (temporal coherence, docs/DESIGN.md §3.3.7).
 *
 * - **Direction is intrinsic**: the chain is oriented so the positive-g side
 *   (front-facing, for a silhouette) lies consistently to one side of the walk —
 *   a geometric vote over the whole chain, independent of which edge happens to
 *   be the anchor and of face-iteration order. Small camera motion cannot flip a
 *   contour's parameterization direction.
 * - **Start and `key` are the minimal crossed mesh edge** along the chain: unique
 *   within a frame and stable *while that edge stays crossed*. The anchor can
 *   churn as the contour sweeps the mesh; frame-to-frame correspondence
 *   (coherence step 3) remaps anchors to persistent identities.
 *
 * Known limits of the stateless vote (measured on a 200-frame sweep): direction
 * can flip exactly at topological events (a loop splitting/merging/dying) and on
 * tiny grazing loops (≲12 crossings) where the vote is noise-dominated — both
 * are correspondence's job to smooth, not this module's.
 */
export interface ZeroSetChain {
  /** ordered world-space points; a closed loop repeats its first point last */
  pts: Vec3[];
  /** identity anchor: the minimal crossed mesh edge ("lo_hi") along the chain */
  key: string;
  closed: boolean;
  /** the crossed mesh edges ("lo_hi") in walk order, parallel to `pts` — lets a
   *  caller aggregate per-crossing data over the chain (e.g. suggestive-contour
   *  strength) or match chains by crossed-edge overlap */
  nodes: string[];
}

/**
 * Canonicalize a walked chain of node (edge-key) strings: closed loops are
 * rotated to start at their minimal crossed edge; open paths keep their walked
 * endpoints. Direction is *not* decided here — `orientChain` fixes it
 * geometrically afterwards (an anchor-relative rule would flip the direction
 * whenever the anchor churns).
 */
function canonicalKeys(keys: string[]): { keys: string[]; key: string; closed: boolean } {
  const closed = keys.length > 2 && keys[0] === keys[keys.length - 1];
  if (closed) {
    const ring = keys.slice(0, -1);
    const n = ring.length;
    let mi = 0;
    for (let i = 1; i < n; i++) if (cmpEdgeKey(ring[i]!, ring[mi]!) < 0) mi = i;
    const out: string[] = [];
    for (let i = 0; i <= n; i++) out.push(ring[(mi + i) % n]!);
    return { keys: out, key: ring[mi]!, closed: true };
  }
  let min = keys[0]!;
  for (const k of keys) if (cmpEdgeKey(k, min) < 0) min = k;
  return { keys: keys.slice(), key: min, closed: false };
}

/**
 * Chain contour segments (each a pair of crossed-edge node keys) into canonically
 * oriented, identity-keyed `ZeroSetChain`s. This is the shared spine behind both
 * the per-vertex zero-set (`zeroSetChains`) and the crease-aware silhouette
 * (`creaseAwareSilhouetteChains`): the two differ only in how they place crossings
 * into `segA`/`segB` and the node maps; the walk, canonical start, intrinsic
 * orientation vote, and stable list order are identical (temporal coherence).
 */
function chainSegments(
  segA: readonly string[],
  segB: readonly string[],
  nodePoint: ReadonlyMap<string, Vec3>,
  nodePlus: ReadonlyMap<string, Vec3>,
  nodeNormal: ReadonlyMap<string, Vec3>,
): ZeroSetChain[] {
  const incident = new Map<string, number[]>();
  const push = (key: string, seg: number) => {
    const l = incident.get(key);
    if (l) l.push(seg);
    else incident.set(key, [seg]);
  };
  for (let s = 0; s < segA.length; s++) {
    push(segA[s]!, s);
    push(segB[s]!, s);
  }

  const used = new Array<boolean>(segA.length).fill(false);
  const other = (seg: number, node: string) => (segA[seg] === node ? segB[seg]! : segA[seg]!);

  const walk = (startNode: string, startSeg: number): string[] => {
    const keys: string[] = [startNode];
    let node = startNode;
    let seg = startSeg;
    for (;;) {
      used[seg] = true;
      node = other(seg, node);
      keys.push(node);
      const next = (incident.get(node) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      seg = next;
    }
    return keys;
  };

  const walked: string[][] = [];
  // open paths first: start at degree-1 nodes (a contour meeting a boundary/crease)
  for (const [node, segs] of incident) {
    if (segs.length !== 1) continue;
    const seg = segs[0]!;
    if (!used[seg]) walked.push(walk(node, seg));
  }
  // remaining closed loops
  for (let s = 0; s < segA.length; s++) if (!used[s]) walked.push(walk(segA[s]!, s));

  // canonicalize: topology-anchored start, *intrinsic* direction, and a stable list
  // order — nothing downstream sees face-iteration or Map order, and a small camera
  // move cannot flip a chain's parameterization (temporal coherence)
  return walked
    .map((keys) => {
      const c = canonicalKeys(keys);
      let ks = c.keys;
      // orientation vote: walking the chain, keep the positive side on a fixed hand —
      // Σ (n × t) · e⁺ over interior nodes, sign-stable under small view changes and
      // independent of the anchor.
      let score = 0;
      for (let i = 1; i + 1 < ks.length; i++) {
        const tangent = sub(nodePoint.get(ks[i + 1]!)!, nodePoint.get(ks[i - 1]!)!);
        score += dot(cross(nodeNormal.get(ks[i]!)!, tangent), nodePlus.get(ks[i]!)!);
      }
      const reverse =
        score !== 0
          ? score < 0
          : c.closed // degenerate vote: fall back to the topological tiebreak
            ? cmpEdgeKey(ks[1]!, ks[ks.length - 2]!) > 0
            : cmpEdgeKey(ks[0]!, ks[ks.length - 1]!) > 0;
      if (reverse) ks = c.closed ? [ks[0]!, ...ks.slice(1, -1).reverse(), ks[0]!] : ks.slice().reverse();
      return { pts: ks.map((k) => nodePoint.get(k)!), key: c.key, closed: c.closed, nodes: ks };
    })
    .sort((a, b) => cmpEdgeKey(a.key, b.key));
}

/**
 * Extract the mesh silhouette for `cam` as canonically oriented, identity-keyed
 * chains. Closed contours come back as loops (first point repeated at the end);
 * contours that run into a mesh boundary come back as open paths.
 */
export function silhouetteChains(mesh: HalfEdgeMesh, cam: Camera): ZeroSetChain[] {
  return zeroSetChains(mesh, viewSignal(mesh, cam));
}

/** Points-only view of `silhouetteChains` (same canonical order). */
export function silhouetteLoops(mesh: HalfEdgeMesh, cam: Camera): Vec3[][] {
  return silhouetteChains(mesh, cam).map((c) => c.pts);
}

/**
 * The silhouette of a *faceted* mesh (a polyhedron with hard edges). Here the
 * interpolated zero-set is the wrong tool — averaged corner normals make it wander
 * across the flat faces instead of landing on the edges. The exact contour of a
 * polyhedron is simply the set of edges whose two faces disagree on facing (one
 * front, one back); a silhouette edge is therefore always a real mesh edge (a
 * crease). Returned as ordered world-space polylines (loops for a closed solid).
 */
export function facetedSilhouetteLoops(mesh: HalfEdgeMesh, cam: Camera): Vec3[][] {
  const P = mesh.positions;
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];

  // per-face facing sign, from the flat face normal at the face centroid
  const front = new Int8Array(mesh.faceCount);
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const a = P[t[0]!]!, b = P[t[1]!]!, c = P[t[2]!]!;
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const toEye = persp ? normalize(sub(cam.eye, centroid)) : toEyeOrtho;
    front[f] = dot(mesh.faceNormals[f]!, toEye) >= 0 ? 1 : -1;
  }

  // interior edges whose two faces flip facing are the silhouette edges
  const edges: Array<[number, number]> = [];
  for (const e of mesh.edges) {
    if (e.boundary || e.halfEdges.length < 2) continue;
    const f0 = mesh.heFace[e.halfEdges[0]!]!;
    const f1 = mesh.heFace[e.halfEdges[1]!]!;
    if (front[f0] !== front[f1]) edges.push([e.v0, e.v1]);
  }
  return chainVertexEdges(edges).map((chain) => chain.vertices.map((v) => P[v]!));
}

/**
 * The mesh silhouette, made **crease-aware**. Same interpolated zero-set as
 * `silhouetteChains`, but the view signal `g = n·toEye` is read per **face corner**
 * from the crease-aware corner normals (docs/DESIGN.md §3.3.2) rather than the one
 * shared vertex normal. Two consequences, both wanted on a capped solid:
 *
 * - A **flat facet** (an extrusion's lid) has all corners sharing the cap normal, so
 *   `g` keeps one sign across the whole face → no interior crossing → the contour
 *   can no longer *wander the lid* the way the shared-normal zero-set does (it drifts
 *   inward as the averaged rim normals tilt). That drift was the phantom silhouette.
 * - Across a **crease** the two incident faces read different corner normals, so the
 *   zero-set is discontinuous there and simply **terminates at the crease** — which
 *   is already drawn as a crease feature — instead of leaking onto the flat cap.
 *
 * On a smooth edge both faces share the corner normals, so the crossing point is
 * identical from either side (nodes chain normally); on a mesh with **no creases**
 * corner normals equal vertex normals, so this reduces to `silhouetteChains`.
 */
export function creaseAwareSilhouetteChains(mesh: HalfEdgeMesh, cam: Camera): ZeroSetChain[] {
  const P = mesh.positions;
  const CN = mesh.cornerNormals;
  const N = mesh.vertexNormals;
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];
  const toEye: Vec3[] = new Array(mesh.vertexCount);
  for (let v = 0; v < mesh.vertexCount; v++) toEye[v] = persp ? normalize(sub(cam.eye, P[v]!)) : toEyeOrtho;
  const positive = (x: number) => x >= 0;

  const nodePoint = new Map<string, Vec3>();
  const nodePlus = new Map<string, Vec3>();
  const nodeNormal = new Map<string, Vec3>();
  const segA: string[] = [];
  const segB: string[] = [];

  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    // g per face corner (crease-aware): a flat facet keeps one sign ⇒ no crossing
    const gc: number[] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const nk = CN[3 * f + k]!;
      const e = toEye[t[k]!]!;
      gc[k] = nk[0] * e[0] + nk[1] * e[1] + nk[2] * e[2];
    }
    const crossed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = t[k]!;
      const b = t[(k + 1) % 3]!;
      const ga = gc[k]!;
      const gb = gc[(k + 1) % 3]!;
      if (positive(ga) === positive(gb)) continue; // no sign change on this corner-pair
      const s = ga / (ga - gb); // crossing a→b; identical point from the twin face on a smooth edge
      const key = edgeKey(a, b);
      if (!nodePoint.has(key)) {
        nodePoint.set(key, addScaled(P[a]!, sub(P[b]!, P[a]!), s));
        const toB = sub(P[b]!, P[a]!);
        nodePlus.set(key, ga >= gb ? [-toB[0], -toB[1], -toB[2]] : toB);
        const na = N[a]!;
        nodeNormal.set(key, addScaled(na, sub(N[b]!, na), s));
      }
      crossed.push(key);
    }
    if (crossed.length === 2) {
      segA.push(crossed[0]!);
      segB.push(crossed[1]!);
    }
  }

  return chainSegments(segA, segB, nodePoint, nodePlus, nodeNormal);
}

export function creaseAwareSilhouetteLoops(mesh: HalfEdgeMesh, cam: Camera): Vec3[][] {
  return creaseAwareSilhouetteChains(mesh, cam).map((c) => c.pts);
}

/** A canonically oriented vertex-index chain with a stable identity anchor:
 *  its canonical first *edge* ("a_b"). A vertex can sit on several chains (a
 *  cube corner joins three crease arcs) but an edge belongs to exactly one, so
 *  the anchor is unique; for view-independent edge sets (creases, boundaries)
 *  it is fully stable across frames. */
export interface VertexChain {
  vertices: number[];
  /** identity anchor: the chain's canonical first edge, "a_b" */
  key: string;
  closed: boolean;
}

/** Canonicalize a walked vertex-index chain: loops start at their minimal vertex
 *  and run toward its smaller-indexed neighbour; arcs run from the smaller
 *  endpoint to the larger. */
function canonicalVertices(chain: number[]): VertexChain {
  const closed = chain.length > 2 && chain[0] === chain[chain.length - 1];
  let vertices: number[];
  if (closed) {
    const ring = chain.slice(0, -1);
    const n = ring.length;
    let mi = 0;
    for (let i = 1; i < n; i++) if (ring[i]! < ring[mi]!) mi = i;
    const dir = ring[(mi + 1) % n]! <= ring[(mi - 1 + n) % n]! ? 1 : -1;
    vertices = [];
    for (let i = 0; i <= n; i++) vertices.push(ring[(((mi + dir * i) % n) + n) % n]!);
  } else {
    vertices = chain[0]! <= chain[chain.length - 1]! ? chain.slice() : chain.slice().reverse();
  }
  return { vertices, key: `${vertices[0]}_${vertices[1]}`, closed };
}

/** Chain undirected vertex-index edges into canonically oriented vertex chains,
 *  breaking at endpoints/junctions (degree ≠ 2) so each chain is a simple arc or
 *  loop. Shared by the faceted silhouette and the mesh source's crease/boundary
 *  features. */
export function chainVertexEdges(edges: ReadonlyArray<readonly [number, number]>): VertexChain[] {
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
      if (degree(v) !== 2) break;
      const next = (incident.get(v) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      e = next;
    }
    return chain;
  };

  const chains: number[][] = [];
  for (const [v, segs] of incident) {
    if (degree(v) === 2) continue;
    for (const e of segs) if (!used[e]) chains.push(walk(v, e));
  }
  for (let e = 0; e < edges.length; e++) if (!used[e]) chains.push(walk(edges[e]![0], e));
  // canonical order of the chain list itself: sort by anchor so the output does
  // not depend on Map iteration order
  return chains.map(canonicalVertices).sort((a, b) => cmpEdgeKey(a.key, b.key));
}

/**
 * The chained zero-set of a per-vertex scalar field `g` on the mesh — the shared
 * machinery behind both the silhouette (g = n·toEye) and suggestive contours
 * (g = radial curvature). `accept(lo, hi, s)` optionally filters a crossing on
 * edge lo→hi at parameter s (e.g. suggestive contours keep only crossings that are
 * front-facing and have increasing radial curvature); rejected crossings are
 * dropped, so contours are trimmed to the accepted region.
 */
export function zeroSetLoops(
  mesh: HalfEdgeMesh,
  g: Float64Array,
  accept: (lo: number, hi: number, s: number) => boolean = () => true,
): Vec3[][] {
  return zeroSetChains(mesh, g, accept).map((c) => c.pts);
}

/** `zeroSetLoops` with canonical orientation + identity keys (see `ZeroSetChain`). */
export function zeroSetChains(
  mesh: HalfEdgeMesh,
  g: Float64Array,
  accept: (lo: number, hi: number, s: number) => boolean = () => true,
): ZeroSetChain[] {
  const P = mesh.positions;
  const N = mesh.vertexNormals;
  const positive = (x: number) => x >= 0; // ties (g == 0) count as positive, keeping crossings even

  // per crossed edge: the crossing point, the edge direction toward the
  // positive-g side, and the interpolated surface normal (both feed the
  // intrinsic orientation vote below)
  const nodePoint = new Map<string, Vec3>();
  const nodePlus = new Map<string, Vec3>();
  const nodeNormal = new Map<string, Vec3>();
  const segA: string[] = [];
  const segB: string[] = [];

  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const crossed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = t[k]!;
      const b = t[(k + 1) % 3]!;
      if (positive(g[a]!) === positive(g[b]!)) continue; // no sign change on this edge
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const ga = g[lo]!;
      const gb = g[hi]!;
      const s = ga / (ga - gb); // g == 0 crossing along lo→hi
      if (!accept(lo, hi, s)) continue; // filtered out (e.g. wrong side / below threshold)
      const key = edgeKey(a, b);
      if (!nodePoint.has(key)) {
        nodePoint.set(key, addScaled(P[lo]!, sub(P[hi]!, P[lo]!), s));
        const toHi = sub(P[hi]!, P[lo]!);
        nodePlus.set(key, ga >= gb ? [-toHi[0], -toHi[1], -toHi[2]] : toHi);
        const nlo = N[lo]!;
        nodeNormal.set(key, addScaled(nlo, sub(N[hi]!, nlo), s));
      }
      crossed.push(key);
    }
    if (crossed.length === 2) {
      segA.push(crossed[0]!);
      segB.push(crossed[1]!);
    }
    // 0 accepted crossings ⇒ nothing here; 1 ⇒ the contour exits the accepted region (dropped)
  }

  return chainSegments(segA, segB, nodePoint, nodePlus, nodeNormal);
}
