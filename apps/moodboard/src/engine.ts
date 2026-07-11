/**
 * The moodboard engine factory — the whole app boot in one published call:
 * `createCanvasEngine` (facade), attach a fresh document, register a draw tool,
 * seed a few widgets. Shared by `main.tsx` (the browser boot) and the tests so
 * they exercise the identical construction path.
 *
 * Every import is a package ROOT — no deep imports, no strata, no loro.
 */
import { createCanvasEngine, createDrawTool, type CanvasEngine, type Tool } from "@ice/core";
import { Sticky, Swatch, type StickyColor } from "./widgets";

/** The one custom tool: a canvas drag mints a sticky from its rect (shortcut "s"). */
export const DRAW_STICKY: Tool = createDrawTool("sticky", { shortcut: "s" });

export interface MoodboardEngine {
  readonly engine: CanvasEngine;
  /** How many widgets the seed spawned (all `undoable:false`, so ⌘Z is user-clean). */
  readonly seeded: number;
}

/** Construct the engine, attach a doc, seed it. Returns the live facade + seed count. */
export function createMoodboardEngine(): MoodboardEngine {
  // Touch the widget modules so their `defineWidget` side effects have run
  // before `createCanvasEngine` validates the declared widget list.
  void Sticky;
  void Swatch;

  const engine = createCanvasEngine({
    widgets: [{ type: "sticky" }, { type: "swatch" }],
    tools: [DRAW_STICKY],
    settings: { zoom: { min: 0.2, max: 4 } },
  });
  engine.docs.create();
  const seeded = seedBoard(engine);
  return { engine, seeded };
}

interface StickySeed {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: StickyColor;
}
interface SwatchSeed {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}

const STICKY_SEEDS: readonly StickySeed[] = [
  { x: -260, y: -120, text: "warm morning light", color: "lemon" },
  { x: -40, y: -140, text: "coastal blues", color: "sky" },
  { x: 180, y: -110, text: "fresh cut grass", color: "mint" },
];
const SWATCH_SEEDS: readonly SwatchSeed[] = [
  { x: -240, y: 120, color: "#f4d03f" },
  { x: -120, y: 130, color: "#5aa0e6" },
  { x: 0, y: 120, color: "#5cb85c" },
  { x: 120, y: 130, color: "#e668a8" },
];

/**
 * Seed the board through the paved-road `ops.spawnWidget`. Each spawn is
 * `undoable:false` so it never enters the local undo stack — the first ⌘Z a
 * user presses reverts THEIR first edit, not a seed.
 */
function seedBoard(engine: CanvasEngine): number {
  let count = 0;
  for (const s of STICKY_SEEDS) {
    engine.ops.spawnWidget("sticky", {
      x: s.x,
      y: s.y,
      props: { text: s.text, color: s.color },
      undoable: false,
    });
    count += 1;
  }
  for (const s of SWATCH_SEEDS) {
    engine.ops.spawnWidget("swatch", { x: s.x, y: s.y, props: { color: s.color }, undoable: false });
    count += 1;
  }
  return count;
}
