// @vitest-environment node
// THE DRAWER'S FOOT on the real layer (petition I21 — `deskLayer({ tray: { foot } })`), over the fake device (`desk-mount.ts`) with the
// six hung: the drawer as drawn names the host's foot to core and grows the scroll's range by it, the pass laid it, and scrolled to
// the range's end the last line of the six hangs whole a pitch above the foot's line — every specimen drawn above it. Without the
// option the frame names no foot and the range is 0.14.0's.
import { afterEach, describe, expect, it } from "vitest";
import { DRAWER } from "@ice/desk";
import { type DeskMount, mountDesk } from "./desk-mount";

let desk: DeskMount | undefined;
afterEach(() => { desk?.dispose(); desk = undefined; });

const FRAME_MS = 16;
/** Step as a live loop does for `ms` of the frame clock — the tray's passes landing between steps — then to sleep. */
async function run(d: DeskMount, ms = 500): Promise<void> {
  for (let i = 0; i < Math.ceil(ms / FRAME_MS); i++) { d.step(); await new Promise((r) => setTimeout(r, 8)); }
  d.toSleep();
}

describe("the drawer's foot on the layer (petition I21)", () => {
  it("the drawer as drawn names the host's foot and a range grown by it; at its end the six's last line hangs whole a pitch above the foot's line", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS, layer: { tray: { foot: 88 } } });
    const door = desk.handle.tray;
    desk.toSleep();
    door.open();
    await run(desk);
    const s = door.state();
    const f = s.frame;
    expect(f?.foot).toBe(88);
    expect(s.laid?.foot).toBe(88);
    const line = (f?.y ?? 0) + (f?.h ?? 0) - 88;
    expect(line).toBe(712);
    const bottom = s.facts?.bottom ?? 0;
    expect(bottom).toBeGreaterThan(0);
    expect(f?.max).toBe(bottom + DRAWER.pitch - ((f?.h ?? 0) - 88));
    door.scroll(f?.max ?? 0);
    await run(desk, 200);
    const drawn = door.state().specimens;
    const lowest = Math.max(...drawn.map((q) => q.screen.y1));
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(lowest).toBeLessThanOrEqual(line - DRAWER.pitch);   // the last line reached, whole, clear of the foot and its ramp
  });

  it("without the option: the frame names no foot, the range is the face's whole height's, nothing laid names one", async () => {
    desk = await mountDesk(undefined, { frameMs: FRAME_MS });
    const door = desk.handle.tray;
    desk.toSleep();
    door.open();
    await run(desk);
    const s = door.state();
    expect(s.frame).not.toHaveProperty("foot");
    expect(s.laid).not.toHaveProperty("foot");
    expect(s.frame?.max).toBe((s.facts?.bottom ?? 0) + DRAWER.pitch - (s.frame?.h ?? 0));
  });
});
