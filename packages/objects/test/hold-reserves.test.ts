// @vitest-environment node
// THE HAND'S RESERVES on the real layer (petition I20 — `deskLayer({ hold })`), over the fake device (`desk-mount.ts`): a notebook
// picked up under VibeField's `{ top: 116, band: 100, travelMs: 560 }` settles with its reading fit 116 under the view's top and 100
// above its foot — the frame the pose seam publishes, at two view heights — and the selection's anchor carries the held bar's travel,
// 560. Without the option the fit is HOLD's (56 / 72) and the anchor names no travel: the bar keeps its own.
import { afterEach, describe, expect, it } from "vitest";
import { HOLD } from "@ice/desk";
import { type DeskMount, mountDesk } from "./desk-mount";

let desk: DeskMount | undefined;
afterEach(() => { desk?.dispose(); desk = undefined; });

const VF = { top: 116, band: 100, travelMs: 560 } as const;

/** A notebook picked up and settled in hand: its frame on screen as the pose seam publishes it, and the selection's anchor. */
function pickUp(d: DeskMount) {
  const book = d.ce.ops.spawnWidget("desk.notebook", { x: 400, y: 200, undoable: false });
  d.toSleep();
  d.ce.ops.open(book);
  d.toSleep();
  const h = d.handle.hand();
  return { settled: h?.settled === true, frame: h?.frame, held: d.handle.selection.anchor().held };
}

describe("the hand's reserves on the layer (petition I20)", () => {
  it("a notebook picked up under the host's hold: the fit 116 under the top and 100 above the foot, at two view heights; the anchor's travel 560", async () => {
    for (const h of [800, 640]) {
      desk = await mountDesk({ w: 1200, h, dpr: 1 }, { frameMs: 16, layer: { hold: VF } });
      const { settled, frame, held } = pickUp(desk);
      expect(settled, `${h}`).toBe(true);
      expect((frame?.cy ?? 0) - (frame?.hy ?? 0), `${h}`).toBeCloseTo(VF.top, 6);
      expect(h - ((frame?.cy ?? 0) + (frame?.hy ?? 0)), `${h}`).toBeCloseTo(VF.band, 6);
      expect(held?.travelMs).toBe(VF.travelMs);
      desk.dispose();
      desk = undefined;
    }
  });

  it("without the option: HOLD's fit (56 / 72) and no travel on the anchor — the bar keeps its own", async () => {
    desk = await mountDesk(undefined, { frameMs: 16 });
    const { settled, frame, held } = pickUp(desk);
    expect(settled).toBe(true);
    expect((frame?.cy ?? 0) - (frame?.hy ?? 0)).toBeCloseTo(HOLD.top, 6);
    expect(800 - ((frame?.cy ?? 0) + (frame?.hy ?? 0))).toBeCloseTo(HOLD.band, 6);
    expect(held).toBeDefined();
    expect(held).not.toHaveProperty("travelMs");
  });
});
