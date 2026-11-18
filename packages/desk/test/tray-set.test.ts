// @vitest-environment node
// THE SET AND THE HIDDEN on the desk handle (petition I54; host/layer.ts `tray.only` / `tray.hide`, `TrayAnchor.only`): the SET the
// drawer lays across its categories — the specimens the desk DRAWS are the set's, the anchor says it and `category` reads "" while the
// chips and `entries` stay the frame's whole hang, told through `subscribe`; its first specimen focused the step after (the after-
// install rise) — and the HIDDEN, the types the board does not hang while the desk still draws them: no specimen drawn, no chip one
// alone fills, `entries` 0 with every type hidden, `lay` refusing one, its object on the desk drawn by its own kind, picked and
// duplicated. The layer mounted as `createDeskHost` mounts it, on the fake device; kinds of the test's own, as a plugin's
// (`desk-never-imports-objects`). The lay's own rules — the fallback, the scroll, the focus let go — are core's
// (packages/core/test/tray-specimens.test.ts and tray-focus.test.ts, through the real stack); here, the handle's doors and what the
// desk draws by them.
import { Camera, createCanvasEngine, p, PrefabId, Selected, Viewport } from "@ice/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectKind, ObjectRect } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };
const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
const SHEET: ObjectKind<ObjectRect, object> = {
  name: "i54-sheet", stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
  hit: (G, x, y) => (Math.abs(x - G.cx) <= G.w / 2 && Math.abs(y - G.cy) <= G.h / 2 ? "content" : null),
};
// four objects in two categories — a plugin's set crosses them
const SHEETS = (["a", "a", "b", "b"] as const).map((category, i) =>
  defineObject({
    type: `i54.sheet${i}`, version: 1, props: { word: p.string({ default: "" }) }, size: { w: 160, h: 120 }, kind: SHEET,
    tray: { label: `S${i}`, category, order: i, hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] } },
  }),
);
const TYPES = SHEETS.map((t) => t.type);
const [S0, S1, S2, S3] = TYPES as [string, string, string, string];

/** A desk layer on the fake device as `createDeskHost` mounts it — the stack's seams and the engine's ops — the drawer out and pinned. */
async function mountDesk() {
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1200, clientHeight: 800, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const ce = createCanvasEngine({ widgets: SHEETS });
  ce.docs.create();
  ce.world.setResource(Camera, { x: -300, y: -100, zoom: 1.25, gesturing: false });
  const { stack } = ce;
  const handle: DeskLayerHandle = deskLayer({ gpu, objects: SHEETS, theme: themeFrom("light", PALETTE), palette: PALETTE })({
    host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog,
    framePick: stack.framePick, pickAt: stack.pickAt, navGeometry: stack.navGeometry, heldPose: stack.heldPose, trayPose: stack.trayPose,
    spatial: stack.index, readMarquee: () => stack.marqueeBuffer, ops: ce.ops,
  });
  const unregister = ce.engine.registerReflector(handle.reflector);
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  step(2);
  handle.tray.open();
  handle.tray.pin({ p: 1 });
  step(4);
  /** The specimens the last frame DREW, by type (sorted: a re-lay keeps a specimen where it hangs, so the drawing order is not the lay's). */
  const drawn = (): string[] => handle.tray.state().specimens.map((s) => s.type).sort();
  /** The desk's objects the last frame drew (the root slot's rows): each its entity and the kind that drew it. */
  const objects = (): readonly { readonly key: number; readonly kind: string }[] => (handle.lastInputs()?.objects ?? []).map((o) => ({ key: o.key as number, kind: o.kind }));
  return { ce, handle, step, drawn, objects, dispose: () => { unregister(); handle.dispose(); ce.dispose(); } };
}

describe("the set and the hidden on the desk handle (petition I54)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); vi.unstubAllGlobals(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("`only` lays the set across its categories — the desk draws its specimens alone; the anchor says it, `category` reads \"\", the chips and `entries` stay the whole hang; `subscribe` is told; its first specimen focused the step after; `only(null)` draws every object again, never the category before it", async () => {
    const d = await mountDesk();
    try {
      expect(d.drawn()).toEqual(TYPES);
      expect(d.handle.tray.anchor().only).toBeNull();
      d.handle.tray.category("a");
      d.step(2);
      expect(d.drawn()).toEqual([S0, S1]);
      const heard = vi.fn();
      d.handle.tray.subscribe(heard);
      expect(d.handle.tray.only([S3, S1, S3])).toEqual([S1, S3]);   // sorted, each once
      expect(d.handle.tray.category()).toBe("");                     // the set wins at once
      d.step(2);
      expect(d.drawn()).toEqual([S1, S3]);
      const a = d.handle.tray.anchor();
      expect({ only: a.only, category: a.category, entries: a.entries, chips: a.categories.map((c) => [c.id, c.count]) })
        .toEqual({ only: [S1, S3], category: "", entries: 4, chips: [["a", 2], ["b", 2]] });
      expect(heard).toHaveBeenCalled();
      // the after-install rise: the set's first specimen focused once it is laid — and drawn where the anchor says
      expect(d.handle.tray.focus("first")).toBe(S1);
      d.step(2);
      const seen = d.handle.tray.state().specimens.find((s) => s.type === S1)?.object;
      expect(d.handle.tray.anchor().focused).toEqual({ id: S1, rect: seen });
      // a chip asked while the set stands: the set wins — the chip is written back "", the set still drawn
      d.handle.tray.category("b");
      d.step(2);
      expect([d.handle.tray.category(), d.drawn()]).toEqual(["", [S1, S3]]);
      // ONLY the set moves — an id no entry names joins it: the same specimens drawn, the same chips, the same focus; the anchor says
      // the set as asked, and `subscribe` is told
      const before = d.handle.tray.anchor();
      heard.mockClear();
      expect(d.handle.tray.only([S1, S3, "i54.none"])).toEqual(["i54.none", S1, S3]);
      d.step(2);
      const after = d.handle.tray.anchor();
      expect(d.drawn()).toEqual([S1, S3]);
      expect({ ...after, only: before.only }).toEqual(before);   // nothing else of the anchor moved
      expect(after.only).toEqual(["i54.none", S1, S3]);
      expect(heard).toHaveBeenCalled();
      // cleared (the token's ×): every object — not category "a", which the drawer showed before the set
      heard.mockClear();
      expect(d.handle.tray.only(null)).toBeNull();
      d.step(2);
      expect(d.drawn()).toEqual(TYPES);
      expect([d.handle.tray.anchor().only, d.handle.tray.category()]).toEqual([null, ""]);
      expect(heard).toHaveBeenCalled();
      // THE DROP, told: a set the frame hangs none of, asked over all — nothing re-laid, nothing drawn differently, the anchor as it
      // was — still a frame, and `subscribe` hears the board's answer (`only` null), so a host's token drops
      heard.mockClear();
      expect(d.handle.tray.only(["i54.nothing"])).toEqual(["i54.nothing"]);
      d.step(2);
      expect([d.handle.tray.only(), d.handle.tray.anchor().only, d.drawn()]).toEqual([null, null, TYPES]);
      expect(heard).toHaveBeenCalled();
    } finally { d.dispose(); }
  });

  it("`hide` keeps a type off the board while the desk draws its objects — no specimen drawn, no chip it alone fills, `entries` without it, `lay` refusing it; its object drawn by its kind, picked and duplicated; every type hidden, `entries` 0; `hide([])` hangs it again", async () => {
    const d = await mountDesk();
    try {
      const obj = d.ce.ops.spawnWidget(S2, { x: 0, y: 0, undoable: false });
      d.step(2);
      expect(d.objects().find((o) => o.key === obj)?.kind).toBe("i54-sheet");   // the control
      expect(d.handle.tray.hide([S3, S2])).toEqual([S2, S3]);
      d.step(2);
      expect(d.drawn()).toEqual([S0, S1]);
      expect([d.handle.tray.anchor().entries, d.handle.tray.categories().map((c) => c.id)]).toEqual([2, ["a"]]);
      expect(d.handle.tray.lay(S2)).toBeUndefined();
      expect(d.handle.tray.isOpen()).toBe(true);   // a refusal folds nothing
      // its object on the desk: drawn by its own kind still, never the missing face — and no kind of the desk faulted
      expect(d.objects().find((o) => o.key === obj)?.kind).toBe("i54-sheet");
      expect(d.handle.status().faults).toBeUndefined();
      // the drawer shut: the desk's own pick finds it at its centre (world 80, 60 through the camera), and it duplicates as ever
      d.handle.tray.pin(null);
      d.handle.tray.close();
      d.step(40);
      const hit = d.handle.pick({ x: (80 + 300) * 1.25, y: (60 + 100) * 1.25 });
      expect([hit?.entity, hit?.type]).toEqual([obj, S2]);
      d.ce.ops.setSelection([obj], "replace");
      const twins = d.ce.ops.duplicateSelection();
      d.step(2);
      expect(twins).toHaveLength(1);
      expect(d.ce.world.read(twins[0] as never, PrefabId).id).toBe(S2);
      expect(d.ce.world.hasTag(twins[0] as never, Selected)).toBe(true);
      expect(d.objects().find((o) => o.key === (twins[0] as number))?.kind).toBe("i54-sheet");
      expect(d.handle.status().faults).toBeUndefined();
      // every type hidden: nothing to offer — the bar's `entries` 0, no chip, nothing drawn on the board
      d.handle.tray.hide(TYPES);
      d.handle.tray.open();
      d.handle.tray.pin({ p: 1 });
      d.step(4);
      expect([d.drawn(), d.handle.tray.anchor().entries, d.handle.tray.categories()]).toEqual([[], 0, []]);
      expect(d.handle.tray.hide([])).toEqual([]);
      d.step(2);
      expect(d.drawn()).toEqual(TYPES);
    } finally { d.dispose(); }
  });

  it("a list that is not one throws at the door, writing nothing — the set and the hidden that stand stay", async () => {
    const d = await mountDesk();
    try {
      d.handle.tray.only([S0]);
      d.handle.tray.hide([S3]);
      expect(() => d.handle.tray.only(S0 as never)).toThrow(/only — .*an array of object types/);
      expect(() => d.handle.tray.hide(null as never)).toThrow(/hide — .*an array of object types/);
      expect([d.handle.tray.only(), d.handle.tray.hide()]).toEqual([[S0], [S3]]);
    } finally { d.dispose(); }
  });
});
