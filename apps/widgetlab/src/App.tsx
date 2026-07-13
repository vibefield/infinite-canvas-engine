/**
 * widgetlab App — the v1 playground App.tsx on the v3 facade. Structure kept
 * 1:1: demo scene (iOS grid, PITCH 174), dark-mode toggle (persisted), themed
 * dot grid, zoom pill, floating Settings/ECS/Inspector buttons, breadcrumbs,
 * keyboard shortcuts (⌘Z/⇧⌘Z undo/redo · Esc exit container · ⌫ delete).
 *
 * v3 adaptations (deliberate):
 *  - createLayoutEngine → createCanvasEngine + docs.create(); the seed spawns
 *    are {undoable:false} so the user's first ⌘Z is clean (moodboard rule).
 *    Spawn ORDER carries v1's zIndex order (fractional StackZ stacks later
 *    spawns on top).
 *  - v1's r3fRoot IBL → GL islands are private scenes (design-004); metallic
 *    cards carry their own studio rigs (gl-cards port). No shared Environment.
 *  - v1's GL overlap glow → CSS inset glow in CardShell, driven by the same
 *    --ic-glow-* vars the settings panel tunes.
 *  - EcsDevtools → @ice/devtools attachDevtools (mounted while the ECS button
 *    is active).
 */
import { Camera, createCanvasEngine, type CanvasEngine } from "@ice/core";
import { attachDevtools, type DevtoolsHandle } from "@ice/devtools";
import { DEFAULT_GRID_CONFIG, type GridConfig } from "@ice/dom";
import { GLViews, createGLBridge, createGLPointerRouter, type GLBridge, type GLPointerRouter, type GlFrameStats } from "@ice/r3f";
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@ice/react";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PMREMGenerator, type Texture } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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
    settings: { zoom: { min: 0.25, max: 3 }, snap: { enabled: false } },
  });
  ce.docs.create();
  for (const [type, x, y, w, h, props] of SCENE) {
    ce.ops.spawnWidget(type, { x, y, w, h, undoable: false, ...(props !== undefined ? { props } : {}) });
  }
  ce.world.sync(); // project the durable seeds now (graybox idiom) — queryable before the first frame
  return ce;
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
    (kind: "down" | "move" | "up" | "cancel", x: number, y: number, e: PointerEvent) =>
      routerRef.current?.route(kind, x, y, e) === true,
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
  const onReady = useCallback(
    (handle: InfiniteCanvasHandle) => {
      disposeGl(); // drop a prior mount's set before wiring a fresh one
      const bridge = createGLBridge(ce.engine);
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
    [ce, disposeGl],
  );
  useEffect(() => disposeGl, [disposeGl]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ic-dark-mode", String(dark));
  }, [dark]);

  // --canvas-bg from theme (v1); the glow CSS vars feed CardShell's inset glow.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--canvas-bg", dark ? themeColors.bgDark : themeColors.bgLight);
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
  }, []);

  return (
    <div className="h-screen w-screen" style={{ background: "var(--canvas-bg)" }}>
      <InfiniteCanvas
        engine={ce}
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
              frameloop="demand"
              gl={{ alpha: true }}
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

      <NavigationBreadcrumbs engine={ce} />
      <ZoomPill ce={ce} />

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
