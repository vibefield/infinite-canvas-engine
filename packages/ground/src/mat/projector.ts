// The gobo projector — pure 4×4 maths in three.js's conventions (column-major
// elements, the WebGL clip range z ∈ [−1, 1]), because the reference's baked
// projector camera and its depth linearisation are stated in them. A projector
// is a perspective camera; a receiver maps its world position through
// `projection · view` to clip space, divides, and reads the plate at the UV.
// The mouse "tilt" is a small rotation applied AFTER the projection — the
// reference's trick (it nudges the clip coordinates, which pans the shadow a
// little and shifts its blur), reproduced exactly rather than rationalised.
//
// Nothing here knows about the GPU: the tests pin every function against
// numbers three.js produced for the same inputs.

/** 16 column-major floats — `Matrix4.elements`, and what WGSL's `mat4x4f` reads. */
export type Mat4 = Float32Array;
/** The sixteen cells as a tuple: the length is the type, so a literal index needs no guard (ICE's kernel casts bounded reads the same way). */
export type Mat4Cells = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
export const cells = (m: Mat4): Mat4Cells => m as unknown as Mat4Cells;
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];   // x y z w

export interface ProjectorSpec {
  /** World metres, y up — the desk scene's frame. */
  readonly position: Vec3;
  readonly quaternion: Quat;
  readonly fovDeg: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

/** three's `makePerspective`, WebGL coordinate system. */
export function perspective(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  const top = near * Math.tan((fovDeg * Math.PI) / 360);
  const height = 2 * top;
  const width = aspect * height;
  const left = -0.5 * width;
  const right = left + width;
  const bottom = top - height;
  const x = (2 * near) / (right - left);
  const y = (2 * near) / (top - bottom);
  const a = (right + left) / (right - left);
  const b = (top + bottom) / (top - bottom);
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  const m = new Float32Array(16);
  m[0] = x; m[5] = y; m[8] = a; m[9] = b; m[10] = c; m[11] = -1; m[14] = d;
  return m;
}

/** Rotation matrix of a unit quaternion (three's `makeRotationFromQuaternion`). */
export function fromQuat(q: Quat): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float32Array(16);
  m[0] = 1 - (yy + zz); m[4] = xy - wz; m[8] = xz + wy;
  m[1] = xy + wz; m[5] = 1 - (xx + zz); m[9] = yz - wx;
  m[2] = xz - wy; m[6] = yz + wx; m[10] = 1 - (xx + yy);
  m[15] = 1;
  return m;
}

/** `a · b`, column-major. */
export function mul4(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
    m[col * 4 + row] = s;
  }
  return m;
}

/** The inverse of `translate(p) · rotate(q)`: `Rᵀ · translate(−p)` — a camera's `matrixWorldInverse`. */
export function rigidInverse(position: Vec3, q: Quat): Mat4 {
  const r = fromQuat(q);
  const m = new Float32Array(16);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) m[col * 4 + row] = r[row * 4 + col] as number;   // Rᵀ
  const [px, py, pz] = position;
  const e = cells(m);
  m[12] = -(e[0] * px + e[4] * py + e[8] * pz);
  m[13] = -(e[1] * px + e[5] * py + e[9] * pz);
  m[14] = -(e[2] * px + e[6] * py + e[10] * pz);
  m[15] = 1;
  return m;
}

/** `projection · view` for a projector — the matrix a receiver multiplies its world position by. */
export function projectorMatrix(spec: ProjectorSpec): Mat4 {
  return mul4(perspective(spec.fovDeg, spec.aspect, spec.near, spec.far), rigidInverse(spec.position, spec.quaternion));
}

/** three's `Quaternion.setFromEuler`, order XYZ. */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** The reference's mouse tilt: `rotate(euler) · base`, the rotation applied in clip space. */
export function tilted(base: Mat4, ex: number, ey: number, ez: number): Mat4 {
  return mul4(fromQuat(quatFromEuler(ex, ey, ez)), base);
}

/** A world point through the matrix: NDC xyz and clip w (the linear depth of a perspective projector). */
export function project(m: Mat4, p: Vec3): { ndc: [number, number, number]; w: number } {
  const [x, y, z] = p;
  const e = cells(m);
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  return { ndc: [cx / cw, cy / cw, cz / cw], w: cw };
}

/** mat.wgsl `blur_ratio` — the reference's `getGoboBlurRatio`: linearise the WebGL NDC z, then a ramp between two depths. */
export function blurRatio(ndcZ: number, sharp: number, soft: number, near: number, far: number): number {
  const lin = (2 * near * far) / (far + near - ndcZ * (far - near));
  return Math.min(Math.max((lin - sharp) / (soft - sharp), 0), 1);
}

/** The hero desk's projector, as baked in the reference (research/tree-shadow/prototype/src/scenes.js). */
export const HERO_PROJECTOR: ProjectorSpec = {
  position: [0.466854, 0.992917, -0.252766],
  quaternion: [0.16182, -0.776664, -0.221667, -0.566984],
  fovDeg: 60, aspect: 1, near: 0.01, far: 20,
};
