// The PHOTO print (PHOTO.md) as a kind (kind.ts): the photo pass behind the registry's door — a
// thin adapter, the pass and its WGSL as they were. Stratum `things`: a print lies among the
// desk's other things in the desk's own order (a print on a note, a note on a print) — in the
// prototype the prints lay above everything, drawn by the photo lab in a render pass of their
// own after the ground's; here they are one more kind's runs in the ground's one pass, with the
// same blend onto the same bytes. A spawned slot's pass takes the root's law every frame (`tune`), and a
// print inside a mini mat's face is lit by the lamp of the desk the mini mat lies on (the slot's `lit` —
// MINIMAT.md §4), through the pass's second pipeline, as the note's is.
// The PICTURES stay the pass's: a host makes one (`pass.picture`, `pass.pictureFrom`) and a
// print's record names it by that handle (`PhotoInstance.picture`, null = its paper alone).
//
// And its WORLD half (kinds/world.ts; D3w): `photoKind` — a print is a BODY (photo/photo.ts `PhotoBody`, the
// prototype's), resolved by `resolvePhoto` under the desk's lamp. At rest the body IS the facts: its centre the
// rect's, its turn the `angle` prop, its edge lifted `hover` × the builder's hover flux (PHOTO.md: 2.2 units),
// its extent the picture's aspect at the law's long side (`printExtent`). Carried, flicked or gliding, the body
// LEADS — the carry (objects/carry.ts) holds it on the finger (the kinematic pin), lets it go with the flick
// of the last 70 ms, and the kind's own state on the desk (`local()` → `Prints`) steps it at 240 Hz through
// the air and the mat's Coulomb grip; when it comes to rest the carry commits ONE transaction and the body
// hands back to the facts once they show it. A fading ghost lifts as it goes (its `leave`). The PICTURE is
// the world half's too (D-D3r-a.2): the `blob` prop names bytes in the app's BlobStore (D-D12), fetched and
// decoded the first time a print is met — raw RGBA by the kind, anything else through the host's decoder —
// into one pass `Picture` per blob, shared by every print of it and dropped with the last. `hitPhoto` is the
// mirror, through the same local eye the pass draws with.

import { SAMPLE_PICTURE, samplePicture } from "./sample";
import type { Entity } from "@ice/core";
import { type KindExtra, type KindPass, type KindProgram, type SlotContext, type KindHost, type KindLocal, numberProp, type ObjectContext, type ObjectHit, type ObjectKind, type ObjectRect, stringProp } from "@ice/desk";
import { type MarkFrame, type MatPass, type DecodedPicture, RGBA_TYPE, carryOf, type ShaderText, BLOB_STORE, PICTURE_DECODER } from "@ice/desk/kit";
import { borderOf } from "./layout";
import { grab, hitPhoto, moveHold, newBody, PHOTO, type PhotoBody, type PhotoGeometry, type PhotoLaw, printSize, release, resolvePhoto, restless, stepPhoto, twist } from "./photo";
import { type Picture, PICTURE_MAX, type PhotoInstance, PhotoPass } from "./photo-pass";
import type { PictureStats } from "./pictures";
import { PHOTO_SHADER_FILES, photoCard, photoShaders } from "./shaders";
import { shaderText } from "../shaders";

/** The print's kind name — its key in the registry and in every slot's `objects`. */
export const PHOTO_KIND = "photo";

export class PhotoKind implements KindPass<PhotoInstance> {
  /** The photo pass itself: a host's door to the pictures (`picture`, `pictureFrom`, `dropPicture`) and the print's law (`law`). */
  readonly pass: PhotoPass;
  constructor(pass: PhotoPass) { this.pass = pass; }

  spawn(mat: MatPass): PhotoKind { return new PhotoKind(this.pass.spawn(mat)); }

  tune(root: KindPass<PhotoInstance>): void { if (root instanceof PhotoKind) this.pass.tune(root.pass); }

  /** The pass's own `prepare`, argument for argument: the slot's camera, grid, clocks, the objects' presence, the light, the lamp — and the records' keys (D6). */
  prepare(_encoder: GPUCommandEncoder, s: SlotContext, records: readonly PhotoInstance[], extra?: KindExtra): number {
    // the hand's prepare, and a capture's (I23): the details the frame holds re-asked at their lod, so a thumbnail's coarser asks evict none
    return this.pass.prepare(s.view, s.fadeIn, s.cfg, s.frame, records, s.present, s.light, s.lit, extra?.keys, s.target === "hand" || s.target === "capture");
  }

  dropped(): number { return this.pass.dropped; }

  /** Records [first, end) — indices into the prints `prepare` was handed, each drawn with its picture. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void { this.pass.drawRange(pass, first, end); }
  records() { return this.pass.records; }
  cardResources() { return this.pass.cardResources(); }
  cardSlot(index: number): number { return this.pass.cardSlot(index); }

  dispose(): void { this.pass.dispose(); }
}

/** The print's program for a host's shader text: its pass made on the root's mat. */
export function photoProgram(text: ShaderText): KindProgram<PhotoInstance> {
  return {
    name: PHOTO_KIND,
    stratum: "things",
    card: photoCard(text),
    create: async (device, format, mat) => new PhotoKind(await PhotoPass.create(device, format, photoShaders(text), mat)),
  };
}

/** The print's silhouette for the desk's marks (D4a): the sheet's own axes on the desk plane (its height's parallax aside), its corner. */
export function photoFrame(G: PhotoGeometry): MarkFrame {
  return { cx: G.centre[0], cy: G.centre[1], hx: G.half[0], hy: G.half[1], angle: Math.atan2(G.ex[1], G.ex[0]), r: G.radius };
}

// ---------------------------------------------------------------- the world half (D3w)

/** A print's extent on the desk, world units: its picture's aspect at the law's long side (the lab's `addPicture`); 3:2 without one. */
export const printExtent = (width: number, height: number, long: number = PHOTO.long): { readonly w: number; readonly h: number } =>
  width > 0 && height > 0 ? printSize(width, height, long) : printSize(3, 2, long);

/**
 * How far a print's drawing reaches past its rect, world units: the leave's height (1.6 × the lift) and the held droop cast
 * along the lamp's capped slope and blurred, and the local eye's scale of a sheet at that height about its far corner.
 */
export function photoReach(law: PhotoLaw = PHOTO): number {
  const h = law.lift * 1.6 + law.bend.held;
  const p = law.shadow.penumbra;
  const shadow = p.slopeMax * h + 3 * (p.sigma0 + p.sigmaPerHeight * h) + 2 * law.bend.held + 4;
  const scale = (law.long / 2) * Math.SQRT2 * (law.eye / (law.eye - law.lift * 1.6) - 1);
  return shadow + scale;
}

/** A print's pose as a still pins it (a FLUX pin, never a Grab — D-D2a-world.5): its height, slope, bend, anchor and the hand holding it. */
export interface PhotoPose {
  readonly h?: number;
  readonly sx?: number;
  readonly sy?: number;
  readonly bend?: number;
  readonly ax?: number;
  readonly ay?: number;
  readonly hold?: { readonly gx: number; readonly gy: number; readonly px: number; readonly py: number };
}

/** A print that came to rest where its facts are not — ONE transaction's worth for the carry: its centre, world units, and its turn (the wheel twists a carried print, D3t-a). */
export interface PrintRest { readonly entity: Entity; readonly x: number; readonly y: number; readonly angle: number }

/** A flick's witness: the body as the hand let it go, and every step the desk took with it since (the law replays them). */
export interface FlickWitness { readonly body: PhotoBody; readonly dts: number[]; landed: { readonly x: number; readonly y: number } | null }

/** The photo kind's own state on one desk: the prints' bodies, their pictures, the carry's door. */
export interface Prints extends KindLocal {
  /** When the kind is next live (K7a — `KindLocal.due`, declared: the six built-ins all say). */
  due(now: number): number;
  /** The hand takes print `e` at a world point (the carry); a body at rest is lifted off its facts. */
  hold(e: Entity, wx: number, wy: number, t: number): void;
  /** The hand moved (world, t seconds) — the grab point follows it exactly. */
  move(e: Entity, wx: number, wy: number, t: number): void;
  /** The hand let go: the flick from the last 70 ms, capped; the body glides from here. */
  drop(e: Entity, t: number): void;
  /**
   * The carry was CANCELLED (Esc — D3t-a): the hand lets go and the print flies back to where it began — its facts, its turn —
   * in `PRINT_RETURN_MS` on the island ease, landing there; nothing is committed.
   */
  cancel(e: Entity, t: number): void;
  /** The wheel turns a carried print about the finger (PHOTO.md), radians; a print in the air takes it as spin. */
  twist(e: Entity, da: number): void;
  /** The print is drawn LIFTED — in a hand, in the air, flying home, its rest not yet in the facts (the builder paints it on top). */
  lifted(e: Entity): boolean;
  /** Prints that came to rest away from their facts since the last ask — the carry commits each in ONE transaction. */
  rests(): PrintRest[];
  /** How many rests wait to be asked for (D7 #14: the carry never idles over one). */
  owed(): number;
  /** The carry committed `e`'s rest (or could not): the body leads until the facts show it (or a second runs out). */
  settle(e: Entity, committed: boolean): void;
  /** A still's pose on `e` (undefined unpins). */
  pin(e: Entity, pose: PhotoPose | undefined): void;
  /** A print just laid by a paste or a drop arrives: it falls from `arrive` onto its place and fades in (PHOTO.md §3). */
  arrive(e: Entity): void;
  /** Fetch, decode and upload a blob's picture before a print names it (a scene's still); resolves once it is on the device. */
  preload(hash: string, width: number, height: number): Promise<void>;
  /** Print `e`'s body as it is now — a copy (a rig's witness); undefined for a print never met. */
  body(e: Entity): PhotoBody | undefined;
  /** The last flick of print `e` — a copy. */
  flick(e: Entity): FlickWitness | undefined;
  /** The pictures: on the device, on their way, missing from the store or undecodable — and where they are resident (K6a: thumbnails, details, slots). */
  pictures(): { readonly ready: number; readonly loading: number; readonly failed: number; readonly resident?: PictureStats };
  /** The world half's: the body to resolve for this frame (the facts at rest, the live body while it leads). */
  bodyFor(ctx: ObjectContext, hx: number, hy: number): PhotoBody;
  /** The world half's: the picture a print's `blob` names (null while it loads, or without one). */
  pictureFor(e: Entity, hash: string, width: number, height: number): Picture | null;
}

interface Print {
  body: PhotoBody;
  /** The body leads the facts: held, gliding, arriving, or its rest committed and not yet in the facts. */
  leads: boolean;
  /** The rest was handed to the carry (queued or committed); the clock at the commit, −1 before it. */
  resting: boolean;
  committedAt: number;
  /** The perspective's anchor, kept after a hold (PHOTO.md: "kept after"). */
  ax: number;
  ay: number;
  pose: PhotoPose | undefined;
  flick: FlickWitness | undefined;
  /** The blob the print draws, for the picture's user count. */
  hash: string;
  /** Where its facts put its centre and its turn, as last resolved. */
  fx: number;
  fy: number;
  fa: number;
  /** A cancelled carry's flight home (D3t-a): where it began, when; null otherwise. */
  back: { readonly x: number; readonly y: number; readonly angle: number; readonly h: number; readonly t0: number } | null;
}

interface Pic {
  picture: Picture | null;
  state: "loading" | "ready" | "failed";
  readonly users: Set<Entity>;
  /** A preload holds it until a print takes it. */
  held: boolean;
  load: Promise<void>;
}

/** A cancelled carry's flight home, ms (D3t-a) — the put-down's own length (design-015 §8: 440 ms home), on the hand's island ease. */
export const PRINT_RETURN_MS = 440;

const copyBody = (b: PhotoBody): PhotoBody => ({ ...b, hold: b.hold ? { ...b.hold, trail: b.hold.trail.map((s) => [...s] as [number, number, number]) } : null });
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The photo kind's `local()` on one desk. */
export function createPrints(host: KindHost, law: PhotoLaw = PHOTO): Prints {
  const prints = new Map<Entity, Print>();
  /** The prints whose body LEADS (in a hand, in the air, flying home, arriving) — the ones the tick steps (D6: never every print). */
  const leading = new Set<Entity>();
  const pics = new Map<string, Pic>();
  /** What has LANDED on each object, counted (D7 — `KindLocal.landed`): the held desk copy is made again when a desk object's moves. */
  const landedOf = new Map<Entity, number>();
  const land = (e: Entity): void => { landedOf.set(e, (landedOf.get(e) ?? 0) + 1); };
  const queue: PrintRest[] = [];
  let last = -1;
  let woke = false;
  let attached = false;
  const passOf = (): PhotoPass | undefined => { const k = host.pass(); return k instanceof PhotoKind ? k.pass : undefined; };

  /** A body at rest where the facts say: the rect's centre, the prop's turn, the builder's hover lifting its edge. */
  const restBody = (ctx: ObjectContext, hx: number, hy: number, pr: Print | undefined): PhotoBody => {
    const b = newBody(ctx.rect.cx, ctx.rect.cy, 2 * hx, 2 * hy, numberProp(ctx.props, "angle", 0), law.hover * ctx.flux.hover);
    b.ax = pr?.ax ?? 0;
    b.ay = pr?.ay ?? 0;
    return b;
  };
  const withPose = (b: PhotoBody, pose: PhotoPose | undefined): PhotoBody => {
    if (pose === undefined) return b;
    if (pose.h !== undefined) b.h = pose.h;
    if (pose.sx !== undefined) b.sx = pose.sx;
    if (pose.sy !== undefined) b.sy = pose.sy;
    if (pose.bend !== undefined) b.bend = pose.bend;
    if (pose.ax !== undefined) b.ax = pose.ax;
    if (pose.ay !== undefined) b.ay = pose.ay;
    if (pose.hold !== undefined) { const H = pose.hold; b.hold = { gx: H.gx, gy: H.gy, px: H.px, py: H.py, vx: 0, vy: 0, ax: 0, ay: 0, trail: [[0, H.px, H.py]] }; }
    return b;
  };
  const print = (e: Entity): Print => {
    let pr = prints.get(e);
    if (pr === undefined) {
      pr = { body: newBody(0, 0, 1, 1), leads: false, resting: false, committedAt: -1, ax: 0, ay: 0, pose: undefined, flick: undefined, hash: "", fx: Number.NaN, fy: Number.NaN, fa: 0, back: null };
      prints.set(e, pr);
    }
    return pr;
  };
  /** Print `e` stops naming `hash`: the picture goes with its last print (a preload holds it until one takes it). */
  const unuse = (e: Entity, hash: string): void => {
    const pic = pics.get(hash);
    if (pic === undefined) return;
    pic.users.delete(e);
    if (pic.users.size > 0 || pic.held) return;
    if (pic.picture !== null) passOf()?.dropPicture(pic.picture);
    pics.delete(hash);
  };
  /** A blob's picture fetched and decoded: raw RGBA by the kind, anything else through the host's decoder (≤ PICTURE_MAX). */
  const decodeOf = async (hash: string, width: number, height: number): Promise<DecodedPicture | undefined> => {
    // the kind's own sample (K5b — the print on the pegboard): made, never fetched
    if (hash === SAMPLE_PICTURE) return { kind: "rgba", bytes: samplePicture(width, height), width, height };
    const blob = await host.use?.(BLOB_STORE)?.get(hash);
    if (blob === undefined) return undefined;
    if (blob.type === RGBA_TYPE) return { kind: "rgba", bytes: blob.bytes, width, height };
    return host.use?.(PICTURE_DECODER)?.(blob, PICTURE_MAX);
  };
  /** The upload: raw RGBA by the kind, a decoded source by the device's copy — and how to decode it again (a print large on screen: its detail, K6a). */
  const upload = (d: DecodedPicture, hash: string, width: number, height: number): Picture | null => {
    const pass = passOf();
    if (pass === undefined) return null;
    if (d.kind === "rgba") return d.bytes.length === d.width * d.height * 4 ? pass.picture(d.bytes, d.width, d.height) : null;
    return pass.pictureFrom(d.source as ImageBitmap, d.width, d.height, () => decodeOf(hash, width, height));
  };
  const load = (hash: string, width: number, height: number): Pic => {
    const had = pics.get(hash);
    if (had !== undefined) return had;
    const pic: Pic = { picture: null, state: "loading", users: new Set(), held: false, load: Promise.resolve() };
    pics.set(hash, pic);
    pic.load = (async () => {
      const decoded = await decodeOf(hash, width, height);
      const picture = decoded === undefined ? null : upload(decoded, hash, width, height);
      if (decoded?.kind === "source") decoded.close?.();
      if (pics.get(hash) !== pic) { if (picture !== null) passOf()?.dropPicture(picture); return; }   // nobody wants it any more
      pic.picture = picture;
      pic.state = picture === null ? "failed" : "ready";
      for (const u of pic.users) land(u);
      woke = true;
    })().catch(() => { pic.state = "failed"; woke = true; });
    return pic;
  };

  return {
    hold(e, wx, wy, t) {
      const pr = prints.get(e);
      if (pr === undefined) return;   // never drawn: nothing to lift
      if (!pr.leads) pr.body = copyBody(pr.body);
      pr.leads = true;
      leading.add(e);
      pr.resting = false;
      pr.committedAt = -1;
      pr.back = null;   // caught on its way home: the hand has it again
      pr.body.hovered = false;
      grab(pr.body, wx, wy, t);
      pr.ax = pr.body.ax;
      pr.ay = pr.body.ay;
    },
    move(e, wx, wy, t) { const pr = prints.get(e); if (pr?.body.hold) moveHold(pr.body, wx, wy, t); },
    drop(e, t) {
      const pr = prints.get(e);
      if (!pr?.body.hold) return;
      release(pr.body, t, law);
      pr.flick = { body: copyBody(pr.body), dts: [], landed: null };
    },
    cancel(e, t) {
      const pr = prints.get(e);
      if (pr === undefined || !pr.leads) return;
      const b = pr.body;
      b.hold = null;
      b.vx = 0; b.vy = 0; b.spin = 0;
      pr.back = { x: b.x, y: b.y, angle: b.angle, h: b.h, t0: t };
      pr.flick = undefined;
    },
    twist(e, da) {
      const pr = prints.get(e);
      if (pr === undefined || !pr.leads || pr.back !== null) return;
      twist(pr.body, da);
    },
    lifted: (e) => prints.get(e)?.leads === true,
    rests: () => queue.splice(0, queue.length),
    owed: () => queue.length,
    settle(e, committed) {
      const pr = prints.get(e);
      if (pr === undefined) return;
      if (committed) pr.committedAt = last < 0 ? 0 : last;
      else { pr.leads = false; pr.resting = false; }
    },
    pin(e, pose) { print(e).pose = pose; woke = true; },
    arrive(e) {
      const pr = print(e);
      pr.leads = true;
      leading.add(e);
      pr.resting = false;
      pr.body.h = law.arrive;
      pr.body.alpha = 0;
      pr.body.x = Number.NaN;   // placed on its facts at the first resolve
    },
    preload(hash, width, height) { const pic = load(hash, width, height); pic.held = true; return pic.load; },
    body: (e) => { const pr = prints.get(e); return pr === undefined ? undefined : copyBody(pr.body); },
    flick: (e) => { const f = prints.get(e)?.flick; return f === undefined ? undefined : { body: copyBody(f.body), dts: [...f.dts], landed: f.landed }; },
    pictures() {
      let ready = 0;
      let loading = 0;
      let failed = 0;
      for (const p of pics.values()) { if (p.state === "ready") ready += 1; else if (p.state === "loading") loading += 1; else failed += 1; }
      const resident = passOf()?.pictureStats;
      return resident === undefined ? { ready, loading, failed } : { ready, loading, failed, resident };
    },
    bodyFor(ctx, hx, hy) {
      const pr = print(ctx.entity);
      pr.fx = ctx.rect.cx;
      pr.fy = ctx.rect.cy;
      pr.fa = numberProp(ctx.props, "angle", 0);
      if (pr.leads && pr.committedAt >= 0 && ((near(ctx.rect.cx, pr.body.x) && near(ctx.rect.cy, pr.body.y) && near(pr.fa, pr.body.angle)) || last - pr.committedAt > 1000)) { pr.leads = false; pr.resting = false; pr.committedAt = -1; }
      if (pr.leads && Number.isNaN(pr.body.x)) { const b = restBody(ctx, hx, hy, pr); b.h = pr.body.h; b.alpha = pr.body.alpha; pr.body = b; }
      if (!pr.leads) pr.body = withPose(restBody(ctx, hx, hy, pr), pr.pose);
      const b = pr.body;
      if (ctx.flux.fade >= 1) return b;
      // a ghost leaves: it lifts toward 1.6 × the lift as it fades (PHOTO.md's `leave`)
      return { ...b, h: b.h + law.lift * 1.6 * (1 - ctx.flux.fade), alpha: Math.min(b.alpha, ctx.flux.fade) };
    },
    pictureFor(e, hash, width, height) {
      const pr = print(e);
      if (pr.hash !== hash) { unuse(e, pr.hash); pr.hash = hash; }
      if (hash === "") return null;
      const pic = load(hash, width, height);
      pic.users.add(e);
      pic.held = false;
      return pic.picture;
    },
    landed: (e) => landedOf.get(e) ?? 0,
    // K7a: next live now while a print leads (in a hand, in the air, flying home, resting to commit), a picture landed, or the last
    // frame's asks wait for their residency step (a detail to fetch); never otherwise — a landing wakes it (`onPictures`)
    due: (now) => (woke || leading.size > 0 || passOf()?.residencyOwed === true ? now : Number.POSITIVE_INFINITY),
    tick(now) {
      const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = now;
      // the pictures' residency (K6a): under the desk's budget, a landed detail waking the desk; the frame boundary — what the
      // last frame's prints asked is bound, fetched or let go before this frame's build
      const pass = passOf();
      if (pass !== undefined) {
        if (!attached) { pass.budget(host.budget); pass.onPictures = () => { woke = true; host.wake?.(); }; attached = true; }
        if (pass.residency()) woke = true;
      }
      let want = woke;
      woke = false;
      // the prints that lead, and those alone (D6): a desk of a thousand prints at rest costs the tick nothing per print
      for (const e of leading) {
        const pr = prints.get(e);
        if (pr === undefined || !pr.leads) { leading.delete(e); continue; }
        if (pr.resting) { want = true; continue; }
        want = true;
        if (pr.back !== null) {
          // a cancelled carry flies home (D3t-a): from where the hand let go to the facts, on the island ease — then the facts lead
          const B = pr.back;
          const u = Math.min(Math.max((now / 1000 - B.t0) / (PRINT_RETURN_MS / 1000), 0), 1);
          const k = carryOf(u);   // the island ease — the hand's own (hold/pose.ts)
          let da = pr.fa - B.angle;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const b = pr.body;
          b.x = B.x + (pr.fx - B.x) * k; b.y = B.y + (pr.fy - B.y) * k; b.angle = B.angle + da * k; b.h = B.h * (1 - k);
          b.sx *= 1 - k; b.sy *= 1 - k; b.vsx = 0; b.vsy = 0; b.vh = 0;
          if (u >= 1) { pr.back = null; pr.leads = false; }
          continue;
        }
        if (Number.isNaN(pr.body.x) || dt <= 0) continue;
        stepPhoto(pr.body, dt, law);
        const flick = pr.flick;
        if (flick !== undefined && flick.landed === null && pr.body.hold === null) flick.dts.push(dt);
        if (pr.body.hold !== null || restless(pr.body)) continue;
        // at rest: ONE transaction's worth for the carry — a print that came back where its facts are commits nothing
        if (flick !== undefined && flick.landed === null) flick.landed = { x: pr.body.x, y: pr.body.y };
        if (near(pr.body.x, pr.fx) && near(pr.body.y, pr.fy) && near(pr.body.angle, pr.fa)) { pr.leads = false; continue; }
        pr.resting = true;
        queue.push({ entity: e, x: pr.body.x, y: pr.body.y, angle: pr.body.angle });
      }
      return want;
    },
    /** The budget's ask (K6a): the thumbnails always, a picture's detail while a frame binds it. */
    keeps: (key) => passOf()?.keeps(key) ?? false,
    forget(e) {
      landedOf.delete(e);
      const pr = prints.get(e);
      if (pr === undefined) return;
      unuse(e, pr.hash);
      prints.delete(e);
    },
    dispose() {
      const pass = passOf();
      for (const p of pics.values()) if (p.picture !== null) pass?.dropPicture(p.picture);
      pics.clear();
      prints.clear();
    },
  };
}

export interface PhotoKindOptions {
  /** The host's shader text; the generated module unless a host says. */
  readonly text?: ShaderText;
  /** The print's numbers (photo.ts `PHOTO`) — the engine's unless a host tweaks them. */
  readonly law?: PhotoLaw;
}

/** The print's kind, whole (kinds/world.ts `ObjectKind`): the program, and the world half on the photo lab's body. */
export function photoKind(opts: PhotoKindOptions = {}): ObjectKind<PhotoGeometry, PhotoInstance> {
  const law = opts.law ?? PHOTO;
  const program = photoProgram(opts.text ?? shaderText);
  const extentOf = (ctx: ObjectContext): { w: number; h: number } => printExtent(numberProp(ctx.props, "width", 0), numberProp(ctx.props, "height", 0), law.long);
  return {
    ...program,
    reach: photoReach(law),
    local: (host: KindHost): Prints => createPrints(host, law),
    resolve(ctx: ObjectContext): PhotoGeometry {
      const { w, h } = extentOf(ctx);
      const prints = ctx.local as Prints | undefined;
      if (prints !== undefined) return resolvePhoto(prints.bodyFor(ctx, w / 2, h / 2), law, ctx.lamp);
      const b = newBody(ctx.rect.cx, ctx.rect.cy, w, h, numberProp(ctx.props, "angle", 0), law.hover * ctx.flux.hover);
      if (ctx.flux.fade < 1) { b.h += law.lift * 1.6 * (1 - ctx.flux.fade); b.alpha = ctx.flux.fade; }
      return resolvePhoto(b, law, ctx.lamp);
    },
    record(G: PhotoGeometry, ctx: ObjectContext): PhotoInstance {
      const { w, h } = extentOf(ctx);
      const border = borderOf(w / 2, h / 2, { ...law, border: numberProp(ctx.props, "border", law.border) });
      const prints = ctx.local as Prints | undefined;
      const picture = prints?.pictureFor(ctx.entity, stringProp(ctx.props, "blob", ""), numberProp(ctx.props, "width", 0), numberProp(ctx.props, "height", 0)) ?? null;
      return { geometry: G, border, picture };
    },
    hit(G: PhotoGeometry, wx: number, wy: number): ObjectHit | null {
      return hitPhoto(G, wx, wy) ? "content" : null;
    },
    frame: photoFrame,
  };
}

/** The rect a print lies in at rest, for a host that places one by its centre: top-left and the f32 size the world stores. */
export function printRect(cx: number, cy: number, width: number, height: number, long: number = PHOTO.long): ObjectRect & { readonly x: number; readonly y: number } {
  const e = printExtent(width, height, long);
  const w = Math.fround(e.w);
  const h = Math.fround(e.h);
  return { x: cx - w / 2, y: cy - h / 2, cx, cy, w, h };
}
