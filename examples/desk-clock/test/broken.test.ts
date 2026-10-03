// @vitest-environment node
// THE FAULT FIXTURE is refused AS DESIGNED (petition I24): a broken clock breaks exactly the way it says and nowhere else — its WGSL is
// refused by a compiler (the token nothing declares) and ICE's own creation refuses its kind while the clock beside it stands; its
// `record` throws from its third call and not before; its `hit` throws on every pick; each has a name and a type of its own and never
// opens. On a device of our own (a plugin's unit has no GPU, and this package imports ICE's published entries alone — test/imports.test.ts):
// its compiler refuses a module that names `BROKEN_WGSL_TOKEN`, as Tint does ("unresolved value"), and keeps WebGPU's error scopes.
import type { Entity } from "@vibecook/ice";
import { createSlotSet, DEFAULT_GRID, type ObjectContext, objectKindOf } from "@vibecook/ice/desk";
import { compose } from "@vibecook/ice/desk/engine";
import { lampOf } from "@vibecook/ice/desk/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BROKEN_CLOCK_OBJECTS, BROKEN_CLOCK_TYPE, BROKEN_WGSL_TOKEN, brokenClockKind, brokenClockShaders, CLOCK, CLOCK_KIND, ClockPass, clockKind, clockShaders, DeskClockBroken, DeskClockFaulty, FAULTY_CLOCK_TYPE } from "../src";

/** A device whose compiler refuses what names the token (a validation error into the scope open, else uncaptured) — every other call a stub. */
function compilerDevice() {
  const scopes: { error: { message: string } | null }[] = [];
  const uncaptured: string[] = [];
  const labelled = (d?: { label?: string }) => ({ label: d?.label ?? "" });
  const device = {
    createBindGroupLayout: labelled, createBindGroup: labelled, createPipelineLayout: labelled, createSampler: labelled,
    createShaderModule: (d: { code: string; label?: string }) => {
      const refused = d.code.includes(BROKEN_WGSL_TOKEN);
      if (refused) { const top = scopes[scopes.length - 1]; if (top !== undefined) top.error ??= { message: `unresolved value '${BROKEN_WGSL_TOKEN}'` }; else uncaptured.push(BROKEN_WGSL_TOKEN); }
      return { ...labelled(d), getCompilationInfo: async () => ({ messages: refused ? [{ type: "error", lineNum: 1, linePos: 1, message: `unresolved value '${BROKEN_WGSL_TOKEN}'` }] : [] }) };
    },
    createRenderPipelineAsync: async (d: { label?: string }) => labelled(d),
    createRenderPipeline: (d: { label?: string }) => labelled(d),
    createBuffer: (d: { label?: string; size: number }) => ({ ...labelled(d), size: d.size, destroy: () => {} }),
    queue: { writeBuffer: () => {} },
    pushErrorScope: () => { scopes.push({ error: null }); },
    popErrorScope: async () => scopes.pop()?.error ?? null,
  };
  return { device: device as unknown as GPUDevice, uncaptured };
}
/** A mat as a pass binds it. */
const MAT = { view: {}, silhouette: {}, noiseTexture: { createView: () => ({}) }, assetVersion: 0 } as never;
const ctxOf = (e: number): ObjectContext => ({
  entity: e as Entity, rect: { cx: 100, cy: 80, w: CLOCK.size, h: CLOCK.size }, props: { zone: "+00:00" }, flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
  look: undefined, theme: {} as never, lamp: lampOf(DEFAULT_GRID.mat.plane), view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 }, grid: DEFAULT_GRID, dt: 0,
});

describe("the desk clock's fault fixture is refused as designed (petition I24)", () => {
  const flags = { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }, GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 } };
  const set: string[] = [];
  beforeAll(() => { const g = globalThis as Record<string, unknown>; for (const [k, v] of Object.entries(flags)) if (!(k in g)) { g[k] = v; set.push(k); } });
  afterAll(() => { for (const k of set) Reflect.deleteProperty(globalThis, k); });

  it("its WGSL is the clock's with ONE function more, naming what nothing declares — the compiler refuses the whole of it", () => {
    const clock = compose(clockShaders()).code;
    const broken = compose(brokenClockShaders()).code;
    expect(clock.includes(BROKEN_WGSL_TOKEN)).toBe(false);
    expect(broken).toContain(`fn desk_clock_broken() -> f32 { return ${BROKEN_WGSL_TOKEN}; }`);
    expect(broken.replace(/\/\/ ---- desk-clock\/broken\.wgsl\n[^\n]*\n\n/, "")).toBe(clock);
  });

  it("its create rejects with the compiler's word, and ICE refuses its kind at create while the clock beside it stands — the error its kind's own", async () => {
    const { device, uncaptured } = compilerDevice();
    await expect(objectKindOf(DeskClockBroken)?.create(device, "bgra8unorm", MAT)).rejects.toThrow(/^WGSL desk-clock\/clock-pass\.wgsl:[\s\S]*unresolved value 'desk_clock_broken_on_purpose'/);
    const slot = await createSlotSet(device, "bgra8unorm", MAT, [clockKind(), brokenClockKind({ wgsl: true })]);
    expect(slot.faults).toEqual([{ kind: "desk-clock-broken", reason: expect.stringMatching(/^refused at create — WGSL .*unresolved value 'desk_clock_broken_on_purpose'$/) }]);
    expect(slot.kinds.get(CLOCK_KIND)?.pass).toBeInstanceOf(ClockPass);
    expect(slot.kinds.get("desk-clock-broken")?.pass).not.toBeInstanceOf(ClockPass);   // the missing face's, under its name
    expect(slot.kinds.get("desk-clock-broken")?.stratum).toBe("things");
    expect(uncaptured).toEqual([BROKEN_WGSL_TOKEN]);   // the bare create above had no scope; ICE's create caught its own
  });

  it("its record throws from its third call — and not before — and its hit on every pick", () => {
    const kind = brokenClockKind({ name: "faulty", recordFrom: 3, hit: true });
    const G = kind.resolve(ctxOf(1));
    expect(() => kind.record(G, ctxOf(1))).not.toThrow();
    expect(() => kind.record(G, ctxOf(1))).not.toThrow();
    expect(() => kind.record(G, ctxOf(1))).toThrow("faulty: its record throws on purpose (call 3)");
    expect(() => kind.record(G, ctxOf(1))).toThrow("(call 4)");
    expect(() => kind.hit(G, 100, 80)).toThrow("faulty: its hit throws on purpose");
    // the clock's own, where it does not break
    expect(brokenClockKind({ name: "whole" }).hit(G, 100, 80)).toBe("content");
  });

  it("each is an object of its own beside the clock — its own type and kind name, the clock's props, never opened, never on the tray", () => {
    expect(BROKEN_CLOCK_OBJECTS).toEqual([DeskClockBroken, DeskClockFaulty]);
    expect([DeskClockBroken.type, DeskClockFaulty.type]).toEqual([BROKEN_CLOCK_TYPE, FAULTY_CLOCK_TYPE]);
    expect([objectKindOf(DeskClockBroken)?.name, objectKindOf(DeskClockFaulty)?.name]).toEqual(["desk-clock-broken", "desk-clock-faulty"]);
    for (const t of BROKEN_CLOCK_OBJECTS) {
      expect(t.openable).toBe(false);
      expect(t.tray).toBeUndefined();
      expect(t.defaultSize).toEqual({ w: CLOCK.size, h: CLOCK.size });
    }
  });
});
