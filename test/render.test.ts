import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { sphere } from "../src/primitives/quadric.js";
import { Line } from "../src/primitives/line.js";
import { classifyFeature, classifyScene } from "../src/pipeline/visibility.js";
import { emitStroke, emitScene, DEFAULT_EMIT_STYLE } from "../src/pipeline/emit.js";
import { renderStrokesSVG } from "../src/backend/svg.js";
import { renderScene, renderSceneSVG } from "../src/pipeline/render.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("emit — visible vs hidden styling", () => {
  test("line behind a sphere emits solid + dashed + solid", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const stroke = classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]);
    const rs = emitStroke(stroke, front);
    expect(rs).toHaveLength(3);
    // middle run is the hidden, ghosted one
    expect(rs[0]!.style.dash).toBeUndefined();
    expect(rs[1]!.style.dash).toBeDefined();
    expect(rs[1]!.style.opacity).toBeLessThan(1);
    expect(rs[2]!.style.dash).toBeUndefined();
  });

  test("straight segments emit as 2-point polylines", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const stroke = classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]);
    for (const r of emitStroke(stroke, front)) expect(r.path.length).toBe(2);
  });

  test("hidden runs can be dropped entirely", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const stroke = classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]);
    const rs = emitStroke(stroke, front, { visible: DEFAULT_EMIT_STYLE.visible, hidden: null });
    expect(rs).toHaveLength(2); // the two visible ends only
  });
});

describe("emit — sphere silhouette samples lie on the projected circle", () => {
  test("adaptive sampling stays on the exact outline", () => {
    const s = sphere([0, 0, 0], 2); // r=2, scale 0.01 → 200 px radius, centre (200,200)
    const stroke = classifyScene([s], front)[0]!;
    const rs = emitStroke(stroke, front);
    expect(rs).toHaveLength(1); // one visible closed run
    expect(rs[0]!.path.length).toBeGreaterThan(16); // curved → subdivided
    for (const [x, y] of rs[0]!.path) {
      expect(Math.hypot(x - 200, y - 200)).toBeCloseTo(200, 1);
    }
  });
});

describe("SVG backend", () => {
  test("well-formed document with correct viewBox and one polyline per run", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const strokes = [
      classifyFeature(s.extractFeatures(front)[0]!, front, [s, line]),
      classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]),
    ];
    const svg = renderStrokesSVG(emitScene(strokes, front), front.viewport, { background: "#fff" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 400"');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain("<rect"); // background
    // silhouette (1) + line runs (visible/hidden/visible = 3) = 4 polylines
    expect((svg.match(/<polyline/g) ?? []).length).toBe(4);
    // a dashed (ghosted) run is present
    expect(svg).toContain("stroke-dasharray");
  });

  test("centerline mode: every stroke is a single-line <path>, no polylines or filled ribbons", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const strokes = [
      classifyFeature(s.extractFeatures(front)[0]!, front, [s, line]),
      classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]),
    ];
    const plain = renderStrokesSVG(emitScene(strokes, front), front.viewport);
    const cl = renderStrokesSVG(emitScene(strokes, front), front.viewport, { centerline: true });
    // same number of strokes, but every one is now an open path (M…L…), no <polyline>
    expect((cl.match(/<polyline/g) ?? []).length).toBe(0);
    expect((cl.match(/<path /g) ?? []).length).toBe((plain.match(/<polyline/g) ?? []).length);
    expect(cl).toContain('d="M ');
    expect(cl).toContain('fill="none"'); // centrelines, not filled ribbons
    expect(cl).not.toContain("Z\""); // no closed ribbon outline
    expect(cl).toContain("stroke-dasharray"); // dashes preserved
  });

  test("renderScene exposes intermediate stages", () => {
    const s = sphere([0, 0, 0], 1);
    const result = renderScene([s], front);
    expect(result.strokes.length).toBeGreaterThanOrEqual(1);
    expect(result.renderStrokes.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.svg).toBe("string");
  });

  test("renderSceneSVG returns a string", () => {
    expect(renderSceneSVG([sphere([0, 0, 0], 1)], front)).toContain("<svg");
  });
});
