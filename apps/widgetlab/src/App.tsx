/**
 * widgetlab App — the v1 playground App.tsx on the v3 facade. Structure kept
 * 1:1: demo scene (iOS grid, PITCH 174), dark-mode toggle (persisted), themed
 * dot grid, zoom pill, floating Settings/ECS/Inspector buttons, breadcrumbs,
 * keyboard shortcuts (⌘Z/⇧⌘Z undo/redo · Esc exit container · ⌫ delete).
 *
 * v3 adaptations (deliberate):
 *  - createLayoutEngine → createCanvasEngine + docs.create() — or, under the
 *    widgetlab-desktop Electron shell, docs.join() over the IPC byte channel
 *    (collab/desktop.ts; the room's first peer seeds, everyone else imports).
 *    The seed spawns are {undoable:false} so the user's first ⌘Z is clean
 *    (moodboard rule). Spawn ORDER carries v1's zIndex order (petition 8:
 *    sibling sequence — later spawns append "last", i.e. on top).
 *  - v1's r3fRoot IBL → GL islands are private scenes (design-004); metallic
 *    cards carry their own studio rigs (gl-cards port). No shared Environment.
 *  - v1's GL overlap glow → CSS inset glow in CardShell, driven by the same
 *    --ic-glow-* vars the settings panel tunes.
 *  - EcsDevtools → @ice/devtools attachDevtools (mounted while the ECS button
 *    is active).
 */
import {
  Active,
  Camera,
  Culled,
  GuideLine,
  MeasuredSize,
  Position,
  PrefabId,
  Selected,
  Size,
  SnapConfig,
  SnapSource,
  SnapTarget,
  Viewport,
  Visible,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
  createCanvasEngine,
  defineQuery,
  selectedEntities,
  spawnWidget,
  type CanvasEngine,
  type DocSession,
  type Entity,
} from "@ice/core";
import { attachDevtools, type DevtoolsHandle } from "@ice/devtools";
import { DEFAULT_GRID_CONFIG, type GridConfig } from "@ice/core";
import { ground } from "@ice/ground";
import { GLViews, captureWidgetPreviews, createGLBridge, createGLPointerRouter, type GLBridge, type GLPointerRouter, type GlFrameStats } from "@ice/r3f";
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@ice/react";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { hasDesktopBridge, startDesktopCollab } from "./collab/desktop";
import { installCursorHalo } from "./cursor";
import { WidgetTray } from "./tray/WidgetTray";
import { InspectorPanel, NavigationBreadcrumbs, SettingsPanel } from "./panels";
import type { OverlapGlowConfig, OverlapGlowThemeColors, ThemeColors } from "./panels";
import { WIDGETS } from "./widgets";

// === v1 theme constants (App.tsx verbatim) ===

const DEFAULT_THEME_COLORS: ThemeColors = {
  dotLight: "#BFC4CC",
  dotDark: "#595E66",
  bgLight: "#FAFAFA",
  bgDark: "#171717",
};

const DEFAULT_OVERLAP_GLOW_THEME_COLORS: OverlapGlowThemeColors = {
  glowLight: "#808080",
  glowDark: "#FFFFFF",
  rimLight: "#808080",
  rimDark: "#FFFFFF",
};

/** v1 DEFAULT_OVERLAP_GLOW_CONFIG values ([candidate, target] pairs — CardChrome's var defaults). */
const DEFAULT_OVERLAP_GLOW: OverlapGlowConfig = {
  glowColor: [0.5, 0.5, 0.5],
  glowAlpha: [0.25, 0.45],
  glowSize: [60, 80],
  rimColor: [0.5, 0.5, 0.5],
  rimWidth: 1,
  rimAlpha: [0.3, 0.5],
  rimRadius: 40,
};

function hexToRgb01(hex: string): [number, number, number] {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(s.slice(0, 2), 16) / 255,
    Number.parseInt(s.slice(2, 4), 16) / 255,
    Number.parseInt(s.slice(4, 6), 16) / 255,
  ];
}

function hexToRgb255(hex: string): string {
  const s = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return `${Number.parseInt(s.slice(0, 2), 16)}, ${Number.parseInt(s.slice(2, 4), 16)}, ${Number.parseInt(s.slice(4, 6), 16)}`;
}

// === the demo scene — v1 createDemoScene coordinates verbatim ===

const GX = 50;
const GY = 50;
const PITCH = 174;
const G3X = GX + PITCH * 2 + 19 + 329 + 19; // 765
const G6X = G3X + PITCH * 2 + 40 + 329 + 30; // 1512

/** type id → [x, y, w, h, props?] in v1 spawn (zIndex) order. */
const SCENE: Array<[string, number, number, number, number, Record<string, unknown>?]> = [
  ["clock-card", GX, GY, 155, 155],
  ["battery-card", GX + PITCH, GY, 155, 155],
  ["calendar-card", GX, GY + PITCH, 155, 155, { dateIso: "", nextEvent: "Design review", nextEventTime: "3:30 PM" }],
  ["weather-card", GX, GY + PITCH * 2, 329, 155, { location: "Cupertino", temp: 72, high: 78, low: 60, condition: "sunny" }],
  ["stocks-card", GX, GY + PITCH * 3, 329, 155],
  ["fitness-card", GX, GY + PITCH * 4, 329, 345],
  ["photos-card", GX + PITCH * 2 + 19, GY, 329, 535],
  ["matte-sphere-card", G3X, GY, 155, 155],
  ["crystal-widget", G3X + PITCH, GY, 155, 155],
  ["torus-knot-card", G3X, GY + PITCH, 329, 155],
  ["floating-cube-widget", G3X, GY + PITCH * 2, 329, 155],
  ["gold-knot-card", G3X, GY + PITCH * 3, 329, 345],
  ["debug-resizable", G3X + PITCH * 2 + 40, GY, 260, 180],
  ["card-container", G3X + PITCH * 2 + 40, GY + 220, 329, 345, { title: "Widgets", accent: "#6366F1" }],
  ["card-container", G3X + PITCH * 2 + 40, GY + 220 + 345 + 19, 329, 345, { title: "Saved", accent: "#EC4899" }],
  ["todo-list-card", G6X, GY, 329, 345],
  ["shapes-card", G6X, GY + 345 + 19, 329, 345],
  ["orbit-cube-card", G6X, GY + (345 + 19) * 2, 329, 155],
];

export function createDemoEngine(): CanvasEngine {
  const ce = createCanvasEngine({
    widgets: WIDGETS,
    // snap on (2026-07-16): cards are snap "both"; guides render at P0 (ground).
    // chrome.liftScale mirrors CardShell's lift transform (1.05) so the
    // multi-select union box keeps wrapping a lifted member (2026-07-17).
    settings: {
      zoom: { min: 0.25, max: 3 },
      snap: { enabled: true, thresholdPx: 5 },
      chrome: { liftScale: 1.05 },
    },
  });
  // Desktop shell (widgetlab-desktop, 2026-07-20): the ROOM owns the document —
  // App's collab effect joins it over the IPC byte channel (the first peer in
  // the room seeds via seedDemoScene; every later window/instance imports the
  // base). The plain browser keeps the local-doc boot below.
  if (!hasDesktopBridge()) {
    const session = ce.docs.create();
    seedDemoScene(ce, session);
    ce.world.sync(); // project the durable seeds now (graybox idiom) — queryable before the first frame
  }
  return ce;
}

/**
 * The demo board (the SCENE grid + the node trio), written through
 * `session.store` directly — NOT `ce.ops`: joinDoc's seeder callback runs
 * BEFORE the facade adopts the session (ops would throw "needs a document"
 * there), and the local boot uses the same path so the two stay one seed.
 */
function seedDemoScene(ce: CanvasEngine, session: DocSession): void {
  for (const [type, x, y, w, h, props] of SCENE) {
    spawnWidget(session.store, ce.world, type, { x, y, w, h, undoable: false, ...(props !== undefined ? { props } : {}) });
  }
  // Node trio (2026-07-16): a wire-able signal → filter → scope chain in its
  // own column right of the todo column. Hover a node to materialize its port
  // dots, drag dot-to-dot to connect (ports accept "signal"; the dashed
  // preview goes solid on a compatible target). Two wires pre-seeded.
  const NX = G6X + 329 + 39; // 1880 — the next column in the v1 grid rhythm
  const signal = spawnWidget(session.store, ce.world, "signal-node", { x: NX, y: 50, w: 170, h: 96, undoable: false });
  const filter = spawnWidget(session.store, ce.world, "filter-node", { x: NX + 240, y: 170, w: 170, h: 96, undoable: false });
  const scope = spawnWidget(session.store, ce.world, "scope-node", { x: NX + 480, y: 62, w: 170, h: 96, undoable: false });
  seedWire(session, signal, "out", filter, "in");
  seedWire(session, filter, "out", scope, "in-a");
}

/**
 * Seed one wire between two node widgets — nodeboard's `seedWire` verbatim on
 * a doc session (design-001 §5.3: a `Wire`-tagged entity carrying
 * `WirePorts{from,to}` + the endpoint relations; geometry never stores a port
 * entity).
 */
function seedWire(session: DocSession, from: Entity, fromPort: string, to: Entity, toPort: string): void {
  session.store.transaction(
    (tx) => {
      const wire = tx.spawn({
        components: [
          [PrefabId, { id: "wire" }],
          [WirePorts, { from: fromPort, to: toPort }],
        ],
        tags: [Wire],
      });
      tx.setRelation(wire, WireFrom, from);
      tx.setRelation(wire, WireTo, to);
    },
    { undoable: false }, // seeds — the user's first ⌘Z stays clean (moodboard rule)
  );
}

// === comment box (UE Blueprint, 2026-07-18) ===

/** Curated accents (the lab's card palette) — random pick per C-spawn. */
const COMMENT_PALETTE = ["#6366F1", "#EC4899", "#22C55E", "#F59E0B", "#06B6D4", "#8B5CF6", "#EF4444", "#3B82F6"];

const COMMENT_PAD = 28;
const COMMENT_HEADER = 44;
const COMMENT_GAP = 12; // header → content breathing room

/**
 * C key: wrap the current selection in a comment-card. The comment spawns at
 * the BOTTOM of the frame (order "first" — ONE undoable tx) so members render
 * and pick above it, sized to the selection bbox (measured-when-real sizes)
 * plus header + padding. Random palette accent per spawn.
 */
function spawnCommentAroundSelection(ce: CanvasEngine): void {
  const sel = selectedEntities(ce.world);
  if (sel.length === 0) return;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const e of sel) {
    const p = ce.world.get(e, Position);
    const m = ce.world.get(e, MeasuredSize);
    const s = m !== undefined && m.w > 0 ? m : ce.world.get(e, Size);
    if (p === undefined || s === undefined) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w);
    maxY = Math.max(maxY, p.y + s.h);
    any = true;
  }
  if (!any) return;
  // Strictly below every widget in the frame: sibling place "first" (petition
  // 8 — retires the minZ−1 scan; each new comment prepends under the previous
  // ones too). (The old "z ≤ 0 breaks picking" note was a misdiagnosis — the
  // dead drags were the C/connect keymap collision.)
  const color = COMMENT_PALETTE[Math.floor(Math.random() * COMMENT_PALETTE.length)] as string;
  const comment = ce.ops.spawnWidget("comment-card", {
    x: minX - COMMENT_PAD,
    y: minY - COMMENT_HEADER - COMMENT_GAP,
    w: maxX - minX + COMMENT_PAD * 2,
    h: maxY - minY + COMMENT_HEADER + COMMENT_GAP + COMMENT_PAD,
    order: "first",
    props: { title: "Comment", color },
  });
  ce.ops.setSelection([comment]);
}

/** DEV-only console probe: `window.__iceDebug()` dumps the live snap state. */
function installDebugProbe(ce: CanvasEngine): void {
  const guideQ = defineQuery([GuideLine]);
  const widgetQ = defineQuery([PrefabId]);
  const wireQ = defineQuery([Wire]);
  // Raw engine handle for ad-hoc DEV forensics (headless scripts poke tags).
  (window as unknown as { __ice?: CanvasEngine }).__ice = ce;
  (window as unknown as { __iceDebug?: () => unknown }).__iceDebug = () => {
    const world = ce.world;
    const guides: unknown[] = [];
    world.query(guideQ).each((b) => {
      for (const r of b) guides.push(world.get(b.entity(r), GuideLine));
    });
    const widgets: unknown[] = [];
    world.query(widgetQ).each((b) => {
      for (const r of b) {
        const e = b.entity(r);
        widgets.push({
          e,
          type: world.get(e, PrefabId)?.id,
          pos: world.get(e, Position),
          size: world.get(e, Size),
          selected: world.hasTag(e, Selected),
          snapSource: world.hasTag(e, SnapSource),
          snapTarget: world.hasTag(e, SnapTarget),
          culled: world.hasTag(e, Culled),
          active: world.hasTag(e, Active),
          visible: world.hasTag(e, Visible),
        });
      }
    });
    let wires = 0;
    world.query(wireQ).each((b) => {
      wires += b.count;
    });
    return {
      snapCfg: world.getResource(SnapConfig),
      camera: world.getResource(Camera),
      viewport: world.getResource(Viewport),
      navDepth: ce.nav.depth(),
      guides,
      widgets,
      wires,
    };
  };
}

/**
 * v1's `r3fRoot={<Environment preset="apartment"/>}` equivalent — but
 * DETERMINISTIC: three's built-in RoomEnvironment through PMREM instead of
 * drei's CDN HDR (a slow/blocked fetch left the metallic cards silhouetted —
 * field-verified 2026-07-12). Near-identical neutral studio look, zero
 * network. <GLViews environment> stamps it on every island scene.
 */
function EnvLoader({ onTex }: { onTex: (t: Texture | null) => void }) {
  const gl = useThree((s) => s.gl);
  const tex = useMemo(() => {
    const pmrem = new PMREMGenerator(gl);
    const t = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return t;
  }, [gl]);
  useEffect(() => {
    onTex(tex);
    return () => onTex(null);
  }, [tex, onTex]);
  return null;
}

// === chrome bits ===

function ZoomPill({ ce }: { ce: CanvasEngine }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const id = setInterval(() => {
      const z = ce.world.getResource(Camera)?.zoom ?? 1;
      setZoom((prev) => (Math.abs(prev - z) > 1e-4 ? z : prev));
    }, 100);
    return () => clearInterval(id);
  }, [ce]);
  const zoomBy = (f: number) => ce.ops.zoomTo((ce.world.getResource(Camera)?.zoom ?? 1) * f);
  return (
    <div className="absolute top-4 right-16 z-50 flex h-10 items-center overflow-hidden rounded-full bg-white shadow-lg dark:bg-neutral-800">
      <button
        type="button"
        onClick={() => zoomBy(0.8)}
        className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title="Zoom out"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => ce.ops.zoomTo(1)}
        onDoubleClick={() => ce.ops.zoomToFit()}
        className="flex h-10 w-14 items-center justify-center text-sm font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
        title="Click: reset to 100% · Double-click: zoom to fit"
        aria-label={`Current zoom: ${Math.round(zoom * 100)}%`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoomBy(1.25)}
        className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}

const fabCls = (active: boolean) =>
  `absolute z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors ${
    active
      ? "bg-neutral-800 text-white dark:bg-white dark:text-neutral-800"
      : "bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
  }`;

export function App() {
  const ce = useMemo(() => createDemoEngine(), []);
  // DEV probe in an EFFECT, not inside createDemoEngine: StrictMode double-runs
  // the memo factory, and a factory-installed probe can close over the
  // ORPHANED twin engine (same seeds, zero frames — no equip tags, 0×0
  // viewport; cost us a debugging detour 2026-07-16). Effects see the
  // committed ce only.
  useEffect(() => {
    if (import.meta.env.DEV) installDebugProbe(ce);
  }, [ce]);
  // Desktop collab (widgetlab-desktop, 2026-07-20): join the switchboard room
  // from an EFFECT — the memo factory's StrictMode orphan twin must never touch
  // the bridge (its onMessage handler is single replace-on-set; an orphan's
  // join would steal the committed engine's channel — collab/desktop.ts header).
  useEffect(() => {
    if (!hasDesktopBridge()) return;
    return startDesktopCollab(ce, (session) => seedDemoScene(ce, session));
  }, [ce]);
  // Natural boot framing (2026-07-18, James: "do zoom to fit, but with a
  // upper and bottom cap"): frame the seeded board once the viewport has
  // been measured and membership has stamped the first tick — frameContent
  // returns false until both exist, so poll briefly and stop on success.
  useEffect(() => {
    if (ce.ops.frameContent()) return;
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (ce.ops.frameContent() || tries > 40) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [ce]);
  const [showSettings, setShowSettings] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showEcs, setShowEcs] = useState(false);
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ic-dark-mode");
      if (saved !== null) return saved === "true";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  const [gridConfig, setGridConfig] = useState<GridConfig>({ ...DEFAULT_GRID_CONFIG });
  const [themeColors, setThemeColors] = useState<ThemeColors>(DEFAULT_THEME_COLORS);
  const [overlapGlow, setOverlapGlow] = useState<OverlapGlowConfig>(DEFAULT_OVERLAP_GLOW);
  const [overlapGlowThemeColors, setOverlapGlowThemeColors] = useState<OverlapGlowThemeColors>(
    DEFAULT_OVERLAP_GLOW_THEME_COLORS,
  );

  // --- GL root: bridge + router + P2 plane arrive in onReady; glRoute delegates
  // via ref. glRef keeps the whole set so we can tear it down — onReady fires
  // from InfiniteCanvas's mount effect, so a StrictMode double-mount would
  // otherwise stack a stale bridge (reflector + world observer) and a stale
  // plane div (glboard disposes the same set in its boot handle's dispose()).
  const routerRef = useRef<GLPointerRouter | null>(null);
  const glRef = useRef<{ bridge: GLBridge; router: GLPointerRouter; plane: HTMLDivElement } | null>(null);
  const [gl, setGl] = useState<{ bridge: GLBridge; plane: HTMLDivElement } | null>(null);
  const [envTex, setEnvTex] = useState<Texture | null>(null);
  const glRoute = useCallback(
    (kind: "down" | "move" | "up" | "cancel", x: number, y: number, e: PointerEvent) => {
      const router = routerRef.current;
      if (router === null) return false;
      const handled = router.route(kind, x, y, e);
      // Moves carry the rich verdict: the router's hover-time overInteractive
      // feeds the pointer's OverInteractive tag (cursor-halo dot over the
      // orbit cube / claimed shapes, same telegraph as DOM interactives).
      return kind === "move" ? { handled, overInteractive: router.overInteractive() } : handled;
    },
    [],
  );
  const disposeGl = useCallback(() => {
    const prev = glRef.current;
    if (prev === null) return;
    prev.bridge.uninstall(); // unregisters the render reflector + world observer
    prev.plane.remove();
    glRef.current = null;
    routerRef.current = null;
  }, []);
  // Cursor halo (2026-07-18): the pointerlab morph as an OS-cursor accent —
  // ring on canvas, zoomed-in ring over cards, solid dot over internal
  // interactives (the opt-out telegraph). Same StrictMode discipline as GL:
  // dispose the prior mount's install before wiring a fresh one.
  const haloRef = useRef<(() => void) | null>(null);
  const disposeHalo = useCallback(() => {
    haloRef.current?.();
    haloRef.current = null;
  }, []);
  const onReady = useCallback(
    (handle: InfiniteCanvasHandle) => {
      disposeHalo();
      haloRef.current = installCursorHalo(ce, handle.host.container);
      disposeGl(); // drop a prior mount's set before wiring a fresh one
      const bridge = createGLBridge(ce.engine);
      // DEV-only forensics twin of __ice — headless scripts inspect islands.
      (window as unknown as { __iceBridge?: GLBridge }).__iceBridge = bridge;
      const router = createGLPointerRouter({ world: ce.world, bridge, index: ce.stack.index });
      routerRef.current = router;
      const plane = handle.host.container.ownerDocument.createElement("div");
      plane.style.cssText = "position:absolute;inset:0;pointer-events:none;"; // P2: display-only (router owns GL hits)
      // P2 sits UNDER the lifted plane (P3) and chrome — glboard's insertion
      // point; appending last would stack GL over dragged widgets/chrome.
      handle.host.container.insertBefore(plane, handle.planes.lifted);
      glRef.current = { bridge, router, plane };
      setGl({ bridge, plane });
    },
    [ce, disposeGl, disposeHalo],
  );
  useEffect(() => disposeGl, [disposeGl]);
  useEffect(() => disposeHalo, [disposeHalo]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ic-dark-mode", String(dark));
  }, [dark]);

  // GL tray previews (design-005 §2 P2): the r3f capture pipeline runs in
  // IDLE time — never on the boot path (the "cached after first capture"
  // contract). The environment is a FACTORY, built ON the capture renderer:
  // PMREM textures don't cross renderers (no CPU image — the main canvas's
  // envTex reads black there), so the capture mirrors EnvLoader instead.
  // Skip-if-captured + coalescing live in the capturer, so StrictMode
  // double-fires cost nothing.
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const kick = (): void => {
      captureWidgetPreviews({
        environment: (gl) => new PMREMGenerator(gl).fromScene(new RoomEnvironment(), 0.04).texture,
      }).catch((e) => console.warn("[widgetlab] GL preview capture failed — tray tiles keep their fallback.", e));
    };
    const idleId = w.requestIdleCallback?.(kick, { timeout: 4000 });
    const timerId = idleId === undefined ? window.setTimeout(kick, 1500) : undefined;
    return () => {
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

  // --canvas-bg from theme (v1); the glow CSS vars feed CardShell's inset glow.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--canvas-bg", dark ? themeColors.bgDark : themeColors.bgLight);
    // Union-box corner radius = CardShell RADIUS (world px; the P4 chrome
    // reflector zoom-scales it) — the group box wraps rounded cards.
    root.style.setProperty("--ic-selection-radius", "22px");
    root.style.setProperty("--ic-glow-color", hexToRgb255(dark ? overlapGlowThemeColors.glowDark : overlapGlowThemeColors.glowLight));
    root.style.setProperty("--ic-glow-size-c", `${overlapGlow.glowSize[0]}px`);
    root.style.setProperty("--ic-glow-size-t", `${overlapGlow.glowSize[1]}px`);
    root.style.setProperty("--ic-glow-alpha-c", String(overlapGlow.glowAlpha[0]));
    root.style.setProperty("--ic-glow-alpha-t", String(overlapGlow.glowAlpha[1]));
  }, [dark, themeColors, overlapGlow, overlapGlowThemeColors]);

  const effectiveGrid = useMemo<Partial<GridConfig>>(
    () => ({ ...gridConfig, dotColor: hexToRgb01(dark ? themeColors.dotDark : themeColors.dotLight) }),
    [gridConfig, dark, themeColors],
  );

  // Keyboard shortcuts. <InfiniteCanvas> already installs the engine default
  // keymap (packages/react/src/keymap.ts) — ⌘Z undo, ⇧⌘Z redo, ⌫/Delete
  // deleteSelection (all skipping editable targets), and Esc →
  // cancelActiveGestures. A second window listener for any of those would fire
  // them TWICE (preventDefault does not stop the engine's listener; undo would
  // step back two edits). The only piece the default keymap lacks is the
  // nav-specific "Esc exits the current container when nested", so that is all
  // this handler adds. The else-branch cancel is left to the keymap (keymap.ts
  // line 79), and the editable-target guard mirrors keymap.ts isEditableTarget
  // (line 42) so Esc inside a widget input never jumps out of the container.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target)) return;
      if (ce.nav.depth() > 0) {
        e.preventDefault();
        ce.ops.exitContainer();
      }
    };
    // C — wrap the selection in a comment box (UE Blueprint, 2026-07-18).
    // CAPTURE phase + stopPropagation: the engine keymap binds "c" to the
    // CONNECT tool (tool shortcuts v/h/c) on window bubble — letting both
    // fire silently flipped the tool, and every later widget drag routed to
    // connect (gates.movable false): the whole board stopped dragging. With
    // a selection C means COMMENT and the keymap never sees it; with none,
    // C falls through and stays the connect-tool shortcut.
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if ((e.key !== "c" && e.key !== "C") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (selectedEntities(ce.world).length === 0) return; // fall through → connect tool
      e.preventDefault();
      e.stopPropagation();
      spawnCommentAroundSelection(ce);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", onKeyDownCapture, true);
    };
  }, [ce]);

  // ECS devtools while the button is active (v1's EcsDevtools panel slot).
  // The FACADE goes in (not ce.engine): the strata observer's durable tab
  // tracks docs.current() live only through it. The handle also rides a ref
  // so the GL profiling callback below can feed the profiler HUD's lanes.
  const devtoolsRef = useRef<DevtoolsHandle | null>(null);
  useEffect(() => {
    if (!showEcs) return;
    const d = attachDevtools(ce);
    devtoolsRef.current = d;
    return () => {
      devtoolsRef.current = null;
      d.detach();
    };
  }, [showEcs, ce]);

  // GL frame profiling → profiler HUD lanes ("gl cpu" = the whole compositor
  // pass on the main thread; "gpu" = summed render-call GPU time, 0 where
  // timer queries are unsupported). Only wired while the ECS panel is open —
  // GLViews skips all measurement when the prop is absent.
  const onGlStats = useCallback((s: GlFrameStats) => {
    const dt = devtoolsRef.current;
    if (dt === null) return;
    dt.lane("gl cpu", s.cpuMs);
    if (s.gpuMs > 0) dt.lane("gpu", s.gpuMs);
    dt.glStats(s); // the full GL panel: renderer counts, VT census, LOD bands, culls
  }, []);

  // The P0 ground layer (grid + wires + snap guides, one WebGPU canvas) —
  // memoized: a new factory identity re-boots the canvas mount effect.
  const groundFactory = useMemo(() => ground(), []);

  // Widget tray open state lives HERE because the canvas itself reacts: the
  // reference design's recede — the whole board eases to 0.98 while the
  // sheet is up. (The tray's handoff math ratio-corrects container coords,
  // so the transient scale never skews engine picks.)
  const [trayOpen, setTrayOpen] = useState(false);

  return (
    <div className="h-screen w-screen" style={{ background: "var(--canvas-bg)" }}>
      {/* The recede (reference design): the board eases to 0.98 while the
          widget sheet is up. The tray proxy is body-level fixed — unaffected. */}
      <div
        className="h-full w-full transition-transform"
        style={{
          transform: trayOpen ? "scale(0.98)" : "scale(1)",
          transitionDuration: "600ms",
          transitionTimingFunction: "cubic-bezier(0.25, 1, 0.3, 1)",
        }}
      >
      <InfiniteCanvas
        engine={ce}
        ground={groundFactory}
        grid={effectiveGrid}
        glRoute={glRoute}
        onReady={onReady}
        className="h-full w-full"
      >
        {/* Canvas pointerEvents none is LOAD-BEARING (glboard precedent):
            without it the R3F canvas swallows every pointer event over the
            whole viewport — DOM widgets lose hover/click while the engine
            keeps working via container bubbling (field report 2026-07-12). */}
        {gl !== null &&
          createPortal(
            <Canvas
              orthographic
              frameloop="never"
              gl={{ alpha: true, antialias: false }}
              style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
            >
              <EnvLoader onTex={setEnvTex} />
              <GLViews
                engine={ce.engine}
                bridge={gl.bridge}
                store={ce.runtime.store}
                environment={envTex}
                {...(showEcs ? { onFrameStats: onGlStats } : {})}
              />
            </Canvas>,
            gl.plane,
          )}
      </InfiniteCanvas>
      </div>

      <NavigationBreadcrumbs engine={ce} />
      <ZoomPill ce={ce} />

      {/* The bottom toolbar ⇄ widget tray (Clean Up moved into it — the
          reference design consolidates actions there). Deferred-spawn drags:
          tiles hand off to ops.insertByDrag only once they leave the sheet. */}
      <WidgetTray ce={ce} open={trayOpen} onOpenChange={setTrayOpen} />

      {/* Dark mode toggle */}
      <button
        type="button"
        onClick={() => setDark((d) => !d)}
        className="absolute top-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full shadow-lg transition-colors bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {dark ? "☀" : "☾"}
      </button>

      <button type="button" onClick={() => setShowSettings((s) => !s)} className={`${fabCls(showSettings)} bottom-4 left-4`} title="Settings">
        ⚙
      </button>
      <button type="button" onClick={() => setShowEcs((s) => !s)} className={`${fabCls(showEcs)} bottom-4 right-16`} title="ECS Editor">
        ▦
      </button>
      <button type="button" onClick={() => setShowInspector((s) => !s)} className={`${fabCls(showInspector)} bottom-4 right-4`} title="Inspector">
        ✎
      </button>

      {showSettings && (
        <SettingsPanel
          engine={ce}
          gridConfig={gridConfig}
          onGridChange={setGridConfig}
          themeColors={themeColors}
          onThemeColorsChange={setThemeColors}
          overlapGlow={overlapGlow}
          onOverlapGlowChange={setOverlapGlow}
          overlapGlowThemeColors={overlapGlowThemeColors}
          onOverlapGlowThemeColorsChange={setOverlapGlowThemeColors}
          stressWidgetType="clock-card"
          onClose={() => setShowSettings(false)}
        />
      )}
      {showInspector && <InspectorPanel engine={ce} onClose={() => setShowInspector(false)} />}
    </div>
  );
}
