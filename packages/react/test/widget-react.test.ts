/**
 * @ice/react spine: WidgetRoot portals from the mount store into host
 * elements; useWidgetProps re-renders on prop change (Tier-3) and FREEZES
 * while hidden (design-004 §2); cull/re-enter preserves React local state
 * (the M6 exit criterion, headless form).
 */
import {
  Camera,
  Viewport,
  createDocSession,
  createEngine,
  createWorld,
  defineWidget,
  installWidgetRuntime,
  p,
  spawnWidget,
  widgets,
  type Entity,
} from "@ice/core";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { WidgetRoot, useWidgetProps, type WidgetComponentProps } from "../src";

// React 18+ act() environment flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let renders = 0;

function NoteView({ entity, world }: WidgetComponentProps) {
  renders += 1;
  const props = useWidgetProps<{ text: string }>(world, entity, "rt:note");
  // Local session state — must survive cull/re-enter while kept mounted.
  const [local] = useState(() => `local-${String(entity)}`);
  return createElement("div", { "data-note": "", "data-local": local }, props?.text ?? "");
}

defineWidget({
  type: "rt:note",
  props: { text: p.string({ default: "hi" }) },
  surface: "dom",
  component: NoteView,
  defaultSize: { w: 100, h: 60 },
});

function makeRig() {
  const world = createWorld();
  const engine = createEngine(world);
  const session = createDocSession(world);
  const runtime = installWidgetRuntime(engine, { keepMounted: 8 });
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 600, h: 400, dpr: 1 });

  // Minimal host layer standing in for the dom-widgets reflector.
  const hostRoot = document.createElement("div");
  document.body.appendChild(hostRoot);
  const hostMap = new Map<Entity, HTMLElement>();
  const hosts = {
    hostFor(e: Entity): HTMLElement | undefined {
      if (!world.isAlive(e)) return undefined;
      let h = hostMap.get(e);
      if (h === undefined) {
        h = document.createElement("div");
        hostRoot.appendChild(h);
        hostMap.set(e, h);
      }
      return h;
    },
  };

  const reactHost = document.createElement("div");
  document.body.appendChild(reactHost);
  const root: Root = createRoot(reactHost);
  let now = 0;
  const step = (n = 1): void => {
    act(() => {
      for (let i = 0; i < n; i++) {
        now += 16;
        engine.step(now);
      }
    });
  };
  const render = (): void => {
    act(() => {
      root.render(createElement(WidgetRoot, { world, store: runtime.store, hosts }));
    });
  };
  return { world, session, runtime, hostRoot, step, render };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WidgetRoot + hooks (M6 exit, headless form)", () => {
  it("portals content, re-renders on Tier-3 prop change, freezes hidden, preserves state across cull", () => {
    renders = 0;
    const rig = makeRig();
    const e = spawnWidget(rig.session.store, rig.world, "rt:note", { x: 50, y: 50 });
    rig.step(3); // project → equip → mount
    rig.render();

    const note = () => rig.hostRoot.querySelector("[data-note]");
    expect(note()?.textContent).toBe("hi");
    const localBefore = note()?.getAttribute("data-local");
    expect(localBefore).toBeTruthy();

    // Prop change through the doc → Tier-3 wake at notify → re-render.
    const group = widgets.get("rt:note")?.groups.find((g) => g.name === "props");
    expect(group).toBeDefined();
    if (group === undefined) return;
    rig.session.store.transaction((tx) => {
      tx.edit(e).set(group.component, { text: "updated" } as never);
    });
    rig.step();
    expect(note()?.textContent).toBe("updated");

    // Hide (pan away): widget stays mounted; local state must survive; a doc
    // edit while hidden must NOT re-render the frozen tree.
    rig.world.setResource(Camera, { x: 100_000, y: 100_000, zoom: 1, gesturing: false });
    rig.step(2);
    expect(note()).toBeTruthy(); // still mounted (hidden host is the reflector's job)
    const rendersWhileHidden = renders;
    rig.session.store.transaction((tx) => {
      tx.edit(e).set(group.component, { text: "edited-while-hidden" } as never);
    });
    rig.step(2);
    expect(renders).toBe(rendersWhileHidden); // FROZEN — no re-render on doc edits

    // Re-enter: refresh render shows the latest value; local state preserved.
    rig.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    rig.step(2);
    expect(note()?.textContent).toBe("edited-while-hidden");
    expect(note()?.getAttribute("data-local")).toBe(localBefore);
  });
});

// --- malformed json cells (2026-07-13 review) --------------------------------

function MemoView({ entity, world }: WidgetComponentProps) {
  const props = useWidgetProps<{ items: string[] }>(world, entity, "rt:memo");
  return createElement("div", { "data-memo": "", "data-items": JSON.stringify(props?.items ?? null) });
}

const memo = defineWidget({
  type: "rt:memo",
  props: { items: p.json(p.array({ kind: "string" }), { default: ["seed"] }) },
  surface: "dom",
  component: MemoView,
  defaultSize: { w: 100, h: 60 },
});
const memoGroup = (() => {
  const g = memo.groups[0];
  if (g === undefined) throw new Error("ice test: rt:memo has no groups");
  return g;
})();

describe("useWidgetProps: malformed json cells never crash render", () => {
  it("falls back to the spec default when a peer wrote invalid JSON into the cell", () => {
    const rig = makeRig();
    const e = spawnWidget(rig.session.store, rig.world, "rt:memo", { x: 10, y: 10, props: { items: ["a"] } });
    rig.step(3);
    rig.render();
    const memoEl = (): Element | null => document.querySelector("[data-memo]");
    expect(memoEl()?.getAttribute("data-items")).toBe('["a"]');

    // A malformed write lands in the raw string cell — the remote-peer case
    // setWidgetProps cannot guard. The render must survive and show defaults.
    rig.session.store.transaction((tx) => tx.edit(e).set(memoGroup.component, { items: "{not json" }));
    rig.step(2);
    expect(memoEl()?.getAttribute("data-items")).toBe('["seed"]');
  });
});
