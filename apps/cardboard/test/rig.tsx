/**
 * Shared headless rig for the card-board exit-criterion tests: the FULL M4
 * interaction stack + M6 widget runtime + the REAL @ice/dom host reflector +
 * a React WidgetRoot, driven under `act()`. Screen == world (identity camera),
 * so synthetic pointer client coords ARE world coords.
 *
 * Reflectors registered: plane-transform, domWidgets, chrome, cursor — the grid
 * (P0 GL) is skipped (WebGL is null under happy-dom and irrelevant to these
 * widget/pointer/commit assertions).
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  type Entity,
  Viewport,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
  installWidgetRuntime,
} from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createChromeReflector,
  createCursorReflector,
  createDomWidgetsReflector,
  createPlaneTransformReflector,
  createPlanes,
} from "@ice/dom";
import { WidgetRoot } from "@ice/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { CardStoreContext } from "../src/todo-card";

// React 18+ act() environment flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export interface Rig {
  container: HTMLElement;
  world: ReturnType<typeof createWorld>;
  session: DocSession;
  runtime: ReturnType<typeof installWidgetRuntime>;
  domWidgets: ReturnType<typeof createDomWidgetsReflector>;
  sink: ReturnType<typeof createRecordingCommitSink>;
  step(n?: number): void;
  render(): void;
  /** Dispatch a synthetic bubbling DOM event (for the imperative pointer adapter). */
  fire(target: EventTarget, type: string, props?: Record<string, unknown>): Event;
  /** Same, wrapped in act() — for events that hit REACT handlers (change/keydown/click). */
  fireReact(target: EventTarget, type: string, props?: Record<string, unknown>): void;
  card(): HTMLElement | null;
  title(): HTMLInputElement | null;
}

export function makeRig(): Rig {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const host = createCanvasHost(container);
  const planes = createPlanes(host);

  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false }); // screen == world
  world.setResource(Viewport, { w: 1200, h: 800, dpr: 1 });
  const engine = createEngine(world);

  const recording = createRecordingCommitSink();
  const sinkRef: { target?: CommitSink } = {};
  const tee: CommitSink = {
    commit(i) {
      recording.commit(i);
      sinkRef.target?.commit(i);
    },
  };
  const stack = installInteractionStack(engine, { sink: tee });
  world.setResource(ActiveTool, { id: "select" });

  const runtime = installWidgetRuntime(engine);
  const session = createDocSession(world);
  sinkRef.target = session.sink;

  const domWidgets = createDomWidgetsReflector(
    { contentPlane: planes.content, liftedPlane: planes.lifted },
    world,
    runtime.store,
  );
  engine.registerReflector(createPlaneTransformReflector({ contentPlane: planes.content, liftedPlane: planes.lifted }));
  engine.registerReflector(domWidgets);
  engine.registerReflector(createChromeReflector(host, world, stack.marqueeBuffer));
  engine.registerReflector(createCursorReflector(host, stack.readCursor));
  attachPointerAdapter(host, stack.queue);

  const reactHost = document.createElement("div");
  document.body.appendChild(reactHost);
  const root = createRoot(reactHost);

  let now = 1000;
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
      root.render(
        createElement(
          CardStoreContext.Provider,
          { value: session.store },
          createElement(WidgetRoot, { world, store: runtime.store, hosts: domWidgets }),
        ),
      );
    });
  };
  const fire = (target: EventTarget, type: string, props: Record<string, unknown> = {}): Event => {
    const ev = new Event(type, { cancelable: true, bubbles: true });
    Object.assign(ev, props);
    target.dispatchEvent(ev);
    return ev;
  };
  const fireReact = (target: EventTarget, type: string, props: Record<string, unknown> = {}): void => {
    act(() => {
      fire(target, type, props);
    });
  };

  return {
    container,
    world,
    session,
    runtime,
    domWidgets,
    sink: recording,
    step,
    render,
    fire,
    fireReact,
    card: () => container.querySelector("[data-card]"),
    title: () => container.querySelector("[data-card-title]"),
  };
}

export type { Entity };
