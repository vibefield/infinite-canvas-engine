/**
 * Card-board demo entry — "the v1 playground reborn" (implementation-plan M6).
 *
 * The FULL M4 interaction stack + M5 durable spine (like graybox) PLUS the M6
 * widget runtime:
 *
 *   createWorld → createEngine → createCanvasHost(#app) → createPlanes (P1 + P3)
 *   → installInteractionStack (late-bound doc sink teed to a recording sink)
 *   → installWidgetRuntime (cull + keep-mounted LRU + mount store)
 *   → restoreAutosave: restored ⇒ use it · quarantined ⇒ stash + fresh · empty ⇒
 *      fresh session + 12 seeded TodoCards
 *   → attachBroadcastRelay ("ice-cardboard") + startAutosave
 *   → reflectors (registration order): planeTransform · grid(P0) · domWidgets(P1/P3)
 *      · chrome(P4) · cursor · doc-ui
 *   → WidgetRoot mounted via createRoot on a sibling div (portals widget React
 *      content INTO the domWidgets host elements; the store context carries the
 *      durable store to each card for commits)
 *   → pointer adapter → keyboard (⌘Z/⇧⌘Z/Esc) → rAF loop.
 *
 * Seeding: each card is spawned with the paved-road `spawnWidget` — a per-card
 * undoable transaction (not one `undoable:false` batch). Consequence: the first
 * ⌘Z after a fresh boot removes the last seeded card. Acceptable for the demo;
 * on reload the cards restore from the doc and the undo history starts empty.
 */
import {
  ActiveTool,
  Camera,
  type CommitSink,
  type DocSession,
  Position,
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
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createDocUi } from "./doc-ui";
import { createLocalStorageStorage } from "./storage";
import { CardStoreContext, type ColorName, TodoCard } from "./todo-card";

const STORAGE_KEY = "ice-cardboard/doc";
const RELAY_CHANNEL = "ice-cardboard";

const cardQ = defineQuery([Position, Size, StackZ]);

/** Seed 12 TodoCards in a grid, each its own paved-road spawnWidget transaction. */
function seedCards(session: DocSession, world: World): number {
  const titles = [
    "Groceries", "Reading", "Weekend trip", "Chores",
    "Work sprint", "Ideas", "Garden", "Bugs to fix",
    "Practice", "Health", "Recipes", "Gifts",
  ];
  const colors: ColorName[] = ["yellow", "blue", "green", "pink"];
  const cols = 4;
  const gapX = 280;
  const gapY = 240;
  const offX = ((cols - 1) * gapX) / 2;
  const offY = ((Math.ceil(titles.length / cols) - 1) * gapY) / 2;
  titles.forEach((title, i) => {
    const x = (i % cols) * gapX - offX;
    const y = Math.floor(i / cols) * gapY - offY;
    spawnWidget(session.store, world, "todo-card", {
      x,
      y,
      props: {
        title,
        color: colors[i % colors.length],
        items: [
          { text: "first task", done: false },
          { text: "second task", done: i % 2 === 0 },
        ],
      },
    });
  });
  return titles.length;
}

async function boot(): Promise<void> {
  // Ensure the widget type is registered (import side effect kept honest).
  void TodoCard;

  const appEl = document.getElementById("app");
  if (appEl === null) throw new Error("cardboard demo: #app element not found");

  const world = createWorld();
  const engine = createEngine(world);
  const host = createCanvasHost(appEl);
  const planes = createPlanes(host); // P1 content + P3 lifted

  // Frame the seeded grid.
  const zoom = 0.8;
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

  // Widget runtime: cull + keep-mounted LRU + the mount store WidgetRoot consumes.
  const runtime = installWidgetRuntime(engine);

  // --- boot the document: restore, quarantine-and-reset, or create fresh ---
  const storage = createLocalStorageStorage(STORAGE_KEY);
  const restored = await restoreAutosave(world, storage);

  let session: DocSession;
  let quarantineReason: string | undefined;
  if (restored.status === "restored") {
    session = restored.session;
  } else {
    if (restored.status === "quarantined") {
      storage.stashQuarantine(restored.bytes);
      quarantineReason = restored.reason;
      console.warn(`cardboard: autosave quarantined — ${restored.reason}; starting fresh.`);
    }
    session = createDocSession(world);
    seedCards(session, world);
  }
  sinkRef.target = session.sink;

  // Project durable entities; the equip/cull/mount systems run in-tick from here.
  world.sync();
  let cardCount = 0;
  world.query(cardQ).each((b) => {
    cardCount += b.count;
  });

  attachBroadcastRelay(session, { channelName: RELAY_CHANNEL });
  const autosave = startAutosave(session, { storage, world });
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => void autosave.flush());
  }

  // Reflectors — registration order is flush order.
  const domWidgets = createDomWidgetsReflector(
    { contentPlane: planes.content, liftedPlane: planes.lifted },
    world,
    runtime.store,
  );
  engine.registerReflector(createPlaneTransformReflector({ contentPlane: planes.content, liftedPlane: planes.lifted }));
  engine.registerReflector(createGridReflector(host));
  engine.registerReflector(domWidgets);
  engine.registerReflector(createChromeReflector(host, world, stack.marqueeBuffer));
  engine.registerReflector(createCursorReflector(host, stack.readCursor));
  const docUi = createDocUi({
    host,
    world,
    session,
    autosave,
    cardCount,
    ...(quarantineReason !== undefined ? { quarantineReason } : {}),
  });
  engine.registerReflector(docUi.reflector);

  // The React widget content layer: one root, portals into the host elements.
  const reactHost = document.createElement("div");
  reactHost.setAttribute("data-cardboard-react-root", "");
  document.body.appendChild(reactHost);
  const root = createRoot(reactHost);
  root.render(
    createElement(
      CardStoreContext.Provider,
      { value: session.store },
      createElement(WidgetRoot, { world, store: runtime.store, hosts: domWidgets }),
    ),
  );

  attachPointerAdapter(host, stack.queue);
  engine.enableTelemetry();
  startRafLoop(engine);
}

void boot().catch((err) => {
  console.error("cardboard demo failed to boot:", err);
});
