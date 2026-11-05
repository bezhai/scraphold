/**
 * Shadow shapes: a structure's outline swept along the sun's offset, as the convex hull of the
 * outline and its shifted copy (exact for the convex outlines buildings and nests use).
 */

type Point = [number, number];

function hull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: readonly Point[]) => {
    const out: Point[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as Point, out[out.length - 1] as Point, p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The area a convex outline covers when moved by (dx, dy), as a polygon. */
export function sweptOutline(outline: readonly Point[], dx: number, dy: number): Point[] {
  return hull([...outline, ...outline.map(([x, y]): Point => [x + dx, y + dy])]);
}
