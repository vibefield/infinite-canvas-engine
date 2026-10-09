// M24 LT1 (design-019 §3.3–§3.5): what the desk lends a LIVE kind beside its texture — a REDRAW that remakes no record, the object's
// DURABLE KEY, and the desk's FRAME COUNT its sight folds by — on a desk layer as a host mounts it (a fake device, the engine's frame
// gate stepped as the sleeping loop steps it), over a probe kind of the test's own: its pass tells its sight what each slot drew, its
// tick steps the sight, a "frame arrived" from outside a frame wakes it and its tick redraws.
import { createCanvasEngine, type Entity, PrefabId, type WidgetType } from "@ice/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KindPass } from "../src/kind";
import type { KindHost, KindLocal, ObjectKind, ObjectRect } from "../src/kinds/world";
import { createSight, type Seen, type Sight } from "../src/kit/live";
import { defineObject } from "../src/object";
import { type LayerMount, mountLayer } from "./layer-mount";

interface ProbeRecord { readonly e: Entity; readonly rect: ObjectRect }

interface ProbeLocal extends KindLocal {
  readonly host: KindHost;
  /** Something arrived outside a frame: the kind is woken, and its tick asks a redraw. */
  arrive(): void;
  /** The next tick answers true — the RESTLESS path (every record of the kind remade), the contrast. */
  restless: boolean;
  /** What each step of the sight said moved, in order. */
  readonly moved: Map<Entity, Seen>[];
}

/** The probe's state on the one desk a test mounts: its local, its sight (its passes tell it), its records made. */
const probe: { local?: ProbeLocal; sight?: Sight; records: number } = { records: 0 };

const probePass = (): KindPass<ProbeRecord> => ({
  spawn: () => probePass(),
  prepare(_encoder, slot, records) { for (const r of records) probe.sight?.saw(r.e, slot, r.rect); return records.length; },
  drawRange() {},
  dispose() {},
});

const probeKind: ObjectKind<ObjectRect, ProbeRecord> = {
  name: "probe", stratum: "things", reach: 0,
  create: async () => probePass(),
  resolve: (ctx) => ctx.rect,
  record: (G, ctx) => { probe.records += 1; return { e: ctx.entity, rect: G }; },
  hit: (G, wx, wy) => (Math.abs(wx - G.cx) <= G.w / 2 && Math.abs(wy - G.cy) <= G.h / 2 ? "content" : null),
  local(host) {
    const sight = createSight(host.frames);
    probe.sight = sight;
    let arrived = false;
    const local: ProbeLocal = {
      host, restless: false, moved: [],
      arrive() { arrived = true; host.wake?.(); },
      tick() {
        if (arrived) { arrived = false; host.redraw?.(); }
        const m = sight.step();
        if (m.size > 0) local.moved.push(new Map(m));
        const was = local.restless;
        local.restless = false;
        return was;
      },
      // due now while a frame was drawn its sight has not stepped over (design-019 §3.4); never else on its own
      due: (now) => (sight.owed() ? now : Number.POSITIVE_INFINITY),
    };
    probe.local = local;
    return local;
  },
};

const Probe: WidgetType = defineObject({ type: "test.probe", version: 1, props: {}, size: { w: 200, h: 120 }, kind: probeKind, interaction: { selectable: true, movable: true } });

describe("a live kind's doors on the desk layer (design-019 §3.3–§3.5)", () => {
  let desk: LayerMount;
  let e: Entity;
  const local = (): ProbeLocal => probe.local as ProbeLocal;
  const sleepStats = () => desk.ce.engine.frame.sleepStats();
  beforeAll(async () => {
    desk = await mountLayer([Probe]);
    e = desk.ce.ops.spawnWidget("test.probe", { x: 100, y: 100 });
    expect(desk.handle.status().state).toBe("ready");
    expect(desk.toSleep()).toBeLessThan(400);
  });
  afterAll(() => { desk?.dispose(); });

  it("keyOf: the object's DURABLE key — the document's (`store.keyOf`), kept by a reload and a peer's copy; none for a runtime entity", () => {
    const key = local().host.keyOf?.(e);
    const session = desk.ce.docs.current();
    expect(typeof key).toBe("string");
    expect(key).toBe(session?.store.keyOf(e));
    expect(local().host.keyOf?.(desk.ce.world.spawn())).toBeUndefined();
    // the same document opened in another engine (a reload, or a peer bootstrapped from a snapshot): the key names the object there
    const other = createCanvasEngine({ widgets: [Probe] });
    expect(other.docs.open(session?.exportEnvelope() as Uint8Array).ok).toBe(true);
    const there = other.docs.current()?.store.resolve(key as never);
    expect(there).toBeDefined();
    expect(other.world.get(there as Entity, PrefabId)?.id).toBe("test.probe");
    expect(other.docs.current()?.store.keyOf(there as Entity)).toBe(key);
    // …and an object made here after it arrives there, by the update, under the key it was given here
    const later = desk.ce.ops.spawnWidget("test.probe", { x: 400, y: 100 });
    other.docs.current()?.applyRemote(session?.exportSnapshot() as Uint8Array);
    other.world.sync();
    const laterKey = local().host.keyOf?.(later) as string;
    expect(other.docs.current()?.store.keyOf(other.docs.current()?.store.resolve(laterKey as never) as Entity)).toBe(laterKey);
    other.dispose();
    desk.ce.ops.setSelection([later]);
    desk.ce.ops.deleteSelection();
    expect(desk.toSleep()).toBeLessThan(400);
  });

  it("frames: the desk's count of frames drawn — the layer's `redraws()`, read live", () => {
    expect(local().host.frames?.()).toBe(desk.handle.redraws());
    desk.ce.ops.panTo(5, 5);
    expect(desk.toSleep()).toBeLessThan(400);
    expect(local().host.frames?.()).toBe(desk.handle.redraws());
    expect(desk.handle.redraws()).toBeGreaterThan(0);
  });

  it("redraw from OUTSIDE a frame: a sleeping loop wakes, ONE frame is drawn, NO record is remade", () => {
    const frames0 = desk.handle.redraws();
    const records0 = probe.records;
    const restless0 = desk.handle.stats().totals.restless;
    const ink0 = sleepStats().wakes["desk:ink"] ?? 0;
    local().host.redraw?.();
    expect(sleepStats().wakes["desk:ink"], "the loop is woken for it").toBe(ink0 + 1);
    expect(desk.toSleep()).toBeLessThan(400);
    expect(desk.handle.redraws() - frames0, "one frame").toBe(1);
    expect(probe.records - records0, "no record remade").toBe(0);
    expect(desk.handle.stats().totals.restless - restless0).toBe(0);
  });

  it("an ARRIVAL: the kind woken, its tick redraws and answers false — one frame, no record remade; the restless answer remakes them (the contrast)", () => {
    const frames0 = desk.handle.redraws();
    const records0 = probe.records;
    const ticks0 = desk.handle.perf().kindTicks.probe ?? 0;
    local().arrive();
    expect(desk.toSleep()).toBeLessThan(400);
    expect(desk.handle.perf().kindTicks.probe ?? 0).toBeGreaterThan(ticks0);
    expect(desk.handle.redraws() - frames0, "one frame per arrival").toBe(1);
    expect(probe.records - records0, "no record remade").toBe(0);
    // three arrivals between two frames are one wake and one frame (they coalesce)
    const frames1 = desk.handle.redraws();
    local().arrive(); local().arrive(); local().arrive();
    expect(desk.toSleep()).toBeLessThan(400);
    expect(desk.handle.redraws() - frames1).toBe(1);
    // the old door: a tick answering true makes the kind RESTLESS — its record remade
    const records1 = probe.records;
    const restless1 = desk.handle.stats().totals.restless;
    local().restless = true;
    local().host.wake?.();
    expect(desk.toSleep()).toBeLessThan(400);
    expect(probe.records - records1).toBe(1);
    expect(desk.handle.stats().totals.restless - restless1).toBe(1);
  });

  it("the SIGHT on the desk: seen when drawn; a step that draws nothing moves nothing; culled by a pan, unseen once the frame that culls it is drawn — and the kind due for it", () => {
    expect(probe.sight?.of(e)).toEqual({ seen: true, px: [200, 120], held: false });
    // input steps that draw nothing (the pointer over the bare mat): every kind ticked, nothing moved
    const moved0 = local().moved.length;
    const ticks0 = desk.handle.perf().kindTicks.probe ?? 0;
    const frames0 = desk.handle.redraws();
    for (let i = 0; i < 3; i++) { desk.ce.engine.frame.wake("input"); desk.step(); }
    expect(desk.handle.perf().kindTicks.probe ?? 0).toBeGreaterThan(ticks0);
    expect(desk.handle.redraws()).toBe(frames0);
    expect(local().moved.length).toBe(moved0);
    expect(probe.sight?.of(e)?.seen).toBe(true);
    // a zoom: px follows it
    desk.ce.ops.zoomTo(0.5, { x: 0, y: 0 });
    expect(desk.toSleep()).toBeLessThan(400);
    expect(probe.sight?.of(e)).toEqual({ seen: true, px: [100, 60], held: false });
    // a pan far away: the frame that culls it is the word — the kind is due after it, steps, and reads unseen; then at rest, never due
    desk.ce.ops.panTo(100_000, 100_000);
    expect(desk.toSleep()).toBeLessThan(400);
    expect(probe.sight?.of(e)).toEqual({ seen: false, px: [0, 0], held: false });
    expect(local().moved.at(-1)?.get(e)?.seen).toBe(false);
    const now = performance.now();
    expect(desk.handle.due(now).kinds.probe).toBe(Number.POSITIVE_INFINITY);
    // …and back: seen again
    desk.ce.ops.panTo(0, 0);
    expect(desk.toSleep()).toBeLessThan(400);
    expect(probe.sight?.of(e)?.seen).toBe(true);
  });
});
