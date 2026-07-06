// Temporal coherence steps 2–3: the frame session + frame-to-frame
// correspondence (persistent ids over anchor churn, orientation reconciliation,
// born/died reporting).

import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import type { Feature } from "../src/pipeline/types.js";
import { Scene } from "../src/scene/scene.js";
import { FrameSession } from "../src/scene/session.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { uvSphere } from "../src/mesh/shapes.js";

const ortho = (eye: Vec3): Camera => ({
  eye,
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: 400, height: 400 },
});

/** closed circle polyline in the z=0 plane, optionally rotated start / reversed */
const circle = (cx: number, r: number, n: number, startAt = 0, rev = false): Vec3[] => {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((2 * Math.PI) / n) * (((rev ? n - i : i) + startAt) % n);
    pts.push([cx + r * Math.cos(a), r * Math.sin(a), 0]);
  }
  return pts;
};

const feat = (anchor: string, pts: Vec3[], owner = "m"): Feature => ({
  type: "silhouette",
  owner,
  id: anchor,
  curve: { kind: "polyline", pts },
  attrs: {},
});

describe("correspondence — synthetic frames through reconcile()", () => {
  test("anchor churn does not change the persistent id; death is reported", () => {
    const s = new FrameSession(new Scene());
    const f0 = s.reconcile([feat("m/silhouette:0_1", circle(0, 1, 24))]);
    expect(f0.born).toEqual(["m/silhouette#0"]);
    expect(f0.ids.get("m/silhouette:0_1")).toBe("m/silhouette#0");

    // next frame: anchor churned AND the loop starts elsewhere — still the same stroke
    const f1 = s.reconcile([feat("m/silhouette:0_2", circle(0, 1, 24, 5))]);
    expect(f1.born).toEqual([]);
    expect(f1.died).toEqual([]);
    expect(f1.ids.get("m/silhouette:0_2")).toBe("m/silhouette#0");

    const f2 = s.reconcile([]);
    expect(f2.died).toEqual(["m/silhouette#0"]);
  });

  test("a flipped chain is reversed in place to match last frame's direction", () => {
    const s = new FrameSession(new Scene());
    s.reconcile([feat("m/silhouette:0_1", circle(0, 1, 24))]);

    const flipped = feat("m/silhouette:0_1", circle(0, 1, 24, 3, true));
    const before = (flipped.curve as { pts: Vec3[] }).pts.map((p) => [...p] as Vec3);
    const f1 = s.reconcile([flipped]);
    expect(f1.reversed).toEqual(["m/silhouette#0"]);
    const after = (flipped.curve as { pts: Vec3[] }).pts;
    // reversed in place: same point set, opposite order
    expect(after.length).toBe(before.length);
    expect(after[1]).toEqual(before[before.length - 2]!);

    // and a same-direction frame afterwards is left alone
    const f2 = s.reconcile([feat("m/silhouette:0_9", circle(0, 1, 24, 7))]);
    expect(f2.reversed).toEqual([]);
    expect(f2.ids.get("m/silhouette:0_9")).toBe("m/silhouette#0");
  });

  test("at a split the larger fragment keeps the id, the shard is born", () => {
    const s = new FrameSession(new Scene());
    s.reconcile([feat("m/silhouette:5_9", circle(0, 1, 32))]);
    // the loop pinches off a small shard to the side
    const f1 = s.reconcile([feat("m/silhouette:5_10", circle(-0.05, 0.9, 28)), feat("m/silhouette:400_410", circle(1.05, 0.12, 10))]);
    expect(f1.ids.get("m/silhouette:5_10")).toBe("m/silhouette#0");
    expect(f1.born).toEqual(["m/silhouette#1"]);
    expect(f1.died).toEqual([]);
  });

  test("distinct loops far apart never cross-match, even with churned anchors", () => {
    const s = new FrameSession(new Scene());
    s.reconcile([feat("m/silhouette:0_1", circle(-5, 1, 24)), feat("m/silhouette:70_80", circle(5, 1, 24))]);
    const f1 = s.reconcile([feat("m/silhouette:0_2", circle(-5.02, 1, 24)), feat("m/silhouette:70_81", circle(5.02, 1, 24))]);
    expect(f1.born).toEqual([]);
    expect(f1.ids.get("m/silhouette:0_2")).toBe("m/silhouette#0");
    expect(f1.ids.get("m/silhouette:70_81")).toBe("m/silhouette#1");
  });
});

describe("frame session — end to end over a scene", () => {
  test("a panning camera keeps the sphere silhouette's persistent id through anchor churn", () => {
    const scene = new Scene();
    scene.add(new Mesh(uvSphere(2, 48, 32), {}, "ball"));
    const session = new FrameSession(scene);

    const rotZ = (p: Vec3, a: number): Vec3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
    const eye: Vec3 = [0, -10, 0];

    const r0 = session.render(ortho(eye));
    expect(r0.coherence.frame).toBe(0);
    expect(r0.coherence.born).toEqual(["ball/silhouette#0"]);
    expect(r0.strokes.every((st) => st.feature.id === "ball/silhouette#0")).toBe(true);

    // this exact pan churns the raw anchor (pole fan: 0_1 → 0_2)
    const r1 = session.render(ortho(rotZ(eye, 0.002)));
    expect(r1.coherence.born).toEqual([]);
    expect(r1.coherence.died).toEqual([]);
    expect(r1.strokes.every((st) => st.feature.id === "ball/silhouette#0")).toBe(true);
    expect(r1.svg).toContain("<svg");
  });

  test("plain scene.render(cam) is untouched by sessions (stateless, no persistent ids)", () => {
    const scene = new Scene();
    scene.add(new Mesh(uvSphere(2, 24, 16), {}, "ball"));
    const res = scene.render(ortho([0, -10, 0]));
    expect(res.strokes.every((st) => st.feature.id!.startsWith("ball/silhouette:"))).toBe(true);
  });
});
