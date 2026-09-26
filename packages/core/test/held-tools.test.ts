// @vitest-environment node
// THE HELD BAR'S TOOLS (design-015 §8; D3t-a — widget/held-tools.ts): a type's `heldTools` are declared on the widget
// type and reached through the engine — `ops.open` puts the mode in hand on with `Held` (the type's `heldTool` of the
// object's props, else its first mode) and `ops.putDown` takes it off; `ops.useHeldTool` makes a mode the tool in hand
// (a toggle chosen again hands back the one before) or runs an action's op (its transaction, the document's history, the
// object's props); a declared-only tool routes nothing; keys match exactly on their modifiers and case-blind on the key.
// Through the REAL stack: a press on the drawing surface with a mode in hand is the TOOL's (never two taps that put the
// object down, which elsewhere on it still do), the pose seam's part rides `HeldPointer`, and the mode's cursor shows over
// the surface alone.
import { describe, expect, it } from "vitest";
import {
  Camera,
  Held,
  HeldPointer,
  HeldPress,
  HeldTool,
  LocalPointer,
  Locked,
  NO_MODS,
  Pointer,
  Viewport,
  createCanvasEngine,
  defineQuery,
  defineWidget,
  keyMatches,
  matchHeldTool,
  p,
  widgets,
  type Entity,
  type HeldToolDef,
} from "../src";

const ran: string[] = [];
const TOOLS: readonly HeldToolDef[] = [
  { id: "pen:black", label: "Black", kind: "mode", keys: ["1"], cursor: "none" },
  { id: "pen:blue", label: "Blue", kind: "mode", keys: ["2"], cursor: "none" },
  { id: "eraser", label: "Eraser", kind: "mode", keys: ["e"], toggle: true, cursor: "none" },
  { id: "undo", label: "Undo", kind: "action", keys: ["mod+z"], run: (api) => { ran.push("undo"); api.undo(); } },
  { id: "redo", label: "Redo", kind: "action", keys: ["mod+shift+z"], run: (api) => { ran.push("redo"); api.redo(); } },
  { id: "tape", label: "Tape", kind: "action", keys: ["t"], run: (api) => { ran.push("tape"); api.transact((tx) => { tx.addTag(api.entity, Locked); }); } },
  { id: "bump", label: "Bump", kind: "action", keys: ["b"], bar: false, run: (api) => { ran.push("bump"); api.setProps({ n: Number(api.props().n ?? 0) + 1 }); } },
  { id: "later", label: "Declared only", keys: ["l"] },
];

// One widget type per FILE (global registry; no test reset).
const BOARD =
  widgets.get("tools:board") ??
  defineWidget({
    type: "tools:board", object: { name: "board" }, openable: true, defaultSize: { w: 200, h: 140 },
    props: { cap: p.enum(["black", "blue"], { default: "blue" }), n: p.number({ default: 0 }) },
    heldTools: TOOLS,
    heldTool: (props) => `pen:${String(props.cap)}`,
  });
const PAD =
  widgets.get("tools:pad") ??
  defineWidget({ type: "tools:pad", object: { name: "pad" }, openable: true, defaultSize: { w: 100, h: 100 }, heldTools: [{ id: "month", label: "Month", kind: "action", run: () => {} }, { id: "pen", label: "Pen", kind: "mode" }] });

const VP = { w: 800, h: 600, dpr: 1 };
const pointerQ = defineQuery([Pointer, LocalPointer]);

function rig() {
  ran.length = 0;
  const ce = createCanvasEngine({ widgets: [BOARD, PAD] });
  ce.docs.create();
  ce.world.setResource(Viewport, VP);
  ce.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const board = ce.ops.spawnWidget("tools:board", { x: 100, y: 100, undoable: false });
  const pad = ce.ops.spawnWidget("tools:pad", { x: 500, y: 400, undoable: false });
  ce.world.sync();
  let now = 1000;
  const step = (n = 1): void => { for (let i = 0; i < n; i++) { now += 16; ce.step(now); } };
  step(5);
  const mouse = (kind: "down" | "move" | "up", x: number, y: number, buttons: number): void => {
    ce.stack.queue.enqueue({ kind, pointerId: "mouse", device: "mouse", screenX: x, screenY: y, buttons, mods: NO_MODS });
  };
  const tap = (x: number, y: number): void => { mouse("move", x, y, 0); step(); mouse("down", x, y, 1); step(); mouse("up", x, y, 0); step(); };
  // the board in hand at its reading pose: centred, 300 × 210 on screen at 1.5 px per unit; its melamine the inner 200 × 120 units
  // (100 × 60 half), its frame the rest out to 100 × 70 half
  ce.stack.heldPose.current = {
    frame: (e) => (e === board ? { cx: 400, cy: 300, hx: 150, hy: 105, s: 1.5, settled: true } : undefined),
    part: (e, x, y) => (e !== board ? null : Math.abs(x) <= 60 && Math.abs(y) <= 40 ? "content" : Math.abs(x) <= 100 && Math.abs(y) <= 70 ? "frame" : null),
  };
  const tool = (e: Entity = board) => ce.world.get(e, HeldTool);
  const pointer = (): Entity | undefined => ce.world.firstOf(pointerQ);
  return { ce, world: ce.world, step, mouse, tap, tool, pointer, board, pad };
}

describe("the held tools' keys (widget/held-tools.ts)", () => {
  const chord = (key: string, m: Partial<{ mod: boolean; shift: boolean; alt: boolean }> = {}) => ({ key, mod: m.mod ?? false, shift: m.shift ?? false, alt: m.alt ?? false });
  it("a spec names its modifiers exactly and its key case-blind", () => {
    expect(keyMatches("1", chord("1"))).toBe(true);
    expect(keyMatches("e", chord("E"))).toBe(true);   // Caps Lock types "E"
    expect(keyMatches("e", chord("E", { shift: true }))).toBe(false);
    expect(keyMatches("mod+z", chord("z", { mod: true }))).toBe(true);
    expect(keyMatches("mod+z", chord("Z", { mod: true, shift: true }))).toBe(false);
    expect(keyMatches("mod+shift+z", chord("Z", { mod: true, shift: true }))).toBe(true);
    expect(keyMatches("mod+Backspace", chord("Backspace", { mod: true }))).toBe(true);
    expect(keyMatches("1", chord("1", { alt: true }))).toBe(false);
  });
  it("matchHeldTool finds the live tool a chord names; a declared-only tool routes nothing", () => {
    expect(matchHeldTool(TOOLS, chord("2"))?.id).toBe("pen:blue");
    expect(matchHeldTool(TOOLS, chord("z", { mod: true }))?.id).toBe("undo");
    expect(matchHeldTool(TOOLS, chord("z", { mod: true, shift: true }))?.id).toBe("redo");
    expect(matchHeldTool(TOOLS, chord("l"))).toBeUndefined();
    expect(matchHeldTool(TOOLS, chord("q"))).toBeUndefined();
  });
  it("defineWidget refuses a repeated id, an action without its op, a malformed key, and tools on what does not open", () => {
    expect(() => defineWidget({ type: "tools:bad1", object: {}, openable: true, heldTools: [{ id: "a", label: "A", kind: "mode" }, { id: "a", label: "A", kind: "mode" }] })).toThrow(/repeats "a"/);
    expect(() => defineWidget({ type: "tools:bad2", object: {}, openable: true, heldTools: [{ id: "a", label: "A", kind: "action" }] })).toThrow(/declare `run`/);
    expect(() => defineWidget({ type: "tools:bad3", object: {}, openable: true, heldTools: [{ id: "a", label: "A", kind: "mode", keys: ["cmd+z"] }] })).toThrow(/not a key spec/);
    expect(() => defineWidget({ type: "tools:bad4", object: {}, heldTools: [{ id: "a", label: "A", kind: "mode" }] })).toThrow(/does not open/);
  });
});

describe("the tool in hand — `HeldTool`, the user's fact (design-015 §8, D3t-a)", () => {
  it("ops.open puts on the type's heldTool of the props; else the first mode; putDown takes it off", () => {
    const r = rig();
    r.ce.ops.open(r.board);
    expect(r.tool()).toEqual({ id: "pen:blue", prev: "pen:blue" });   // the prop's default cap
    r.ce.ops.putDown();
    expect(r.world.has(r.board, HeldTool)).toBe(false);
    r.ce.ops.open(r.pad);
    expect(r.tool(r.pad)).toEqual({ id: "pen", prev: "pen" });   // no heldTool: the first mode
  });

  it("a mode becomes the tool in hand; the same again stays; a toggle chosen again hands back the one before", () => {
    const r = rig();
    r.ce.ops.open(r.board);
    expect(r.ce.ops.useHeldTool("pen:black")).toBe(true);
    expect(r.tool()).toEqual({ id: "pen:black", prev: "pen:blue" });
    r.ce.ops.useHeldTool("pen:black");
    expect(r.tool()).toEqual({ id: "pen:black", prev: "pen:blue" });
    r.ce.ops.useHeldTool("eraser");
    expect(r.tool()).toEqual({ id: "eraser", prev: "pen:black" });
    r.ce.ops.useHeldTool("eraser");
    expect(r.tool()).toEqual({ id: "pen:black", prev: "eraser" });
  });

  it("an action runs its op: one transaction the document's undo reverts, the history's steps, the object's props", () => {
    const r = rig();
    r.ce.ops.open(r.board);
    r.ce.ops.useHeldTool("tape");
    r.world.sync();
    expect(r.world.hasTag(r.board, Locked)).toBe(true);
    r.ce.ops.useHeldTool("undo");
    r.world.sync();
    expect(r.world.hasTag(r.board, Locked)).toBe(false);
    r.ce.ops.useHeldTool("redo");
    r.world.sync();
    expect(r.world.hasTag(r.board, Locked)).toBe(true);
    r.ce.ops.useHeldTool("bump");
    r.ce.ops.useHeldTool("bump");
    r.world.sync();
    expect(ran).toEqual(["tape", "undo", "redo", "bump", "bump"]);
    const props = r.world.get(r.board, BOARD.groups[0]?.component as never) as { n: number } | undefined;
    expect(props?.n).toBe(2);
  });

  it("nothing held, an unknown tool, or a declared-only one: false, nothing runs", () => {
    const r = rig();
    expect(r.ce.ops.useHeldTool("tape")).toBe(false);
    r.ce.ops.open(r.board);
    expect(r.ce.ops.useHeldTool("nope")).toBe(false);
    expect(r.ce.ops.useHeldTool("later")).toBe(false);
    expect(ran).toEqual([]);
  });
});

describe("the tool's press and the part under the pointer (the held input, D3t-a)", () => {
  it("the pose seam's part rides HeldPointer: the drawing surface, the frame, nothing", () => {
    const r = rig();
    r.ce.ops.open(r.board);
    r.step();
    r.mouse("move", 400 + 30 * 1.5, 300, 0); r.step();
    const p = r.pointer() as Entity;
    expect(r.world.get(p, HeldPointer)).toEqual({ x: 30, y: 0, inside: true, part: "content" });
    r.mouse("move", 400 + 80 * 1.5, 300, 0); r.step();
    expect(r.world.get(p, HeldPointer)?.part).toBe("frame");
    r.mouse("move", 400 + 140 * 1.5, 300, 0); r.step();
    expect(r.world.get(p, HeldPointer)?.part).toBe("");
  });

  it("a press on the surface with a mode in hand is the TOOL's — two taps there never put it down; on the frame they do", () => {
    const r = rig();
    r.ce.ops.open(r.board);
    r.step();
    r.mouse("move", 400, 300, 0); r.step();
    r.mouse("down", 400, 300, 1); r.step();
    expect(r.world.get(r.pointer() as Entity, HeldPress)?.kind).toBe("tool");
    r.mouse("up", 400, 300, 0); r.step();
    r.tap(400, 300);
    r.step(2);
    expect(r.world.hasTag(r.board, Held)).toBe(true);   // two dots, never a way back
    const fx = 400 + 80 * 1.5;
    r.tap(fx, 300);
    expect(r.world.get(r.pointer() as Entity, HeldPress)).toBeUndefined();
    r.tap(fx, 300);
    r.step(2);
    expect(r.world.hasTag(r.board, Held)).toBe(false);   // the frame is the object's own: two taps put it down
  });

  it("the mode's cursor shows over the surface alone; none in hand, none of it", () => {
    const r = rig();
    r.mouse("move", 400, 300, 0); r.step();
    expect(r.ce.stack.readCursor()).toBe("default");
    r.ce.ops.open(r.board);
    r.step(2);
    r.mouse("move", 401, 300, 0); r.step();
    expect(r.ce.stack.readCursor()).toBe("none");
    r.mouse("move", 400 + 80 * 1.5, 300, 0); r.step();
    expect(r.ce.stack.readCursor()).toBe("default");
    r.ce.ops.putDown();
    r.mouse("move", 400, 300, 0); r.step();
    expect(r.ce.stack.readCursor()).toBe("default");
  });
});
