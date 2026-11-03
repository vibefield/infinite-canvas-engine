// The tray offers objects that can be created without source content. Prints arrive from images.
import { describe, expect, it } from "vitest";
import { layTray, PEG_LATTICE } from "@ice/kernel";
import { DESK_OBJECTS } from "../src";

const P = 40;

describe("the five creatable objects on the pegboard", () => {
  const hung = DESK_OBJECTS.filter((t) => t.tray !== undefined);

  it("offers creatable objects and leaves image prints off the tray", () => {
    const by = Object.fromEntries(hung.map((t) => [t.type, t.tray]));
    expect(Object.keys(by).sort()).toEqual(["desk.board", "desk.calendar", "desk.minimat", "desk.note", "desk.notebook"]);
    expect(by["desk.note"]?.hang.accessory).toBe("hook");
    expect(by["desk.note"]?.hang.pegs.length).toBe(2);
    expect(by["desk.minimat"]?.hang.accessory).toBe("shelf");
    expect(DESK_OBJECTS.find((t) => t.type === "desk.photo")?.tray).toBeUndefined();
    expect(by["desk.board"]?.hang.accessory).toBe("rail");
    expect(by["desk.notebook"]?.hang.accessory).toBe("shelf");
    expect(by["desk.calendar"]?.hang.accessory).toBe("hook");
  });

  it("files them under the chips' ids (design-018 §6): paper — the note, the notebook, the calendar; surfaces — the mini mat, the whiteboard", () => {
    const by = Object.fromEntries(hung.map((t) => [t.type, t.tray?.category]));
    expect(by).toEqual({ "desk.note": "paper", "desk.notebook": "paper", "desk.calendar": "paper", "desk.minimat": "surfaces", "desk.board": "surfaces" });
  });

  it("hangs each at its object's own aspect — a shelf's a whole number of pitches high (its hang point is its foot)", () => {
    for (const t of hung) {
      const h = t.tray?.hang;
      if (h === undefined) continue;
      expect(Math.abs(h.w / h.h - t.defaultSize.w / t.defaultSize.h), t.type).toBeLessThan(0.02);
      if (h.accessory === "shelf") expect(Number.isInteger(h.h / P), t.type).toBe(true);
    }
  });

  it("lays at the drawer's widths with every peg on a punched hole and one line's tops together", () => {
    const items = hung.flatMap((t) => (t.tray === undefined ? [] : [{ type: t.type, hang: t.tray.hang, category: t.tray.category ?? "", order: t.tray.order ?? 0 }]));
    for (const width of [1120, 880, 400]) {
      const { placed } = layTray(items, width, P);
      expect(placed.length).toBe(5);
      for (const s of placed) for (const g of s.pegs) {
        expect(g.x / P).toBe(g.col + PEG_LATTICE.colPhase + ((g.row & 1) !== 0 ? 0.5 : 0));
        expect(g.y / P).toBe(g.row + PEG_LATTICE.rowPhase);
        expect(g.x / P >= PEG_LATTICE.border && g.x / P <= width / P - PEG_LATTICE.border).toBe(true);
      }
      const first = placed.filter((s) => s.line === 0).map((s) => s.y);
      expect(Math.max(...first) - Math.min(...first), `${width}: the first line's tops`).toBe(0);
    }
  });
});
