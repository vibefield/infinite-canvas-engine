// The PHOTO print from the world (design-015 §5–6; D3w): the Photo object through `defineObject`; its world half
// = the Node oracle's own `printOf` for the same print (rest, held, hovered, between notes — PARITY BY
// CONSTRUCTION); the BlobStore round trip (D-D12: bytes by hash, one picture per blob, dropped with its last
// print); the FLICK LAW (the finger's last 70 ms, the cap, a stopped finger throws nothing, the glide's Coulomb
// grip); and the carry: a press, a flick, a glide — ONE transaction when the print comes to rest, one undo step; a
// TAPED print is never carried, and a press-drag on it gives as every taped object does (D4a's give, through the marks).
import { Captures, ChildOf, createCanvasEngine, Drag, type Entity, GestureActive, LocalPointer, Movable, Pointer, PointerButtons, PointerWorld, Position, Selectable, Size, Viewport, Watches, CancelRequest, GestureCancelled, PressWheel } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeskBuilder, FLUX_REST, type KindHost, type ObjectContext, DEFAULT_GRID, objectKindOf, MARKS, MAT_GRID } from "@ice/desk";
import { createMemoryBlobStore, hashBytes, RGBA_TYPE } from "@ice/desk/kit";
import { PHOTO_KIND, PhotoKind, photoKind, PRINT_RETURN_MS, type Prints, printRect } from "../src/photo/kind";
import { createPhotoCarry, Photo, PHOTO_TYPE, TWIST_PER_WHEEL } from "../src";
import { lampOf } from "../src/paper/paper";
import { grab, moveHold, newBody, PHOTO, release, restless, stepPhoto } from "../src/photo/photo";
import type { Picture, PhotoPass } from "../src/photo/photo-pass";
import { THEMES } from "../oracle/fixtures/vf-theme";
import { fakeOracle, type OracleInternals, sceneOf } from "./oracle-fake";
import { must } from "../../desk/test/must";

const lamp = lampOf(MAT_GRID.plane);
const META = { w: 192, h: 128 };   // the committed picture (oracle/fixtures/assets/photo-1.json)
const kind = photoKind();
const VIEW = { camX: 13.7, camY: -21.3, zoom: 1, width: 1200, height: 800, dpr: 2 };
type Print = { x: number; y: number; angle?: number; height?: number; sx?: number; sy?: number; bend?: number; ax?: number; ay?: number; hold?: { gx: number; gy: number; px: number; py: number } };
const ctxOf = (p: Print, over: Partial<ObjectContext> = {}): ObjectContext => {
  const r = printRect(p.x, p.y, META.w, META.h);
  return {
    entity: 11 as Entity, rect: { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h }, props: { blob: "", width: META.w, height: META.h, border: PHOTO.border, angle: p.angle ?? 0 },
    flux: FLUX_REST, look: undefined, theme: THEMES.light, lamp, view: VIEW, grid: DEFAULT_GRID, dt: 1 / 60, ...over,
  };
};

/** A photo pass that records what the kind asks of it. */
function stubPass() {
  const log: string[] = [];
  let n = 0;
  const pass = {
    picture: (bytes: Uint8Array, w: number, h: number) => { n += 1; log.push(`picture ${w}x${h} ${bytes.length}`); return { id: n, width: w, height: h } as unknown as Picture; },
    pictureFrom: (_s: unknown, w: number, h: number) => { n += 1; log.push(`pictureFrom ${w}x${h}`); return { id: n, width: w, height: h } as unknown as Picture; },
    dropPicture: (p: Picture) => { log.push(`drop ${(p as unknown as { id: number }).id}`); },
    // the residency (K6a): nothing to bind or fetch on a stub
    budget: () => {},
    residency: () => false,
    keeps: () => false,
    onPictures: () => {},
  };
  return { kindPass: new PhotoKind(pass as unknown as PhotoPass), log };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

let oracle: OracleInternals;
let undoGpu: () => void;
beforeAll(async () => { const o = await fakeOracle({ photo: META }); oracle = o.desk; undoGpu = o.undo; });
afterAll(() => undoGpu());

describe("the Photo object (design-015 §6)", () => {
  it("desk.photo — blob · width · height · border · angle; things; selectable but NOT core-movable (its carry is its own); offered to a mini mat", () => {
    expect(Photo.type).toBe(PHOTO_TYPE);
    expect(objectKindOf(Photo)?.name).toBe(PHOTO_KIND);
    expect(Photo.stratum).toBe("things");
    expect(Object.keys(Photo.propToGroup).sort()).toEqual(["angle", "blob", "border", "height", "width"]);
    expect(Photo.capabilityTags).not.toContain(Movable);
    expect(Photo.capabilityTags).toContain(Selectable);
    expect(Photo.provides).toContain(PHOTO_TYPE);
  });
});

describe("the print's world half = the oracle's `printOf` (parity by construction)", () => {
  it("at rest, turned, by the scene's numbers: the geometry and the border, number for number (the extent is the picture's aspect, exact — never the f32 Size)", () => {
    for (const name of ["photo-rest-z1", "photo-night-z1"]) {
      const p = must((sceneOf<{ prints: Print[] }>(name).prints)[0]);
      const ctx = ctxOf(p);
      const R = kind.record(kind.resolve(ctx), ctx);
      const O = oracle.printOf(p);
      expect(R.geometry).toEqual(O.geometry);
      expect(R.border).toBe(O.border);
      expect(R.picture).toBeNull();   // no desk, no picture: the paper alone
    }
    const between = must(sceneOf<{ things: (Print & { kind: string })[] }>("photo-over-note-z1").things.find((t) => t.kind === "print"));
    const ctx = ctxOf(between);
    expect(kind.resolve(ctx)).toEqual(oracle.printOf(between).geometry);
  });

  it("the stack's top print hovered — the builder's hover flux lifts its edge the law's 2.2: = the oracle's `height: 2.2`, with or without a desk", () => {
    const top = must(sceneOf<{ prints: Print[] }>("photo-stack-z1").prints[2]);
    expect(top.height).toBe(PHOTO.hover);
    expect(kind.resolve(ctxOf(top, { flux: { ...FLUX_REST, hover: 1 } }))).toEqual(oracle.printOf(top).geometry);
    const prints = must(kind.local)({ pass: () => undefined }) as Prints;
    expect(kind.resolve(ctxOf(top, { flux: { ...FLUX_REST, hover: 1 }, local: prints }))).toEqual(oracle.printOf(top).geometry);
  });

  it("the held still is a FLUX pin on the print's body (never a Grab): its height, slope, bend, anchor and hand = the oracle's held print", () => {
    const held = must(sceneOf<{ prints: Print[] }>("photo-held-z1").prints[0]);
    const prints = must(kind.local)({ pass: () => undefined }) as Prints;
    const hold = must(held.hold);
    prints.pin(11 as Entity, { h: held.height ?? 0, sx: held.sx ?? 0, sy: held.sy ?? 0, bend: held.bend ?? 0, ax: held.ax ?? 0, ay: held.ay ?? 0, hold });
    const ctx = ctxOf(held, { local: prints });
    expect(kind.resolve(ctx)).toEqual(oracle.printOf(held).geometry);
    prints.pin(11 as Entity, undefined);
    expect(kind.resolve(ctx)).toEqual(oracle.printOf({ x: held.x, y: held.y, angle: held.angle ?? 0 }).geometry);
  });

  it("hit: the sheet as drawn is content, past its corner null; reach covers the leave's lift and its shadow", () => {
    const G = kind.resolve(ctxOf({ x: 520, y: 330, angle: -0.07 }));
    expect(kind.hit(G, 520, 330)).toBe("content");
    expect(kind.hit(G, 520 + 260, 330)).toBeNull();
    const leaving = kind.resolve(ctxOf({ x: 520, y: 330 }, { flux: { ...FLUX_REST, fade: 0.01 } }));
    const past = Math.max(leaving.bounds.x1 - (520 + 200), 200 - 520 + leaving.bounds.x0 < 0 ? 520 - 200 - leaving.bounds.x0 : 0);
    expect(kind.reach).toBeGreaterThanOrEqual(past);
    expect(leaving.alpha).toBeCloseTo(0.01, 12);
  });
});

describe("a print's bytes through the app's BlobStore (D-D12)", () => {
  it("the store is content-addressed: SHA-256 hex over the bytes, idempotent; a hash it does not hold is undefined", async () => {
    const store = createMemoryBlobStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const h = await store.put(bytes, RGBA_TYPE);
    expect(h).toBe("9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a");
    expect(await store.put(new Uint8Array([1, 2, 3, 4]), RGBA_TYPE)).toBe(h);
    expect(store.size()).toBe(1);
    expect(await store.get(h)).toEqual({ bytes, type: RGBA_TYPE });
    expect(await store.get("0".repeat(64))).toBeUndefined();
    expect(await hashBytes(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("a print names its blob; the kind fetches it, makes ONE picture for every print of it, and drops it with the last", async () => {
    const store = createMemoryBlobStore();
    const hash = await store.put(new Uint8Array(4 * 3 * 2), RGBA_TYPE);
    const stub = stubPass();
    const prints = must(kind.local)({ pass: () => stub.kindPass, blobs: store }) as Prints;
    expect(prints.pictureFor(1 as Entity, hash, 3, 2)).toBeNull();   // on its way
    await settle();
    expect(prints.tick?.(0)).toBe(true);   // a picture landed: a frame
    const pic = prints.pictureFor(1 as Entity, hash, 3, 2);
    expect(pic).not.toBeNull();
    expect(prints.pictureFor(2 as Entity, hash, 3, 2)).toBe(pic);
    expect(stub.log).toEqual(["picture 3x2 24"]);
    prints.forget?.(1 as Entity);
    expect(stub.log).toEqual(["picture 3x2 24"]);
    prints.forget?.(2 as Entity);
    expect(stub.log).toEqual(["picture 3x2 24", "drop 1"]);
    expect(prints.pictures()).toEqual({ ready: 0, loading: 0, failed: 0 });
  });

  it("an encoded blob goes through the host's decoder (and is closed once uploaded); a blob the store lacks draws the paper alone", async () => {
    const store = createMemoryBlobStore();
    const png = await store.put(new Uint8Array([137, 80, 78, 71]), "image/png");
    const stub = stubPass();
    const closed: string[] = [];
    const host: KindHost = { pass: () => stub.kindPass, blobs: store, decode: async (b, max) => ({ kind: "source", source: { type: b.type, max }, width: 40, height: 30, close: () => closed.push(b.type) }) };
    const prints = must(kind.local)(host) as Prints;
    prints.pictureFor(1 as Entity, png, 40, 30);
    prints.pictureFor(2 as Entity, "f".repeat(64), 40, 30);
    await settle();
    expect(stub.log).toEqual(["pictureFrom 40x30"]);
    expect(closed).toEqual(["image/png"]);
    expect(prints.pictures()).toEqual({ ready: 1, loading: 0, failed: 1 });
    expect(prints.pictureFor(2 as Entity, "f".repeat(64), 40, 30)).toBeNull();
  });

  it("a scene preloads a blob before any print names it: the first frame has the picture", async () => {
    const store = createMemoryBlobStore();
    const hash = await store.put(new Uint8Array(4), RGBA_TYPE);
    const stub = stubPass();
    const prints = must(kind.local)({ pass: () => stub.kindPass, blobs: store }) as Prints;
    await prints.preload(hash, 1, 1);
    expect(prints.pictureFor(5 as Entity, hash, 1, 1)).not.toBeNull();
  });
});

describe("the FLICK LAW (PHOTO.md §3)", () => {
  const body = () => newBody(0, 0, 400, 266, 0, 0);
  it("the flick is the finger's velocity over the LAST 70 ms, capped at 4200 u/s; a finger that stopped before letting go throws nothing", () => {
    expect(PHOTO.throw).toEqual({ window: 0.07, max: 4200 });
    const b = body();
    grab(b, 0, 0, 0);
    for (let i = 1; i <= 10; i++) moveHold(b, i * 30, 0, i * 0.01);   // 3000 u/s for 100 ms …
    for (let i = 1; i <= 10; i++) moveHold(b, 300 + i * 10, 0, 0.1 + i * 0.01);   // … then 1000 u/s for the last 100 ms
    release(b, 0.2);
    expect(b.vx).toBeCloseTo(1000, 6);   // only the last 70 ms count
    expect(b.vy).toBe(0);
    const fast = body();
    grab(fast, 0, 0, 0);
    for (let i = 1; i <= 10; i++) moveHold(fast, i * 100, i * 50, i * 0.01);   // 11 180 u/s
    release(fast, 0.1);
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(PHOTO.throw.max, 6);
    const stopped = body();
    grab(stopped, 0, 0, 0);
    for (let i = 1; i <= 10; i++) moveHold(stopped, i * 10, 0, i * 0.01);
    release(stopped, 0.1 + 0.08);   // held still for 80 ms — more than the 70 ms window
    expect(stopped.vx).toBe(0);
  });

  it("on the mat the COULOMB grip: 2400 u/s² + 5/s viscous per 240 Hz substep; it stops short of the continuous law by the step, never past it", () => {
    const { grip: g, viscous: c } = PHOTO.slide;
    const b = body();
    b.vx = 1200;
    stepPhoto(b, 1 / 60);   // one frame = four 240 Hz substeps of the grip
    let v = 1200;
    let x = 0;
    for (let i = 0; i < 4; i++) { v = Math.max(0, v - (g + c * v) / 240); x += v / 240; }
    expect(b.vx).toBeCloseTo(v, 9);
    expect(b.x).toBeCloseTo(x, 9);
    let t = 1 / 60;
    for (; t < 5 && restless(b); t += 1 / 60) stepPhoto(b, 1 / 60);
    const tStop = Math.log(1 + (c * 1200) / g) / c;
    const d = (1200 - g * tStop) / c;   // the continuous law's stopping distance
    expect(b.x).toBeLessThan(d);
    expect(b.x).toBeGreaterThan(d - 1200 / 240);   // within one substep's travel
    expect(t).toBeLessThan(tStop + 0.2);
  });

  it("in the AIR it only drags (0.9/s) — no grip until it is down: a print let go at the hand's height glides further than one let go on the mat", () => {
    const low = body();
    const high = body();
    low.vx = 800;
    high.vx = 800;
    high.h = PHOTO.lift;
    stepPhoto(low, 1 / 60);
    stepPhoto(high, 1 / 60);
    expect(high.vx).toBeCloseTo(800 * Math.exp(-PHOTO.slide.air / 60), 9);
    expect(low.vx).toBeLessThan(high.vx - 30);
  });
});

describe("the CARRY — ONE transaction when the print comes to rest", () => {
  function desk() {
    const ce = createCanvasEngine({ widgets: [Photo] });
    ce.docs.create();
    let now = 1000;
    const { world } = ce;
    const at = printRect(400, 300, META.w, META.h);
    const e = ce.ops.spawnWidget(PHOTO_TYPE, { x: at.x, y: at.y, w: at.w, h: at.h, props: { width: META.w, height: META.h }, undoable: false });
    ce.ops.spawnWidget(PHOTO_TYPE, { x: -900, y: -900, w: at.w, h: at.h, props: { width: META.w, height: META.h }, undoable: false });   // a print above it
    ce.step(now);
    const stub = stubPass();
    const prints = must(kind.local)({ pass: () => stub.kindPass }) as Prints;
    const pending: (() => void)[] = [];
    const carry = createPhotoCarry({ world, docs: ce.docs, prints: () => prints, isPrint: (q) => q === e, props: Photo.groups[0]?.component, defer: (fn) => pending.push(fn) });
    // a local pointer and the recognizer its press made (the facts the carry reads)
    const p = world.spawn({ components: [[Pointer, { id: "mouse", device: "mouse", owner: "" }], [PointerWorld, { x: 400, y: 300 }], [PointerButtons, { buttons: 0, downX: 0, downY: 0, downMs: 0 }]], tags: [LocalPointer] });
    const rec = world.spawn({ components: [] });
    const rect = () => { const pos = must(world.get(e, Position)); const s = must(world.get(e, Size)); return { cx: pos.x + s.w / 2, cy: pos.y + s.h / 2, w: s.w, h: s.h }; };
    /** One desk frame: the carry, the kinds' clock, the build's resolve. */
    const frame = (dtMs = 16) => {
      now += dtMs;
      carry.follow(now);
      prints.tick?.(now);
      const ctx = { ...ctxOf({ x: 0, y: 0 }), entity: e, rect: rect(), props: { width: META.w, height: META.h, angle: 0 }, local: prints };
      return kind.resolve(ctx);
    };
    const press = (x: number, y: number) => { world.edit(p).set(PointerWorld, { x, y }).set(PointerButtons, { buttons: 1, downX: 0, downY: 0, downMs: 0 }); world.addRelation(rec, Watches, p); world.setRelation(rec, Captures, e); };
    const moveTo = (x: number, y: number) => { world.edit(p).set(PointerWorld, { x, y }); };
    const up = () => { world.edit(p).set(PointerButtons, { buttons: 0, downX: 0, downY: 0, downMs: 0 }); };
    const flush = () => { for (const fn of pending.splice(0)) fn(); now += 16; ce.step(now); };
    const undoSteps = (): number => { const s = must(ce.docs.current()).store; let n = 0; while (s.canUndo() && n < 20) { s.undo(); n += 1; } for (let i = 0; i < n; i++) s.redo(); now += 16; ce.step(now); return n; };
    /**
     * Esc (D3t-a): the gestures' cancel — core's one-tick request, written and cleared — and the sweep's word on the press's recognizer:
     * CANCELLED, still capturing the print for the frame before the reap (cleanup reaps a terminal recognizer at terminal + 1).
     */
    const cancelEsc = () => { world.setResource(CancelRequest, { active: true }); world.setResource(CancelRequest, { active: false }); world.addTag(rec, GestureCancelled); };
    /** The wheel the press has turned (core's `PressWheel` sum on the pointer). */
    const wheelTo = (dy: number) => { if (world.has(p, PressWheel)) world.edit(p).set(PressWheel, { dx: 0, dy }); else world.addComponent(p, PressWheel, { dx: 0, dy }); };
    const angleProp = (): number => (world.get(e, Photo.groups[0]?.component as never) as { angle: number }).angle;
    return { ce, world, e, carry, prints, frame, press, moveTo, up, flush, rect, undoSteps, cancelEsc, wheelTo, angleProp, now: () => now, stepEngine: () => { now += 16; ce.step(now); } };
  }

  it("a press lifts it (the kinematic pin: the grab point stays under the finger), the document does not move while it is carried", () => {
    const d = desk();
    expect(d.world.getReverse(must(d.world.getRelation(d.e, ChildOf)), ChildOf).at(-1)).not.toBe(d.e);
    d.frame();
    d.press(450, 320);
    let G = d.frame();
    for (let i = 1; i <= 10; i++) { d.moveTo(450 + 8 * i, 320 + 3 * i); G = d.frame(); }
    expect(d.carry.held()).toEqual([d.e]);
    expect(must(d.prints.body(d.e)).h).toBeGreaterThan(5);
    expect(must(d.prints.body(d.e)).hold?.px).toBe(530);
    expect(d.rect().cx).toBeCloseTo(400, 9);   // flux, not a fact
    expect(G.eye[0]).toBe(530);   // the local eye stands over the finger
    expect(d.carry.commits()).toBe(0);
  });

  it("a flick glides it on and grips; at rest ONE transaction lands it where the law does, raised to the top — one undo step, ⌘Z puts it back", () => {
    const d = desk();
    const before = d.undoSteps();
    d.frame();
    d.press(450, 320);
    d.frame();
    for (let i = 1; i <= 12; i++) { d.moveTo(450 + 12 * i, 320); d.frame(); }   // 750 u/s to the right
    d.up();
    for (let i = 0; i < 400 && d.carry.commits() === 0; i++) { d.frame(); d.flush(); }
    expect(d.carry.commits()).toBe(1);
    const flick = must(d.prints.flick(d.e));
    expect(flick.body.vx).toBeGreaterThan(300);
    // the law, replayed from the release with the steps the desk took: the landing is the law's, to the last bit
    const b = { ...flick.body };
    for (const dt of flick.dts) stepPhoto(b, dt);
    expect(must(flick.landed)).toEqual({ x: b.x, y: b.y });
    d.frame();
    expect(d.rect().cx).toBeCloseTo(b.x, 6);
    expect(d.rect().cy).toBeCloseTo(b.y, 6);
    expect(d.rect().cx).toBeGreaterThan(400 + 144 + 20);   // it glided past where the hand let go
    expect(d.undoSteps()).toBe(before + 1);
    expect(d.world.getReverse(must(d.world.getRelation(d.e, ChildOf)), ChildOf).at(-1)).toBe(d.e);   // raised over the print that lay above it
    must(d.ce.docs.current()).store.undo();
    d.stepEngine();
    expect(d.rect().cx).toBeCloseTo(400, 6);
  });

  it("Esc CANCELS a carry (D3t-a): no flick — the print flies home to where it began in PRINT_RETURN_MS and lands there; nothing is committed", () => {
    const d = desk();
    const before = d.undoSteps();
    d.frame();
    d.press(450, 320);
    d.frame();
    for (let i = 1; i <= 12; i++) { d.moveTo(450 + 12 * i, 320 + 4 * i); d.frame(); }
    expect(d.prints.lifted(d.e)).toBe(true);
    d.cancelEsc();
    d.frame();
    expect(d.carry.cancels()).toBe(1);
    expect(d.carry.held()).toEqual([]);
    const b0 = must(d.prints.body(d.e));
    expect(b0.hold).toBeNull();
    expect(Math.hypot(b0.vx, b0.vy)).toBe(0);   // no flick
    for (let t = 0; t < PRINT_RETURN_MS + 64; t += 16) { d.frame(); d.flush(); }
    const b = must(d.prints.body(d.e));
    expect([b.x, b.y, b.angle]).toEqual([400, 300, 0]);   // home: its facts
    expect(d.prints.lifted(d.e)).toBe(false);
    expect(d.carry.commits()).toBe(0);
    expect(d.undoSteps()).toBe(before);
  });

  it("the WHEEL twists a carried print about the finger (0.0035 rad a unit — the lab's) and its rest commits the turn with the place", () => {
    const d = desk();
    d.frame();
    d.press(450, 320);
    d.frame();
    d.wheelTo(100);
    d.frame();
    const b = must(d.prints.body(d.e));
    expect(b.angle).toBeCloseTo(100 * TWIST_PER_WHEEL, 12);
    // about the finger: the grab point is still under it
    const gx = must(b.hold).gx;
    const gy = must(b.hold).gy;
    expect(b.x + Math.cos(b.angle) * gx - Math.sin(b.angle) * gy).toBeCloseTo(450, 9);
    expect(b.y + Math.sin(b.angle) * gx + Math.cos(b.angle) * gy).toBeCloseTo(320, 9);
    d.wheelTo(60);   // back a little
    d.frame();
    expect(must(d.prints.body(d.e)).angle).toBeCloseTo(60 * TWIST_PER_WHEEL, 12);
    d.up();
    for (let i = 0; i < 400 && d.carry.commits() === 0; i++) { d.frame(); d.flush(); }
    expect(d.carry.commits()).toBe(1);
    expect(d.angleProp()).toBeCloseTo(60 * TWIST_PER_WHEEL, 9);
  });

  it("a press on a print in the AIR catches it where it is — the hand takes the gliding body, not its facts — and it paints lifted while it leads", () => {
    const d = desk();
    d.frame();
    d.press(450, 320);
    d.frame();
    for (let i = 1; i <= 12; i++) { d.moveTo(450 + 12 * i, 320); d.frame(); }
    d.up();
    for (let i = 0; i < 6; i++) d.frame();   // gliding
    const glide = must(d.prints.body(d.e));
    expect(glide.hold).toBeNull();
    expect(glide.x).toBeGreaterThan(400 + 144);
    expect(d.prints.lifted(d.e)).toBe(true);
    // caught: pressed where it is drawn now
    d.press(glide.x, glide.y);
    d.frame();
    const caught = must(d.prints.body(d.e));
    expect(must(caught.hold).px).toBe(glide.x);
    expect(Math.abs(caught.x - glide.x)).toBeLessThan(20);   // held from where it flew, never snapped back to its facts
    d.up();
    for (let i = 0; i < 400 && d.carry.commits() === 0; i++) { d.frame(); d.flush(); }
    expect(d.carry.commits()).toBe(1);
    expect(d.rect().cx).toBeGreaterThan(400 + 144);
  });

  it("a press that never moved it commits nothing; a print that is not held is never carried", () => {
    const d = desk();
    d.frame();
    d.press(450, 320);
    d.frame();
    d.up();
    for (let i = 0; i < 120; i++) { d.frame(); d.flush(); }
    expect(d.carry.commits()).toBe(0);
    expect(d.rect().cx).toBeCloseTo(400, 9);
    expect(must(d.prints.body(d.e)).h).toBe(0);
  });
});

describe("a TAPED print (D4a's tape over D3w's carry)", () => {
  it("is never carried: a press that becomes a drag meets the tape — the print gives ≤ 2.2 px and settles, once a gesture, its Position never moved; untaped, the carry takes it again", () => {
    const ce = createCanvasEngine({ widgets: [Photo] });
    ce.docs.create();
    ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 2 });
    const { world } = ce;
    let now = 1000;
    const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
    const at = printRect(400, 300, META.w, META.h);
    const e = ce.ops.spawnWidget(PHOTO_TYPE, { x: at.x, y: at.y, w: at.w, h: at.h, props: { width: META.w, height: META.h }, undoable: false });
    step(3);
    const builder = createDeskBuilder(world, { objects: [Photo] });
    const prints = must(kind.local)({ pass: () => stubPass().kindPass }) as Prints;
    const carry = createPhotoCarry({ world, docs: ce.docs, prints: () => prints, isPrint: (q) => q === e, props: Photo.groups[0]?.component, defer: (fn) => fn(), refused: (q) => builder.meetTape(q) });
    const LOOKS = new Map<string, unknown>();
    /** One desk frame as the layer's reflector runs it: the carry, then the build when the builder has word of anything or still moves. */
    const frame = (): number => {
      now += 16;
      carry.follow(now);
      const woke = builder.changed();
      const wasLive = builder.live();
      if (woke || wasLive) builder.build({ x: 0, y: 0, zoom: 1 }, { width: 1200, height: 800, dpr: 2 }, 1 / 60, THEMES.light, DEFAULT_GRID, LOOKS);
      return (must(builder.geometryOf(e)) as { centre: readonly number[] }).centre[0] as number - 400;
    };
    const settle = (): void => { let n = 0; do frame(); while (builder.live() && ++n < 200); };
    ce.ops.setLocked([e], true);
    step(1);
    settle();
    expect(frame()).toBe(0);
    // a press on it — the recognizer captures it, still a press: nothing gives yet
    const p = world.spawn({ components: [[Pointer, { id: "mouse", device: "mouse", owner: "" }], [PointerWorld, { x: 450, y: 320 }], [PointerButtons, { buttons: 1, downX: 0, downY: 0, downMs: 0 }]], tags: [LocalPointer] });
    const rec = world.spawn({ components: [[Drag, { startX: 450, startY: 320 }]] });
    world.addRelation(rec, Watches, p);
    world.setRelation(rec, Captures, e);
    for (let i = 0; i < 3; i++) expect(frame()).toBe(0);
    expect(builder.changed()).toBe(false);
    // past the slop the recognizer is an ACTIVE drag that drives nothing (a print is not core-movable): the carry refuses it
    world.addTag(rec, GestureActive);
    const gives: number[] = [];
    let n = 0;
    do { world.edit(p).set(PointerWorld, { x: 450 + 4 * n, y: 320 }); gives.push(frame()); n += 1; } while ((builder.live() || n < 2) && n < 100);
    const peak = Math.max(...gives.map(Math.abs));
    expect(peak).toBeGreaterThan(1.5);
    expect(peak).toBeLessThanOrEqual(MARKS.give.px);
    expect(gives.at(-1)).toBe(0);
    expect(n).toBeLessThan(40);
    // the same gesture goes on: it gave once
    for (let i = 0; i < 10; i++) { world.edit(p).set(PointerWorld, { x: 700 + i, y: 320 }); expect(frame()).toBe(0); }
    expect(carry.held()).toEqual([]);
    expect(carry.commits()).toBe(0);
    expect(world.get(e, Position)).toEqual({ x: at.x, y: at.y });
    // let go and untaped: the next press is carried again
    world.edit(p).set(PointerButtons, { buttons: 0, downX: 0, downY: 0, downMs: 0 });
    world.destroy(rec);
    frame();
    ce.ops.setLocked([e], false);
    step(1);
    const rec2 = world.spawn({ components: [[Drag, { startX: 450, startY: 320 }]], tags: [GestureActive] });
    world.addRelation(rec2, Watches, p);
    world.setRelation(rec2, Captures, e);
    world.edit(p).set(PointerButtons, { buttons: 1, downX: 0, downY: 0, downMs: 0 });
    frame();
    expect(carry.held()).toEqual([e]);
  });
});
