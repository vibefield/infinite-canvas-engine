// @vitest-environment node
// THE CONTAINED FAULTS COUNT (design-015 D7, the surface review's #3): the reflector flush catches every throw and logs it,
// and Chromium never sends console-API messages to the Log domain, so a kind's record throwing on some frames skipped those
// frames with every rig's "no page errors" row green. apps/desk's engine routes each contained fault into `DESK_FAULTS`
// (`window.__desk.faults`), which every rig's row reads; here, a reflector throwing on alternate frames lands in the list.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeskEngine } from "../src/desk";

describe("apps/desk's contained faults (D7)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("a reflector throwing on alternate frames lands in the page's faults — one entry per skipped frame, and still on the console", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const faults: string[] = [];
    const engine = createDeskEngine(undefined, faults);
    let frames = 0;
    engine.engine.registerReflector({ name: "alternate", always: true, flush() { frames += 1; if (frames % 2 === 0) throw new Error(`frame ${frames} refused`); } });
    for (let i = 1; i <= 6; i++) engine.step(i * 16);
    expect(frames).toBe(6);
    expect(faults).toEqual(['reflector "alternate": frame 2 refused', 'reflector "alternate": frame 4 refused', 'reflector "alternate": frame 6 refused']);
    expect(logged).toHaveBeenCalledTimes(3);
    engine.dispose();
  });
});
