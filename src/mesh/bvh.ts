// bvh.ts — a static bounding-volume hierarchy over a mesh's triangles, used to
// cull the candidate set for `Mesh.raycast` (src/mesh/mesh-source.ts).
//
// This module is deliberately NOT re-exported from src/index.ts: it is engine
// machinery with no public surface. Tests import it directly.
//
// ---------------------------------------------------------------------------
// The correctness spine — read before changing anything here
// ---------------------------------------------------------------------------
// The BVH is a *filter* in front of an unchanged Möller–Trumbore test. It never
// decides what a hit is; it only decides which triangles are asked. Everything
// rests on two claims:
//
//   A (superset). Every face MT would accept is in the candidate set.
//   B (order).    Candidates come out in ascending face index — exactly the order
//                 the old linear scan visited them.
//
// Given A and B, the array `raycast` hands to its final sort is *element-wise
// identical* to the linear scan's, so the returned Hit[] is identical bit for
// bit. No reasoning about `t` values is needed anywhere.
//
// The asymmetry that makes this tractable: **over-inclusion costs only time;
// under-inclusion is the only possible bug.** So we pad generously (see
// EPS_BVH_PAD_REL) and never trade Claim A for speed.
//
// Claim B is not free. `Array.prototype.sort` is stable (ES2019+), so hits with
// bit-identical `t` — a ray through a shared edge, coplanar faces — resolve by
// *insertion* order, which for the linear scan is face index. A BVH collects in
// tree order, so we sort the candidate buffer (see `candidates`) rather than hope
// the final sort absorbs it. Sorting a few dozen Int32s per ray is nothing next
// to the MT tests it replaces, and it removes the question entirely.
import type { AABB, Ray, Vec3 } from "../math/types.js";
import { EPS_BVH_PAD_REL } from "../curve/epsilon.js";
import type { HalfEdgeMesh } from "./halfedge.js";

// Perf knobs, not epsilons: they change which candidates are *grouped*, never
// which are *accepted*, so they cannot affect output and don't belong in
// epsilon.ts (which is for tolerances that can).
const BVH_BINS = 16;
const BVH_MAX_LEAF = 4;
/** SAH cost of visiting one node relative to testing one triangle. */
const BVH_TRAVERSAL_COST = 1;
const BVH_TRI_COST = 1;

export interface TriangleBVH {
  /** [minx,miny,minz,maxx,maxy,maxz] per node. */
  readonly nodeBounds: Float64Array;
  /** leaf: index of its first prim in `primIndex`. interior: index of right child. */
  readonly nodeStart: Int32Array;
  /** >0 ⇒ leaf holding this many prims. 0 ⇒ interior (left child is always i+1). */
  readonly nodeCounts: Int32Array;
  /** face indices, permuted so each leaf's prims are contiguous. */
  readonly primIndex: Int32Array;
  readonly nodeCount: number;
  readonly maxDepth: number;
  /** ascending face indices hit by `ray`'s *infinite line*; valid until the next call. */
  candidates(ray: Ray): Int32Array;
}

/** Build the static BVH. O(N·depth) with small constants — single-digit ms at 10k
 *  triangles, once per mesh (see `Mesh.bvh()`, which builds lazily). */
export function buildTriangleBVH(he: HalfEdgeMesh, bounds: AABB): TriangleBVH {
  const F = he.faceCount;
  const P = he.positions;

  // Uniform ABSOLUTE pad, derived from the mesh's own scale. Never per-box
  // relative: that is exactly zero on an axis-aligned triangle (a cube face, any
  // extrusion lid), which is the case that needs the pad most. See
  // EPS_BVH_PAD_REL for why a pad is required at all.
  const diag = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  const pad = EPS_BVH_PAD_REL * diag;

  // Per-triangle padded bounds + centroids (build scratch; dropped on return).
  const triBounds = new Float64Array(6 * F);
  const centroids = new Float64Array(3 * F);
  for (let f = 0; f < F; f++) {
    const t = he.triangles[f]!;
    const a = P[t[0]]!;
    const b = P[t[1]]!;
    const c = P[t[2]]!;
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(a[k]!, b[k]!, c[k]!);
      const hi = Math.max(a[k]!, b[k]!, c[k]!);
      triBounds[6 * f + k] = lo - pad;
      triBounds[6 * f + 3 + k] = hi + pad;
      // Centroid from the *unpadded* extent — the pad is symmetric, so it cancels;
      // computing it this way keeps binning independent of the pad entirely.
      centroids[3 * f + k] = (lo + hi) * 0.5;
    }
  }

  // A BVH over F prims has at most 2F-1 nodes (every split adds two children and
  // consumes a leaf). F=0 still needs one (empty) root.
  const maxNodes = Math.max(1, 2 * F - 1);
  const nodeBounds = new Float64Array(6 * maxNodes);
  const nodeStart = new Int32Array(maxNodes);
  const nodeCounts = new Int32Array(maxNodes);
  const primIndex = new Int32Array(F);
  for (let i = 0; i < F; i++) primIndex[i] = i;
  const scratch = new Int32Array(F);

  let nodeCount = 0;
  let maxDepth = 0;

  /** Union of prims [start,start+count) into node `n`'s slot. */
  const boundPrims = (n: number, start: number, count: number): void => {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity;
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = start; i < start + count; i++) {
      const f = primIndex[i]!;
      if (triBounds[6 * f]! < x0) x0 = triBounds[6 * f]!;
      if (triBounds[6 * f + 1]! < y0) y0 = triBounds[6 * f + 1]!;
      if (triBounds[6 * f + 2]! < z0) z0 = triBounds[6 * f + 2]!;
      if (triBounds[6 * f + 3]! > x1) x1 = triBounds[6 * f + 3]!;
      if (triBounds[6 * f + 4]! > y1) y1 = triBounds[6 * f + 4]!;
      if (triBounds[6 * f + 5]! > z1) z1 = triBounds[6 * f + 5]!;
    }
    nodeBounds[6 * n] = x0;
    nodeBounds[6 * n + 1] = y0;
    nodeBounds[6 * n + 2] = z0;
    nodeBounds[6 * n + 3] = x1;
    nodeBounds[6 * n + 4] = y1;
    nodeBounds[6 * n + 5] = z1;
  };

  const surfaceArea = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    if (dx < 0 || dy < 0 || dz < 0) return 0;
    return 2 * (dx * dy + dy * dz + dz * dx);
  };

  /** Recursive build over primIndex[start, start+count). Returns the node index.
   *  Written recursively for clarity; depth is O(log F) on any real mesh and the
   *  forced-split rule below bounds the pathological case. */
  const build = (start: number, count: number, depth: number): number => {
    const n = nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    boundPrims(n, start, count);

    if (count === 0) {
      nodeStart[n] = start;
      nodeCounts[n] = 0;
      // An empty *root* would look like an interior node (count 0). Only reachable
      // for F=0, where traversal short-circuits on nodeCount===0 anyway.
      return n;
    }

    const makeLeaf = (): number => {
      nodeStart[n] = start;
      nodeCounts[n] = count;
      return n;
    };
    if (count <= 1) return makeLeaf();

    // Centroid bounds decide the split axis; a node whose centroids all coincide
    // has no valid SAH split at all (every bin lands in one bucket).
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity;
    let cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = start; i < start + count; i++) {
      const f = primIndex[i]!;
      const x = centroids[3 * f]!, y = centroids[3 * f + 1]!, z = centroids[3 * f + 2]!;
      if (x < cx0) cx0 = x;
      if (y < cy0) cy0 = y;
      if (z < cz0) cz0 = z;
      if (x > cx1) cx1 = x;
      if (y > cy1) cy1 = y;
      if (z > cz1) cz1 = z;
    }
    const cmin = [cx0, cy0, cz0];
    const cext = [cx1 - cx0, cy1 - cy0, cz1 - cz0];

    // Binned SAH. Chosen over full-sweep SAH specifically because it needs NO
    // sort: a sort over coincident centroids (constant on symmetric meshes like
    // cube() or torusMesh) would need an explicit index tie-break or it becomes a
    // determinism hazard. Binning + a fixed-order scan has no ties to break.
    let bestAxis = -1;
    let bestPlane = -1;
    let bestCost = Infinity;
    const binCount = new Int32Array(BVH_BINS);
    const binBox = new Float64Array(6 * BVH_BINS);

    for (let axis = 0; axis < 3; axis++) {
      const ext = cext[axis]!;
      if (!(ext > 0)) continue; // flat on this axis ⇒ every centroid in one bin
      const kInv = BVH_BINS / ext;
      binCount.fill(0);
      for (let b = 0; b < BVH_BINS; b++) {
        binBox[6 * b] = Infinity;
        binBox[6 * b + 1] = Infinity;
        binBox[6 * b + 2] = Infinity;
        binBox[6 * b + 3] = -Infinity;
        binBox[6 * b + 4] = -Infinity;
        binBox[6 * b + 5] = -Infinity;
      }
      for (let i = start; i < start + count; i++) {
        const f = primIndex[i]!;
        const b = binOf(centroids[3 * f + axis]!, cmin[axis]!, kInv);
        binCount[b]!++;
        for (let k = 0; k < 3; k++) {
          if (triBounds[6 * f + k]! < binBox[6 * b + k]!) binBox[6 * b + k] = triBounds[6 * f + k]!;
          if (triBounds[6 * f + 3 + k]! > binBox[6 * b + 3 + k]!) binBox[6 * b + 3 + k] = triBounds[6 * f + 3 + k]!;
        }
      }

      // Sweep left→right then right→left, accumulating counts and boxes, so each
      // candidate plane's SAH cost is available in O(BINS) total.
      const leftCount = new Int32Array(BVH_BINS);
      const leftArea = new Float64Array(BVH_BINS);
      let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
      let acc = 0;
      for (let b = 0; b < BVH_BINS; b++) {
        acc += binCount[b]!;
        if (binCount[b]! > 0) {
          if (binBox[6 * b]! < lx0) lx0 = binBox[6 * b]!;
          if (binBox[6 * b + 1]! < ly0) ly0 = binBox[6 * b + 1]!;
          if (binBox[6 * b + 2]! < lz0) lz0 = binBox[6 * b + 2]!;
          if (binBox[6 * b + 3]! > lx1) lx1 = binBox[6 * b + 3]!;
          if (binBox[6 * b + 4]! > ly1) ly1 = binBox[6 * b + 4]!;
          if (binBox[6 * b + 5]! > lz1) lz1 = binBox[6 * b + 5]!;
        }
        leftCount[b] = acc;
        leftArea[b] = acc > 0 ? surfaceArea(lx0, ly0, lz0, lx1, ly1, lz1) : 0;
      }
      let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity, rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
      let rAcc = 0;
      // plane p splits bins [0,p) | [p,BINS); iterate p descending so the right
      // side accumulates, but *evaluate* candidates in ascending p below.
      const rightCount = new Int32Array(BVH_BINS + 1);
      const rightArea = new Float64Array(BVH_BINS + 1);
      for (let b = BVH_BINS - 1; b >= 0; b--) {
        if (binCount[b]! > 0) {
          if (binBox[6 * b]! < rx0) rx0 = binBox[6 * b]!;
          if (binBox[6 * b + 1]! < ry0) ry0 = binBox[6 * b + 1]!;
          if (binBox[6 * b + 2]! < rz0) rz0 = binBox[6 * b + 2]!;
          if (binBox[6 * b + 3]! > rx1) rx1 = binBox[6 * b + 3]!;
          if (binBox[6 * b + 4]! > ry1) ry1 = binBox[6 * b + 4]!;
          if (binBox[6 * b + 5]! > rz1) rz1 = binBox[6 * b + 5]!;
        }
        rAcc += binCount[b]!;
        rightCount[b] = rAcc;
        rightArea[b] = rAcc > 0 ? surfaceArea(rx0, ry0, rz0, rx1, ry1, rz1) : 0;
      }

      // Fixed evaluation order (axis 0,1,2 then plane 1..BINS-1) + strict `<`
      // ⇒ first-encountered wins, deterministically. No sort, no min-over-array.
      for (let p = 1; p < BVH_BINS; p++) {
        const nL = leftCount[p - 1]!;
        const nR = rightCount[p]!;
        if (nL === 0 || nR === 0) continue;
        const cost =
          BVH_TRAVERSAL_COST + BVH_TRI_COST * (nL * leftArea[p - 1]! + nR * rightArea[p]!);
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestPlane = p;
        }
      }
    }

    // Leaf when SAH says a leaf is cheaper AND the leaf is small. If the node is
    // still large, force a split regardless: a soup of coincident triangles must
    // not silently degenerate back into the linear scan we're replacing.
    const parentArea = surfaceArea(
      nodeBounds[6 * n]!, nodeBounds[6 * n + 1]!, nodeBounds[6 * n + 2]!,
      nodeBounds[6 * n + 3]!, nodeBounds[6 * n + 4]!, nodeBounds[6 * n + 5]!,
    );
    const leafCost = BVH_TRI_COST * count * parentArea;
    const wantLeaf = bestAxis < 0 || bestCost >= leafCost;
    if (wantLeaf && count <= BVH_MAX_LEAF) return makeLeaf();

    let mid: number;
    if (bestAxis < 0) {
      // No valid SAH split (all centroids coincide on every axis). Median-by-index:
      // deterministic, and it guarantees termination.
      mid = start + (count >> 1);
    } else {
      // Stable counting partition into scratch: left side keeps its relative order,
      // then the right side does. Preserving original face order within a leaf is a
      // free head start on Claim B (the candidate sort still guarantees it).
      const kInv = BVH_BINS / cext[bestAxis]!;
      let lo = 0;
      for (let i = start; i < start + count; i++) {
        const f = primIndex[i]!;
        if (binOf(centroids[3 * f + bestAxis]!, cmin[bestAxis]!, kInv) < bestPlane) scratch[lo++] = f;
      }
      let hi = lo;
      for (let i = start; i < start + count; i++) {
        const f = primIndex[i]!;
        if (binOf(centroids[3 * f + bestAxis]!, cmin[bestAxis]!, kInv) >= bestPlane) scratch[hi++] = f;
      }
      for (let i = 0; i < count; i++) primIndex[start + i] = scratch[i]!;
      mid = start + lo;
      // Defensive: the SAH scan only offers planes with nL>0 and nR>0, so this
      // cannot fire. If it ever did, a degenerate split would recurse forever.
      if (mid === start || mid === start + count) mid = start + (count >> 1);
    }

    nodeCounts[n] = 0; // interior
    build(start, mid - start, depth + 1); // left child is always n+1
    nodeStart[n] = build(mid, start + count - mid, depth + 1); // right child index
    return n;
  };

  build(0, F, 0);

  // Traversal scratch, retained. The stack is sized to the tree's *observed* depth,
  // so overflow is structurally impossible — no magic cap, no runtime check.
  const stack = new Int32Array(maxDepth + 2);
  const candidateBuf = new Int32Array(F);

  const bvh: TriangleBVH = {
    nodeBounds,
    nodeStart,
    nodeCounts,
    primIndex,
    nodeCount,
    maxDepth,
    candidates(ray: Ray): Int32Array {
      return traverse(bvh, ray, stack, candidateBuf);
    },
  };
  return bvh;
}

/** Bin index for a centroid coordinate. Pure f64 + Math.floor ⇒ deterministic. */
function binOf(c: number, cmin: number, kInv: number): number {
  const b = Math.floor((c - cmin) * kInv);
  return b < 0 ? 0 : b >= BVH_BINS ? BVH_BINS - 1 : b;
}

/**
 * Collect the faces whose padded boxes the ray's **infinite line** may meet, in
 * ascending face index.
 *
 * Infinite line, not a half-ray: `Mesh.raycast` applies no `t >= 0` filter, so
 * negative-t hits are part of its contract (and `isOccluded` compares depths in a
 * shifted frame). Clipping to [0,∞) here would silently change public output.
 *
 * A consequence worth noting: with all-hits collection and no tMax, there is no
 * early exit, so ordered front-to-back traversal would buy nothing. We push both
 * children unconditionally — which also deletes the sign-of-direction child
 * ordering that is the usual home of BVH traversal bugs.
 */
function traverse(bvh: TriangleBVH, ray: Ray, stack: Int32Array, out: Int32Array): Int32Array {
  if (bvh.nodeCount === 0 || out.length === 0) return out.subarray(0, 0);
  const o = ray.origin;
  const d = ray.dir;

  // Per-ray constants. The parallel flags are why this is NaN-free: NaN can only
  // arise from 0 * ±Infinity, i.e. d[k]===0 AND numerator===0. The textbook
  // 1/dir + min/max form hits exactly that when a ray grazes a box face — and the
  // well-known operand-ordering fix repairs it on only ONE side (fix the bmin
  // case and the bmax case breaks). Branching on the flag removes the case
  // entirely: in the else-branch below ik is finite, and finite−finite=finite,
  // finite×finite ∈ {finite, ±Infinity}. NaN is unreachable, by construction.
  // Not hypothetical: dir is exactly [0,0,-1] all over the tests, cube() is
  // axis-aligned on exact ±1/0 coords, and normalize() can emit -0 (1/-0 = -∞).
  const px = d[0] === 0, py = d[1] === 0, pz = d[2] === 0;
  const ix = px ? 0 : 1 / d[0];
  const iy = py ? 0 : 1 / d[1];
  const iz = pz ? 0 : 1 / d[2];
  const ox = o[0], oy = o[1], oz = o[2];

  const B = bvh.nodeBounds;
  let k = 0;
  let sp = 0;
  stack[sp++] = 0;

  while (sp > 0) {
    const n = stack[--sp]!;

    // Ray–slab against node n's box, as an infinite line.
    let tmin = -Infinity;
    let tmax = Infinity;
    let miss = false;

    if (px) {
      if (ox < B[6 * n]! || ox > B[6 * n + 3]!) miss = true;
    } else {
      const a = (B[6 * n]! - ox) * ix;
      const b = (B[6 * n + 3]! - ox) * ix;
      if (a < b) { if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      else { if (b > tmin) tmin = b; if (a < tmax) tmax = a; }
    }
    if (!miss) {
      if (py) {
        if (oy < B[6 * n + 1]! || oy > B[6 * n + 4]!) miss = true;
      } else {
        const a = (B[6 * n + 1]! - oy) * iy;
        const b = (B[6 * n + 4]! - oy) * iy;
        if (a < b) { if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
        else { if (b > tmin) tmin = b; if (a < tmax) tmax = a; }
      }
    }
    if (!miss) {
      if (pz) {
        if (oz < B[6 * n + 2]! || oz > B[6 * n + 5]!) miss = true;
      } else {
        const a = (B[6 * n + 2]! - oz) * iz;
        const b = (B[6 * n + 5]! - oz) * iz;
        if (a < b) { if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
        else { if (b > tmin) tmin = b; if (a < tmax) tmax = a; }
      }
    }
    if (miss || !(tmin <= tmax)) continue;

    const count = bvh.nodeCounts[n]!;
    if (count > 0) {
      const start = bvh.nodeStart[n]!;
      for (let i = start; i < start + count; i++) out[k++] = bvh.primIndex[i]!;
    } else if (n + 1 < bvh.nodeCount) {
      stack[sp++] = n + 1; // left
      stack[sp++] = bvh.nodeStart[n]!; // right
    }
  }

  // Claim B: restore ascending face index. TypedArray.sort is numeric-ascending
  // (unlike Array's lexicographic default) and sorts the view in place.
  const cands = out.subarray(0, k);
  cands.sort();
  return cands;
}
