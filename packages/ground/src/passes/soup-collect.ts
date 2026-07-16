/**
 * Triangle-soup builders — the PURE half of the geometry passes (no three
 * import; unit-tested under happy-dom). Collectors emit screen-px triangles
 * with per-vertex rgba into a growable soup; the three-side `soup-mesh`
 * uploads them. MSAA (renderer antialias) smooths edges, matching the old 2D
 * canvases' stroke AA closely enough at 1–2 px widths.
 */

export interface TriSoup {
  /** xyz per vertex (z = 0 — the layer renders flat in screen space). */
  positions: Float32Array;
  /** rgba per vertex, 0-1. */
  colors: Float32Array;
  vertexCount: number;
}

export type Rgba = readonly [number, number, number, number];

export class SoupBuilder {
  private pos: number[] = [];
  private col: number[] = [];

  private vert(x: number, y: number, c: Rgba): void {
    this.pos.push(x, y, 0);
    this.col.push(c[0], c[1], c[2], c[3]);
  }

  /** Axis-aligned rect (two triangles). */
  rect(x: number, y: number, w: number, h: number, c: Rgba): void {
    this.vert(x, y, c);
    this.vert(x + w, y, c);
    this.vert(x + w, y + h, c);
    this.vert(x, y, c);
    this.vert(x + w, y + h, c);
    this.vert(x, y + h, c);
  }

  /** Stroke segment (a→b) of `width`, flat caps — a quad across the segment normal. */
  segment(ax: number, ay: number, bx: number, by: number, width: number, c: Rgba): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    this.vert(ax + nx, ay + ny, c);
    this.vert(bx + nx, by + ny, c);
    this.vert(bx - nx, by - ny, c);
    this.vert(ax + nx, ay + ny, c);
    this.vert(bx - nx, by - ny, c);
    this.vert(ax - nx, ay - ny, c);
  }

  /** Stroke a polyline (interleaved xy) as per-segment quads (smooth-curve joins). */
  polyline(points: ArrayLike<number>, width: number, c: Rgba): void {
    const n = Math.floor((points.length as number) / 2);
    for (let i = 1; i < n; i++) {
      this.segment(
        points[(i - 1) * 2] as number,
        points[(i - 1) * 2 + 1] as number,
        points[i * 2] as number,
        points[i * 2 + 1] as number,
        width,
        c,
      );
    }
  }

  /** Filled disc as a triangle fan (MSAA smooths the rim; 16 segs ≈ round at ≤8 px). */
  disc(cx: number, cy: number, r: number, c: Rgba, segments = 16): void {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.vert(cx, cy, c);
      this.vert(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, c);
      this.vert(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, c);
    }
  }

  build(): TriSoup {
    return {
      positions: new Float32Array(this.pos),
      colors: new Float32Array(this.col),
      vertexCount: this.pos.length / 3,
    };
  }
}

/**
 * `rgba(r, g, b, a)` / `rgb(…)` / `#rrggbb` → [r,g,b,a] 0-1 (the WiresConfig
 * colors are CSS strings — v1/2D-canvas heritage). Unknown formats fall back
 * to opaque mid-gray rather than throwing in a reflector path.
 */
export function parseCssColor(css: string): Rgba {
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  if (rgba !== null) {
    return [
      Number(rgba[1]) / 255,
      Number(rgba[2]) / 255,
      Number(rgba[3]) / 255,
      rgba[4] === undefined ? 1 : Number(rgba[4]),
    ];
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex !== null) {
    const v = Number.parseInt(hex[1] as string, 16);
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255, 1];
  }
  return [0.5, 0.5, 0.5, 1];
}
