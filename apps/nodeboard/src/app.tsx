/**
 * node-board — the M8 node-graph demo (implementation-plan M8). The card-board
 * DOM skeleton (M4 interaction stack + M5 durable spine + M6 widget runtime)
 * PLUS the M8 node-editor layer:
 *
 *   createWorld → createEngine → createCanvasHost(#app) → createPlanes (P1+P3)
 *   → installInteractionStack (late-bound doc sink teed to a recording sink)
 *   → installWidgetRuntime (cull + keep-mounted LRU + mount store; the
 *      activeMembership stamper ships INSIDE it — never added again here)
 *   → createNestedCanvas + addSystems("react", nav.navIntegrity)
 *   → restore/quarantine/seed (4 root nodes + 1 group with 2 children + 1 wire)
 *   → relay + autosave → reflectors (planeTransform · grid(P0) · WIRES(P0) ·
 *      domWidgets(P1/P3) · chrome(P4) · cursor · doc-ui toolbar)
 *   → ONE React root: StoreContext + NavContext over <WidgetRoot>
 *   → attachPointerAdapter (no GL route — every surface is DOM) → rAF loop.
 *
 * SIDE-EFFECT FREE: `boot()` and the seed helpers are exported for both the
 * browser entry (`main.tsx`) and the headless exit tests. `boot({ mount:false })`
 * runs the engine/session/seed/nav path WITHOUT the browser-only pieces (grid,
 * rAF, relay, autosave, ResizeObserver, React mount) so happy-dom can drive it.
 */
import {
  ActiveTool,
  Camera,
  ChildOf,
  type CommitSink,
  type DocSession,
  type Engine,
  type Entity,
  PrefabId,
  Position,
  Size,
  StackZ,
  Viewport,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  type World,
  attachBroadcastRelay,
  createDocSession,
  createEngine,
  createNestedCanvas,
  createRecordingCommitSink,
  createWorld,
  defineQuery,
  installInteractionStack,
  installWidgetRuntime,
  restoreAutosave,
  spawnWidget,
  startAutosave,
  writeRuntimeResource,
} from "@ice/core";
import type { NestedCanvas } from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createChromeReflector,
  createCursorReflector,
  createDomWidgetsReflector,
  createGridReflector,
  createPlaneTransformReflector,
  createPlanes,
  createWiresReflector,
  startRafLoop,
} from "@ice/dom";
import { WidgetRoot } from "@ice/react";
import { createRoot } from "react-dom/client";
import { createDocUi } from "./doc-ui";
import { GroupNode, MathNode, SumNode } from "./nodes";
import { type NodeboardStorage, createLocalStorageStorage } from "./storage";
import { NavContext, StoreContext } from "./store-context";

const STORAGE_KEY = "ice-nodeboard/doc";
const RELAY_CHANNEL = "ice-nodeboard";

const widgetQ = defineQuery([Position, Size, StackZ]);

// Ensure all three widget types register (import side effect kept honest).
void MathNode;
void SumNode;
void GroupNode;

// --- seed helpers (each its own paved-road spawnWidget transaction) ----------

/** Spawn one math-node (top-left `x,y`); optional starting `value`. */
export function spawnMathNode(
  store: DocSession["store"],
  world: World,
  x: number,
  y: number,
  value?: number,
): Entity {
  return spawnWidget(store, world, "math-node", { x, y, ...(value !== undefined ? { props: { value } } : {}) });
}

/** Spawn one sum-node (top-left `x,y`). */
export function spawnSumNode(store: DocSession["store"], world: World, x: number, y: number): Entity {
  return spawnWidget(store, world, "sum-node", { x, y });
}

/** Spawn one group-node container (top-left `x,y`); optional `label`. */
export function spawnGroupNode(
  store: DocSession["store"],
  world: World,
  x: number,
  y: number,
  label?: string,
): Entity {
  return spawnWidget(store, world, "group-node", { x, y, ...(label !== undefined ? { props: { label } } : {}) });
}

/**
 * Seed one wire between two nodes through a store transaction, mirroring the doc
 * commit sink's wire block (design-001 §5.3): a `Wire`-tagged entity carrying
 * `PrefabId{wire}` + `WirePorts{from,to}` + the `WireFrom`/`WireTo` endpoint
 * relations. Geometry NEVER stores a port entity — the two port IDs plus the
 * endpoint widgets are all a wire needs.
 */
export function seedWire(
  store: DocSession["store"],
  from: Entity,
  fromPort: string,
  to: Entity,
  toPort: string,
): void {
  store.transaction((tx) => {
    const wire = tx.spawn({
      components: [
        [PrefabId, { id: "wire" }],
        [WirePorts, { from: fromPort, to: toPort }],
      ],
      tags: [Wire],
    });
    tx.setRelation(wire, WireFrom, from);
    tx.setRelation(wire, WireTo, to);
  });
}

/**
 * Seed the demo scene: 4 root nodes (one math→sum pair pre-wired), plus a
 * group-node containing 2 nodes (reparented via a `ChildOf` store transaction —
 * the same relation write consume/CommitReparent uses). Returns the widget count
 * (nodes + group; the wire has no geometry so it is not a widget).
 */
export function seedScene(session: DocSession, world: World): number {
  const store = session.store;

  // Root row: a pre-wired math → sum pair + two standalone nodes.
  const mathA = spawnMathNode(store, world, -360, -60, 3);
  const sumB = spawnSumNode(store, world, -80, -60);
  spawnMathNode(store, world, -360, 150, 7);
  spawnSumNode(store, world, 200, 120);

  // A group with two children (reparented below).
  const group = spawnGroupNode(store, world, 150, -190, "Group A");
  const innerMath = spawnMathNode(store, world, 175, -150, 2);
  const innerSum = spawnSumNode(store, world, 175, -50);

  // One store transaction: reparent the two children under the group + the wire.
  store.transaction((tx) => {
    tx.setRelation(innerMath, ChildOf, group);
    tx.setRelation(innerSum, ChildOf, group);
  });
  seedWire(store, mathA, "out", sumB, "in");

  let count = 0;
  world.query(widgetQ).each((b) => {
    count += b.count;
  });
  return count;
}

// --- boot --------------------------------------------------------------------

export interface BootOptions {
  /** Viewport element the host styles. Default: `#app`. */
  readonly container?: HTMLElement;
  /** Autosave sink. Default: localStorage. */
  readonly storage?: NodeboardStorage;
  /**
   * false → HEADLESS: skip the React mount, grid, rAF loop, broadcast relay,
   * autosave, ResizeObserver, and the toolbar. Engine/session/seed/nav still
   * wire. Default true (the browser app).
   */
  readonly mount?: boolean;
}

export interface BootHandle {
  readonly world: World;
  readonly engine: Engine;
  readonly session: DocSession;
  readonly stack: ReturnType<typeof installInteractionStack>;
  readonly nav: NestedCanvas;
  /** Widgets present after boot (seeded or restored). */
  readonly widgetCount: number;
  dispose(): void;
}

export async function boot(options: BootOptions = {}): Promise<BootHandle> {
  const mount = options.mount !== false;

  const appEl = options.container ?? document.getElementById("app");
  if (appEl === null) throw new Error("node-board: no container (pass opts.container or add #app).");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);
  const planes = createPlanes(host); // P1 content + P3 lifted

  // Frame the seeded scene.
  const zoom = 0.8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  world.setResource(Camera, { x: -vw / 2 / zoom, y: -vh / 2 / zoom, zoom, gesturing: false });

  const measure = (): void => {
    const rect = appEl.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    world.setResource(Viewport, { w: rect.width || vw, h: rect.height || vh, dpr });
  };
  measure();
  let resizeObserver: ResizeObserver | undefined;
  if (mount && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(appEl);
  }

  // Commit seam: recording sink (telemetry) tee'd with the late-bound doc sink.
  const recording = createRecordingCommitSink();
  const sinkRef: { target?: CommitSink } = {};
  const teeSink: CommitSink = {
    commit(intent) {
      recording.commit(intent);
      sinkRef.target?.commit(intent);
    },
  };
  const stack = installInteractionStack(engine, { sink: teeSink });
  writeRuntimeResource(world, ActiveTool, { id: "select" });

  const runtime = installWidgetRuntime(engine);

  // Nested canvas: the membership stamper is already installed by the widget
  // runtime (design-004 §7); we add ONLY navIntegrity (react tick, pre-picking)
  // and own the enter/exit ops. The ops clear + rebuild the shared spatial index
  // through the stack's cache seam.
  const nav = createNestedCanvas(world, {
    index: stack.index,
    clearSpatialCaches: () => stack.clearCaches(),
  });
  engine.addSystems("react", nav.navIntegrity);

  // --- boot the document: restore, quarantine-and-reset, or create fresh ---
  const storage = options.storage ?? createLocalStorageStorage(STORAGE_KEY);
  const restored = await restoreAutosave(world, storage);

  let session: DocSession;
  let quarantineReason: string | undefined;
  if (restored.status === "restored") {
    session = restored.session;
  } else {
    if (restored.status === "quarantined") {
      storage.stashQuarantine(restored.bytes);
      quarantineReason = restored.reason;
      console.warn(`node-board: autosave quarantined — ${restored.reason}; starting fresh.`);
    }
    session = createDocSession(world);
    seedScene(session, world);
  }
  sinkRef.target = session.sink;

  // Project durable entities; equip/cull/mount + membership + spatialSync run
  // in-tick from the first step.
  world.sync();
  let widgetCount = 0;
  world.query(widgetQ).each((b) => {
    widgetCount += b.count;
  });

  let autosave: ReturnType<typeof startAutosave> | undefined;
  if (mount) {
    attachBroadcastRelay(session, { channelName: RELAY_CHANNEL });
    autosave = startAutosave(session, { storage, world });
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => void autosave?.flush());
    }
  }

  // --- reflectors (registration order = flush order) ---
  const domWidgets = createDomWidgetsReflector(
    { contentPlane: planes.content, liftedPlane: planes.lifted },
    world,
    runtime.store,
  );
  engine.registerReflector(createPlaneTransformReflector({ contentPlane: planes.content, liftedPlane: planes.lifted }));
  if (mount) engine.registerReflector(createGridReflector(host));
  // WIRES (P0): renders under content; reads the connect preview off the stack's
  // out-of-ECS buffer. `stack.wirePreview` IS the WirePreviewBuffer (fields align
  // with the reflector's WirePreview by construction), so return it directly.
  engine.registerReflector(createWiresReflector(host, world, { readPreview: () => stack.wirePreview }));
  engine.registerReflector(domWidgets);
  engine.registerReflector(createChromeReflector(host, world, stack.marqueeBuffer));
  engine.registerReflector(createCursorReflector(host, stack.readCursor));

  let docUi: ReturnType<typeof createDocUi> | undefined;
  if (mount && autosave !== undefined) {
    docUi = createDocUi({
      host,
      world,
      session,
      nav,
      autosave,
      widgetCount,
      ...(quarantineReason !== undefined ? { quarantineReason } : {}),
    });
    engine.registerReflector(docUi.reflector);
  }

  // --- ONE React root: StoreContext (durable commits) + NavContext (enter). ---
  const navApi = {
    enter: (container: Entity) => nav.enterContainer(container),
    exit: () => nav.exitContainer(),
  };
  let root: ReturnType<typeof createRoot> | undefined;
  let reactHost: HTMLDivElement | undefined;
  if (mount) {
    reactHost = document.createElement("div");
    reactHost.setAttribute("data-nodeboard-react-root", "");
    document.body.appendChild(reactHost);
    root = createRoot(reactHost);
    root.render(
      <StoreContext.Provider value={session.store}>
        <NavContext.Provider value={navApi}>
          <WidgetRoot world={world} store={runtime.store} hosts={domWidgets} />
        </NavContext.Provider>
      </StoreContext.Provider>,
    );
  }

  const detachAdapter = attachPointerAdapter(host, stack.queue);

  if (mount) {
    engine.enableTelemetry();
    startRafLoop(engine);
  }

  return {
    world,
    engine,
    session,
    stack,
    nav,
    widgetCount,
    dispose() {
      detachAdapter();
      docUi?.detach();
      resizeObserver?.disconnect();
      root?.unmount();
      reactHost?.remove();
      host.dispose();
    },
  };
}
