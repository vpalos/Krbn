#!/usr/bin/env python3
"""Parse AhaBlitz logo.svg -> clean, hole-bridged 2D profiles for Krbn extrude.

Pipeline: flatten SVG paths -> simplify -> per colour group apply nonzero fill
(union solid rings, subtract counters) via shapely -> keyhole-bridge each hole
into its outer ring -> center/scale. Emits profiles.json."""
import json, re, math, xml.etree.ElementTree as ET
import numpy as np, mapbox_earcut as earcut
from svgpathtools import parse_path
from shapely.geometry import Polygon, MultiPolygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely import set_precision

SRC, OUT = "logo-simple.svg", "profiles.json"
SEG = 0.9            # curve flattening segment length (SVG units)
SIMP_EPS = 0.12      # collinear simplify threshold (SVG units)
TARGET_W = 44.0      # final logo width (world units), centered at origin
EXTRUDE_HINT = 3.6   # (passed through for reference; scene sets height)

def parse_transform(t):
    if not t: return (0.0, 0.0)
    m = re.search(r"translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)", t)
    if m: return (float(m.group(1)), float(m.group(2)))
    m = re.search(r"translate\(\s*([-\d.]+)\s*\)", t)
    if m: return (float(m.group(1)), 0.0)
    return (0.0, 0.0)

def flatten_subpath(sp):
    pts = []
    for seg in sp:
        L = seg.length(error=1e-4)
        n = max(2, int(math.ceil(L / SEG)))
        for i in range(n):
            z = seg.point(i / n)
            pts.append((z.real, z.imag))
    out = []
    for p in pts:
        if not out or abs(p[0]-out[-1][0]) > 1e-6 or abs(p[1]-out[-1][1]) > 1e-6:
            out.append(p)
    return out

def simplify_ring(poly, eps=SIMP_EPS):
    pts = list(poly)
    changed = True
    while changed and len(pts) > 4:
        changed = False
        i = 0
        while i < len(pts) and len(pts) > 4:
            a, b, c = pts[i-1], pts[i], pts[(i+1) % len(pts)]
            dx, dy = c[0]-a[0], c[1]-a[1]
            L = math.hypot(dx, dy)
            d = (abs((b[0]-a[0])*dy - (b[1]-a[1])*dx)/L) if L > 1e-9 else math.hypot(b[0]-a[0], b[1]-a[1])
            if d < eps:
                pts.pop(i); changed = True
            else:
                i += 1
    return pts

def signed_area(poly):
    a = 0.0; n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]; x1, y1 = poly[(i+1) % n]
        a += x0*y1 - x1*y0
    return a/2.0

def point_in_poly(pt, poly):
    x, y = pt; inside = False; n = len(poly); j = n-1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi + 1e-30) + xi):
            inside = not inside
        j = i
    return inside

def bridge_hole(outer, hole):
    """Merge hole ring into outer ring via a keyhole cut (mapbox-style)."""
    if signed_area(hole) > 0: hole = hole[::-1]        # hole must be CW
    hi = max(range(len(hole)), key=lambda i: hole[i][0])
    hx, hy = hole[hi]
    best_i, best_x = None, -1e30
    for i in range(len(outer)):
        ax, ay = outer[i]; bx, by = outer[(i+1) % len(outer)]
        if (ay > hy) != (by > hy):
            t = (hy - ay)/(by - ay + 1e-30); ix = ax + t*(bx-ax)
            if ix >= hx - 1e-9 and ix > best_x:
                best_x = ix; best_i = i if ax > bx else (i+1) % len(outer)
    if best_i is None:
        best_i = min(range(len(outer)), key=lambda i: (outer[i][0]-hx)**2 + (outer[i][1]-hy)**2)
    return outer[:best_i+1] + hole[hi:] + hole[:hi+1] + outer[best_i:]

def ring_of(coords):
    r = [(x, y) for (x, y) in coords]
    if len(r) > 1 and abs(r[0][0]-r[-1][0]) < 1e-9 and abs(r[0][1]-r[-1][1]) < 1e-9:
        r = r[:-1]
    return r

def fillhex(el):
    """Fill colour from the `fill` attr or a `style="fill:..."` (Inkscape)."""
    f = el.get("fill") or ""
    if not f:
        s = el.get("style") or ""
        m = re.search(r"fill:\s*(#[0-9a-fA-F]{3,6}|url\([^)]*\))", s)
        f = m.group(1) if m else ""
    return f.lower()

def fill_class(fill):
    """Green brand ink vs dark ink. Near-black -> dark, anything else -> green."""
    if "blitz" in fill:            # green gradient reference
        return "green"
    if fill.startswith("#"):
        h = fill.lstrip("#")
        if len(h) == 3:
            h = "".join(c*2 for c in h)
        try:
            r_, g_, b_ = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        except ValueError:
            return "dark"
        return "dark" if max(r_, g_, b_) < 0x50 else "green"
    return "dark"

def main():
    root = ET.parse(SRC).getroot()
    ns = "{http://www.w3.org/2000/svg}"
    contours = []
    for path_el in root.iter(ns+"path"):
        d = path_el.get("d")
        if not d: continue
        cls = fill_class(fillhex(path_el))
        tx, ty = parse_transform(path_el.get("transform"))
        for sp in parse_path(d).continuous_subpaths():
            ring = flatten_subpath(sp)
            if len(ring) < 3: continue
            world = simplify_ring([(x+tx, -(y+ty)) for (x, y) in ring])
            if len(world) < 3: continue
            contours.append({"pts": world, "area": signed_area(world), "cls": cls})

    # Fill rule: SVG NONZERO winding. A contour bounds SOLID iff the winding number
    # just inside it — sign(itself) + Σ sign(containing same-fill contours) — is
    # non-zero; otherwise it bounds a HOLE. This is correct where naive rules fail:
    #  * even-odd nesting depth wrongly subtracts a same-winding inner shape (the
    #    original logo's A crossbar) -> spurious hollow;
    #  * bare signed-area wrongly treats a standalone CW glyph (the diamond) as a
    #    hole -> it vanishes. Winding number gets both right.
    # Each profile is then either hole-free (a simple `ring`, extruded by krbn/shapes
    # `extrude`) or holed (rings + a hole-aware earcut cap: counters are real tunnels
    # with NO bridge cuts).
    polys = [Polygon(c["pts"]).buffer(0) for c in contours]
    reps = [p.representative_point() for p in polys]

    def winding_inside(idx):
        pt, cls_i = reps[idx], contours[idx]["cls"]
        w = 0
        for j, cj in enumerate(contours):
            if cj["cls"] != cls_i:
                continue
            if j == idx or polys[j].contains(pt):
                w += 1 if cj["area"] > 0 else -1
        return w

    solid = [winding_inside(k) != 0 for k in range(len(contours))]

    profiles = []
    for cls in ("green", "dark"):
        adds = [polys[k] for k, c in enumerate(contours) if c["cls"] == cls and solid[k]]
        holes = [polys[k] for k, c in enumerate(contours) if c["cls"] == cls and not solid[k]]
        if not adds: continue
        region = unary_union(adds)
        if holes: region = region.difference(unary_union(holes))
        region = set_precision(region, 1e-6)
        region_polys = list(region.geoms) if isinstance(region, MultiPolygon) else [region]
        for poly in region_polys:
            if poly.is_empty or poly.area < 1e-6: continue
            poly = orient(poly, 1.0)                 # exterior CCW, holes CW
            ext = ring_of(list(poly.exterior.coords))
            interiors = [ring_of(list(h.coords)) for h in poly.interiors]
            if not interiors:
                profiles.append({"cls": cls, "holed": False, "ring": ext})
                continue
            verts = list(ext)
            counts = [len(ext)]
            for h in interiors:
                verts += h
                counts.append(counts[-1] + len(h))
            arr = np.array(verts, dtype=np.float64)
            tris = earcut.triangulate_float64(arr, np.array(counts, dtype=np.uint32))
            captris = []
            for i in range(0, len(tris), 3):
                a, b, c = int(tris[i]), int(tris[i+1]), int(tris[i+2])
                # force CCW (normal +z) so every lid triangle front-faces the camera
                ax, ay = verts[a]; bx, by = verts[b]; cx_, cy_ = verts[c]
                if (bx-ax)*(cy_-ay) - (by-ay)*(cx_-ax) < 0:
                    b, c = c, b
                captris.append([a, b, c])
            starts = [0] + counts[:-1]
            rings = [[starts[i], len(ext) if i == 0 else len(interiors[i-1])]
                     for i in range(len(counts))]
            profiles.append({"cls": cls, "holed": True, "verts": verts,
                             "rings": rings, "captris": captris})

    def all_pts(pr):
        return pr["verts"] if pr["holed"] else pr["ring"]

    allpts = [p for pr in profiles for p in all_pts(pr)]
    minx = min(p[0] for p in allpts); maxx = max(p[0] for p in allpts)
    miny = min(p[1] for p in allpts); maxy = max(p[1] for p in allpts)
    cx, cy = (minx+maxx)/2, (miny+maxy)/2
    s = TARGET_W/(maxx-minx)
    def norm(pts):
        return [[round((x-cx)*s, 4), round((y-cy)*s, 4)] for (x, y) in pts]
    for pr in profiles:
        if pr["holed"]:
            pr["verts"] = norm(pr["verts"])
        else:
            pr["ring"] = norm(pr["ring"])

    meta = {"count": len(profiles), "width": round((maxx-minx)*s, 3),
            "height": round((maxy-miny)*s, 3), "extrudeHint": EXTRUDE_HINT,
            "profiles": profiles}
    json.dump(meta, open(OUT, "w"))
    print(f"profiles={len(profiles)} W={meta['width']} H={meta['height']}")
    for i, pr in enumerate(profiles):
        if pr["holed"]:
            print(f"  #{i:2d} {pr['cls']:5s} HOLED verts={len(pr['verts'])} "
                  f"rings={len(pr['rings'])} captris={len(pr['captris'])}")
        else:
            print(f"  #{i:2d} {pr['cls']:5s} ring pts={len(pr['ring'])}")

if __name__ == "__main__":
    main()
