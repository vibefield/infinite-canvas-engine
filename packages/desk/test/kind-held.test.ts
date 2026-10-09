// @vitest-environment node
// M24 LT2 (design-019 §5 · §13.2): THE HAND'S INPUT TO A KIND on a desk layer as a host mounts it — a kind of the test's own, as a
// plugin's, on the fake device, stepped on a frame clock of its own so the pickup settles: its object picked up, the pointer's facts
// enqueued where the hand drew it, and the kind TOLD them through `KindLocal.held` in its held extent's units (the layer folds core's
// facts after the drivers, before the ticks); its `open.cursor` shown by L4 over its named part; `open.wheel` / `open.escape` carried
// onto its widget type; a `held` or a `cursor` that throws a strike at the kind's boundary, never the frame's.
import { createCanvasEngine, type Entity, type InputMods, NO_MODS, Viewport, type WidgetType } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deskLayer, type DeskLayerHandle } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { HeldCursorContext, HeldEvent, KindLocal, ObjectKind, ObjectRect } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakeDevice, installGpuFlags } from "./fake-gpu";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } };

/** What the kind's desk state was told and asked, and what it says. */
interface HandLocal extends KindLocal {
  readonly told: { readonly e: Entity; readonly events: readonly HeldEvent[] }[];
  readonly asked: HeldCursorContext[];
  cursor: string | undefined;
  /** `held` / `cursor` throw while set (the kind's boundary). */
  throws: boolean;
}

const locals = new Map<string, HandLocal>();

/** An openable kind: a page whose inside (inset 10 units) is its `live` part and whose edge is `content`; it takes the wheel and Escape. */
function handKind(name: string, open: "all" | "plain"): ObjectKind<ObjectRect> {
  const pass = (): KindPass => ({ spawn: () => pass(), prepare: (_e, _s, records) => records.length, drawRange: () => {}, dispose: () => {} });
  return {
    name, stratum: "things", reach: 0, create: async () => pass(), resolve: (c) => c.rect, record: () => ({}),
    hit: (G, wx, wy) => {
      const dx = Math.abs(wx - G.cx);
      const dy = Math.abs(wy - G.cy);
      return dx <= G.w / 2 - 10 && dy <= G.h / 2 - 10 ? "live" : dx <= G.w / 2 && dy <= G.h / 2 ? "content" : null;
    },
    local: () => {
      const l: HandLocal = {
        told: [], asked: [], cursor: "pointer", throws: false,
        held(e, events) { if (l.throws) throw new Error("no hand today"); l.told.push({ e, events }); },
      };
      locals.set(name, l);
      return l;
    },
    open: open === "all"
      ? {
          extent: (c) => c.rect, wheel: "kind", escape: "kind",
          cursor(c) { const l = c.local as HandLocal; l.asked.push(c); if (l.throws) throw new Error("no cursor today"); return l.cursor; },
        }
      : { extent: (c) => c.rect },
  };
}

const PAGE = defineObject({ type: "hand.page", version: 1, props: {}, size: { w: 240, h: 160 }, kind: handKind("hand-page", "all") });
const PLAIN = defineObject({ type: "hand.plain", version: 1, props: {}, size: { w: 240, h: 160 }, kind: handKind("hand-plain", "plain") });

const mounted: (() => void)[] = [];
afterEach(() => { for (const end of mounted.splice(0).reverse()) end(); vi.unstubAllGlobals(); locals.clear(); });

/** A desk layer on the fake device over the test's objects, stepped on a frame clock of its own (the pickup settles in 560 ms of it). */
async function mountDesk(objects: WidgetType[]) {
  mounted.push(installGpuFlags());
  const { device } = fakeDevice();
  Object.assign(device, { addEventListener: () => {}, lost: new Promise(() => {}), destroy: () => {} });
  const adapter = { features: new Set<string>(), requestDevice: async () => device };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => "bgra8unorm" } as unknown as GPU;
  const context = { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({ createView: () => ({ label: "swap" }), width: 1, height: 1 }) };
  const canvas = { style: {}, width: 1, height: 1, clientWidth: 1200, clientHeight: 800, getContext: () => context, remove: () => {} };
  const node = () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => {} });
  const container = { ownerDocument: { createElement: (tag: string) => (tag === "canvas" ? canvas : node()), defaultView: undefined, addEventListener: () => {}, removeEventListener: () => {} }, prepend: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLElement;
  vi.stubGlobal("navigator", { gpu });
  const frameFaults: string[] = [];
  const ce = createCanvasEngine({ widgets: objects, onReflectorFault: (name, err) => { frameFaults.push(`${name}: ${String(err)}`); } });
  ce.docs.create();
  ce.world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const handle: DeskLayerHandle = deskLayer({ gpu, objects, theme: themeFrom("light", PALETTE), palette: PALETTE, ambient: "still" })({ host: { container }, world: ce.world, frame: ce.engine.frame, catalog: ce.catalog, heldPose: ce.stack.heldPose, framePick: ce.stack.framePick });
  const unregister = ce.engine.registerReflector(handle.reflector);
  mounted.push(() => { unregister(); handle.dispose(); ce.dispose(); });
  for (let i = 0; i < 100 && handle.status().state === "pending"; i++) await new Promise((r) => setTimeout(r, 5));
  let clock = performance.now();
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { clock += 16; ce.engine.step(clock); } };
  /** Spawn one of `type`, pick it up, and step until the pickup has settled — its frame on screen as the hand drew it. */
  const pickUp = (type: string) => {
    const e = ce.ops.spawnWidget(type, { x: 300, y: 200, undoable: false });
    step(2);
    ce.ops.open(e);
    for (let i = 0; i < 120 && ce.stack.heldPose.current?.frame(e)?.settled !== true; i++) step();
    const frame = ce.stack.heldPose.current?.frame(e);
    if (frame === undefined || !frame.settled) throw new Error("the pickup never settled");
    return { e, frame };
  };
  const put = (kind: "down" | "move" | "up", x: number, y: number, buttons: number, mods: InputMods = NO_MODS): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods });
    step();
  };
  return { ce, handle, step, pickUp, put, frameFaults };
}

describe("the hand's input to a kind on the desk layer (design-019 §5, M24 LT2)", () => {
  it("open.wheel and open.escape ride the widget type (`heldWheel`, `heldEscape`) — the hand's and the desk's when a kind says nothing", () => {
    expect([PAGE.heldWheel, PAGE.heldEscape]).toEqual(["kind", "kind"]);
    expect([PLAIN.heldWheel, PLAIN.heldEscape]).toEqual(["hand", "desk"]);
  });

  it("the kind is TOLD the hand's input on its object, in its held extent's units — its part, the press's count — before its tick; a kind with no `held` is told nothing", async () => {
    const d = await mountDesk([PAGE, PLAIN]);
    const { e, frame } = d.pickUp("hand.page");
    const l = locals.get("hand-page") as HandLocal;
    l.told.length = 0;
    d.put("move", frame.cx + 30 * frame.s, frame.cy - 20 * frame.s, 0);
    d.put("down", frame.cx + 30 * frame.s, frame.cy - 20 * frame.s, 1);
    d.put("up", frame.cx + 30 * frame.s, frame.cy - 20 * frame.s, 0);
    d.put("down", frame.cx + 30 * frame.s, frame.cy - 20 * frame.s, 1);
    d.put("up", frame.cx + 30 * frame.s, frame.cy - 20 * frame.s, 0);
    const events = l.told.flatMap((t) => t.events);
    expect(l.told.every((t) => t.e === e)).toBe(true);
    expect(events.map((x) => (x.type === "pointer" ? `${x.phase} ${x.part} ${Math.round(x.x)},${Math.round(x.y)} ×${x.count}` : x.type))).toEqual([
      "move live 30,-20 ×0", "down live 30,-20 ×1", "up live 30,-20 ×1", "down live 30,-20 ×2", "up live 30,-20 ×2",
    ]);
    expect(d.ce.world.isAlive(e) && d.handle.status().state).toBe("ready");
    // the edge: `content` — the press is told too (it is on the object), and two instant taps there still put it down (the hand's rule)
    l.told.length = 0;
    d.put("down", frame.cx + 115 * frame.s, frame.cy, 1);
    d.put("up", frame.cx + 115 * frame.s, frame.cy, 0);
    d.put("down", frame.cx + 115 * frame.s, frame.cy, 1);
    d.put("up", frame.cx + 115 * frame.s, frame.cy, 0);
    d.step(2);
    expect(l.told.flatMap((t) => t.events).filter((x) => x.type === "pointer" && x.phase === "down").map((x) => (x.type === "pointer" ? x.part : ""))).toEqual(["content", "content"]);
    expect(d.ce.stack.heldPose.current?.frame(e)?.settled ?? false).toBe(false);   // put down: the hand is flying it home
    // a kind with no `held`: its object in hand is told nothing (no throw, no strike)
    const plain = d.pickUp("hand.plain");
    d.put("move", plain.frame.cx, plain.frame.cy, 0);
    expect(d.frameFaults).toEqual([]);
  });

  it("the kind's cursor over its NAMED part is the container's — asked with the object, the part and its desk state; over its edge, the desk's own", async () => {
    const d = await mountDesk([PAGE]);
    const { e, frame } = d.pickUp("hand.page");
    const l = locals.get("hand-page") as HandLocal;
    d.put("move", frame.cx, frame.cy, 0);
    expect(d.ce.stack.readCursor()).toBe("pointer");
    expect(l.asked.at(-1)).toEqual({ entity: e, part: "live", local: l });
    l.cursor = "text";
    d.step();
    expect(d.ce.stack.readCursor()).toBe("text");
    d.put("move", frame.cx + 115 * frame.s, frame.cy, 0);   // the edge: content
    expect(d.ce.stack.readCursor()).toBe("default");
  });

  it("a `held` or a `cursor` that THROWS is a strike against the kind — the frame never faults; the third makes it missing, and nothing of it is asked again", async () => {
    const d = await mountDesk([PAGE]);
    const { frame } = d.pickUp("hand.page");
    const l = locals.get("hand-page") as HandLocal;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    l.throws = true;
    d.put("move", frame.cx, frame.cy, 0);   // the cursor's throw (L4, in the tick) and the held's (the flush): two strikes
    expect(d.ce.stack.readCursor()).toBe("default");
    expect(d.frameFaults).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/hand-page/);
    d.put("move", frame.cx + 5, frame.cy, 0);   // the third
    expect(d.handle.status().faults?.map((f) => f.kind)).toEqual(["hand-page"]);
    const asks = l.asked.length;
    d.put("move", frame.cx + 10, frame.cy, 0);
    expect(l.asked.length).toBe(asks);   // a missing kind is asked nothing
    expect(d.frameFaults).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });
});
