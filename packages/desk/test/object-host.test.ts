// K4b (design-016 §5 · K-L2): an object DECLARES its DOM half — `defineObject({ host: { lend, text, mount } })` — and the desk
// layer builds whatever the registered objects declare, generically: it never finds a half by type or names a kind. Until K4b
// the layer built the note's editor and the calendar's input itself (`host/layer.ts`, found by type), which no plugin kind could
// have. Here a THIRD-PARTY object — a kind of the test's own, no reference kind in sight — lends a service, declares a text part
// over the desk's ONE editor (the desk's since K8a — editor-lease.test.ts leases it), and mounts a half handed it. The halves are
// made at the mount, before the device boots, so a fake page (the few members a mount reads) is enough.
import { createCanvasEngine, InsertGhost, type WidgetType } from "@ice/core";
import { describe, expect, it } from "vitest";
import { deskLayer, type DeskLayerOptions } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindDriver, KindDriverHost, KindHost, ObjectDomHost, ObjectKind } from "../src/kinds/world";
import type { DeskEditor } from "../src/kit/editor";
import { BLOB_STORE, type BlobStore, PICTURE_DECODER } from "../src/kit/blobs";
import { PRINT_RASTER, type PrintRaster } from "../src/kit/print";
import { TEXT_RASTER, type TextRaster } from "../src/kit/raster";
import { service, serviceKey } from "../src/kit/services";
import { defineObject, hostOf } from "../src/object";
import { DEFAULT_GRID } from "../src/mat/grid";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

/** A kind of the test's own: no pass is ever made (no device boots), no geometry is ever asked. */
function scribbleKind(name: string, locals: KindHost[]): ObjectKind {
  return {
    name, stratum: "things", reach: 0,
    create: async () => ({}) as KindPass,
    resolve: () => ({}), record: () => ({}), hit: () => null,
    local: (host) => { locals.push(host); return {}; },
  };
}

/** What the halves were handed, in the order the layer called them. */
interface Calls { lend: { type: string; text: TextRaster | undefined }[]; text: ObjectDomHost[]; mount: ObjectDomHost[]; order: string[] }

function mountDesk(objects: WidgetType[], text?: TextRaster, more: Pick<DeskLayerOptions, "blobs" | "services"> = {}) {
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const page = fakePage();
  const { stack } = ce;
  const handle = deskLayer({ theme: themeFrom("light", PALETTE), palette: PALETTE, objects, ...(text !== undefined ? { text } : {}), ...more })({
    host: { container: page.container } as never, world: ce.world,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
    transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
  });
  return { ce, page, handle };
}

const fakePrint = { hand: () => undefined } as unknown as PrintRaster;
const fakeText = { version: () => 0 } as unknown as TextRaster;

describe("an object's DOM half is DECLARED, and the desk builds what the objects declare (K4b; K8a)", () => {
  it("lend → every kind's local; text → the object's parts over the desk's ONE editor; mount → handed its own object, driver and look, and the editor", () => {
    const calls: Calls = { lend: [], text: [], mount: [], order: [] };
    const locals: KindHost[] = [];
    const driver: KindDriver = { follow: () => {}, idle: () => true };
    const Scribble = defineObject({
      type: "test.scribble", version: 1, props: {}, kind: scribbleKind("scribble", locals),
      drivers: () => driver,
      host: {
        lend: (h) => { calls.order.push("lend"); calls.lend.push({ type: "test.scribble", text: h.use(TEXT_RASTER) }); return [service(PRINT_RASTER, fakePrint)]; },
        text: (h) => { calls.order.push("text"); calls.text.push(h); return [{ part: "scribble.line" }]; },
        mount: (h) => { calls.order.push("mount"); calls.mount.push(h); },
      },
    });
    expect(hostOf(Scribble)?.text).toBeTypeOf("function");
    const { ce, handle } = mountDesk([Scribble], fakeText);
    try {
      // lent before the local, and the kind's world half reads what its DOM half lent (the calendar's print raster, as a plugin's)
      expect(calls.order).toEqual(["lend", "text", "mount"]);
      expect(calls.lend).toEqual([{ type: "test.scribble", text: fakeText }]);
      expect(locals.map((h) => h.use?.(PRINT_RASTER))).toEqual([fakePrint]);
      // the halves are handed the object they were declared on and ITS driver — never found by type
      expect(calls.text[0]?.object).toBe(Scribble);
      expect(calls.text[0]?.driver).toBe(driver);
      expect(calls.mount[0]?.object).toBe(Scribble);
      expect(calls.mount[0]?.driver).toBe(driver);
      // the one editor is the DESK's: the handle's door, handed to every half — no object made it
      expect(handle.editor()).toBeDefined();
      expect(calls.text[0]?.editor).toBe(handle.editor());
      expect(calls.mount[0]?.editor).toBe(handle.editor());
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("the ONE editor needs no kind: the desk makes it whether or not any object takes text, and every half that mounts is handed the same one", () => {
    const borrowed: DeskEditor[] = [];
    const locals: KindHost[] = [];
    const Borrower = defineObject({ type: "test.borrower", version: 1, props: {}, kind: scribbleKind("borrower", locals), host: { mount: (h) => { borrowed.push(h.editor); } } });
    const Other = defineObject({ type: "test.other", version: 1, props: {}, kind: scribbleKind("other", locals), host: { mount: (h) => { borrowed.push(h.editor); } } });
    const { ce, handle } = mountDesk([Borrower, Other]);
    try {
      expect(borrowed).toEqual([handle.editor(), handle.editor()]);
      // nothing lent: every kind's local sees no print raster
      expect(locals.map((h) => h.use?.(PRINT_RASTER))).toEqual([undefined, undefined]);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("a driver asks after what objects PROVIDE (K8a — `KindDriverHost.provides`), never after a kind's name: a predicate over the desk's types, none when nothing provides the key", () => {
    let host: KindDriverHost | undefined;
    const Sticky = defineObject({ type: "test.sticky", version: 1, props: {}, kind: scribbleKind("sticky", []), provides: ["test.sticks"], drivers: (h) => { host = h; return undefined; } });
    const Plain = defineObject({ type: "test.unsticky", version: 1, props: {}, kind: scribbleKind("unsticky", []) });
    const { ce, handle } = mountDesk([Sticky, Plain]);
    try {
      const a = ce.ops.spawnWidget(Sticky.type, { x: 0, y: 0, w: 10, h: 10, undoable: false });
      const b = ce.ops.spawnWidget(Plain.type, { x: 20, y: 0, w: 10, h: 10, undoable: false });
      ce.step(16);
      const sticks = host?.provides("test.sticks");
      expect(sticks?.(a)).toBe(true);
      expect(sticks?.(b)).toBe(false);
      expect(host?.provides("test.nothing")).toBeUndefined();
      // an INSERT GHOST (core's tray adoption, K5b) provides nothing to a driver, as it is no kind's: only the twin it becomes
      ce.world.addComponent(a, InsertGhost, { type: Sticky.type, props: "{}", screenX: 0, screenY: 0 });
      expect(sticks?.(a)).toBe(false);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("a desk whose objects declare no DOM half still has the desk's editor, and the halves are asked for nothing", () => {
    const locals: KindHost[] = [];
    const Plain = defineObject({ type: "test.plain", version: 1, props: {}, kind: scribbleKind("plain", locals) });
    expect(hostOf(Plain)).toBeUndefined();
    const { ce, handle } = mountDesk([Plain], fakeText);
    try {
      expect(handle.editor()).toBeDefined();
      expect(handle.editor().lease()).toBeUndefined();
      expect(locals.length).toBe(1);
      expect(locals[0]?.use?.(PRINT_RASTER)).toBeUndefined();
      expect(locals[0]?.use?.(TEXT_RASTER)).toBe(fakeText);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });
});

// K8a (design-016 §5 · K-L2): `KindHost` was a FIXED list — `print` was the desk calendar's raster, lent to the calendar alone — so no
// plugin kind could lend a service of its own or use one another lent. The services are an open registry by key now: a kind LENDS
// under a key (its DOM half's `lend`), ANY kind USES by key, the host's own three are entries, and a name is lent once per desk.
describe("the services: an open registry any kind lends to and any kind uses, by key (K8a)", () => {
  /** A service of a plugin's own — a metronome its DOM half makes and another plugin's world half reads. */
  interface Metronome { readonly bpm: number }
  const METRONOME = serviceKey<Metronome>("test.metronome");

  it("a plugin's DOM half lends under ITS key and ANOTHER plugin's world half uses it — by a key it declared itself (by name)", () => {
    const locals: { readonly name: string; readonly host: KindHost }[] = [];
    const kindOf = (name: string): ObjectKind => ({ ...scribbleKind(name, []), local: (host) => { locals.push({ name, host }); return {}; } });
    const beat: Metronome = { bpm: 96 };
    // the lender, and a user that never imports it: its own key value, the same NAME (a kind names another only by a registry name)
    const Lender = defineObject({ type: "test.lender", version: 1, props: {}, kind: kindOf("lender"), host: { lend: () => [service(METRONOME, beat)] } });
    const Listener = defineObject({ type: "test.listener", version: 1, props: {}, kind: kindOf("listener") });
    const { ce, handle } = mountDesk([Listener, Lender]);
    try {
      const mine = serviceKey<Metronome>("test.metronome");
      expect(locals.map((l) => l.name)).toEqual(["listener", "lender"]);
      // every kind sees what any object lent — the listener registered BEFORE the lender too: the lends are made before any local
      for (const l of locals) expect(l.host.use?.(mine), l.name).toBe(beat);
      expect(locals[0]?.host.use?.(serviceKey<Metronome>("test.other"))).toBeUndefined();
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("the host's own services are entries of the same registry — text, blobs, the decoder, and any the app lends by key", () => {
    const hosts: KindHost[] = [];
    const Plain = defineObject({ type: "test.plain-services", version: 1, props: {}, kind: scribbleKind("plain-services", hosts) });
    const blobs = { put: async () => "", get: async () => undefined } as BlobStore;
    const { ce, handle } = mountDesk([Plain], fakeText, { blobs, services: [service(METRONOME, { bpm: 120 })] });
    try {
      const h = hosts[0];
      expect(h?.use?.(TEXT_RASTER)).toBe(fakeText);
      expect(h?.use?.(BLOB_STORE)).toBe(blobs);
      expect(h?.use?.(PICTURE_DECODER)).toBeTypeOf("function");
      expect(h?.use?.(METRONOME)?.bpm).toBe(120);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("a DOM half's lend is handed what is lent so far, and a DOM half uses the registry too (`ObjectDomHost.use`)", () => {
    const seen: (Metronome | undefined)[] = [];
    const mounted: (Metronome | undefined)[] = [];
    const First = defineObject({ type: "test.first-lender", version: 1, props: {}, kind: scribbleKind("first-lender", []), host: { lend: () => [service(METRONOME, { bpm: 60 })] } });
    const HALF = serviceKey<{ readonly half: Metronome | undefined }>("test.half");
    const Second = defineObject({
      type: "test.second-lender", version: 1, props: {}, kind: scribbleKind("second-lender", []),
      host: { lend: (h) => { const m = h.use(METRONOME); seen.push(m); return [service(HALF, { half: m })]; }, mount: (h) => { mounted.push(h.use(HALF)?.half); } },
    });
    const { ce, handle } = mountDesk([First, Second]);
    try {
      expect(seen.map((m) => m?.bpm)).toEqual([60]);
      expect(mounted.map((m) => m?.bpm)).toEqual([60]);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("a name is lent ONCE per desk: a second lender is a mount error naming both — never a silent winner", () => {
    const A = defineObject({ type: "test.lends-a", version: 1, props: {}, kind: scribbleKind("lends-a", []), host: { lend: () => [service(METRONOME, { bpm: 1 })] } });
    const B = defineObject({ type: "test.lends-b", version: 1, props: {}, kind: scribbleKind("lends-b", []), host: { lend: () => [service(METRONOME, { bpm: 2 })] } });
    expect(() => mountDesk([A, B])).toThrow(/"test\.metronome" is lent twice — by the object "test\.lends-a" and by the object "test\.lends-b"/);
    // …and so is a kind's lend over the host's own
    const C = defineObject({ type: "test.lends-text", version: 1, props: {}, kind: scribbleKind("lends-text", []), host: { lend: () => [service(TEXT_RASTER, fakeText)] } });
    expect(() => mountDesk([C], fakeText)).toThrow(/"text" is lent twice — by the host and by the object "test\.lends-text"/);
  });
});

// K8a (design-016 §5 — the handle's one kind-shaped door): a still pinned a note's writing through `pinGreek(e, GreekPin)`, the paper
// kind's shape stated in the desk. `pinAsset` is generic: the value reaches the object's kind as `ctx.asset`, in whatever shape the
// kind defines — here a kind of the test's own reads its own.
describe("a still pins a kind's OWN asset through the handle's generic door (K8a)", () => {
  it("pinAsset hands the object's kind the value as `ctx.asset` at the next build, and `undefined` unpins it", () => {
    const assets: unknown[] = [];
    const kind: ObjectKind = { ...scribbleKind("stamped", []), record: (_G, ctx) => { assets.push(ctx.asset); return {}; } };
    const Stamped = defineObject({ type: "test.stamped", version: 1, props: {}, kind });
    const { ce, handle } = mountDesk([Stamped]);
    try {
      const e = ce.ops.spawnWidget(Stamped.type, { x: 0, y: 0, w: 40, h: 40, undoable: false });
      ce.step(16);
      const build = (): void => { handle.builder.changed(); handle.builder.build({ x: -100, y: -100, zoom: 1 }, { width: 400, height: 300, dpr: 1 }, 1 / 60, themeFrom("light", PALETTE), DEFAULT_GRID, new Map(), { now: 0 }); };
      handle.pinAsset(e, { stamp: "wax", seal: 3 });
      build();
      expect(assets.at(-1)).toEqual({ stamp: "wax", seal: 3 });
      handle.pinAsset(e, undefined);
      build();
      expect(assets.at(-1)).toBeUndefined();
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });
});
