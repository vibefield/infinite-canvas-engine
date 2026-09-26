// The NOTEBOOK (NOTEBOOK.md) as a kind (kind.ts): the real 3D book behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`, registered `composite`: the
// pass renders EVERY book into a layer of its own in `prepare` — each book's shadow map, then the 4×
// layer (the books, then the mat under them), recorded into the frame's encoder after the mat's wind —
// and its one run is the layer laid over the frame, after every other run of the stratum (the
// prototype's "books above everything": its lab drew them in a command buffer of their own after the
// ground's). The composite lays every book at once, so a thing laid ON a notebook still draws under it:
// interleaving books among other things needs a layer per run of books (design-015 §4.2 — D-D4's
// exception, named, D-D3r-b.2). The desk eye (eye.ts) is the slot's view's; the law and the ruling's
// ink are the host's (a lab's panel edits the law; the ink is the product's colour — the theme gate).
// ROOT ONLY (D-D18): a spawned slot's pass draws nothing (kinds/layer.ts).
//
// And its WORLD half (kinds/world.ts; D3w): `notebookKind` — an entity of the notebook's widget type becomes a
// `NotebookDraw` exactly as the lab's `makeBook` → `resolveBooks` → `drawBooks` makes one: its motion from the
// durable spread (`spread` sheets turned onto the left) and a still's FLUX pin (open, a sheet mid-turn, the
// peek, the tilt — the kind's own state, never a Grab), its lift the builder's (held ← Grab: 30 units through
// the desk eye, the hover's 3.5), its ring the selection's — never under a lifted or an open book —, its tilt
// into the carry's motion (the rect's velocity, sprung), its mesh rebuilt only when its pose moves. Its hit is
// `pickNotebook`: the eye's ray through the SAME desk eye the pass draws with (the geometry carries it), into
// the case or a page — `content` either way (the parts, the turn zones and the pen, are D3t's). Its colours
// are the product's (`theme()`: the covers, the page, the ruling's ink — set on the root pass by the kind's
// local, the theme gate). A deleted book is gone at once (NOTEBOOK.md: instant) — its ghost draws nothing.

import type { Entity } from "@ice/core";
import type { KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../mat/mat-pass";
import { type DeskEye, eyeOf } from "../notebook/eye";
import { NOTEBOOK, type NotebookLaw } from "../notebook/law";
import { type NotebookLook, type Ruling, RULINGS } from "../notebook/layout";
import { type BuiltMesh, buildMesh, MeshWriter } from "../notebook/mesh";
import { newMotion, type NotebookMotion, poseKey, poseOf, tiltToward, withDesk } from "../notebook/motion";
import { type NotebookDraw, NotebookPass } from "../notebook/pass";
import { pickNotebook } from "../notebook/pick";
import { lampDir, type Rigid, rigidOf } from "../notebook/place";
import { NOTEBOOK_SHADER_FILES, notebookShaders } from "../notebook/shaders";
import { coverFrame, type Frame, frameOf, type NotebookPose, relaxOf, specOf, swingOf } from "../notebook/shape";
import { type ShaderText, shaderText } from "../shaders";
import { settled, spring } from "../springs";
import { HOLD } from "../hold/pose";
import { MAT_COLORS, type Palette, type RGB, type RGBA, rgb, type ThemeName, type TokenRef } from "../theme";
import type { MarkFrame } from "../marks/layout";
import { LayeredKind } from "./layer";
import { type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectHit, type ObjectKind, stringProp } from "./world";

/** The notebook's kind name — its key in the registry and in every slot's `objects`. */
export const NOTEBOOK_KIND = "notebook";

/** No ink: what the knobs carry while no book draws (a host sets `ruleInk` before one does). */
const NO_INK: RGBA = [0, 0, 0, 0];

export class NotebookKind extends LayeredKind<NotebookDraw, NotebookPass> {
  /** The notebook's law — its eye, its light and shadow, its lift: the host's (a lab's panel edits it); `NOTEBOOK` until one says. */
  law: NotebookLaw = NOTEBOOK;
  /** The ruling's ink and its presence on the page — the PRODUCT's colour (the theme gate): a host sets it before a book draws. */
  ruleInk: RGBA | null = null;

  /** Root only (D-D18): a spawned slot's pass — a mini mat's inside, a flight's departed desk — holds nothing and draws nothing. */
  spawn(_mat: MatPass): NotebookKind { return new NotebookKind(null); }

  /** The pass's own `prepare`, as the prototype's lab called it: the slot's camera, grid, clocks and light, the desk eye over the slot's view, the law, the colours. */
  protected prepareOwn(pass: NotebookPass, s: SlotContext, records: readonly NotebookDraw[]): number {
    if (records.length > 0 && !this.ruleInk) throw new Error("notebook: the ruling's ink is the host's (the theme gate) — set the kind's `ruleInk` before a book draws");
    const v = s.view;
    const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, this.law.eye);
    // a deleted book is gone at once (D3w: its ghost's record is marked, never drawn)
    const shown = records.some((r) => VANISHED.has(r)) ? records.filter((r) => !VANISHED.has(r)) : records;
    return pass.prepare(v, s.fadeIn, s.cfg, s.frame, s.light, eye, this.law, { cast: MAT_COLORS.cast, select: s.select, ruleInk: this.ruleInk ?? NO_INK }, shown);
  }
}

/** The records of books being deleted: NOTEBOOK.md's delete is instant, so a ghost's record is kept out of the pass. */
const VANISHED = new WeakSet<NotebookDraw>();

/** The notebook's program for a host's shader text: its pass made on the root's mat; its objects one composite run, last in `things`. */
export function notebookProgram(text: ShaderText): KindProgram<NotebookDraw> {
  return {
    name: NOTEBOOK_KIND,
    stratum: "things",
    composite: true,
    create: async (device, format, mat) => new NotebookKind(await NotebookPass.create(device, format, notebookShaders(text(NOTEBOOK_SHADER_FILES)), mat)),
  };
}

// ---------------------------------------------------------------- the world half (D3w)

/**
 * What the notebook's kind takes from the host's palette (NOTEBOOK.md's covers): the page, the ruling's ink and its
 * presence, and each cover by name — its cloth, band, three accents, endpaper, its design and whether it is paper.
 */
export interface NotebookPalette extends Palette {
  readonly notebooks?: {
    readonly paper: TokenRef;
    readonly ink: TokenRef;
    /** The ruling's presence on the page (the dots, the rules), 0 … 1. */
    readonly rule: number;
    readonly covers: Readonly<Record<string, { readonly cloth: TokenRef; readonly band: TokenRef; readonly a: TokenRef; readonly b: TokenRef; readonly c: TokenRef; readonly endpaper: TokenRef; readonly design: NotebookLook["design"]; readonly paperCover: boolean }>>;
  };
}

/** The notebook's look for a theme, parsed: each cover's `NotebookLook`, the ruling's ink with its presence. */
export interface NotebookObjectLook {
  readonly covers: Readonly<Record<string, NotebookLook>>;
  readonly ruleInk: RGBA;
}

/** A book's still, pinned on the kind's own state (a FLUX pin — D-D2a-world.5): open (or a swing, 0 … 1), a sheet mid-turn, the peek, the tilt. */
export interface BookPose {
  readonly open?: boolean | number;
  readonly turn?: { readonly dir: 1 | -1; readonly phi: number; readonly psi: number; readonly twist?: number };
  readonly peek?: number;
  readonly tilt?: readonly [number, number];
}

/** A book as the builder resolved it: what its record draws, and what its hit reads — the same eye the pass draws with. */
export interface NotebookGeometry {
  readonly frame: Frame;
  readonly pose: NotebookPose;
  readonly mesh: BuiltMesh;
  readonly version: number;
  readonly rigid: Rigid;
  readonly lamp: readonly [number, number, number];
  readonly theta: number;
  readonly ring: number;
  readonly eye: DeskEye;
  readonly fade: number;
  /** Where it lies: the case's centre on the mat and its turn (the placement's, before the lift and the tilt). */
  readonly cx: number;
  readonly cy: number;
  readonly angle: number;
}

/** The notebook's own state on one desk: each book's id, mesh and pinned pose, the carry's tilt; the ruling's ink on the root pass. */
export interface Books extends KindLocal {
  /** A still's pose on `e` (undefined unpins). */
  pin(e: Entity, pose: BookPose | undefined): void;
  /** The world half's: the book's pin and its tilt state. */
  state(e: Entity): BookState;
  /** The world half's: the mesh for a pose, rebuilt only when the pose moved. */
  meshFor(e: Entity, F: Frame, pose: NotebookPose, law: NotebookLaw): { readonly mesh: BuiltMesh; readonly version: number };
  /** The world half's: the ruling's ink on the root pass — the product's colour (the theme gate). */
  ink(rule: RGBA): void;
}

interface BookState {
  readonly id: number;
  pose: BookPose | undefined;
  /** The carry's tilt (radians about x and y), sprung into the rect's motion; where the rect was. */
  tiltX: number; tiltXV: number; tiltY: number; tiltYV: number;
  lastX: number; lastY: number;
  /** The cover IN HAND (D4b): its swing 0 shut … 1 open on the hand's spring, and its velocity. */
  coverT: number; coverV: number;
  writer: MeshWriter | null;
  mesh: BuiltMesh | null;
  key: string;
  version: number;
}

/** The notebook's `local()`. */
export function createBooks(host: KindHost): Books {
  const books = new Map<Entity, BookState>();
  let next = 1;
  let woke = false;
  const state = (e: Entity): BookState => {
    let st = books.get(e);
    if (st === undefined) { st = { id: next++, pose: undefined, tiltX: 0, tiltXV: 0, tiltY: 0, tiltYV: 0, lastX: Number.NaN, lastY: Number.NaN, coverT: 0, coverV: 0, writer: null, mesh: null, key: "", version: 0 }; books.set(e, st); }
    return st;
  };
  return {
    pin(e, pose) { state(e).pose = pose; woke = true; },
    state,
    meshFor(e, F, pose, law) {
      const st = state(e);
      const key = `${poseKey(pose)}#${F.spec.sheets}`;
      if (st.mesh === null || key !== st.key) {
        st.writer ??= new MeshWriter();
        st.mesh = buildMesh(st.writer, F, pose, law);
        st.key = key;
        st.version += 1;
      }
      return { mesh: st.mesh, version: st.version };
    },
    ink(rule) {
      const k = host.pass();
      if (!(k instanceof NotebookKind)) return;
      const had = k.ruleInk;
      if (had === null || had[0] !== rule[0] || had[1] !== rule[1] || had[2] !== rule[2] || had[3] !== rule[3]) k.ruleInk = rule;
    },
    tick() { const w = woke; woke = false; return w; },
    forget(e) { books.delete(e); },
    dispose() { books.clear(); },
  };
}

/** A book's DEFAULT turn on the mat when a host lays one: the lab's `makeBook` (never set down quite square). */
export const bookAngle = (seed: number): number => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s) - 0.5) * 0.06; };

/**
 * How far a book's drawing reaches past its closed case, world units: the open spread to its left (a cover and the
 * spine), the lift (held and opening) seen through the desk eye and cast along the lamp's capped slope, blurred.
 */
export function notebookReach(law: NotebookLaw = NOTEBOOK): number {
  const F = frameOf(specOf(law));
  const h = law.lift.held + law.lift.open + law.lift.hover;
  return F.W + F.sw + law.shadow.slopeMax * h + 3 * (law.shadow.sigma0 + law.shadow.perUnit * h) + F.W * (law.eye.min / (law.eye.min - h) - 1);
}

/**
 * A book's silhouette for the desk's marks (D4a — the brackets, a member's ticks, the tape): the footprint of its case on
 * the mat at its turn — the closed case W × H about the book's centre and, as the cover swings over, the cover's own
 * footprint beside it (open, the whole spread) — with the fore-edge's corner. The height's parallax aside, as the print's:
 * the marks go around where the book LIES. The oracle's marks read the same function (oracle/frame.mjs).
 */
export function bookFrame(F: Frame, theta: number, cx: number, cy: number, angle: number): MarkFrame {
  const c = coverFrame(F, theta);
  const x0 = Math.min(-F.W / 2, c.ox, c.ox + c.ux * F.W);
  const x1 = F.W / 2;
  const mid = (x0 + x1) / 2;
  return { cx: cx + mid * Math.cos(angle), cy: cy + mid * Math.sin(angle), hx: (x1 - x0) / 2, hy: F.H / 2, angle, r: F.spec.coverRadius };
}

/** The notebook's silhouette on a resolved book (`bookFrame` on its geometry). */
export const notebookFrame = (G: NotebookGeometry): MarkFrame => bookFrame(G.frame, G.theta, G.cx, G.cy, G.angle);

const clamp = (x: number, a: number, b: number): number => Math.min(Math.max(x, a), b);
/** One damped spring step (the motion's own: semi-implicit Euler). */
const springStep = (x: number, v0: number, to: number, hz: number, z: number, h: number): [number, number] => {
  const w = 2 * Math.PI * hz;
  const v = v0 + (w * w * (to - x) - 2 * z * w * v0) * h;
  return [x + v * h, v];
};

export interface NotebookKindOptions {
  readonly text?: ShaderText;
  /** The notebook's numbers (notebook/law.ts `NOTEBOOK`) — the engine's unless a host tweaks them. */
  readonly law?: NotebookLaw;
}

/** The notebook's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the lab's own book. */
export function notebookKind(opts: NotebookKindOptions = {}): ObjectKind<NotebookGeometry, NotebookDraw, NotebookObjectLook> {
  const law = opts.law ?? NOTEBOOK;
  const program = notebookProgram(opts.text ?? shaderText);
  const F = frameOf(specOf(law, { sheets: law.block.sheets }));
  const sheets = F.spec.sheets;
  return {
    ...program,
    reach: notebookReach(law),
    local: (host: KindHost): Books => createBooks(host),
    resolve(ctx: ObjectContext): NotebookGeometry {
      const books = ctx.local as Books | undefined;
      const st = books?.state(ctx.entity);
      const pin = st?.pose;
      const left = clamp(Math.round(numberProp(ctx.props, "spread", 0)), 0, sheets);
      // IN HAND (design-015 §8, D4b): the cover swings toward its target on the hand's spring (a palm's — 1.4 Hz, ζ .78), snapped for
      // a still; the swing is the kind's `openness`, which the builder reads to time the flight home. On the desk the cover is shut.
      const held = ctx.held;
      let cover: number | undefined;
      if (st !== undefined) {
        if (held === undefined) { st.coverT = 0; st.coverV = 0; }
        else {
          const target = held.open ? 1 : 0;
          if (held.snap) { st.coverT = target; st.coverV = 0; }
          else {
            [st.coverT, st.coverV] = spring(st.coverT, st.coverV, target, HOLD.cover.hz, HOLD.cover.zeta, ctx.dt);
            if (settled(st.coverT, st.coverV, target, 1e-3)) { st.coverT = target; st.coverV = 0; }
          }
          cover = st.coverT;
        }
      }
      const open = cover !== undefined ? cover : pin?.open;
      const m: NotebookMotion = newMotion(sheets, left, open === true || (typeof open === "number" && open >= 0.5));
      if (typeof open === "number") { m.theta = open * Math.PI; m.fluttered = true; }
      if (pin?.turn) {
        const t = pin.turn;
        const i = t.dir === 1 ? m.sheets.findIndex((q) => q.side === 0) : m.sheets.map((q) => q.side).lastIndexOf(1);
        const q = m.sheets[i];
        if (q) { q.air = true; q.side = t.dir === 1 ? 1 : 0; q.phi = t.phi; q.psi = t.psi; q.tw = t.twist ?? 0; }
      }
      if (pin?.peek !== undefined) { m.peek = pin.peek; m.peekOn = pin.peek > 0; }
      m.lift = ctx.flux.lift;
      m.held = ctx.flux.lift > 0;
      m.hover = m.opened ? 0 : ctx.flux.hover;
      // the tilt: a still's pin, else into the carry's motion (the rect's velocity, CSS px/s) while it is lifted, sprung
      if (pin?.tilt) { m.tiltX = pin.tilt[0]; m.tiltY = pin.tilt[1]; }
      else if (st !== undefined) {
        const dt = Math.min(Math.max(ctx.dt, 0), 0.05);
        const moved = !Number.isNaN(st.lastX) && dt > 0;
        const vx = moved ? ((ctx.rect.cx - st.lastX) / dt) * ctx.view.zoom : 0;
        const vy = moved ? ((ctx.rect.cy - st.lastY) / dt) * ctx.view.zoom : 0;
        st.lastX = ctx.rect.cx;
        st.lastY = ctx.rect.cy;
        tiltToward(m, vx, vy, law);
        const tx = m.held ? m.tiltTX : 0;
        const ty = m.held ? m.tiltTY : 0;
        for (let k = 0; k < 8; k++) {
          [st.tiltX, st.tiltXV] = springStep(st.tiltX, st.tiltXV, tx, law.springs.tilt[0], law.springs.tilt[1], dt / 8);
          [st.tiltY, st.tiltYV] = springStep(st.tiltY, st.tiltYV, ty, law.springs.tilt[0], law.springs.tilt[1], dt / 8);
        }
        if (Math.abs(st.tiltX - tx) + Math.abs(st.tiltY - ty) < 1e-4 && Math.abs(st.tiltXV) + Math.abs(st.tiltYV) < 1e-3) { st.tiltX = tx; st.tiltY = ty; st.tiltXV = st.tiltYV = 0; }
        m.tiltX = st.tiltX;
        m.tiltY = st.tiltY;
      }
      // the ring: a selected book lying closed on the mat — never under a lifted or an open one
      m.ring = m.opened ? 0 : ctx.flux.ring * (1 - ctx.flux.lift);
      const angle = numberProp(ctx.props, "angle", 0);
      const swing = Math.min(Math.max(swingOf(m.theta), 0), Math.PI);
      // biome-ignore lint/style/useExponentiationOperator: the lab's arithmetic (lab/notebook.ts `placementOf`), verbatim — it feeds a record
      const opening = law.lift.open * Math.pow(Math.sin(swing), 0.85);
      const v = ctx.view;
      const eye = eyeOf({ x: v.camX, y: v.camY, zoom: v.zoom }, { width: v.width, height: v.height }, law.eye);
      // in hand the book RISES toward the desk eye (the pose is the eye's, D4b): a point z up reads H/(H − z) times its size, so
      // z = H·(1 − 1/grow) is the reading size — the perspective of a book held close, not a zoomed camera's
      const rise = held !== undefined && held.grow > 1 ? eye.h * (1 - 1 / held.grow) : 0;
      const place = { cx: ctx.rect.cx, cy: ctx.rect.cy, angle, lift: m.lift * law.lift.held + m.hover * law.lift.hover + opening + rise, tiltX: m.tiltX, tiltY: m.tiltY, zc: F.b + F.T / 2 };
      const pose = withDesk(poseOf(m, law), place.lift);
      const built = books?.meshFor(ctx.entity, F, pose, law) ?? { mesh: buildMesh(new MeshWriter(), F, pose, law), version: 1 };
      return {
        frame: F, pose, mesh: built.mesh, version: built.version, rigid: rigidOf(place), lamp: lampDir(ctx.lamp, ctx.rect.cx, ctx.rect.cy, law.shadow.slopeMax),
        theta: m.theta, ring: m.ring, eye, fade: ctx.flux.fade,
        cx: ctx.rect.cx, cy: ctx.rect.cy, angle,
      };
    },
    record(G: NotebookGeometry, ctx: ObjectContext): NotebookDraw {
      const look = ctx.look as NotebookObjectLook | undefined;
      const covers = look?.covers ?? {};
      const cover = covers[stringProp(ctx.props, "cover", "")] ?? Object.values(covers)[0];
      if (look === undefined || cover === undefined) throw new Error("desk/notebook: the covers are the host's — the palette names no `notebooks` (kinds/notebook.ts `NotebookPalette`)");
      (ctx.local as Books | undefined)?.ink(look.ruleInk);
      const rulingName = stringProp(ctx.props, "ruling", "dots") as Ruling;
      const sw = swingOf(G.theta);
      const draw: NotebookDraw = {
        id: (ctx.local as Books | undefined)?.state(ctx.entity).id ?? 1, mesh: G.mesh, version: G.version, frame: G.frame, rigid: G.rigid, lamp: G.lamp,
        theta: G.theta, gamma: relaxOf(G.theta), look: cover, ruling: RULINGS.includes(rulingName) ? rulingName : "dots", seed: numberProp(ctx.props, "seed", 0) % 97, ring: G.ring,
        selfShadow: G.pose.airs.length > 0 || (sw > 0.02 && sw < Math.PI - 0.02), ink: { pages: [], layers: [] },
      };
      if (G.fade < 1) VANISHED.add(draw);
      return draw;
    },
    hit(G: NotebookGeometry, wx: number, wy: number): ObjectHit | null {
      if (G.fade < 1) return null;
      return pickNotebook(G.frame, G.pose, law, G.rigid, G.eye, wx, wy, G.mesh) === null ? null : "content";
    },
    frame: notebookFrame,
    // THE OPENING (design-015 §8, D4b): the spread — twice the case's width, left of the spine — comes to the hand under the desk
    // eye; the cover's swing is its motion; ‹ pages ›, the four pens and undo are its tools — declared here with no `kind` (dim
    // in the bar, nothing routes to them), built on D3t-a's seam at D3t-b
    open: {
      extent: (c) => ({ cx: c.rect.cx - c.rect.w / 2, cy: c.rect.cy, w: c.rect.w * 2, h: c.rect.h }),
      pose: "eye",
      spread: true,
      openness: (c) => (c.local as Books | undefined)?.state(c.entity).coverT ?? 0,
      tools: [
        { id: "turn:-1", label: "Previous page", hint: "←", glyph: "chevron-left" },
        { id: "turn:1", label: "Next page", hint: "→", glyph: "chevron" },
        { id: "pen", label: "Pens", hint: "1–4", glyph: "pen" },
        { id: "undo", label: "Undo", hint: "⌘Z", glyph: "undo" },
      ],
    },
    theme(palette: Palette, _name: ThemeName): NotebookObjectLook {
      const n = (palette as NotebookPalette).notebooks;
      if (n === undefined) return { covers: {}, ruleInk: [0, 0, 0, 0] };
      const paper: RGB = rgb(n.paper.css);
      const ink: RGB = rgb(n.ink.css);
      const covers = Object.fromEntries(Object.entries(n.covers).map(([name, c]) => [name, {
        cloth: rgb(c.cloth.css), band: rgb(c.band.css), accents: [rgb(c.a.css), rgb(c.b.css), rgb(c.c.css)] as const, endpaper: rgb(c.endpaper.css), paper, ink, design: c.design, paperCover: c.paperCover,
      } satisfies NotebookLook]));
      return { covers, ruleInk: [ink[0], ink[1], ink[2], n.rule] };
    },
  };
}
