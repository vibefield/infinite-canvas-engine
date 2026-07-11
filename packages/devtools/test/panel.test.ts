/**
 * @ice/devtools panel — attach/detach lifecycle, the pointers + loop live feeds,
 * and the sovereignty per-prefab component badges. Runs under happy-dom; reads
 * the world outside the tick (the panel's contract).
 */
import {
  ClaimedBy,
  createDocSession,
  createEngine,
  createWorld,
  defineQuery,
  defineSystem,
  defineWidget,
  Drag,
  GesturePhases,
  LocalPointer,
  p,
  Pointer,
  PointerButtons,
  PointerScreen,
  Position,
  Size,
  spawnWidget,
  Watches,
} from "@ice/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachDevtools } from "../src/panel";

// Module scope: the schema registry is process-global, so a file-unique widget type.
const Card = defineWidget({
  type: "dt:card",
  version: 1,
  props: { title: p.string({ default: "Untitled" }) },
  groups: { content: ["title"] },
  surface: "dom",
  component: null,
  defaultSize: { w: 200, h: 120 },
  interaction: { selectable: true, movable: true },
});

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
});

describe("attach / detach lifecycle", () => {
  it("mounts into the container and detach removes the panel + stops the timer", () => {
    vi.useFakeTimers();
    try {
      const engine = createEngine(createWorld());
      const handle = attachDevtools(engine, { container, intervalMs: 250 });

      expect(container.querySelector("[data-ice-devtools]")).not.toBeNull();
      expect(vi.getTimerCount()).toBeGreaterThan(0); // the refresh interval is armed

      handle.detach();
      expect(container.querySelector("[data-ice-devtools]")).toBeNull();
      expect(vi.getTimerCount()).toBe(0); // interval cleared
      handle.detach(); // idempotent
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POINTERS tab", () => {
  it("renders a live pointer row and a recognizer row", () => {
    const world = createWorld();
    const engine = createEngine(world);

    const ptr = world.spawn({
      components: [
        [Pointer, { id: "mouse-1", device: "mouse", owner: "" }],
        [PointerScreen, { x: 12, y: 34 }],
        [PointerButtons, { buttons: 1, downX: 0, downY: 0 }],
      ],
    });
    world.addTag(ptr, LocalPointer);

    const rec = world.spawn({ components: [[Drag, {}]] });
    world.addTag(rec, GesturePhases.tags.Active);
    world.addRelation(rec, Watches, ptr);
    world.setRelation(ptr, ClaimedBy, rec);

    // Default tab is POINTERS; attach renders immediately.
    attachDevtools(engine, { container, telemetry: false });

    const pointerRows = container.querySelectorAll('[data-row="pointer"]');
    const recRows = container.querySelectorAll('[data-row="recognizer"]');
    expect(pointerRows).toHaveLength(1);
    expect(recRows).toHaveLength(1);
    expect(pointerRows[0]?.textContent).toContain("mouse-1");
    expect(pointerRows[0]?.textContent).toContain("·local");
    expect(recRows[0]?.textContent).toContain("Drag");
    expect(recRows[0]?.textContent).toContain("[Active]");
    expect(recRows[0]?.textContent).toContain(`watches:[#${ptr}]`);
  });
});

describe("LOOP tab", () => {
  it("shows a system row after a step with telemetry armed", () => {
    const world = createWorld();
    const engine = createEngine(world);
    engine.addSystems(
      "simulate",
      defineSystem(defineQuery([Position]), () => {}, { name: "probe" }),
    );
    world.spawn({ components: [[Position, { x: 0, y: 0 }]] });

    attachDevtools(engine, { container }); // arms telemetry
    engine.step(16);
    engine.step(32);

    (container.querySelector('[data-tab="loop"]') as HTMLButtonElement).click();

    const systemRows = container.querySelectorAll('[data-row="system"]');
    expect(systemRows.length).toBeGreaterThan(0);
    expect(Array.from(systemRows).some((r) => r.textContent?.includes("simulate/probe"))).toBe(true);
  });
});

describe("SOVEREIGNTY tab", () => {
  it("shows a durable widget prefab and its component rows when selected", () => {
    const world = createWorld();
    const engine = createEngine(world);
    const session = createDocSession(world);

    const e = spawnWidget(session.store, world, "dt:card", { x: 10, y: 10 });
    engine.step(16); // durable projection places the entity + its group cells

    attachDevtools(engine, { container, telemetry: false });
    (container.querySelector('[data-tab="sovereignty"]') as HTMLButtonElement).click();

    const prefabRow = container.querySelector('[data-prefab="dt:card"]') as HTMLElement;
    expect(prefabRow).not.toBeNull();
    expect(prefabRow.textContent).toContain("durable");
    expect(prefabRow.textContent).toContain("×1");

    prefabRow.click(); // select → render its component list

    const compRows = container.querySelectorAll('[data-row="component"]');
    const texts = Array.from(compRows).map((r) => r.textContent ?? "");
    expect(compRows.length).toBeGreaterThanOrEqual(3);
    expect(texts.some((t) => t.includes("Position"))).toBe(true);
    expect(texts.some((t) => t.includes("PrefabId"))).toBe(true);
    // The group component generated by defineWidget rides the same durable set.
    const contentComp = Card.groups.find((g) => g.name === "content")?.component;
    expect(contentComp).toBeDefined();
    expect(world.has(e, Size)).toBe(true);
  });
});
