/**
 * Gray-box demo entry — the FULL M4 interaction stack PLUS the M5 durable spine
 * wired end-to-end (design-005 §6.5–6.6).
 *
 *   createWorld → createEngine → createCanvasHost(#app)
 *   → installInteractionStack (late-bound doc sink teed to a recording sink)
 *   → restoreAutosave (localStorage): restored ⇒ use it · quarantined ⇒ stash
 *     the corrupt bytes + start fresh (the M5 never-brick exit path) · empty ⇒
 *     fresh session + durable scene seed
 *   → attachBroadcastRelay ("ice-graybox") — two tabs converge live
 *   → startAutosave — debounced envelope writes, deferred mid-gesture
 *   → plane / gray-box / cursor / HUD / doc-UI reflectors → pointer adapter → rAF
 *
 * Interaction is unchanged from M4 (select tool: tap selects, drag moves,
 * empty-canvas drag marquees; space/middle/touch pan; wheel zoom). NEW: the
 * scene is DURABLE (500 boxes committed in one transaction), so a move commits
 * and syncs to a second tab; Cmd-Z / Shift-Cmd-Z undo/redo; Esc cancels a
 * gesture; the top-right panel shows undo availability + autosave state.
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  Viewport,
  attachBroadcastRelay,
  createDocSession,
  createEngine,
  createRecordingCommitSink,
  createWorld,
  installInteractionStack,
  restoreAutosave,
  startAutosave,
} from "@ice/core";
import {
  attachPointerAdapter,
  createCanvasHost,
  createCursorReflector,
  createGrayboxReflector,
  createPlaneTransformReflector,
  startRafLoop,
} from "@ice/dom";
import { attachDevtools } from "@ice/devtools";
import { createDocUi } from "./doc-ui";
import { installHarnessHotkeys } from "./harness";
import { createHudReflector } from "./hud";
import { equipSceneBoxes, spawnSceneDurable } from "./scene";
import { createLocalStorageStorage } from "./storage";

const STORAGE_KEY = "ice-graybox/doc";
const RELAY_CHANNEL = "ice-graybox";

async function boot(): Promise<void> {
  const appEl = document.getElementById("app");
  if (appEl === null) throw new Error("graybox demo: #app element not found");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);

  // Frame the seeded scene (centered on the origin) into the viewport.
  const zoom = 0.3;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  world.setResource(Camera, { x: -vw / 2 / zoom, y: -vh / 2 / zoom, zoom, gesturing: false });

  const measure = (): void => {
    const rect = appEl.getBoundingClientRect();
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    world.setResource(Viewport, { w: rect.width, h: rect.height, dpr });
  };
  measure();
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(appEl);

  // The commit seam: a recording sink feeds the HUD tally; the real doc-backed
  // sink is late-bound (the session needs the world; the stack needs a sink at
  // install). The tee sends every intent to both (durable.test fly-back idiom).
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

  // --- boot the document: restore, quarantine-and-reset, or create fresh ---
  const storage = createLocalStorageStorage(STORAGE_KEY);
  const restored = await restoreAutosave(world, storage);

  let session: DocSession;
  let boxCount = 0;
  let quarantineReason: string | undefined;

  if (restored.status === "restored") {
    session = restored.session;
  } else {
    if (restored.status === "quarantined") {
      storage.stashQuarantine(restored.bytes); // park the corrupt save; never brick boot
      quarantineReason = restored.reason;
      console.warn(`graybox: autosave quarantined — ${restored.reason}; starting fresh.`);
    }
    session = createDocSession(world);
    // Plan-letter default is 10k (M3 exit scale); ?n=500 keeps the two-tab
    // full-snapshot relay snappy on slow machines until M9's update-mode relay.
    const n = Number(new URLSearchParams(location.search).get("n")) || 10_000;
    boxCount = spawnSceneDurable(session, world, { count: n });
  }
  sinkRef.target = session.sink;

  // Project the durable entities (spawned or restored) and equip the runtime
  // capability tags they don't carry in the document.
  world.sync();
  const equipped = equipSceneBoxes(world);
  if (restored.status === "restored") boxCount = equipped;

  // Live two-tab sync + debounced persistence.
  attachBroadcastRelay(session, { channelName: RELAY_CHANNEL });
  const autosave = startAutosave(session, { storage, world });
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => void autosave.flush());
  }

  const plane = createPlaneTransformReflector(host);
  const graybox = createGrayboxReflector(host);
  engine.registerReflector(plane);
  engine.registerReflector(graybox);
  engine.registerReflector(createCursorReflector(host, stack.readCursor));
  engine.registerReflector(createHudReflector({ engine, host, plane, graybox, sink: recording }));
  const docUi = createDocUi({ engine, host, world, session, autosave, boxCount, ...(quarantineReason !== undefined ? { quarantineReason } : {}) });
  engine.registerReflector(docUi.reflector);

  attachPointerAdapter(host, stack.queue);
  installHarnessHotkeys(engine, { plane, graybox }, stack.queue);

  engine.enableTelemetry();
  startRafLoop(engine);

  // Devtools: strata's observer panel + FPS/reflect profiler HUD. Fire-and-forget
  // boot (no dispose seam), so the handle stays attached for the page's lifetime.
  // A bare core engine (not the facade) → the observer's durable tab idles.
  attachDevtools(engine);
}

void boot().catch((err) => {
  console.error("graybox demo failed to boot:", err);
});
