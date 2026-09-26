// `window.__desk.note` — the sticky notes' door for the rigs (D2c; the prototype's `__ground.note`):
// the editor (focus, blur, type as the platform would), the world's writing (text, seeds, the claim),
// the flux (the caret, the wipe) and the ink (the layout, where the raster lives, the pages, the
// writing's counters), and the text raster itself (`ink` — r8 bytes for a text, as the prototype's
// `ink.make` drew the committed raster). Reads the world and the layer; writes only what the editor
// or the platform would.

import { type CanvasEngine, defineQuery, Editing, type Entity } from "@ice/core";
import type { DeskLayerHandle } from "@ice/desk";
import { DEFAULT_BLEED, DEFAULT_HAND_LAW, layoutText, type NoteRasterInfo, type PaperKind, type WritingStats } from "@ice/desk";
import { NOTE_INK, NOTE_TYPE, type PaperDriver } from "@ice/desk/objects";
import { deskText } from "./faces";

export interface NoteApi {
  fontReady(face?: string): boolean;
  focus(id: number, index?: number): boolean;
  blur(): void;
  /** The note the editor is on, or −1. */
  editing(): number;
  /** Entities carrying the world's `Editing` claim. */
  claimed(): number[];
  /** Type as the platform would: into the editor at its selection, then its `input` event. */
  type(text: string): boolean;
  /** The note's writing as the world holds it (live mid-session) and as the document does. */
  ink(id: number): { readonly text: string; readonly seeds: string } | null;
  docInk(id: number): { readonly text: string; readonly seeds: string } | null;
  sessionOpen(): boolean;
  canUndo(): boolean;
  caret(): { readonly entity: number; readonly index: number; readonly on: boolean } | null;
  wipe(id: number): { readonly index: number; readonly t0: number } | null;
  editorRect(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  editorPlacement(): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly angle: number } | null;
  editorFocused(): boolean;
  layout(id: number): { readonly glyphs: number; readonly lines: number; readonly positions: number[]; readonly ascent: number } | null;
  raster(id: number): NoteRasterInfo | null;
  writing(): WritingStats | null;
  pages(): { readonly used: number; readonly rows: number; readonly layersUsed: number } | null;
  /** The text raster's own bytes for a text (base64 r8), laid by the hand's law with the note seed's glyph seeds. */
  rasterBytes(text: string, w: number, h: number, band: number, face: string, seed: number): string | null;
}

const claimedQ = defineQuery([Editing]);

export function noteApi(engine: CanvasEngine, handle: DeskLayerHandle): NoteApi {
  const { world } = engine;
  const E = (id: number) => id as Entity;
  /** The note's driver (D-D7-A.3): its typing session and its writing. */
  const paper = (): PaperDriver | undefined => handle.driver(NOTE_TYPE) as PaperDriver | undefined;
  const editor = () => handle.editor();
  return {
    fontReady: (face = "caveat") => deskText().ready(face),
    focus: (id, index) => editor()?.focus(E(id), index) ?? false,
    blur: () => editor()?.blur(),
    editing: () => (editor()?.editing() as number | undefined) ?? -1,
    claimed() { const out: number[] = []; world.query(claimedQ).each((b) => { for (const r of b) out.push(b.entity(r) as number); }); return out; },
    type(text) {
      const el = editor()?.element;
      if (el === undefined || el.hidden) return false;
      el.setRangeText(text, el.selectionStart, el.selectionEnd, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    ink: (id) => (world.isAlive(E(id)) ? ((world.get(E(id), NOTE_INK) as { text: string; seeds: string } | undefined) ?? null) : null),
    docInk: (id) => (engine.docs.current()?.store.getComponent(E(id), NOTE_INK) as { text: string; seeds: string } | undefined) ?? null,
    sessionOpen: () => (paper()?.typing.open() ?? false),
    canUndo: () => engine.docs.current()?.store.canUndo() ?? false,
    caret() { const c = paper()?.writing()?.caretOf(); return c === undefined ? null : { entity: c.entity as number, index: c.index, on: c.on }; },
    wipe: (id) => paper()?.writing()?.wipeOf(E(id)) ?? null,
    editorRect() { const el = editor()?.element; if (el === undefined || el.hidden) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; },
    editorPlacement: () => editor()?.placement() ?? null,
    editorFocused: () => { const el = editor()?.element; return el !== undefined && document.activeElement === el; },
    layout(id) { const L = paper()?.writing()?.layoutOf(E(id)); return L === undefined ? null : { glyphs: L.glyphs.length, lines: L.lines.length, positions: [...L.positions], ascent: L.ascent }; },
    raster: (id) => paper()?.writing()?.rasterOf(E(id)) ?? null,
    writing: () => paper()?.writing()?.stats() ?? null,
    pages: () => (handle.ground()?.pass("paper") as PaperKind | undefined)?.pass.shelves.stats ?? null,
    rasterBytes(text, w, h, band, face, seed) {
      const raster = deskText();
      const metrics = raster.metrics(face);
      if (metrics === undefined) return null;
      const r = raster.raster(layoutText(text, { w, h }, DEFAULT_HAND_LAW, metrics, seed), face, { w, h }, band, DEFAULT_BLEED);
      let bin = "";
      for (const b of r.bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    },
  };
}
