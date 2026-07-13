/**
 * gl-board — the M7 mixed DOM+GL demo (implementation-plan M7). Card-board's
 * boot skeleton (M4 interaction stack + M5 durable spine + M6 widget runtime)
 * PLUS the M7 GL views plane:
 *
 *   createWorld → createEngine → createCanvasHost(container) → createPlanes (P1+P3)
 *   → INSERT the P2 GL-views div between P1 content and P3 lifted (DOM order IS
 *      strata order — §1) → installInteractionStack (late-bound doc sink teed to
 *      a recording sink) → installWidgetRuntime (cull + keep-mounted LRU + mount
 *      store) → restore/quarantine/seed → relay + autosave → reflectors
 *      (planeTransform · grid(P0) · domWidgets(P1/P3) · chrome(P4) · cursor · doc-ui)
 *   → createGLBridge + createGLPointerRouter → ONE React root: the store provider
 *      wraps BOTH <WidgetRoot> (DOM widgets) AND a react-dom portal of
 *      <Canvas><GLViews/></Canvas> into the P2 div → attachPointerAdapter with
 *      the router as `glRoute` → keyboard → rAF loop.
 *
 * This module is SIDE-EFFECT FREE: `boot()` and the seeding helpers are exported
 * for both the browser entry (`main.tsx`) and the headless exit tests. `boot()`
 * takes `mount: false` to run the engine/session/seed path (and the bridge +
 * router + adapter wiring) WITHOUT the browser-only pieces — GL <Canvas>, grid,
 * rAF, relay, autosave, ResizeObserver — so the smoke test can drive it under
 * happy-dom (which has no WebGL) without throwing.
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  type Engine,
  type Entity,
  Position,
  type RelayChannel,
  Size,
  StackZ,
  Viewport,
  type World,
  attachBroadcastRelay,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  defineQuery,
  installInteractionStack,
  installWidgetRuntime,
  restoreAutosave,
  spawnWidget,
  startAutosave,
} from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createChromeReflector,
  createCursorReflector,
  createDomWidgetsReflector,
  createGridReflector,
  createPlaneTransformReflector,
  createPlanes,
  startRafLoop,
} from "@ice/dom";
import { WidgetRoot } from "@ice/react";
import { attachDevtools, type DevtoolsHandle } from "@ice/devtools";
import { type GLBridge, type GLPointerRouter, GLViews, createGLBridge, createGLPointerRouter } from "@ice/r3f";
import { Canvas } from "@react-three/fiber";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { createDocUi } from "./doc-ui";
import { NoteCard } from "./note-card";
import { SpinCube } from "./spin-cube";
import { type GlboardStorage, createLocalStorageStorage } from "./storage";
import { StoreContext } from "./store-context";

const STORAGE_KEY = "ice-glboard/doc";
const RELAY_CHANNEL = "ice-glboard";

const widgetQ = defineQuery([Position, Size, StackZ]);

const GL_CANVAS_STYLE: CSSProperties = { pointerEvents: "none", position: "absolute", inset: 0 };

// Ensure both widget types are registered (import side effect kept honest).
void NoteCard;
void SpinCube;

// --- seeding (each spawn its own paved-road spawnWidget transaction) ---------

/** Spawn one note card (top-left `x,y`). Exported testable. */
export function spawnNoteCard(
  store: DocSession["store"],
  world: World,
  x: number,
  y: number,
  props?: { title?: string; body?: string },
): Entity {
  return spawnWidget(store, world, "note-card", { x, y, ...(props !== undefined ? { props } : {}) });
}

/** Spawn one spin-cube (top-left `x,y`). Exported testable. */
export function spawnSpinCube(
  store: DocSession["store"],
  world: World,
  x: number,
  y: number,
  props?: { color?: string; spinning?: boolean },
): Entity {
  return spawnWidget(store, world, "spin-cube", { x, y, ...(props !== undefined ? { props } : {}) });
}

const NOTE_SEED: ReadonlyArray<{ x: number; y: number; title: string; body: string }> = [
  { x: -520, y: -230, title: "Welcome", body: "Drag anything to move it. Tap a cube's center to toggle its spin." },
  { x: 300, y: -260, title: "Mixed surfaces", body: "DOM cards and GL cubes live on one infinite canvas." },
  { x: -540, y: 120, title: "Native inputs", body: "This textarea is interactive — typing never drags the card." },
  { x: 320, y: 150, title: "One document", body: "Every edit is durable + undoable (⌘Z) and relays across tabs." },
];

const CUBE_SEED: ReadonlyArray<{ x: number; y: number; color: string; spinning: boolean }> = [
  { x: -160, y: -110, color: "#4f8ef7", spinning: true },
  { x: 60, y: 60, color: "#ef6f6f", spinning: true },
  { x: -40, y: -300, color: "#5cc98c", spinning: false },
];

/** Seed a scattered board of note cards + spin-cubes; returns the count. */
export function seedScene(session: DocSession, world: World): number {
  for (const n of NOTE_SEED) spawnNoteCard(session.store, world, n.x, n.y, { title: n.title, body: n.body });
  for (const c of CUBE_SEED) spawnSpinCube(session.store, world, c.x, c.y, { color: c.color, spinning: c.spinning });
  return NOTE_SEED.length + CUBE_SEED.length;
}

// --- boot --------------------------------------------------------------------

export interface BootOptions {
  /** Viewport element the host styles. Default: `#app`. */
  readonly container?: HTMLElement;
  /** Autosave sink. Default: localStorage. */
  readonly storage?: GlboardStorage;
  /** Injected relay channel (tests); omit → BroadcastChannel via the channel name. */
  readonly channel?: RelayChannel;
  /**
   * false → HEADLESS: skip the React mount, GL <Canvas>, grid (WebGL), rAF loop,
   * broadcast relay, autosave, and ResizeObserver. Engine/session/seed + bridge
   * + router + adapter still wire. Default true (the browser app).
   */
  readonly mount?: boolean;
}

export interface BootHandle {
  readonly world: World;
  readonly engine: Engine;
  readonly session: DocSession;
  readonly bridge: GLBridge;
  readonly router: GLPointerRouter;
  /** Widgets present after boot (seeded or restored). */
  readonly widgetCount: number;
  dispose(): void;
}

export async function boot(options: BootOptions = {}): Promise<BootHandle> {
  const mount = options.mount !== false;

  const appEl = options.container ?? document.getElementById("app");
  if (appEl === null) throw new Error("gl-board: no container (pass opts.container or add #app).");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);
  const planes = createPlanes(host); // P1 content + P3 lifted

  // The P2 GL-views plane: a transparent, pointer-events-none div inserted
  // BEFORE the lifted plane, so DOM order gives P1 content < P2 GL < P3 lifted.
  // The <Canvas> renders into it (below) and the router owns GL hit testing.
  const glPlane = appEl.ownerDocument.createElement("div");
  glPlane.setAttribute("data-gl-plane", "");
  Object.assign(glPlane.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  host.container.insertBefore(glPlane, planes.lifted);

  // Frame the seeded board.
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
  world.setResource(ActiveTool, { id: "select" });

  const runtime = installWidgetRuntime(engine);

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
      console.warn(`gl-board: autosave quarantined — ${restored.reason}; starting fresh.`);
    }
    session = createDocSession(world);
    seedScene(session, world);
  }
  sinkRef.target = session.sink;

  // Project durable entities; equip/cull/mount + spatialSync run in-tick from here.
  world.sync();
  let widgetCount = 0;
  world.query(widgetQ).each((b) => {
    widgetCount += b.count;
  });

  let autosave: ReturnType<typeof startAutosave> | undefined;
  if (mount) {
    if (options.channel !== undefined) {
      attachBroadcastRelay(session, { channelName: RELAY_CHANNEL, channel: options.channel });
    } else {
      attachBroadcastRelay(session, { channelName: RELAY_CHANNEL });
    }
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
  engine.registerReflector(domWidgets);
  engine.registerReflector(createChromeReflector(host, world, stack.marqueeBuffer));
  engine.registerReflector(createCursorReflector(host, stack.readCursor));

  let docUi: ReturnType<typeof createDocUi> | undefined;
  if (mount && autosave !== undefined) {
    docUi = createDocUi({
      host,
      world,
      session,
      autosave,
      widgetCount,
      ...(quarantineReason !== undefined ? { quarantineReason } : {}),
    });
    engine.registerReflector(docUi.reflector);
  }

  // --- the GL seam: bridge (engine↔R3F) + router (event-time GL hit path) ---
  const bridge = createGLBridge(engine, { devAssertRenderWrites: true });
  const router = createGLPointerRouter({ world, bridge, index: stack.index });

  // Declared ahead of the React render below: the GLViews profiling callback
  // closes over it (frames only tick after boot finishes, so it is assigned
  // by the time the first report fires).
  let devtools: DevtoolsHandle | undefined;

  // --- ONE React root: store provider over BOTH DOM widgets AND the GL Canvas.
  // react-dom portals the Canvas into the P2 plane; R3F v9 bridges this DOM
  // context into the Canvas reconciler, so both surfaces share `session.store`.
  let root: ReturnType<typeof createRoot> | undefined;
  let reactHost: HTMLDivElement | undefined;
  if (mount) {
    reactHost = document.createElement("div");
    reactHost.setAttribute("data-glboard-react-root", "");
    document.body.appendChild(reactHost);
    root = createRoot(reactHost);
    root.render(
      <StoreContext.Provider value={session.store}>
        <WidgetRoot world={world} store={runtime.store} hosts={domWidgets} />
        {createPortal(
          <Canvas orthographic frameloop="demand" gl={{ alpha: true }} style={GL_CANVAS_STYLE}>
            <GLViews
              engine={engine}
              bridge={bridge}
              store={runtime.store}
              onFrameStats={(s) => {
                // GL costs → profiler HUD lanes (devtools is always attached
                // on this board, so the lanes are always live).
                devtools?.lane("gl cpu", s.cpuMs);
                if (s.gpuMs > 0) devtools?.lane("gpu", s.gpuMs);
              }}
            />
          </Canvas>,
          glPlane,
        )}
      </StoreContext.Provider>,
    );
  }

  const detachAdapter = attachPointerAdapter(host, stack.queue, {
    glRoute: (kind, x, y, native) => router.route(kind, x, y, native),
  });

  // Devtools: strata's observer panel + FPS/reflect profiler HUD (the profiler is
  // especially useful on this mixed DOM+GL board). Browser-only. A bare core
  // engine (not the facade) → the observer's durable tab idles.
  if (mount) {
    engine.enableTelemetry();
    startRafLoop(engine);
    devtools = attachDevtools(engine);
  }

  return {
    world,
    engine,
    session,
    bridge,
    router,
    widgetCount,
    dispose() {
      devtools?.detach();
      detachAdapter();
      docUi?.detach();
      resizeObserver?.disconnect();
      root?.unmount();
      reactHost?.remove();
      glPlane.remove();
      bridge.uninstall();
      host.dispose();
    },
  };
}
