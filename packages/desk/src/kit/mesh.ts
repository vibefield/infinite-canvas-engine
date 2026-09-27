// A MESH WRITER for a kind that draws real 3D (design-016 §5; the notebook's, moved here at K4a so the desk calendar's
// pad builds with it without importing the notebook): a growable vertex + index writer and the mesh it builds. A vertex
// is 16 floats — position · normal · uv · (material, page, flags, ao) · the face's size in world units (what uv is a
// fraction of) · two extras — and the kind's shader reads a material by the number the kind gives it. Pure: typed
// arrays out, no GPU.

export const VERTEX_FLOATS = 16;
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

/** Flags: a face seen from both sides (a sheet in the air, the spine). */
export const FLAG_TWO_SIDED = 1;

/** A growable vertex + index writer. */
export class MeshWriter {
  v: Float32Array;
  ix: Uint32Array;
  nv = 0;
  ni = 0;
  readonly min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  readonly max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  constructor(vcap = 8192, icap = 24576) { this.v = new Float32Array(vcap * VERTEX_FLOATS); this.ix = new Uint32Array(icap); }
  reset(): void { this.nv = 0; this.ni = 0; this.min.fill(Number.POSITIVE_INFINITY); this.max.fill(Number.NEGATIVE_INFINITY); }
  vert(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, mat: number, page: number, flags: number, ao: number, sx: number, sy: number, e0 = 0, e1 = 0): number {
    if ((this.nv + 1) * VERTEX_FLOATS > this.v.length) { const g = new Float32Array(this.v.length * 2); g.set(this.v); this.v = g; }
    const o = this.nv * VERTEX_FLOATS;
    const a = this.v;
    const nl = Math.hypot(nx, ny, nz) || 1;
    a[o] = px; a[o + 1] = py; a[o + 2] = pz; a[o + 3] = nx / nl; a[o + 4] = ny / nl; a[o + 5] = nz / nl;
    a[o + 6] = u; a[o + 7] = v; a[o + 8] = mat; a[o + 9] = page; a[o + 10] = flags; a[o + 11] = ao;
    a[o + 12] = sx; a[o + 13] = sy; a[o + 14] = e0; a[o + 15] = e1;
    if (px < this.min[0]) this.min[0] = px; if (py < this.min[1]) this.min[1] = py; if (pz < this.min[2]) this.min[2] = pz;
    if (px > this.max[0]) this.max[0] = px; if (py > this.max[1]) this.max[1] = py; if (pz > this.max[2]) this.max[2] = pz;
    return this.nv++;
  }
  tri(a: number, b: number, c: number): void {
    if (this.ni + 3 > this.ix.length) { const g = new Uint32Array(this.ix.length * 2); g.set(this.ix); this.ix = g; }
    this.ix[this.ni++] = a; this.ix[this.ni++] = b; this.ix[this.ni++] = c;
  }
  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }
  /** A grid's quads: `cols` × `rows` vertices laid out row-major from `first`. */
  gridQuads(first: number, cols: number, rows: number): void {
    for (let j = 0; j + 1 < rows; j++) for (let i = 0; i + 1 < cols; i++) {
      const a = first + j * cols + i;
      this.quad(a, a + 1, a + cols + 1, a + cols);
    }
  }
}

/** A built mesh: views onto the writer's arrays (copy before the next build) and the local bounds. */
export interface BuiltMesh {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly vcount: number;
  readonly icount: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

