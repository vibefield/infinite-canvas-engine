// THE BOOKS' MEMORY (K6a's "made on first use, let go with the last" — K7a found what it missed): a desk calendar and a notebook
// drawn and then removed give back what they made — the calendar kind's page tables (227 KB) stood after its last pad, the kind
// over its 1 MB "none on the desk" line in rig:stress. Read from the device's memory ledger (K2), the desk mounted on a fake device.

import { describe, expect, it } from "vitest";
import { mountDesk } from "./desk-mount";

describe("the books' memory after their last object (K7a)", () => {
  it("a desk calendar and a notebook drawn, then deleted: each kind's ledger is back where it stood with none (≤ 64 B more)", async () => {
    const desk = await mountDesk(undefined, { gpuLedger: true });
    try {
      const kinds = (): { calendar: number; notebook: number } => {
        const r = desk.handle.gpuMemory?.()?.read();
        if (r === undefined) throw new Error("no ledger");
        return { calendar: r.byLabel.calendar?.bytes ?? 0, notebook: r.byLabel.notebook?.bytes ?? 0 };
      };
      const before = kinds();
      const pad = desk.ce.ops.spawnWidget("desk.calendar", { x: 600, y: 400 });
      const book = desk.ce.ops.spawnWidget("desk.notebook", { x: 300, y: 300 });
      desk.toSleep();
      const on = kinds();
      expect(on.calendar, "the pad drawn: its layer, tables and meshes made").toBeGreaterThan(before.calendar + 1_000_000);
      expect(on.notebook, "the book drawn: its layer and shadow map made").toBeGreaterThan(before.notebook + 1_000_000);
      desk.ce.ops.setSelection([pad, book]);
      desk.ce.ops.deleteSelection();
      // the ghosts fade on the frame's clock: real time between the steps, as the loop's frames have
      for (let n = 0; n < 300 && !desk.step(); n++) await new Promise((r) => setTimeout(r, 8));
      const off = kinds();
      expect(off.calendar - before.calendar, `the calendar kind after its last pad: ${off.calendar} B (before ${before.calendar})`).toBeLessThanOrEqual(64);
      expect(off.notebook - before.notebook, `the notebook kind after its last book: ${off.notebook} B (before ${before.notebook})`).toBeLessThanOrEqual(64);
    } finally {
      desk.dispose();
    }
  });
});
