/**
 * @ice/devtools — strata's first-party tools, engine-flavored (rebuilt
 * 2026-07-13, superseding the M10 hand-rolled 4-tab panel: the standing rule
 * is observers/inspectors WRAP `@vibecook/strata-ecs/tools`, never
 * re-implement them).
 *
 * `attachDevtools(engine)` = strata's observer panel + FPS profiler, plus the
 * engine glue strata cannot know:
 *
 *   DESCRIBE        PrefabId → widget type; recognizers → kind + live phase;
 *                   pointers/ports/wires/peers/chrome labeled as such.
 *   DURABLE TAB     fed from the facade's CURRENT DocSession (docId, converged
 *                   snapshot, attachment baseline) — the getter re-reads per
 *                   poll, so it tracks docs.create/open/join/close live.
 *   EPHEMERAL TAB   fed from an app-provided PresenceSession getter (the
 *                   facade keeps presence private; collab demos pass theirs).
 *   "reflect" LANE  the engine's post-notify reflector flush cost — the one
 *                   frame slice strata's world hooks cannot see — reported
 *                   into the profiler via an onPublish hook reading
 *                   `lastFrame()` telemetry (one frame late by construction:
 *                   publish runs before this frame's reflect).
 *
 *   GPU SLOT        (design-016 K2) the WebGPU desk's frames — the GPU span,
 *                   its passes, draws by kind, pipelines, bind groups,
 *                   uploads, memory — pushed by the host through `gpuFrame`
 *                   as the STRUCTURAL MIRROR `GpuPanelFrame` (gpu-panel.ts:
 *                   devtools cannot import desk; the old GlPanelStats way),
 *                   mounted on the first push; each push also reports the
 *                   host LANES `desk flush`, `encode` and `gpu` beside
 *                   strata's per-system lanes. They are readings side by
 *                   side, not a partition: `desk flush` runs inside `reflect`,
 *                   `encode` inside `desk flush`, and `gpu` on the GPU, in
 *                   parallel with the next frame's CPU — and a frame's GPU
 *                   span lands a frame or two late (its timestamps are read
 *                   back asynchronously), in the frame the report arrives.
 *
 * By default all the tools mount into ONE draggable dock (dock.ts —
 * 2026-07-13, James: "make the 3 tools into one draggable panel"); pass
 * `dock: false` for the classic scattered corners.
 *
 * Reads only, outside the tick (verified-unrestricted); never a reflector,
 * never writes ECS. Nobody imports this package (depcruise-enforced leaf).
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import {
  attachObserver,
  attachProfiler,
  defaultDescribe,
  type DescribeFn,
  type EntityDescription,
  type ObserverDurableSource,
  type ObserverEphemeralSource,
  type ObserverHandle,
  type ObserverOptions,
  type ProfilerHandle,
  type ProfilerOptions,
} from "@vibecook/strata-ecs/tools";
import { createDock, type Dock, type DockOptions, type DockSlotId } from "./dock";
import { createGpuPanel, type GpuPanel, type GpuPanelFrame, type GpuPanelOptions, type GpuPanelStats } from "./gpu-panel";
import {
  CursorVisual,
  Drag,
  GesturePhases,
  GestureSuspended,
  HandleSpec,
  LongPress,
  Pinch,
  Pointer,
  Port,
  PrefabId,
  PresencePeer,
  Tap,
  WheelPan,
  WheelZoom,
  Wire,
  type CanvasEngine,
  type Engine,
  type PresenceSession,
} from "@ice/core";

export interface DevtoolsOpts {
  /** Where the dock (or, with `dock: false`, each panel) mounts (default: document.body). */
  readonly container?: HTMLElement;
  /**
   * ONE draggable dock hosting all three tools (the default). `false` scatters
   * them to their classic fixed corners; an object sets initial placement.
   * The dock mounts lazily with the first tool that needs it.
   */
  readonly dock?: boolean | Pick<DockOptions, "corner" | "title" | "width">;
  /** Observer panel: `false` to omit, or strata passthrough options. */
  readonly observer?: boolean | Pick<ObserverOptions, "defaultTab" | "tab" | "recorderCap">;
  /** Profiler HUD: `false` to omit, or strata passthrough options. */
  readonly profiler?: boolean | Pick<ProfilerOptions, "budgetMs" | "windowSize" | "corner" | "expanded" | "lanes">;
  /** Collab demos: the presence session whose store feeds the ephemeral tab. */
  readonly presence?: () => PresenceSession | null | undefined;
  /** The GPU slot (K2): `false` to omit, or its options (budget, expanded, the host's capture). Mounts lazily on the first `gpuFrame` push. */
  readonly gpu?: boolean | Pick<GpuPanelOptions, "budgetMs" | "expanded" | "capture" | "captureFrames">;
  /** Override entity labeling (default: the engine describe below). */
  readonly describe?: DescribeFn;
}

export interface DevtoolsHandle {
  readonly observer: ObserverHandle | null;
  readonly profiler: ProfilerHandle | null;
  /** Host-cost lane passthrough (paint, decode…); no-op when the profiler is off. */
  lane(name: string, ms: number): void;
  /**
   * Feed one GPU frame (K2 — wire the desk's GPU profiler here: `profiler.subscribe((r) => devtools.gpuFrame(r, profiler.stats()))`).
   * Mounts the GPU slot on the first push and reports the host lanes `desk flush` / `encode` / `gpu`. No-op when `gpu: false`.
   */
  gpuFrame(frame: GpuPanelFrame, stats?: GpuPanelStats): void;
  /** Tear all panels + the telemetry hook down. Idempotent. */
  detach(): void;
}

const COLOR = {
  widget: "#3fb950",
  gesture: "#a371f7",
  pointer: "#58a6ff",
  graph: "#ffa657",
  presence: "#f778ba",
  chrome: "#8b949e",
} as const;

const PHASE_ORDER = ["Active", "Possible", "Recognized", "Pending", "Ended", "Cancelled", "Failed"] as const;

function phaseOf(world: World, e: Entity): string | null {
  // Suspended is a rider OUTSIDE the phase set (a pinch freezes single-pointer
  // recognizers without ending them) — surface it first, it explains "stuck".
  if (world.hasTag(e, GestureSuspended)) return "suspended";
  for (const name of PHASE_ORDER) {
    if (world.hasTag(e, GesturePhases.tags[name])) return name.toLowerCase();
  }
  return null;
}

/**
 * Engine-aware entity labeling for the observer's lists + timeline: identity
 * off ROLE (widget type, recognizer kind + phase, pointer device), not off
 * raw component-name composition. Falls back to strata's defaultDescribe.
 */
export function engineDescribe(world: World, e: Entity): EntityDescription {
  const prefab = world.get(e, PrefabId)?.id;
  if (typeof prefab === "string") return { label: prefab, color: COLOR.widget };

  const kind = world.has(e, Tap)
    ? "tap"
    : world.has(e, LongPress)
      ? "longpress"
      : world.has(e, Pinch)
        ? "pinch"
        : world.has(e, WheelZoom)
          ? "wheelzoom"
          : world.has(e, WheelPan)
            ? "wheelpan"
            : world.has(e, Drag)
              ? "drag"
              : undefined;
  if (kind !== undefined) return { label: kind, color: COLOR.gesture, phase: phaseOf(world, e) };

  if (world.has(e, Pointer)) return { label: `pointer:${world.read(e, Pointer).device}`, color: COLOR.pointer };
  if (world.has(e, Port)) return { label: "port", color: COLOR.graph };
  if (world.hasTag(e, Wire)) return { label: "wire", color: COLOR.graph };
  if (world.hasTag(e, PresencePeer)) return { label: "peer", color: COLOR.presence };
  if (world.has(e, CursorVisual)) return { label: "cursor", color: COLOR.presence };
  if (world.has(e, HandleSpec)) return { label: "handle", color: COLOR.chrome };
  return defaultDescribe(world, e);
}

/** Accepts the facade (durable tab included) or a bare core engine. */
export type DevtoolsEngine = CanvasEngine | Engine;

export function attachDevtools(engine: DevtoolsEngine, opts: DevtoolsOpts = {}): DevtoolsHandle {
  const isFacade = "docs" in engine;
  const core: Engine = isFacade ? engine.engine : engine;
  const world = core.world;

  // Durable tab: only the facade knows the current session; the getter is
  // re-read each poll so it swaps live across doc open/close/join. The store
  // and attachment are the STRUCTURAL mirrors the observer contract documents
  // (docId + snapshot / baseline) — never a sync path.
  const docs = isFacade ? engine.docs : undefined;
  const durable =
    docs === undefined
      ? undefined
      : (): ObserverDurableSource | null => {
          const s = docs.current();
          if (s === undefined) return null;
          return {
            store: s.store as unknown as ObserverDurableSource["store"],
            attachment: s.attachment as unknown as ObserverDurableSource["attachment"],
          };
        };

  const presence = opts.presence;
  const ephemeral =
    presence === undefined
      ? undefined
      : (): ObserverEphemeralSource | null => presence()?.eph ?? null;

  // The dock is created with the first tool that mounts (so all-flags-off
  // attaches stay DOM-free).
  let dock: Dock | null = null;
  const mountIn = (id: DockSlotId): { container?: HTMLElement } => {
    if (opts.dock === false) return opts.container !== undefined ? { container: opts.container } : {};
    if (dock === null) {
      dock = createDock({
        ...(typeof opts.dock === "object" ? opts.dock : {}),
        ...(opts.container !== undefined ? { container: opts.container } : {}),
      });
    }
    return { container: dock.slot(id) };
  };

  const observer =
    opts.observer === false
      ? null
      : attachObserver(world, {
          ...(typeof opts.observer === "object" ? opts.observer : {}),
          ...mountIn("observer"),
          describe: opts.describe ?? engineDescribe,
          ...(durable !== undefined ? { durable } : {}),
          ...(ephemeral !== undefined ? { ephemeral } : {}),
        });

  const profiler =
    opts.profiler === false
      ? null
      : attachProfiler(world, {
          ...(typeof opts.profiler === "object" ? opts.profiler : {}),
          ...mountIn("profiler"),
        });

  // The "reflect" lane: reflector flushes run POST-notify, invisible to
  // strata's in-world hooks. Publish runs before this frame's reflect, so the
  // hook reports the PREVIOUS frame's cost — a one-frame lag a HUD can carry.
  //
  // FIXED 2026-08-15 (petition I14): this read `phaseFlushMicros.get("reflect")`,
  // a map keyed by strata PHASE names — and reflect is not a phase, so the
  // lookup was always undefined and the lane NEVER reported since it shipped.
  // `FrameTelemetry.reflectMicros` is the real source (engine.ts arms the
  // reflector registry's own timing from `enableTelemetry`).
  //
  // The GUEST lanes (petition I14, 2026-08-15): guest work runs between the
  // tick and the publish hooks, so — like reflect — no strata in-world hook can
  // see it, and it was previously invisible to the profiler entirely. One lane
  // per guest, reporting its own last invocation; suspended guests stop
  // reporting rather than flatlining at zero, so a silent lane means "gone",
  // which is exactly what the doctor's row says too.
  let removePublish: (() => void) | undefined;
  if (profiler !== null) {
    core.enableTelemetry();
    removePublish = core.onPublish(() => {
      const us = core.lastFrame()?.reflectMicros;
      if (us !== undefined && us > 0) profiler.lane("reflect", us / 1000);
      for (const g of core.guests.list()) {
        if (g.status === "running" && g.lastMs > 0) profiler.lane(`guest:${g.id}`, g.lastMs);
      }
    });
  }

  let detached = false;
  let gpu: GpuPanel | null = null;
  return {
    observer,
    profiler,
    lane(name, ms) {
      profiler?.lane(name, ms);
    },
    gpuFrame(frame, stats) {
      if (detached || opts.gpu === false) return;
      if (gpu === null) {
        gpu = createGpuPanel({
          ...(typeof opts.gpu === "object" ? opts.gpu : {}),
          ...mountIn("gpu"),
        });
      }
      gpu.push(frame, stats);
      // the host lanes beside strata's per-system ones (side by side, not a partition — the header)
      if (frame.cpu.flush !== null) profiler?.lane("desk flush", frame.cpu.flush);
      profiler?.lane("encode", frame.cpu.encode);
      if (frame.span !== null) profiler?.lane("gpu", frame.span);
    },
    detach() {
      if (detached) return;
      detached = true;
      removePublish?.();
      observer?.dispose();
      profiler?.dispose();
      gpu?.dispose();
      gpu = null;
      dock?.dispose();
      dock = null;
    },
  };
}
