// THE IDLE WASTE (K6a, design-016 §6): a desk's notebook and calendar kinds made — every desk makes them — hold none of their big
// textures until one of their objects is drawn or printed (K2's ledger: 164 MB for the notebook kind, 42 MB for the calendar
// kind, on a desk with neither); what they make then is let go with the last of their objects. On a fake device (no pixels).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSlotSet } from "@ice/desk";
import { LAYER_IDLE_MS } from "@ice/desk/kit";
import { CALENDAR_KIND, type CalendarKind } from "../src/calendar/kind";
import { TILE_TEX } from "../src/calendar/tiles";
import { deskKinds } from "../src/kinds";
import { NOTEBOOK_KIND, type NotebookKind } from "../src/notebook/kind";
import { CuttingMat } from "../../desk/src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../../desk/src/mat/shaders";
import { shaderText } from "../src/shaders";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";
import { must } from "../../desk/test/must";

describe("the notebook and calendar kinds at idle", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  async function desk() {
    const { device } = fakeDevice();
    const made: { readonly label: string; readonly size: GPUExtent3D; destroyed: boolean }[] = [];
    const make = device.createTexture.bind(device);
    (device as { createTexture: GPUDevice["createTexture"] }).createTexture = (d) => {
      const t = make(d);
      const kept = { label: d.label ?? "", size: d.size, destroyed: false };
      made.push(kept);
      (t as { destroy: () => void }).destroy = () => { kept.destroyed = true; };
      return t;
    };
    const mat = await CuttingMat.create(device, "bgra8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
    const set = await createSlotSet(device, "bgra8unorm", mat, deskKinds());
    const live = (label: string) => made.filter((t) => t.label === label && !t.destroyed);
    return { set, made, live };
  }

  it("made on a desk with neither, the kinds hold no shadow maps, no print tiles — their stand-ins only (one texel each)", async () => {
    const { live } = await desk();
    expect(live("notebook/shadow maps")).toHaveLength(0);
    expect(live("calendar/print tiles")).toHaveLength(0);
    expect(live("notebook/shadow maps (none yet)").map((t) => t.size)).toEqual([[1, 1, 1]]);
    expect(live("calendar/print tiles (none yet)").map((t) => t.size)).toEqual([[1, 1, 1]]);
  });

  it("the calendar's tiles are made at the FIRST tile laid and let go by `releaseTiles` (the last pad gone) — `tileBytes` says which", async () => {
    const { set, live } = await desk();
    const pass = must((must(set.kinds.get(CALENDAR_KIND)).pass as CalendarKind).pass);
    expect(pass.tileBytes).toBe(0);
    pass.writeTileBytes(0, new Uint8Array(TILE_TEX * TILE_TEX * 4));
    expect(live("calendar/print tiles")).toHaveLength(1);
    expect(pass.tileBytes).toBe(pass.layers * TILE_TEX * TILE_TEX * 4);
    pass.releaseTiles();
    expect(live("calendar/print tiles")).toHaveLength(0);
    expect(pass.tileBytes).toBe(0);
    pass.writeTileBytes(1, new Uint8Array(TILE_TEX * TILE_TEX * 4));   // a pad again: made again
    expect(live("calendar/print tiles")).toHaveLength(1);
  });

  it("the notebook's page ink is made at the first page's ink and let go by `releaseInk` (the last book gone); the layer let go by `releaseLayer`", async () => {
    const { set, live } = await desk();
    const pass = must((must(set.kinds.get(NOTEBOOK_KIND)).pass as NotebookKind).pass);
    expect(live("notebook/ink")).toHaveLength(0);
    pass.uploadInk(0, new Uint8Array(4), 0, 0, 1, 1);
    expect(live("notebook/ink")).toHaveLength(1);
    pass.releaseInk();
    expect(live("notebook/ink")).toHaveLength(0);
    pass.releaseLayer();   // nothing drawn yet: nothing to let go, and no fault
    expect(live("notebook/shadow maps")).toHaveLength(0);
    expect(pass.layerMade).toBe(false);
    expect(pass.drawnWithin(LAYER_IDLE_MS)).toBe(false);   // no book drawn: the kind's tick would let a made layer go
  });
});
