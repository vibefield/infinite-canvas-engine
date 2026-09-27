// The PHOTO's law — pure: no GPU (PHOTO.md). A print on the desk is a thin
// rigid sheet with a pose in 3D: a centre on the mat plane and a HEIGHT off
// it, a turn in the plane, a SLOPE (the tilt a held or gliding sheet takes),
// a bend (a pinched sheet droops away from the fingers). `stepPhoto` is its
// physics — held, it hangs from the grab point, which follows the finger
// exactly, and swings about it under inertia and air; let go, it glides on
// its air cushion, lands and grips the mat. `resolvePhoto` turns the pose into
// the GEOMETRY the pass draws, and `unproject` is the CPU mirror of
// photo.wgsl's ray cast, so what is picked is what is drawn.
//
// The camera is top-down and orthographic (thinking-the-desk §6); a lifted
// sheet reads near through ONE local perspective: an eye `law.eye` world units
// above the desk over the sheet's anchor (the grab point while held), so a
// sheet at height h reads eye/(eye − h) larger about the finger — the lift's
// scale is a consequence, not a number — and a tilted sheet keystones.
//
// World units are the desk's (CSS px at zoom 1; the note's scale — theme.ts
// PAPER.size 200 = 3″, so a 6×4 print is 400 long). Axes: x right, y down the
// screen, z up off the mat. Time in seconds.

import { MAT_COLORS, MAT_GRID, type RGB } from "@ice/desk";
import { PHYSICS, type Lamp, lampOf } from "@ice/desk/kit";

/**
 * The desk's ONE light: the mat's gobo projector as a lamp over the desk (paper.ts `lampOf` —
 * world (1930, −826), 994 up), the same the notes and the notebooks are lit and shadowed by.
 * Per print, the direction toward it from the print, and the shadow's ground slope away from
 * it, capped at `PHYSICS.shadow.slopeMax` (a print far from the lamp keeps a finite shadow).
 */
export const LAMP: Lamp = lampOf(MAT_GRID.plane);

/**
 * The shadow's two terms: the PENUMBRA is the note's (kit/physics.ts `PHYSICS.shadow`: σ at contact, alpha
 * resting, the slope's cap — one physics for every sheet on the desk; its growth and held alpha below) — and a
 * tight CONTACT term at the base that fades as the sheet rises off the mat (gone by `reach`), as
 * the notebook's slab has (the tree-shadow design system's `--lift-1`).
 */
export const DESK_SHADOW = {
  // σ grows 0.36 per unit, not the note's 0.75: a held print rides twice as high as a held note (24 vs 12), and at the
  // note's rate its shadow blurred into nothing — this keeps a held print's penumbra as soft as a held note's (σ ≈ 11).
  // PHOTO.md §8 Q-2: the one law may want to be this (or the note's lift may want to be the print's).
  penumbra: { sigma0: PHYSICS.shadow.sigma, sigmaPerHeight: 0.36, alpha: PHYSICS.shadow.alpha, alphaHeld: 0.42, slopeMax: PHYSICS.shadow.slopeMax },
  contact: { alpha: 0.22, sigma: 1.1, reach: 2.5 },
} as const;

/** The colour a shadow casts ON the mat — theme.ts `MAT.cast` (the tree-shadow design system's `--cast-rgb`, "the world's darkest value"). */
export const CAST: RGB = MAT_COLORS.cast;

const PHOTO_SPEC = {
  /** The print's long side — a 6×4 at the note's scale. */
  long: 400,
  /** The white border, as a fraction of the short side (a classic bordered print). 0 = borderless. */
  border: 0.05,
  /** The die-cut corner. */
  radius: 2.5,
  /** The paper under the emulsion: a resin-coated white, a touch warm (sRGB), and its fibre ±/255. */
  paper: [0.957, 0.953, 0.937] as RGB,
  grain: 1.5 / 255,
  /** The local eye's height over the desk: at h the sheet reads eye/(eye − h) larger. */
  eye: 720,
  /** How high a held sheet rides, and how far a hovered one rises (the edge lifting under the finger). */
  lift: 24,
  hover: 2.2,
  /** Where a pasted print starts its fall from. */
  arrive: 70,
  /** The height spring: rising under the hand, falling to the mat (Hz, ζ), and the landing's bounce (restitution; below this speed it just settles). */
  rise: { hz: 5.5, zeta: 0.82 },
  fall: { hz: 3.6, zeta: 0.5, restitution: 0.18, settle: 30 },
  /**
   * The tilt (the sheet's slope): toward the fingers while held (the far edge hangs lowest — degrees at
   * the far corner), with the air while it moves (the leading edge rides up — degrees per 1000 u/s),
   * never past `max`; a spring (Hz, ζ) so it wobbles once when the hand stops.
   */
  tilt: { grab: 3, motion: 5, max: 12, hz: 3.2, zeta: 0.42 },
  /** The bend: a held sheet droops away from the fingers (units at the far corner); a resting print keeps a faint curl along its long side. */
  bend: { held: 5, rest: 0.9, rate: 9 },
  /**
   * The swing about the grab point: `drag` = the air's pull on the sheet's centre (the centre trails the
   * motion), `inertia` = the share of the hand's acceleration the sheet feels (it swings when the hand
   * jerks or stops), `damp` = rotational damping per second. OFF (James, 2026-09-24: "do not make them
   * rotate") — a carried print keeps its turn; only the wheel turns it. The machinery stays for the panel.
   */
  swing: { drag: 0, inertia: 0, damp: 2.2 },
  /**
   * Sliding: in the air a glide with `air` drag per second; on the mat the cutting mat's grip — a
   * constant deceleration (u/s²) plus a viscous share per second; the same for the turn (rad/s², /s).
   */
  slide: { air: 0.9, grip: 2400, viscous: 5, spinGrip: 7, spinViscous: 4 },
  /** A flick's velocity is the hand's over this window (s), capped at this speed (u/s). */
  throw: { window: 0.07, max: 4200 },
  /** The shadow's two terms (`DESK_SHADOW`). */
  shadow: DESK_SHADOW,
  /** The gloss: the lamp's highlight (strength, shininess), and the room's sheen off the coating (strength). */
  gloss: { spec: 0.2, shininess: 42, sheen: 0.5 },
  /**
   * By night (PHOTO.md §4a): the print is lit by the Moon at the mat's night law — `level` of its day
   * luminance in the Moon's light (MAT.md: the moonlit sage shows at ½ the sunlit) — the palm's shade
   * deepening to the sky's fill; its paper seen as the mat is (the rods' blue), its picture foveally
   * (`keep` 1 = cones alone, white-balanced: the picture's hue exactly).
   */
  night: { level: 0.5, keep: 1 },
  /** Going away (delete): the sheet lifts and fades over this long (s). */
  leave: 0.28,
} as const;

/** The law with its literals widened — what a host tunes (a copy: `structuredClone(PHOTO)`). */
type Widen<T> = T extends number ? number : T extends RGB ? RGB : { -readonly [K in keyof T]: Widen<T[K]> };
export type PhotoLaw = Widen<typeof PHOTO_SPEC>;
/** The engine's numbers. Never written — a host tunes its own copy. */
export const PHOTO: PhotoLaw = PHOTO_SPEC;

/** The unit direction toward the lamp from a point of the desk at height z (x right, y down, z up). */
export function lightAt(x: number, y: number, z = 0, lamp: Lamp = LAMP): readonly [number, number, number] {
  const dx = lamp.x - x;
  const dy = lamp.y - y;
  const dz = lamp.h - z;
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
}

/** A cast shadow's offset on the mat per unit of height at a desk point — away from the lamp, capped. */
export function shadowSlope(x: number, y: number, lamp: Lamp = LAMP, max: number = DESK_SHADOW.penumbra.slopeMax): readonly [number, number] {
  const h = Math.max(lamp.h, 1e-6);
  let sx = -(lamp.x - x) / h;
  let sy = -(lamp.y - y) / h;
  const m = Math.hypot(sx, sy);
  if (m > max) { sx *= max / m; sy *= max / m; }
  return [sx, sy];
}

// ---------------------------------------------------------------- the body

export interface Hold {
  /** The grab point in the sheet's own frame (unrotated, centre origin). */
  gx: number; gy: number;
  /** The finger, world — where the grab point is, exactly. */
  px: number; py: number;
  /** The finger's filtered velocity and acceleration (world/s, world/s²). */
  vx: number; vy: number; ax: number; ay: number;
  /** Recent finger samples for the flick: [t, x, y]. */
  trail: [number, number, number][];
}

export interface PhotoBody {
  /** Centre on the mat plane, world. */
  x: number; y: number;
  /** The turn in the plane, radians (positive = clockwise on screen). */
  angle: number;
  vx: number; vy: number; spin: number;
  /** Height of the centre off the mat, and its rate. */
  h: number; vh: number;
  /** The slope (dz/dx, dz/dy, world axes) and its rate. */
  sx: number; sy: number; vsx: number; vsy: number;
  bend: number;
  /** Half extents (world). */
  readonly hx: number; readonly hy: number;
  /** The perspective's anchor in the sheet's frame — the grab point while held (so the finger's point never slides), kept after. */
  ax: number; ay: number;
  hold: Hold | null;
  hovered: boolean;
  /** Presence: 1 here, falling to 0 as it leaves; `leaving` = on its way out. */
  alpha: number;
  leaving: boolean;
}

export function newBody(x: number, y: number, w: number, h: number, angle = 0, height = 0): PhotoBody {
  return {
    x, y, angle, vx: 0, vy: 0, spin: 0, h: height, vh: 0, sx: 0, sy: 0, vsx: 0, vsy: 0,
    bend: PHOTO.bend.rest, hx: w / 2, hy: h / 2, ax: 0, ay: 0, hold: null, hovered: false, alpha: 1, leaving: false,
  };
}

/** The print's size for an image: the long side is `law.long`, the aspect is the picture's. */
export function printSize(imgW: number, imgH: number, long: number = PHOTO.long): { w: number; h: number } {
  const k = long / Math.max(imgW, imgH, 1);
  return { w: Math.max(imgW * k, 8), h: Math.max(imgH * k, 8) };
}

const rot = (a: number, x: number, y: number): [number, number] => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
};
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const clampLen = (x: number, y: number, max: number): [number, number] => {
  const l = Math.hypot(x, y);
  return l > max && l > 0 ? [(x * max) / l, (y * max) / l] : [x, y];
};
/** A damped spring's acceleration toward `target` (Hz, ζ). */
const spring = (x: number, v: number, target: number, hz: number, zeta: number) => {
  const w = 2 * Math.PI * hz;
  return w * w * (target - x) - 2 * zeta * w * v;
};

/** Take hold of the sheet at a world point (the finger), in its own frame. */
export function grab(b: PhotoBody, wx: number, wy: number, t: number): void {
  const [gx, gy] = rot(-b.angle, wx - b.x, wy - b.y);
  b.hold = { gx, gy, px: wx, py: wy, vx: 0, vy: 0, ax: 0, ay: 0, trail: [[t, wx, wy]] };
  b.ax = gx; b.ay = gy;
  b.vx = 0; b.vy = 0; b.spin = 0;
}

/** The finger moved (world, at time t in seconds). */
export function moveHold(b: PhotoBody, wx: number, wy: number, t: number): void {
  const H = b.hold;
  if (!H) return;
  H.px = wx; H.py = wy;
  H.trail.push([t, wx, wy]);
  while (H.trail.length > 2 && t - (H.trail[0] as [number, number, number])[0] > 0.25) H.trail.shift();
}

/** Let go at time t: the sheet leaves with the finger's recent velocity (and its own swing). */
export function release(b: PhotoBody, t: number, law: PhotoLaw = PHOTO): void {
  const H = b.hold;
  if (!H) return;
  // the flick: the finger's displacement over the last `window` seconds — a finger that stopped before letting go throws nothing
  const recent = H.trail.filter(([ts]) => t - ts <= law.throw.window);
  let vx = 0;
  let vy = 0;
  if (recent.length >= 2) {
    const a = recent[0] as [number, number, number];
    const z = recent[recent.length - 1] as [number, number, number];
    const dt = Math.max(z[0] - a[0], 1 / 240);
    if (t - z[0] < law.throw.window) { vx = (z[1] - a[1]) / dt; vy = (z[2] - a[2]) / dt; }
  }
  // the centre's velocity = the grab point's + the swing's (ω × r); a print never leaves the hand spinning
  const [rx, ry] = rot(b.angle, -H.gx, -H.gy);
  [b.vx, b.vy] = clampLen(vx - b.spin * ry, vy + b.spin * rx, law.throw.max);
  b.spin = 0;
  b.hold = null;
}

/** Turn a held sheet about the finger (the wheel), radians. */
export function twist(b: PhotoBody, da: number): void {
  if (b.hold) { b.angle += da; place(b); } else { b.spin += da * 8; }
}

/** A held sheet's centre from its grab point and turn. */
function place(b: PhotoBody): void {
  const H = b.hold;
  if (!H) return;
  const [rx, ry] = rot(b.angle, -H.gx, -H.gy);
  b.x = H.px + rx; b.y = H.py + ry;
}

/** Is the sheet still moving (or still settling)? A host renders on demand while any is. */
export function restless(b: PhotoBody): boolean {
  return b.hold !== null || b.leaving || Math.abs(b.vx) + Math.abs(b.vy) > 0.5 || Math.abs(b.spin) > 1e-3 || Math.abs(b.vh) > 0.05
    || Math.abs(b.h - (b.hovered ? PHOTO.hover : 0)) > 0.02 || Math.abs(b.sx) + Math.abs(b.sy) > 1e-4 || Math.abs(b.vsx) + Math.abs(b.vsy) > 1e-4;
}

/** The half diagonal — the reach of a corner from the centre. */
const diag = (b: PhotoBody) => Math.hypot(b.hx, b.hy);

/** Advance the body by `dt` seconds (substepped at 240 Hz). */
export function stepPhoto(b: PhotoBody, dt0: number, law: PhotoLaw = PHOTO): void {
  let dt = dt0;
  if (dt <= 0) return;
  dt = Math.min(dt, 0.05);
  const H = b.hold;
  // the finger's velocity and acceleration, filtered once per frame (pointer events are discrete)
  let g0x = 0;
  let g0y = 0;
  if (H) {
    const [rx, ry] = rot(b.angle, H.gx, H.gy);
    g0x = b.x + rx; g0y = b.y + ry;   // where the grab point was last frame
    const kv = 1 - Math.exp(-dt / 0.03);
    const ka = 1 - Math.exp(-dt / 0.045);
    const nvx = H.vx + ((H.px - g0x) / dt - H.vx) * kv;
    const nvy = H.vy + ((H.py - g0y) / dt - H.vy) * kv;
    H.ax += ((nvx - H.vx) / dt - H.ax) * ka; H.ay += ((nvy - H.vy) / dt - H.ay) * ka;
    H.vx = nvx; H.vy = nvy;
  }
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  const I = (b.hx * b.hx + b.hy * b.hy) / 3;   // a plate's moment about its centre per unit mass: (w² + h²)/12 = (hx² + hy²)/3
  for (let i = 0; i < n; i++) {
    if (H) {
      // the grab point walks from where it was to the finger over the frame
      const f = (i + 1) / n;
      const gx = g0x + (H.px - g0x) * f;
      const gy = g0y + (H.py - g0y) * f;
      const [rx, ry] = rot(b.angle, -H.gx, -H.gy);   // grab point → centre
      const IG = I + rx * rx + ry * ry;
      const vcx = H.vx - b.spin * ry;
      const vcy = H.vy + b.spin * rx;
      const tau = cross(rx, ry, -H.ax * law.swing.inertia, -H.ay * law.swing.inertia) + cross(rx, ry, -vcx * law.swing.drag, -vcy * law.swing.drag);
      b.spin += (tau / IG - law.swing.damp * b.spin) * h;
      b.angle += b.spin * h;
      const [nx, ny] = rot(b.angle, -H.gx, -H.gy);
      b.x = gx + nx; b.y = gy + ny;
      b.vx = H.vx - b.spin * ny; b.vy = H.vy + b.spin * nx;
    } else {
      const onMat = b.h < law.hover + 0.6;   // a hovered print only lifts its edge: it still grips
      const s = Math.hypot(b.vx, b.vy);
      if (!onMat) {
        const k = Math.exp(-law.slide.air * h);
        b.vx *= k; b.vy *= k; b.spin *= Math.exp(-law.slide.air * 1.5 * h);
      } else if (s > 0) {
        const ns = Math.max(0, s - (law.slide.grip + law.slide.viscous * s) * h);
        b.vx *= ns / s; b.vy *= ns / s;
      }
      if (onMat) {
        const w = Math.abs(b.spin);
        const nw = Math.max(0, w - (law.slide.spinGrip + law.slide.spinViscous * w) * h);
        b.spin = w > 0 ? (b.spin * nw) / w : 0;
      }
      b.x += b.vx * h; b.y += b.vy * h; b.angle += b.spin * h;
    }

    // the height: up under the hand, down to the mat; the mat is a floor
    const target = b.leaving ? law.lift * 1.6 : H ? law.lift : b.hovered ? law.hover : 0;
    const up = target > b.h;
    b.vh += spring(b.h, b.vh, target, up ? law.rise.hz : law.fall.hz, up ? law.rise.zeta : law.fall.zeta) * h;
    b.h += b.vh * h;
    if (b.h < 0) { b.h = 0; b.vh = b.vh < -law.fall.settle ? -b.vh * law.fall.restitution : 0; }

    // the slope: toward the fingers, with the air; flat on the mat
    const aloft = Math.min(b.h / law.lift, 1);
    const tanMax = Math.tan((law.tilt.max * Math.PI) / 180);
    let tx = 0;
    let ty = 0;
    if (H) {
      const [gx, gy] = rot(b.angle, H.gx, H.gy);   // centre → grab point
      const k = Math.tan((law.tilt.grab * Math.PI) / 180) / diag(b);
      tx += gx * k; ty += gy * k;
    }
    const km = (Math.tan((law.tilt.motion * Math.PI) / 180) / 1000) * aloft;
    tx += b.vx * km; ty += b.vy * km;
    [tx, ty] = clampLen(tx, ty, tanMax);
    b.vsx += spring(b.sx, b.vsx, tx, law.tilt.hz, law.tilt.zeta) * h;
    b.vsy += spring(b.sy, b.vsy, ty, law.tilt.hz, law.tilt.zeta) * h;
    b.sx += b.vsx * h; b.sy += b.vsy * h;

    // the bend: a pinched sheet droops, a resting one keeps its curl
    const bendTarget = H ? law.bend.held * Math.min(Math.hypot(H.gx, H.gy) / diag(b) + 0.35, 1) : law.bend.rest;
    b.bend += (bendTarget - b.bend) * (1 - Math.exp(-law.bend.rate * h));

    clearMat(b);
  }
  // presence: out over `leave`; a new print comes in over a few frames (never a pop)
  b.alpha = b.leaving ? Math.max(0, b.alpha - dt / law.leave) : Math.min(1, b.alpha + dt / 0.12);
}

/**
 * No corner goes through the mat: the lowest point of the tilted, drooping sheet is the
 * centre's height less the slope's fall to the far corner less the droop — when that is
 * under 0 the slope gives (the far corner rests on the mat while the near one lifts, as a
 * sheet lifted by its corner does) and its rate with it.
 */
export function clearMat(b: PhotoBody): void {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const fall = Math.abs(b.sx * c + b.sy * s) * b.hx + Math.abs(-b.sx * s + b.sy * c) * b.hy;
  const room = Math.max(b.h - droopOf(b), 0);
  if (fall > room) {
    const k = fall > 0 ? room / fall : 0;
    b.sx *= k; b.sy *= k; b.vsx *= k; b.vsy *= k;
  }
}

/** How far the droop lowers the far corner: only a held sheet droops (the rest curl rises), and never below the mat — a sheet just lifted drapes on it. */
const droopOf = (b: PhotoBody) => (b.hold ? Math.min(b.bend, b.h) : 0);

// ---------------------------------------------------------------- the geometry

export type Vec3 = readonly [number, number, number];

export interface PhotoGeometry {
  /** The sheet's centre in 3D (world units, z = height). */
  readonly centre: Vec3;
  /** The sheet's own axes in 3D (unit) and its normal. */
  readonly ex: Vec3; readonly ey: Vec3; readonly n: Vec3;
  readonly half: readonly [number, number];
  readonly radius: number;
  /** The local eye (world units): over the anchor, `law.eye` above the mat. */
  readonly eye: Vec3;
  /** The bend: the droop's amount and where it hangs from (the sheet's frame); the rest curl. Signed (droop, held). */
  readonly droop: number; readonly curl: number;
  readonly grab: readonly [number, number];
  readonly alpha: number;
  /** Toward the lamp from the print (unit), the shadow's slope on the mat, the penumbra's alpha (resting → held). */
  readonly light: Vec3;
  readonly slope: readonly [number, number];
  readonly shadowAlpha: number;
  /** The world rect the pass's quad covers: the sheet as seen and its shadow. */
  readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The pose → what the pass draws and the hit-test reads. */
export function resolvePhoto(b: PhotoBody, law: PhotoLaw = PHOTO, lamp: Lamp = LAMP): PhotoGeometry {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const n = norm([-b.sx, -b.sy, 1]);
  // the sheet's x axis: its in-plane direction lifted onto the tilted plane; y completes the frame (n × ex points down-screen, as y does)
  const ex = norm([c, s, b.sx * c + b.sy * s]);
  const ey = crs(n, ex);
  let centre: Vec3 = [b.x, b.y, b.h];
  const [axw, ayw] = rot(b.angle, b.ax, b.ay);
  let eye: Vec3 = [b.x + axw, b.y + ayw, law.eye];
  if (b.hold) {
    // a tilted sheet is shorter over the mat by the tilt's cosine: pin the grab point, as drawn, to the finger — and the eye over it
    const g = pointAt({ centre, ex, ey }, b.hold.gx, b.hold.gy);
    centre = [b.x + b.hold.px - g[0], b.y + b.hold.py - g[1], b.h];
    eye = [b.hold.px, b.hold.py, law.eye];
  }
  const G: Omit<PhotoGeometry, "bounds"> = {
    centre, ex, ey, n, half: [b.hx, b.hy], radius: law.radius, eye,
    droop: droopOf(b), curl: b.hold ? 0 : b.bend, grab: [b.hold?.gx ?? b.ax, b.hold?.gy ?? b.ay], alpha: b.alpha,
    light: lightAt(b.x, b.y, b.h, lamp), slope: shadowSlope(b.x, b.y, lamp, law.shadow.penumbra.slopeMax),
    shadowAlpha: law.shadow.penumbra.alpha + (law.shadow.penumbra.alphaHeld - law.shadow.penumbra.alpha) * Math.min(Math.max(b.h / law.lift, 0), 1),
  };
  // bounds: every corner as seen and as cast, grown by the widest blur and the bend
  const slope = G.slope;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  let hmax = 0;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const P = pointAt(G, u * b.hx, v * b.hy);
    const [px, py] = project(eye, P);
    hmax = Math.max(hmax, P[2] + b.bend);
    for (const [qx, qy] of [[px, py], [P[0] + slope[0] * (P[2] + b.bend), P[1] + slope[1] * (P[2] + b.bend)]] as const) {
      x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
    }
  }
  const pad = 3 * (law.shadow.penumbra.sigma0 + law.shadow.penumbra.sigmaPerHeight * hmax) + 2 * b.bend + 4;
  return { ...G, bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } };
}

/** The sheet's own frame → a 3D point on its (flat) plane. */
export function pointAt(G: Pick<PhotoGeometry, "centre" | "ex" | "ey">, u: number, v: number): Vec3 {
  return [G.centre[0] + G.ex[0] * u + G.ey[0] * v, G.centre[1] + G.ex[1] * u + G.ey[1] * v, G.centre[2] + G.ex[2] * u + G.ey[2] * v];
}

/** A 3D point as the local eye sees it on the desk plane (world units). */
export function project(eye: Vec3, P: Vec3): [number, number] {
  const k = eye[2] / Math.max(eye[2] - P[2], 1e-3);
  return [eye[0] + (P[0] - eye[0]) * k, eye[1] + (P[1] - eye[1]) * k];
}

/** The bend's offset along the normal at a point of the sheet (photo.wgsl `photo_bend`). */
export function bendAt(G: Pick<PhotoGeometry, "half" | "droop" | "curl" | "grab">, u: number, v: number): number {
  const d = Math.hypot(u - G.grab[0], v - G.grab[1]) / (2 * Math.hypot(G.half[0], G.half[1]));
  const cu = u / Math.max(G.half[0], G.half[1]);
  return G.curl * cu * cu - G.droop * d * d;
}

/** A desk point (world) → the point of the sheet the eye sees there, in the sheet's frame (photo.wgsl `photo_unproject`). */
export function unproject(G: PhotoGeometry, wx: number, wy: number): [number, number] {
  const D: Vec3 = [wx - G.eye[0], wy - G.eye[1], -G.eye[2]];
  const hit = (lift: number): [number, number] => {
    const C: Vec3 = [G.centre[0] + G.n[0] * lift, G.centre[1] + G.n[1] * lift, G.centre[2] + G.n[2] * lift];
    const t = dot(G.n, sub(C, G.eye)) / dot(G.n, D);
    const P: Vec3 = [G.eye[0] + D[0] * t, G.eye[1] + D[1] * t, G.eye[2] + D[2] * t];
    const r = sub(P, C);
    return [dot(r, G.ex), dot(r, G.ey)];
  };
  const [u0, v0] = hit(0);
  return hit(bendAt(G, u0, v0));
}

export function sdRoundBox(qx: number, qy: number, hx: number, hy: number, r: number): number {
  const rr = Math.min(Math.max(r, 0), hx, hy);
  const ax = Math.abs(qx) - hx + rr;
  const ay = Math.abs(qy) - hy + rr;
  return Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0) - rr;
}

/** Is the desk point on the sheet as drawn? */
export function hitPhoto(G: PhotoGeometry, wx: number, wy: number): boolean {
  const [u, v] = unproject(G, wx, wy);
  return sdRoundBox(u, v, G.half[0], G.half[1], G.radius) < 0;
}
