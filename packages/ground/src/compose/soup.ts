/**
 * Triangle-soup builders — the PURE half of the overlay passes (no GPU, no
 * three; unit-tested under happy-dom). Collectors emit screen-px triangles with
 * per-vertex rgba into a growable soup; `compose/overlay.ts` uploads them.
 *
 * This is the COPY of `passes/soup-collect.ts` across the Phase-C wall (C1,
 * 2026-09-07): the new leg may not import the old one, so the pure code moved
 * by copy and `test/overlay-collectors.test.ts` asserts the two emit
 * byte-identical soups. `passes/soup-collect.ts` dies with the old leg at C2 and
 * this file is what survives — the two must not drift meanwhile.
 *
 * THREE deliberate differences from the original. (1) `TriSoup`'s arrays are
 * `Float32Array<ArrayBuffer>` rather than the bare `Float32Array`: what
 * `SoupBuilder` builds always is one, and `queue.writeBuffer` refuses the
 * `ArrayBufferLike` the bare form widens to (three's `BufferAttribute` did
 * not). (2) The hex parser's byte masks are written in decimal, as `theme.ts`'s
 * own parser writes them: the theme gate reads a bare two-digit hex literal as a
 * colour, and this file is inside the tree it polices (block comments included,
 * which is why this sentence does not spell one). Same number, and
 * `overlay-collectors.test.ts` proves the same bytes come out. (3) The old
 * mesh rode three's MSAA, which smoothed its edges; the engine's swap chain is
 * not multisampled, so this soup's edges are hard — the parity rig measures
 * exactly that band and design-013 C1 records it.
 */

export interface TriSoup {
  /** xyz per vertex (z = 0 — the overlay draws flat in screen space). */
  positions: Float32Array<ArrayBuffer>;
  /** rgba per vertex, 0-1. */
  colors: Float32Array<ArrayBuffer>;
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

  /** Filled disc as a triangle fan (16 segs ≈ round at ≤8 px). */
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
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  return [0.5, 0.5, 0.5, 1];
}

/**
 * Per-flush frame facts a collector reads — the new leg's copy of the old
 * `GroundFrame` (`src/pass.ts`), identical in shape so the collectors below are
 * verbatim. The compose host builds it from the slot's view.
 */
export interface OverlayFrame {
  /** CSS-px viewport size. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Engine camera: world top-left + zoom. */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
}
