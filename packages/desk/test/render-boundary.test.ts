// @vitest-environment node
// M24 LT3 (design-019 §8 — petition I24's strikes, extended): THE KIND BOUNDARY IN THE RENDER HALF. A ground made on the fake device
// with a PROBE kind beside a PLAIN one, and the boundary a host hands it (`GroundOptions.boundary`): in every slot a frame or a capture
// draws — the root, a mini mat's inside, a departed desk, the hand, a capture, a tray specimen — a throw from the probe's pass (its
// `prepare`, `drawRange`, `drawOver`, `spawn`, `endHold`, the tray's `idle`/`idleAt`) is handed to the boundary and the frame goes on:
// that slot draws nothing more of the probe, the plain kind draws, the render pass stays usable (the slot's scissor set again). Each
// kind's `prepare` runs in a GPU error scope of its own: an error raised there is the kind's, never the device's uncaptured. A ground
// with no boundary throws as before (a unit's, the oracle's).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Ground, type GroundFrameInputs, type PortalInputs, type RenderBoundary } from "../src/ground";
import { HOLD_SHADER_FILES, holdShaders } from "../src/hold/shaders";
import type { ComposeOptions } from "../src/engine/shader";
import type { CardMaterial, KindPass, KindProgram, SlotContext } from "../src/kind";
import type { ObjectContext, ObjectKind } from "../src/kinds/world";
import { DEFAULT_GRID } from "../src/mat/grid";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { themeFrom } from "../src/theme";
import { drawerRect } from "../src/tray/drawer";
import { trayShaders } from "../src/tray/shaders";
import { specimenFrames } from "../src/tray/specimens";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const VIEW = { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 };
const THEME = themeFrom("light", { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } });
/** A WGSL the fake device refuses (a validation error raised into the scope open when it is made). */
const BROKEN = "fn broken() { nothing_declares_this; }";

/** Which of the probe's calls throw, and where: the root's pass, or a spawned slot's. */
interface Faults {
  prepare?: "root" | "spawned" | "all" | undefined;
  drawRange?: "root" | "spawned" | "all" | undefined;
  drawOver?: boolean;
  spawn?: boolean;
  endHold?: boolean;
  idle?: boolean;
  idleAt?: boolean;
  /** Its prepare raises a GPU validation error (a module the device refuses) instead of throwing. */
  gpu?: boolean;
}

/** A kind that draws nothing but logs each range it draws (a debug group per range, by its slot's label), its pass's calls faulted on demand. */
function probeKind(name: string, faults: Faults, device: () => GPUDevice, composite = false): ObjectKind {
  const hits = (where: Faults["prepare"], spawned: boolean): boolean => where === "all" || (where === "root" && !spawned) || (where === "spawned" && spawned);
  const pass = (label: string, spawned: boolean): KindPass => ({
    spawn: () => { if (faults.spawn === true) throw new Error(`${name}: its spawn throws on purpose`); return pass(`${label}+`, true); },
    prepare: (_e: GPUCommandEncoder, _s: SlotContext, records: readonly unknown[]) => {
      if (faults.gpu === true) device().createShaderModule({ code: BROKEN, label: `${label} broken` });
      if (hits(faults.prepare, spawned)) throw new Error(`${name}: its prepare throws on purpose (${label})`);
      return records.length;
    },
    drawRange: (p, first, end) => {
      if (hits(faults.drawRange, spawned)) { p.setScissorRect(1, 2, 3, 4); throw new Error(`${name}: its drawRange throws on purpose (${label})`); }
      p.pushDebugGroup(`kind ${label} ${first}-${end}`);
      p.popDebugGroup();
    },
    drawOver: (p, index) => { if (faults.drawOver === true) throw new Error(`${name}: its drawOver throws on purpose`); p.pushDebugGroup(`over ${label} ${index}`); p.popDebugGroup(); },
    endHold: () => { if (faults.endHold === true) throw new Error(`${name}: its endHold throws on purpose`); },
    idle: () => { if (faults.idle === true) throw new Error(`${name}: its idle throws on purpose`); },
    idleAt: () => { if (faults.idleAt === true) throw new Error(`${name}: its idleAt throws on purpose`); return Number.POSITIVE_INFINITY; },
    dispose: () => {},
  });
  return {
    name, stratum: "things", reach: 0, ...(composite ? { composite: true } : {}),
    create: async () => pass(name, false),
    resolve: (ctx: ObjectContext) => ctx,
    record: (_g, ctx) => ({ e: ctx.entity }),
    hit: () => null,
  };
}

/** A ground of the probe and the plain kind on the fake device, the boundary's words recorded; `watch` its GPU scopes. */
async function groundOf(faults: Faults, opts: { readonly boundary?: boolean; readonly watch?: boolean; readonly composite?: boolean } = {}) {
  const log: string[] = [];
  const fake = fakeDevice(log, { refuse: (code) => (code === BROKEN ? "unresolved value 'nothing_declares_this'" : undefined) });
  const threw: string[] = [];
  const gpu: string[] = [];
  const boundary: RenderBoundary = {
    threw: (kind, call, err) => { threw.push(`${kind} ${call}: ${err instanceof Error ? err.message : String(err)}`); },
    watch: opts.watch ?? true,
    device: fake.device,
    gpu: (kind, error) => { gpu.push(`${kind}: ${error.message}`); },
  };
  const probe = probeKind("probe", faults, () => fake.device, opts.composite === true);
  const plain = probeKind("plain", {}, () => fake.device);
  const ground = await Ground.create({
    device: fake.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [probe, plain],
    hold: holdShaders(shaderText(HOLD_SHADER_FILES)), tray: trayShaders(shaderText),
    ...(opts.boundary === false ? {} : { boundary }),
  });
  /** The ranges each slot drew, in order (`kind <label> <first>-<end>`), and the scissors set. */
  const drew = (): string[] => log.filter((l) => l.startsWith("debug kind ") || l.startsWith("debug over ")).map((l) => l.slice(6));
  return { ground, log, threw, gpu, fake, probe, plain, drew, faults };
}

const objects = [{ kind: "probe", record: { id: "p1" }, key: 1 }, { kind: "plain", record: { id: "a" }, key: 2 }, { kind: "probe", record: { id: "p2" }, key: 3 }, { kind: "plain", record: { id: "b" }, key: 4 }];
const rest: GroundFrameInputs = { view: VIEW, theme: THEME, objects };
/** A live inside after object 1 (a plain one): the pool's slot, prepared by both kinds' SPAWNED passes. */
const inside: PortalInputs = { at: 1, grid: DEFAULT_GRID, view: { camX: -300, camY: -200, zoom: 0.5, width: 1200, height: 800, dpr: 2 }, present: { opacity: 1, portal: { cx: 600, cy: 400, hx: 250, hy: 180, r: 8 } }, objects: [{ kind: "probe", record: { id: "in-p" }, key: 11 }, { kind: "plain", record: { id: "in-a" }, key: 12 }] };

describe("the kind boundary in the render half (design-019 §8, M24 LT3)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  it("the ROOT: a prepare that throws — handed to the boundary, the slot draws nothing of the kind, the plain kind draws; the frame submitted, nothing leaves it", async () => {
    const g = await groundOf({ prepare: "root" });
    const submits = g.fake.queue.submits;
    expect(() => g.ground.render(rest)).not.toThrow();
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe)"]);
    expect(g.drew()).toEqual(["kind plain 0-2"]);   // the plain kind's two objects — one run now the probe's between them is left out
    expect(g.fake.queue.submits - submits).toBe(1);
    // a frame later, the fault gone: the probe draws again — the boundary keeps nothing of a frame (the host counts the strikes)
    g.log.length = 0;
    g.threw.length = 0;
    g.faults.prepare = undefined;
    g.ground.render(rest);
    expect(g.threw).toEqual([]);
    expect(g.drew()).toEqual(["kind probe 0-1", "kind plain 0-1", "kind probe 1-2", "kind plain 1-2"]);
    g.ground.dispose();
  });

  it("a drawRange that throws mid-slot: the kind is skipped for the rest of the slot, the slot's scissor set again, and the kinds after it still draw", async () => {
    const g = await groundOf({ drawRange: "root" });
    g.ground.render(rest);
    expect(g.threw).toEqual(["probe drawRange: probe: its drawRange throws on purpose (probe)"]);   // once: the slot asks it no more
    expect(g.drew()).toEqual(["kind plain 0-2"]);
    // the probe narrowed the scissor before it threw: the slot's own is set again before the next run
    const narrowed = g.log.indexOf("scissor 1,2,3,4");
    expect(narrowed).toBeGreaterThan(-1);
    expect(g.log[narrowed + 1]).toBe("scissor 0,0,2400,1600");
    expect(g.log.indexOf("debug kind plain 0-2")).toBeGreaterThan(narrowed);
    g.ground.dispose();
  });

  it("a MINI MAT's INSIDE: the spawned pass's prepare throws — the inside draws the plain kind alone, the root draws both; a spawn that throws draws the kind's objects there in the missing face", async () => {
    const g = await groundOf({ prepare: "spawned" });
    g.ground.render({ ...rest, portals: [inside] });
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe+)"]);
    expect(g.drew()).toEqual(["kind probe 0-1", "kind plain 0-1", "kind plain+ 0-1", "over plain 0", "kind probe 1-2", "kind plain 1-2"]);
    g.ground.dispose();
    const s = await groundOf({ spawn: true });
    s.ground.render({ ...rest, portals: [inside] });
    expect(s.threw).toEqual(["probe spawn: probe: its spawn throws on purpose"]);
    // the inside's probe object is the missing face's (the desk's pipeline, no kind range); its plain one and the root's draw
    expect(s.drew()).toEqual(["kind probe 0-1", "kind plain 0-1", "kind plain+ 0-1", "over plain 0", "kind probe 1-2", "kind plain 1-2"]);
    expect(s.log).toContain("pipeline desk/missing");
    // the slot is reused: its spawn is not asked again, frame after frame
    s.threw.length = 0;
    s.ground.render({ ...rest, portals: [inside] });
    expect(s.threw).toEqual([]);
    s.ground.dispose();
  });

  it("a COMPOSITE kind (one run over all its records, after the stratum's) whose prepare throws: that run never drawn, the rest of the stratum drawn", async () => {
    const g = await groundOf({ prepare: "root" }, { composite: true });
    g.ground.render(rest);
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe)"]);
    expect(g.drew()).toEqual(["kind plain 0-2"]);   // never "kind probe 0-2" — the composite's one run
    g.faults.prepare = undefined;
    g.log.length = 0;
    g.ground.render(rest);
    expect(g.drew()).toEqual(["kind plain 0-2", "kind probe 0-2"]);   // the control: its run, after the stratum's
    g.ground.dispose();
  });

  it("an inside lying on an object of a kind the slot skips is still drawn where it lies — its own kinds prepared afresh — and the skipped kind's drawOver never asked", async () => {
    const g = await groundOf({ prepare: "root" });
    g.ground.render({ ...rest, portals: [{ ...inside, at: 0 }] });
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe)"]);
    expect(g.drew()).toEqual(["kind probe+ 0-1", "kind plain+ 0-1", "kind plain 0-2"]);
    g.ground.dispose();
  });

  it("a DEPARTED desk (a flight's outgoing slot) and a drawOver after an inside: each a throw of the kind's, the frame drawn", async () => {
    const g = await groundOf({ prepare: "spawned" });
    g.ground.render({ ...rest, outgoing: { grid: DEFAULT_GRID, order: "under", view: VIEW, objects: [{ kind: "probe", record: { id: "out-p" }, key: 21 }, { kind: "plain", record: { id: "out-a" }, key: 22 }] } });
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe+)"]);
    expect(g.drew()).toEqual(["kind plain+ 0-1", "kind probe 0-1", "kind plain 0-1", "kind probe 1-2", "kind plain 1-2"]);
    g.ground.dispose();
    // the inside lies on a PROBE object (at 0): its drawOver throws — handed on, the rest drawn
    const o = await groundOf({ drawOver: true });
    o.ground.render({ ...rest, portals: [{ ...inside, at: 0 }] });
    expect(o.threw).toEqual(["probe drawOver: probe: its drawOver throws on purpose"]);
    // (its run drawn and its inside; then the slot asks the probe no more — its second object left out, the plain ones one run)
    expect(o.drew()).toEqual(["kind probe 0-1", "kind probe+ 0-1", "kind plain+ 0-1", "kind plain 0-2"]);
    o.ground.dispose();
  });

  it("THE HAND: the hand slot's prepare throws — the held frame laid all the same (the desk copy, the composite); the hold's end (`endHold`) that throws, likewise", async () => {
    const g = await groundOf({ prepare: "root", endHold: true });
    const held: GroundFrameInputs = { ...rest, objects: [objects[1] as (typeof objects)[number], objects[3] as (typeof objects)[number]], held: { object: objects[0] as (typeof objects)[number], view: { ...VIEW, zoom: 2.5 }, grid: DEFAULT_GRID, e: 1, blur: 14, dim: 0.3, filter: { saturate: 1, brightness: 1 }, light: THEME.matLight, stamp: "s1" } };
    const submits = g.fake.queue.submits;
    expect(() => g.ground.render(held)).not.toThrow();
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe)"]);   // the hand's slot (the copy holds no probe)
    expect(g.drew()).toEqual(["kind plain 0-2"]);   // the desk copy's plain objects; the hand drew nothing of the probe
    expect(g.fake.queue.submits - submits).toBe(2);   // the copy's submit and the frame's
    expect(g.log).toContain("pass hold");
    g.threw.length = 0;
    g.ground.render(rest);   // the hold is over: every kind's endHold — the probe's throws
    expect(g.threw.filter((t) => t.startsWith("probe endHold"))).toEqual(["probe endHold: probe: its endHold throws on purpose"]);
    g.ground.dispose();
  });

  it("A CAPTURE: its prepare throws inside the capture's own encoding — handed on, and the capture still answers its bytes", async () => {
    const g = await groundOf({ prepare: "root" });
    g.ground.render(rest);
    g.threw.length = 0;
    const c = await g.ground.capture(rest, { scale: 0.25 });
    expect(c).toMatchObject({ width: 600, height: 400 });
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe)"]);
    g.ground.dispose();
  });

  it("A TRAY SPECIMEN: its slot's spawn and prepare inside the boundary, and the tray's idle and idleAt", async () => {
    const g = await groundOf({ prepare: "spawned", idle: true, idleAt: true });
    const env = { view: { width: 1200, height: 800, dpr: 2 }, theme: THEME, grid: DEFAULT_GRID, looks: new Map(), lift: () => 0 };
    const shelf = { natural: { w: 400, h: 200 }, rect: { x: 100, y: 80, w: 160, h: 80 }, props: {}, accessory: "hook" as const, pegs: [[-1, -0.5], [1, -0.5]] as [number, number][], label: "Probe" };
    const specimens = (k: { probe: ObjectKind; plain: ObjectKind }) => specimenFrames([
      { key: 7, type: "t:probe", kind: k.probe, ...shelf },
      { key: 8, type: "t:plain", kind: k.plain, ...shelf, rect: { x: 400, y: 80, w: 160, h: 80 } },
    ], { rect: drawerRect(1200, 800, 1), scroll: 0 }, env);
    const frames = specimens(g);
    // a specimen's slot whose spawn throws: the kind's strike, and the specimen drawn in the missing face
    const sp = await groundOf({ spawn: true });
    sp.ground.render({ view: VIEW, theme: THEME, tray: { p: 1, scroll: 0, specimens: specimens(sp) } });
    expect(sp.threw).toEqual(["probe spawn: probe: its spawn throws on purpose"]);
    expect(sp.log).toContain("pipeline desk/missing");
    expect(sp.drew()).toEqual(["kind plain+ 0-1"]);
    sp.ground.dispose();
    g.ground.render({ view: VIEW, theme: THEME, tray: { p: 1, scroll: 0, specimens: frames } });
    expect(g.threw).toEqual(["probe prepare: probe: its prepare throws on purpose (probe+)"]);
    expect(g.drew()).toEqual(["kind plain+ 0-1"]);   // the plain specimen drawn, the probe's not
    g.threw.length = 0;
    g.ground.idleTray();
    expect(g.ground.trayIdleAt()).toBe(Number.POSITIVE_INFINITY);
    expect(g.threw).toEqual(["probe idle: probe: its idle throws on purpose", "probe idleAt: probe: its idleAt throws on purpose"]);
    g.ground.dispose();
  });

  it("a GPU error raised in a kind's prepare is THAT kind's (its own validation scope) — told to the boundary, never the device's uncaptured; unwatched, the device's", async () => {
    const g = await groundOf({ gpu: true });
    g.ground.render(rest);
    await new Promise((r) => setTimeout(r, 0));   // the scopes are answered later, as a device answers them
    expect(g.gpu).toEqual(["probe: Error while parsing WGSL: unresolved value 'nothing_declares_this'"]);
    expect(g.fake.uncaptured).toEqual([]);
    expect(g.threw).toEqual([]);   // a GPU error is no throw: the frame drew the probe
    expect(g.drew()).toEqual(["kind probe 0-1", "kind plain 0-1", "kind probe 1-2", "kind plain 1-2"]);
    g.ground.dispose();
    const u = await groundOf({ gpu: true }, { watch: false });
    u.ground.render(rest);
    await new Promise((r) => setTimeout(r, 0));
    expect(u.gpu).toEqual([]);
    expect(u.fake.uncaptured.map((e) => e.message)).toEqual(["Error while parsing WGSL: unresolved value 'nothing_declares_this'"]);
    u.ground.dispose();
  });

  it("with NO boundary (a unit's ground, the oracle's): a kind's throw leaves the frame, as before", async () => {
    const g = await groundOf({ prepare: "root" }, { boundary: false });
    expect(() => g.ground.render(rest)).toThrow(/probe: its prepare throws on purpose/);
    g.ground.dispose();
    const d = await groundOf({ drawRange: "root" }, { boundary: false });
    expect(() => d.ground.render(rest)).toThrow(/its drawRange throws on purpose/);
    d.ground.dispose();
  });

  describe("a kind the FLAT CARD composes (K7b)", () => {
    /** A card material over a uniform, a record array and a texture array (card.test.ts's), its functions named after the kind. */
    const material = (name: string): CardMaterial => ({
      shaders: (): ComposeOptions => ({ modules: [], entry: { label: `${name}/card.wgsl`, text: `fn ${name}_quad(slot: u32, vid: u32) -> vec4f { return vec4f(0.0); }\nfn ${name}_frag(slot: u32, clip: vec4f) -> vec4f { return vec4f(1.0); }` } }),
      bindings: [
        { wgsl: `var<uniform> ${name}_k: vec4f`, entry: { stages: ["fragment"], buffer: "uniform" } },
        { wgsl: `var<storage, read> ${name}s: array<vec4f>`, entry: { stages: ["vertex", "fragment"], buffer: "read-only-storage" } },
        { wgsl: `var ${name}_tex: texture_2d_array<f32>`, entry: { stages: ["fragment"], texture: "float", dimension: "2d-array" } },
      ],
      quad: `${name}_quad`,
      frag: `${name}_frag`,
    });
    const program = (name: string, f: { prepare?: boolean; cardSlot?: boolean }): KindProgram => {
      const pass = (): KindPass => ({
        spawn: pass,
        prepare: (_e, _s, records) => { if (f.prepare === true) throw new Error(`${name}: its prepare throws on purpose`); return records.length; },
        drawRange: (p, first, end) => { p.pushDebugGroup(`kind ${name} ${first}-${end}`); p.popDebugGroup(); },
        cardResources: () => ({ version: 1, resources: [{ label: `${name}/k` }, { label: `${name}/records`, getMappedRange: () => new ArrayBuffer(0) }, { label: `${name}/tex` }] as unknown as GPUBuffer[] }),
        cardSlot: (i) => { if (f.cardSlot === true) throw new Error(`${name}: its cardSlot throws on purpose`); return i * 10; },
        dispose: () => {},
      });
      return { name, stratum: "things", card: material(name), create: async () => pass() };
    };
    const cards = [{ kind: "note", record: {} }, { kind: "print", record: {} }, { kind: "note", record: {} }, { kind: "print", record: {} }];

    it("its prepare, or its cardSlot, that throws: none of its objects routed to the card — the other material's cards ONE draw, the frame drawn", async () => {
      for (const f of [{ prepare: true }, { cardSlot: true }]) {
        const log: string[] = [];
        const threw: string[] = [];
        const fake = fakeDevice(log);
        const ground = await Ground.create({
          device: fake.device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("note", {}), program("print", f)],
          boundary: { threw: (kind, call) => { threw.push(`${kind} ${call}`); }, watch: false, device: fake.device, gpu: () => {} },
        });
        ground.render({ view: VIEW, theme: THEME, objects: cards });
        expect(threw).toEqual([f.prepare === true ? "print prepare" : "print cardSlot"]);
        const frame = log.slice(log.indexOf("pass ground"));
        // the two notes' cards one run — [0, 2) — the prints nowhere: not as cards, not by their own pass
        expect(frame.filter((l) => l.startsWith("draw 6") || l.startsWith("debug kind "))).toEqual(["draw 6,2,0,0"]);
        ground.dispose();
      }
    });
  });
});
