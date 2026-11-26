// @vitest-environment node
// rig:world's scene-to-world mapping (scripts/world.mjs, src/rig/stage.ts) held in Node against the oracle desk's own reading of the
// same stills (frame.mjs): a note the world spawns is handed what the oracle's scene hands the writing — its MARKS (petition I60), its
// selection's WASH, and its far-LOD greek from its own layout when the pen writes it (petition I59) — and a still whose moment is the
// oracle desk's clock (mid-writing, mid-marking) is named as one the world cannot draw, never silently skipped.
import { encodeMarks, findQuote, inkOf, mark } from "@ice/desk/kit";
import { ORACLE_SCENES } from "@ice/objects/oracle/scenes.mjs";
import { describe, expect, it } from "vitest";
import { notFromTheWorld } from "../scripts/world-scenes.mjs";
import { noteAssetOf, noteSpec, type OracleNote } from "../src/rig/stage";

type Still = { readonly notes?: readonly OracleNote[] };
const still = (name: string): Still => {
  const sc = ORACLE_SCENES.find((s) => s.name === name);
  if (sc === undefined) throw new Error(`no oracle still ${name}`);
  return sc.scene as Still;
};
const INK = ["paper-ink-z1", "paper-ink-night-z1", "paper-ink-far-z0.28", "paper-ink-wash-z2", "paper-ink-nolight-z1", "paper-ink-nolight-wash-z1"];

describe("a still's note, spawned into the world, carries the ink the oracle's desk draws (petition I60)", () => {
  it("its marks cell: each [quote, change] laid by the kit's mark over the words the quote finds — the oracle's reading — and '' unmarked", () => {
    for (const name of INK) {
      const notes = still(name).notes ?? [];
      const markedNotes = notes.filter((n) => n.marks !== undefined && n.marks.length > 0);
      expect(markedNotes.length, name).toBeGreaterThan(0);
      for (const n of notes) {
        const props = noteSpec(n).props as Record<string, unknown>;
        let ink = inkOf({ text: n.text ?? "", seeds: "" }, n.seed ?? 1);
        for (const [q, change] of n.marks ?? []) {
          const r = findQuote(n.text ?? "", q);
          if ("error" in r) throw new Error(r.error);
          ink = mark(ink, r.from, r.to, change as Parameters<typeof mark>[3]);
        }
        expect(props.marks, `${name}: "${n.text}"`).toBe(n.marks === undefined ? "" : encodeMarks(ink.marks));
        if (n.marks !== undefined) expect(props.marks, name).not.toBe("");
      }
    }
  });

  it("a note the pen writes is pinned no greek of its own (its layout's lines are its far LOD, as on the oracle's desk); a blank note and a stated greek are pinned as before", () => {
    for (const name of ["paper-pen-far-z0.28", "paper-ink-far-z0.28"]) {
      const written = (still(name).notes ?? []).filter((n) => n.asset === undefined && (n.text ?? "").length > 0);
      expect(written.length, name).toBeGreaterThan(0);
      for (const n of written) expect(noteAssetOf(n), `${name}: "${n.text}"`).toBeUndefined();
    }
    expect(noteAssetOf({ x: 0, y: 0, text: "" })).toEqual({ greek: { x0: 16, em: 24, lines: [] } });
    expect(noteAssetOf({ x: 0, y: 0, text: "", greek: [[30, 120]] })).toEqual({ greek: { x0: 16, em: 24, lines: [{ y: 30, width: 120 }] } });
    expect(noteAssetOf({ x: 0, y: 0, text: "hi", greek: [[30, 120]] })?.greek?.lines).toEqual([{ y: 30, width: 120 }]);   // a still's stated lines win
    expect(noteAssetOf({ x: 0, y: 0, text: "hi", asset: "note-1" })).toEqual({ greek: { x0: 16, em: 24, lines: [] } });   // a committed raster: no pen
  });
});

describe("the stills rig:world cannot draw are named with their reason (scripts/world-scenes.mjs)", () => {
  it("mid-writing (`arrive`) and mid-marking (`inked`) stills are the oracle desk's clock's; every other ink and pen still is drawn", () => {
    const named = ORACLE_SCENES.filter((sc) => /^paper-(pen|ink)-/.test(sc.name)).map((sc) => [sc.name, notFromTheWorld(sc)] as const);
    const held = named.filter(([, why]) => why !== undefined);
    expect(held.map(([n]) => n).sort()).toEqual(["paper-ink-nolight-reinking-z1", "paper-ink-nolight-stroking-z1", "paper-pen-nolight-writing-z1", "paper-pen-writing-z1"]);
    for (const [, why] of held) expect(why).toMatch(/^mid-(writing|marking): .*oracle desk's clock/);
    expect(named.length - held.length).toBe(14);
  });
});
