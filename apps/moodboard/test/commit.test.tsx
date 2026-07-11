/**
 * The sanctioned widget-edit path, headless. Renders the REAL sticky view (proving
 * `useWidgetProps` read wiring), then edits the sticky's props group through
 * `useCommit` — the one durable-write seam — and checks ⌘Z semantics: undo reverts
 * the EDIT, not the seed (seeds are spawned `undoable:false`, so they never enter
 * the undo stack).
 */
import { EngineProvider, useCommit, type WidgetComponentProps } from "@ice/react";
import type { CanvasEngine, Entity } from "@ice/core";
import { act, createElement, type ComponentType, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { createMoodboardEngine } from "../src/engine";
import { Sticky } from "../src/widgets";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const STICKY_PROPS = Sticky.groups.find((g) => g.name === "props") as (typeof Sticky.groups)[number];
const StickyView = Sticky.component as ComponentType<WidgetComponentProps>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c();
    } catch {
      /* best effort */
    }
  }
  document.body.innerHTML = "";
});

function makeEngine(): { engine: CanvasEngine; step: (n?: number) => void } {
  const { engine } = createMoodboardEngine();
  cleanups.push(() => engine.dispose());
  let now = 0;
  const step = (n = 1): void =>
    act(() => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    });
  return { engine, step };
}

function mountView(engine: CanvasEngine, entity: Entity): { textOf: () => string } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root: Root = createRoot(el);
  cleanups.push(() => act(() => root.unmount()));
  const node: ReactElement = createElement(
    EngineProvider,
    { engine },
    createElement(StickyView, { entity, world: engine.world }),
  );
  act(() => root.render(node));
  return {
    textOf: () => (el.querySelector("[data-sticky-text]") as HTMLTextAreaElement | null)?.value ?? "",
  };
}

/** Read the committed text off the sticky's props group component. */
function committedText(engine: CanvasEngine, e: Entity): string {
  const v = engine.world.get(e, STICKY_PROPS.component) as { text?: string } | undefined;
  return v?.text ?? "";
}

describe("moodboard sticky edit (useCommit)", () => {
  it("commits an edit; undo reverts the edit but not the seed", () => {
    const { engine, step } = makeEngine();

    // A seed sticky — spawned undoable:false, so it is NOT on the undo stack.
    const e = engine.ops.spawnWidget("sticky", { x: 0, y: 0, props: { text: "seed", color: "lemon" }, undoable: false });
    step(2);

    // The real view reflects the seeded text (useWidgetProps read path).
    const view = mountView(engine, e);
    expect(view.textOf()).toBe("seed");

    // Edit through the sanctioned commit seam (one guarded tx, whole-group write).
    const commitRef: { current?: (fn: (tx: import("@ice/core").GuardedTx) => void) => void } = {};
    function Probe(): null {
      commitRef.current = useCommit();
      return null;
    }
    const probeEl = document.createElement("div");
    document.body.appendChild(probeEl);
    const probeRoot = createRoot(probeEl);
    cleanups.push(() => act(() => probeRoot.unmount()));
    act(() => probeRoot.render(createElement(EngineProvider, { engine }, createElement(Probe))));

    act(() => {
      commitRef.current?.((tx) =>
        tx.edit(e).set(STICKY_PROPS.component, { text: "sunset gradient", color: "lemon" } as never),
      );
    });
    step();
    expect(committedText(engine, e)).toBe("sunset gradient");
    expect(view.textOf()).toBe("sunset gradient"); // the view re-rendered on the doc edit

    // ⌘Z reverts the edit; the seeded sticky survives.
    act(() => {
      engine.docs.undo();
    });
    step();
    expect(committedText(engine, e)).toBe("seed");
    expect(engine.world.isAlive(e)).toBe(true);

    // Nothing left to undo — the seed was never on the stack.
    expect(engine.docs.undo()).toBe(false);
  });
});
