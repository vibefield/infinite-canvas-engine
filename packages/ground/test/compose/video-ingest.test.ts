// @vitest-environment node
// VideoIngest (design-013 §6 reflector 7, §8 B6; §9 Q5 RULED): the video kind's contract is a
// REGISTERED STABLE-TEXTURE HANDLE. A producer states its size once, Residency names that handle
// in the card's `TextureRef` (whole uv), and each arriving frame is copied ONCE into the texture
// and closed — never retained and re-imported (that is the rig's mechanism, and the ground has no
// `texture_external` variant). Pinned here: the door (`defineWidget({ surface: "video" })`), the
// handle in the ref after a tick, one copy and one close per arrival, the copy as a QUEUE OP in
// the reflector rather than in `arrive`, the demand clamp (paused drops, a bucket throttles), a
// culled card's picture surviving the round trip, and the texture dying through the table's drain.
import {
  alwaysGpu,
  Camera,
  createCanvasEngine,
  createResidencyStore,
  defineCanvasType,
  defineWidget,
  installSurfaceInfra,
  NO_TEXTURE,
  SurfaceDemand,
  TextureRef,
  Viewport,
  tools,
  widgets,
  type Entity,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIELD_CONFIG } from "../../src/field/layout";
import { createFrameBuilder } from "../../src/compose/frame-inputs";
import { createContentResidency } from "../../src/compose/residency";
import { createVideoIngest, type VideoIngestSource } from "../../src/compose/video-ingest";
import { FIT } from "../../src/nav/flight";
import { THEMES } from "../../oracle/fixtures/vf-theme";
import { must } from "./must";

// One widget type per FILE (global registry; no test reset).
const LIVE = widgets.get("vi:live") ?? defineWidget({ type: "vi:live", surface: "video", component: null, defaultSize: { w: 320, h: 180 } });
// The old `picture`: a GPU target whose demand is paused, so the last good frame stays and nothing uploads.
const PICTURE = widgets.get("vi:picture") ?? defineWidget({ type: "vi:picture", surface: "video", component: null, defaultSize: { w: 320, h: 180 }, behaviors: [alwaysGpu.with({ paused: true })] });
// A kind that asks for 10 fps — `toFpsBucket(10)` is 10, so `demandIntervalMs` is 100 ms.
const SLOW = widgets.get("vi:slow") ?? defineWidget({ type: "vi:slow", surface: "video", component: null, defaultSize: { w: 320, h: 180 }, behaviors: [alwaysGpu.with({ requestedFps: 10 })] });
const ROOT = defineCanvasType({
  id: "vi:root",
  semanticVersion: 1,
  semantic: { placement: { widgets: [LIVE, PICTURE, SLOW] } },
  presentation: { camera: { arrival: "fit", padding: FIT.pad, minZoom: FIT.minZoom, maxZoom: FIT.maxZoom } },
});
const TOOLS = [must(tools.get("select"), "the select tool"), must(tools.get("pan"), "the pan tool")];
const VP = { width: 1600, height: 900, dpr: 1 };
const CAM = { x: 0, y: 0, zoom: 1 };
const SIZE = { width: 320, height: 180 } as const;
// A browser has these for free and Dawn's `globals` install them (`oracle/render.mjs`); a plain
// Node test has neither, and the ground's modules read the global the way every other one does
// (`card/content.ts`, `card/frame-pass.ts`, `engine/target.ts`). The values are the spec's bits.
const TEXTURE_USAGE = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08, RENDER_ATTACHMENT: 0x10 } as const;
(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= TEXTURE_USAGE;
/** What `copyExternalImageToTexture`'s destination must be able to do (R4): COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT. */
const VIDEO_USAGE = TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.RENDER_ATTACHMENT;

interface Log {
  /** One entry per `copyExternalImageToTexture`: which texture, from which source, how big. */
  readonly copies: Array<{ texture: string; source: string; width: number; height: number; premultiplied: boolean; flipY: boolean }>;
  readonly destroyed: string[];
  /** One entry per `close()` — a double close shows up as a repeat. */
  readonly closed: string[];
  readonly created: Array<{ label: string; format: string; usage: number; width: number; height: number }>;
}
const newLog = (): Log => ({ copies: [], destroyed: [], closed: [], created: [] });

/** A device stand-in: the ingest creates textures and enqueues copies; the residency reads `format` and makes views. */
function fakeDevice(log: Log, maxTextureDimension2D = 8192): GPUDevice {
  return {
    limits: { maxTextureDimension2D },
    createTexture: (d: GPUTextureDescriptor) => {
      const label = d.label ?? "tex";
      const size = d.size as { width: number; height: number };
      log.created.push({ label, format: String(d.format), usage: d.usage, width: size.width, height: size.height });
      return {
        label,
        format: d.format,
        createView: () => ({ label: `${label}/view` }) as unknown as GPUTextureView,
        destroy: () => { log.destroyed.push(label); },
      } as unknown as GPUTexture;
    },
    queue: {
      copyExternalImageToTexture: (
        src: { source: unknown; origin?: unknown; flipY?: boolean },
        dst: { texture: GPUTexture; premultipliedAlpha?: boolean },
        size: { width: number; height: number },
      ) => {
        log.copies.push({
          texture: String(dst.texture.label),
          source: String((src.source as { id?: string }).id),
          width: size.width,
          height: size.height,
          premultiplied: dst.premultipliedAlpha === true,
          flipY: src.flipY === true,
        });
      },
    },
  } as unknown as GPUDevice;
}

/** A `VideoFrame` stand-in: the ingest reads `displayWidth`/`displayHeight` and calls `close()` exactly once. */
function fakeFrame(id: string, log: Log, w: number = SIZE.width, h: number = SIZE.height): VideoIngestSource {
  return {
    id,
    displayWidth: w,
    displayHeight: h,
    close: () => { log.closed.push(id); },
  } as unknown as VideoIngestSource;
}

function makeBoard() {
  const log = newLog();
  const device = fakeDevice(log);
  const ce = createCanvasEngine({ widgets: [LIVE, PICTURE, SLOW], canvasTypes: [ROOT], rootCanvas: ROOT, presentationFallback: ROOT, tools: TOOLS });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: VP.width, h: VP.height, dpr: 1 });
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const store = createResidencyStore({});
  installSurfaceInfra(ce.engine, { residency: { table: store.table, allocator: store.allocator } });
  const live = ce.ops.spawnWidget("vi:live", { x: 100, y: 100, w: SIZE.width, h: SIZE.height, undoable: false });
  const picture = ce.ops.spawnWidget("vi:picture", { x: 500, y: 100, w: SIZE.width, h: SIZE.height, undoable: false });
  const slow = ce.ops.spawnWidget("vi:slow", { x: 900, y: 100, w: SIZE.width, h: SIZE.height, undoable: false });
  let frameMs = 0;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { frameMs += 16; ce.step(frameMs); } };
  ce.world.sync();
  step(5); // membership, cull, band, demand, residency
  const residency = createContentResidency(ce.world);
  residency.attach(store.table);
  let clock = 0;
  const ingest = createVideoIngest({ device, world: ce.world, residency, now: () => clock });
  const builder = createFrameBuilder(ce.world, { residency });
  return {
    ce, world: ce.world, step, store, residency, ingest, builder, log, device,
    build: () => builder.build(CAM, VP, 1 / 60, THEMES.dark, DEFAULT_FIELD_CONFIG),
    ref: (e: Entity) => must(ce.world.get(e, TextureRef), "a TextureRef"),
    tick: (): void => { ingest.reflector.flush(ce.world); },
    setClock: (ms: number): void => { clock = ms; },
    pan: (x: number): void => { ce.world.setResource(Camera, { x, y: 0, zoom: 1, gesturing: false }); },
    live, picture, slow,
  };
}

describe("VideoIngest · a producer's frame becomes the card's texture (B6)", () => {
  it("the door: a video widget is declared like any other and equip stamps its kind and gpu target", () => {
    const { world, live } = makeBoard();
    expect(LIVE.surface).toBe("video");
    expect(world.get(live, TextureRef)).toBeDefined();
    // the kind behaviour's only legal answer for a video surface
    expect(must(world.get(live, SurfaceDemand), "demand").mode).toBe("live");
    expect(() =>
      defineWidget({ type: "vi:with-a-view", surface: "video", component: (() => null) as unknown }),
    ).toThrow(/video surface and carries a component/);
  });

  it("register mints the stable handle the card's TextureRef names after a tick — the whole texture, and the plate until a frame lands", () => {
    const { step, store, residency, ingest, ref, log, live } = makeBoard();
    expect(ref(live).texture).toBe(NO_TEXTURE);   // nothing registered: no destination exists
    const handle = ingest.register(live, SIZE);
    expect(handle).not.toBe(NO_TEXTURE);
    expect(store.table.describe(handle)?.kind).toBe("stable");
    expect(ingest.stats().registered).toBe(1);
    expect(ingest.handleOf(live)).toBe(handle);
    // R4: the format and the usage the copy's destination must have
    expect(log.created).toEqual([{ label: `content/video:${String(live)}`, format: "rgba8unorm", usage: VIDEO_USAGE, width: 320, height: 180 }]);
    // the registration is a table revision, which is the door Residency's guard wakes on
    step(1);
    const r = ref(live);
    expect(r.texture).toBe(handle);
    expect([r.layer, r.u0, r.v0, r.u1, r.v1]).toEqual([0, 0, 0, 1, 1]);
    // realised, never written: `empty` is never sampled (§10.2)
    expect(residency.contentOf(live).mode).toBe("plate");
  });

  it("an arrival is ONE copy and ONE close — enqueued by the reflector, not by `arrive` — and the card then draws `own`", () => {
    const { step, residency, ingest, builder, build, tick, log, live } = makeBoard();
    ingest.register(live, SIZE);
    step(1);
    const before = builder.wakes().content;
    build();
    const frame = fakeFrame("f1", log);
    expect(ingest.arrive(live, frame)).toBe(true);
    // the copy is a QUEUE OP that must precede GpuCompose's submit: nothing happened yet
    expect(log.copies).toEqual([]);
    expect(log.closed).toEqual([]);
    tick();
    expect(log.copies).toEqual([{ texture: `content/video:${String(live)}`, source: "f1", width: 320, height: 180, premultiplied: true, flipY: false }]);
    expect(log.closed).toEqual(["f1"]);
    expect(ingest.stats()).toMatchObject({ arrivals: 1, copies: 1, dropped: 0, paused: 0 });
    const c = residency.contentOf(live);
    expect(c.mode).toBe("own");
    if (c.mode !== "own") throw new Error("unreachable");
    expect(c.srgb).toBe(false);                                   // `rgba8unorm` — the texture's ACTUAL format
    expect(c.uv).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
    expect(builder.wakes().content).toBeGreaterThan(before);       // the arrival woke the builder
    expect(build().stats.textured).toBe(1);
  });

  it("two arrivals in one tick are one copy: the superseded frame is closed at once and never copied", () => {
    const { step, ingest, tick, log, live } = makeBoard();
    ingest.register(live, SIZE);
    step(1);
    expect(ingest.arrive(live, fakeFrame("f1", log))).toBe(true);
    expect(ingest.arrive(live, fakeFrame("f2", log))).toBe(true);
    expect(log.closed).toEqual(["f1"]);       // superseded, closed at once — never held for a second frame
    tick();
    expect(log.copies.map((c) => c.source)).toEqual(["f2"]);
    expect(log.closed).toEqual(["f1", "f2"]); // exactly one close per frame
    expect(ingest.stats()).toMatchObject({ arrivals: 2, copies: 1, dropped: 1 });
  });

  it("a PAUSED card drops its frames: closed, never copied, and nothing wakes", () => {
    const { step, residency, ingest, tick, log, picture, world } = makeBoard();
    ingest.register(picture, SIZE);
    step(1);
    expect(must(world.get(picture, SurfaceDemand), "demand").mode).toBe("paused");
    const touches = residency.stats().touches;
    expect(ingest.arrive(picture, fakeFrame("p1", log))).toBe(false);
    tick();
    expect(log.copies).toEqual([]);
    expect(log.closed).toEqual(["p1"]);
    expect(ingest.stats()).toMatchObject({ arrivals: 1, copies: 0, dropped: 1, paused: 1 });
    expect(residency.stats().touches).toBe(touches);   // no upload, no dirt, no frame
  });

  it("a bucket is a ceiling: one copy per interval, the rest dropped and closed", () => {
    const { step, ingest, tick, log, slow, world, setClock } = makeBoard();
    ingest.register(slow, SIZE);
    step(1);
    expect(must(world.get(slow, SurfaceDemand), "demand").fpsBucket).toBe(10);   // 10 fps ⇒ 100 ms
    setClock(1000);
    expect(ingest.arrive(slow, fakeFrame("s1", log))).toBe(true);
    tick();
    setClock(1050);
    expect(ingest.arrive(slow, fakeFrame("s2", log))).toBe(false);   // 50 ms after the copy: inside the interval
    tick();
    setClock(1100);
    expect(ingest.arrive(slow, fakeFrame("s3", log))).toBe(true);    // 100 ms: the interval is up
    tick();
    expect(log.copies.map((c) => c.source)).toEqual(["s1", "s3"]);
    expect(log.closed).toEqual(["s1", "s2", "s3"]);
    expect(ingest.stats()).toMatchObject({ arrivals: 3, copies: 2, dropped: 1, paused: 0 });
  });

  it("a culled card keeps its picture: the ref comes back to the same key and the ingest re-asserts the write — no re-copy owed", () => {
    const { step, residency, ingest, tick, log, live, ref, pan } = makeBoard();
    const handle = ingest.register(live, SIZE);
    step(1);
    ingest.arrive(live, fakeFrame("f1", log));
    tick();
    expect(residency.contentOf(live).mode).toBe("own");
    const key = { ...ref(live) };
    // off screen: Residency gives a video card no destination at all (it holds no key)
    pan(100_000);
    step(2);
    expect(ref(live).texture).toBe(NO_TEXTURE);
    expect(residency.contentOf(live).mode).toBe("plate");
    // the host collects after every submit, and the trunk's sweep drops a debt whose ref went away
    residency.collect();
    expect(residency.isWritten(live)).toBe(false);
    pan(0);
    step(2);
    expect({ ...ref(live) }).toEqual(key);           // the same handle, the same whole uv — the same destination
    expect(ingest.stats().copies).toBe(1);
    // the stable texture still holds those pixels, so the ingest says so again — no producer, no new frame
    tick();
    expect(residency.contentOf(live).mode).toBe("own");
    expect(log.copies).toHaveLength(1);
    expect(residency.textureOf(handle)).toBeDefined();
  });

  it("unregister closes the queued frame and the texture dies through the table's drain, at collect", () => {
    const { step, residency, ingest, log, live, ref } = makeBoard();
    ingest.register(live, SIZE);
    step(1);
    ingest.arrive(live, fakeFrame("f1", log));
    expect(ingest.unregister(live)).toBe(true);
    expect(log.closed).toEqual(["f1"]);              // the queued frame is never left behind
    expect(ingest.stats().registered).toBe(0);
    expect(log.copies).toEqual([]);
    step(1);                                         // Residency gives the destination back
    expect(ref(live).texture).toBe(NO_TEXTURE);
    expect(residency.collect()).toBe(1);
    expect(log.destroyed).toEqual([`content/video:${String(live)}`]);
    expect(ingest.arrive(live, fakeFrame("f2", log))).toBe(false);   // nothing registered: refused and closed
    expect(log.closed).toEqual(["f1", "f2"]);
  });

  it("registering twice replaces the first: the new handle is named, the old texture destroyed at collect, and the card owes a fresh frame", () => {
    const { step, residency, ingest, tick, log, live, ref, setClock } = makeBoard();
    const first = ingest.register(live, SIZE);
    step(1);
    ingest.arrive(live, fakeFrame("f1", log));
    tick();
    expect(residency.contentOf(live).mode).toBe("own");
    // a frame in flight when the producer re-registers was produced for the OLD texture: dropped, closed, never copied
    setClock(1000);   // past the 60 fps bucket, so this one is genuinely QUEUED and not throttled at the door
    expect(ingest.arrive(live, fakeFrame("stale", log))).toBe(true);
    const second = ingest.register(live, { width: 640, height: 360 });
    expect(second).not.toBe(first);
    expect(log.closed).toEqual(["f1", "stale"]);
    expect(ingest.stats().registered).toBe(1);
    step(1);
    expect(ref(live).texture).toBe(second);
    expect(residency.collect()).toBe(1);
    expect(log.destroyed).toEqual([`content/video:${String(live)}`]);   // the first texture, by the same label
    tick();
    expect(residency.contentOf(live).mode).toBe("plate");               // a new destination is a new debt
    ingest.arrive(live, fakeFrame("f2", log));
    tick();
    expect(residency.contentOf(live).mode).toBe("own");
    expect(log.copies.map((c) => c.source)).toEqual(["f1", "f2"]);
    expect(ingest.stats()).toMatchObject({ arrivals: 3, copies: 2, dropped: 1 });
  });

  it("dispose closes every frame still queued", () => {
    const { step, ingest, log, live, slow } = makeBoard();
    ingest.register(live, SIZE);
    ingest.register(slow, SIZE);
    step(1);
    ingest.arrive(live, fakeFrame("f1", log));
    ingest.arrive(slow, fakeFrame("s1", log));
    expect(log.closed).toEqual([]);
    ingest.dispose();
    expect(log.closed.sort()).toEqual(["f1", "s1"]);
    expect(ingest.stats().registered).toBe(0);
    // the counters stay honest through a teardown: a frame that never became a copy is a drop
    const st = ingest.stats();
    expect(st.arrivals).toBe(st.copies + st.dropped);
    expect(st).toMatchObject({ arrivals: 2, copies: 0, dropped: 2 });
  });

  it("a source smaller than the registered texture copies its own size, and one with no pixels is refused", () => {
    const { step, ingest, tick, log, live, setClock } = makeBoard();
    ingest.register(live, SIZE);
    step(1);
    expect(ingest.arrive(live, fakeFrame("small", log, 160, 90))).toBe(true);
    tick();
    expect(log.copies).toEqual([{ texture: `content/video:${String(live)}`, source: "small", width: 160, height: 90, premultiplied: true, flipY: false }]);
    setClock(1000);   // past the bucket: this one reaches the flush, and is refused THERE for having no pixels
    expect(ingest.arrive(live, fakeFrame("empty", log, 0, 0))).toBe(true);
    tick();
    expect(log.copies).toHaveLength(1);
    expect(log.closed).toEqual(["small", "empty"]);
    expect(ingest.stats()).toMatchObject({ arrivals: 2, copies: 1, dropped: 1 });
  });
});
