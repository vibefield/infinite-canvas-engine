/**
 * `createCanvasEngine` — THE published construction path (design-005 §4).
 *
 * Construction wires: world + engine + the FULL interaction stack + the
 * widget runtime + nested canvas + settings resources, doc-less. A document
 * attaches later through `engine.docs.*` (doc-attached remains the default
 * POSTURE: `docs.create()` is the first call of every editor app) — the
 * commit seam is a FORWARDING sink whose target swaps per session, so the
 * stack never rebuilds across doc open/close.
 *
 * `ops.*` is the catalog of engine-owned write paths (design-005 §4 table):
 * app handlers call ops between frames (design-002 §3); each op is one
 * transaction / one resource write / one tag sweep. Nothing here adds a
 * write path that didn't already exist — ops BIND existing primitives to
 * the current session.
 *
 * Budgets: the frame preview's (children, bytes). Port budgets remain reviewed
 * constants (RUNTIME_BUDGETS) in v1 — recorded. `keepMounted` and `fboBytes`
 * left at design-015 D5b with the mount LRU and the GL ledger.
 */
import type { Entity, Resource, World } from "@vibecook/strata-ecs";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import { fitCamera, zoomAtPoint } from "@ice/kernel";
import {
  canvasIdentityOf,
  canvasPackId,
  type CanvasCatalogContribution,
  type CanvasType,
} from "../canvas/define-canvas-type";
import {
  bindEngineCatalog,
  compileEngineCatalog,
  type EngineCatalog,
} from "../canvas/engine-catalog";
import {
  createPlacementAuthority,
  type PlacementAuthority,
} from "../canvas/placement";
import {
  CanvasIntentScope,
  CanvasSession,
  createCanvasSessionController,
  type CanvasSessionValue,
} from "../canvas/session";
import type {
  CanvasRuntimeExtension,
  FrameBehavior,
} from "../canvas/extensions";
import type { FrameProjection } from "../canvas/frame-projection";
import {
  installCanvasRuntimeExtensions,
  type CanvasRuntimeExtensionHost,
} from "../canvas/runtime-extension-host";
import {
  installFrameBehaviors,
  type FrameBehaviorHost,
} from "../canvas/frame-behavior-host";
import {
  collectCanvasDiagnostics,
  type CanvasDiagnostic,
  type CanvasDiagnosticSnapshot,
} from "../canvas/diagnostics";
import {
  createFramePreviewStore,
  FRAME_PREVIEW_DEFAULT_BYTES,
  FRAME_PREVIEW_DEFAULT_CHILDREN,
  type FramePreviewStore,
} from "../canvas/frame-preview";
import {
  createPresentationTransitionCoordinator,
  type PresentationPlane,
  type PresentationTransitionCoordinator,
} from "../canvas/presentation-transition";
import type { CanvasCatalogSection } from "../canvas/define-canvas-type";
import {
  ActiveTool,
  BoardRoot,
  Camera,
  CameraLimits,
  ChildOf,
  ChromeSettings,
  Container,
  GestureSettings,
  InsertGhost,
  Locked,
  PointerSettings,
  Position,
  Selectable,
  Size,
  SnapConfig,
  StageMode,
  TransformTween,
  Viewport,
  Wire,
  ZoomThroughSettings,
} from "../catalog";
import { Active, Visible } from "../catalog/camera-derived";
import {
  createBehaviorRuntime,
  type BehaviorPresence,
  type BehaviorRuntime,
  type BehaviorSession,
} from "../behavior/runtime";
import type { AnyBehaviorDef } from "../behavior/types";
import { createEngine, type Engine } from "../engine/engine";
import type { FrameControl } from "../engine/frame-control";
import { isMidGesture } from "../interaction/gesture-status";
import type { CommitIntent, CommitSink } from "../engine/commit-sink";
import { guardedTransaction, retargetTweensToDoc } from "../guards/guarded-tx";
import { writeRuntimeResource } from "../guards/resource-writer";
import { installInteractionStack, type InteractionStack } from "../interaction/install";
import { createNestedCanvas, currentNavFrame, type NavOpts, type NestedCanvas } from "../nav/nested-canvas";
import { NavIntent } from "../nav/nav-geometry";
import { cancelActiveGestures } from "../ops/gestures";
import { Held, HeldIntent, HeldTool, HeldView, TrayIntent } from "../catalog/desk";
import { heldEntity } from "../systems/held";
import { arrangeWidgets, type ArrangeOpts } from "../ops/arrange";
import { insertByDrag, type InsertByDragOpts } from "../ops/insert";
import { cascadeDestroy } from "../ops/cascade";
import { clearSelection, selectedEntities, setSelection } from "../ops/selection";
import { closeTray, trayHung } from "../ops/tray";
import { installWidgetRuntime, type WidgetRuntime } from "../widget/mount-store";
import { spawnWidget, type SpawnWidgetOpts } from "../widget/spawn";
import { setWidgetProps } from "../widget/set-props";
import { trayTakeProps, WidgetEquipped, type WidgetType } from "../widget/define-widget";
import { registerBuiltinTools, type Tool } from "../tools/define-tool";
import { PrefabId } from "../schema/prefab";
import { createDocSession, openDocSession, type DocSession, type DocSessionOpts, type OpenDocResult } from "../doc/doc-kit";
import type { CommitExtender } from "../doc/doc-commit-sink";
import { gateVerdict } from "../doc/version-gate";
import { joinDoc, type JoinDocOpts, type JoinResult } from "../doc/bootstrap";
import type { ByteChannel } from "../doc/channels";
import { startAutosave, type Autosave, type AutosaveOpts, type AutosaveStorageWrite } from "../doc/autosave";
import { attachPresence, type PresenceOpts, type PresenceSession } from "../presence/presence-kit";
import { installPresence } from "../presence/remote-cursors";
import type { EngineGpu } from "../surface/gpu-device";
import {
  CAMERA_DEFAULTS,
  CHROME_DEFAULTS,
  FIT_DEFAULTS,
  GESTURE_DEFAULTS,
  POINTER_DEFAULTS,
  SNAP_DEFAULTS,
  type WheelMode,
  ZOOM_THROUGH_DEFAULTS,
} from "../settings/defaults";

export interface CanvasEngineOpts {
  /** Registered widget types (definition happens at defineWidget; this list is validated). */
  readonly widgets?: readonly { readonly type: string }[];
  /** Registered tools (definition happens at defineTool; validated). */
  readonly tools?: readonly Tool[];
  /** Explicit Canvas SDK definitions. Supplying any typed field enables typed mode. */
  readonly canvasTypes?: readonly CanvasType[];
  /** New-document root only; existing documents retain their durable identity. */
  readonly rootCanvas?: CanvasType;
  /** Presentation-only fallback for unknown/incompatible document semantics. */
  readonly presentationFallback?: CanvasType;
  /** Presentation-only sections merged deterministically at compilation. */
  readonly catalogContributions?: readonly CanvasCatalogContribution[];
  /** Governed current-frame runtime definitions compiled by this engine. */
  readonly canvasRuntimeExtensions?: readonly CanvasRuntimeExtension[];
  /** Governed view-independent semantic frame definitions compiled by this engine. */
  readonly frameBehaviors?: readonly FrameBehavior[];
  /** Bounded read-only instance-preview projections compiled by this engine. */
  readonly frameProjections?: readonly FrameProjection[];
  /**
   * Behaviors this engine runs (design-009). Definition is the import
   * side-effect; listing them here COMPILES and installs them — a behavior that
   * is defined but never registered costs nothing and does nothing, which is
   * what makes "a plugin declared it" and "this engine runs it" separable.
   */
  readonly behaviors?: readonly AnyBehaviorDef[];
  /** Generic guest breaker routing for hosts that use the published facade. */
  readonly onGuestFault?: (id: string, error: unknown) => void;
  /**
   * A reflector that threw (design-015 D7): the flush contains it — that frame is skipped — and routes it here (default:
   * `console.error`). A host that counts its faults (apps/desk's `window.__desk.faults`, the rigs' "no page errors") passes it.
   */
  readonly onReflectorFault?: (name: string, error: unknown) => void;
  readonly onGuestNotice?: (message: string) => void;
  /** Behavior-specific routing preserves hook and entity provenance. The two
   *  pairs are COMPLEMENTARY, not alternatives: a fault that also strikes the
   *  breaker (a thenable hook; throws spanning instances) reaches BOTH the
   *  behavior route and the guest route — pass both, or the guest half of
   *  those events still lands on the console default. */
  readonly onBehaviorFault?: (
    behavior: string,
    hook: string,
    entity: Entity | undefined,
    error: unknown,
  ) => void;
  readonly onBehaviorLog?: (
    behavior: string,
    message: string,
    rest: readonly unknown[],
  ) => void;
  readonly budgets?: {
    /** Portal-preview limits may be lowered from 128 children / 256 KiB. */
    readonly framePreviewChildren?: number;
    readonly framePreviewBytes?: number;
  };
  readonly settings?: {
    /**
     * The CameraLimits clamp. The desk's is infinite: `{ min: 1e-8, max: 1e8 }`
     * (design-015 §9) — every camera path holds finite and invertible there.
     */
    readonly zoom?: { readonly min?: number; readonly max?: number };
    /**
     * GestureSettings seeds. `wheel` is a plain wheel's job (design-015 §9,
     * D-D11): "pan" (default) or the desk's "zoom" about the pointer by
     * `zoom · exp(−Δ · wheelZoomRate)` (default rate 0.0016, the prototype's).
     */
    readonly gestures?: Partial<Record<Exclude<keyof typeof GESTURE_DEFAULTS, "wheel">, number>> & {
      readonly wheel?: WheelMode;
    };
    readonly pointers?: Partial<Record<keyof typeof POINTER_DEFAULTS, number>>;
    readonly snap?: { readonly enabled?: boolean; readonly thresholdPx?: number };
    /** Selection-chrome knob: liftScale = the app's visual drag-lift scale (the resize handles wrap it). */
    readonly chrome?: { readonly liftScale?: number };
    /**
     * Nav seeds (design-015 §9 — D2b). `zoomThrough`: a wheel zoom that leaves a container's
     * face covering the view by `in` CSS px cuts into it, one that leaves the current frame's
     * face `out` px short cuts back out — off unless `enabled` (the desk's is on); `gate` is the
     * face's short side (CSS px) across which a live inside comes in (a face enters only at 1).
     */
    readonly nav?: {
      readonly zoomThrough?: {
        readonly enabled?: boolean;
        readonly in?: number;
        readonly out?: number;
        readonly gate?: readonly [number, number];
      };
    };
  };
  readonly policy?: {
    /** The gate verdict a "migrate"-classified doc downgrades to when migration is off/fails. */
    readonly versionGate?: "reject" | "readOnly" | "migrate";
  };
  /**
   * The engine's GPU device (design-012 §4; the device door since design-015 D5b): acquire it with
   * `acquireCompositorDevice()` before constructing the engine and pass it here. ONE device per engine
   * (D7): the desk's layer draws with it — `createDeskHost` hands it through the layer context — and never
   * acquires its own, so its `errors()` sees the desk's uncaptured GPU errors; the app owns its end of life.
   * Absent — the common case, and every headless engine — the desk acquires its own device.
   */
  readonly compositorDevice?: EngineGpu;
}

export interface CanvasOps {
  /** cancel active gestures → switch (design-003 §8; the strata-example lesson). */
  setTool(id: string): void;
  spawnWidget(type: string, opts: SpawnWidgetOpts): Entity;
  /**
   * Tray adoption (2026-07-19): DRAFT-spawn a runtime ghost of `type` centered
   * under the pressing pointer and enqueue one synthetic down — the ordinary
   * drag stack takes over (lift, snap, drop targets, folder consume). Release
   * promotes it through ONE `create` tx (selected, one undo step); cancel or a
   * rejected drop flies it back to the tray press point and despawns it with
   * zero undo footprint. Call from the tray tile's `pointerdown` AFTER
   * `stopPropagation()` (the down must not double-land via the adapter).
   */
  insertByDrag(type: string, opts: InsertByDragOpts): Entity;
  /**
   * THE TRAY'S OWN TAKE, LAID (petition I37 — a host's keyboard path through the pegboard: its arrows move `focusTray`, its ⏎ lays):
   * what a specimen dragged off the board makes, with no drag — the type at its natural size, made with what its entry says one taken
   * carries (`trayTakeProps`), CENTRED on `at` (a world point of the current frame), in ONE transaction (one undo step), selected;
   * and the board folds as a handed take's does (`closeTray`). Only a type the board hangs now (`trayHung` — the frame takes it, the
   * renderer draws it, the drawer shows its category); refused (undefined) for any other and while an object is in hand. Throws as
   * `spawnWidget` does (no document, a read-only one). Laid in the current frame, never consumed by a container under the point —
   * a drop's consume is the drag's.
   */
  layFromTray(type: string, at: { readonly x: number; readonly y: number }): Entity | undefined;
  /** Validated prop update: Standard-Schema-checked, json serialized, ONE tx (2026-07-13 review). */
  setWidgetProps(entity: Entity, props: Readonly<Record<string, unknown>>): void;
  deleteSelection(): void;
  /** Twin spawns offset +16/+16; the clones become the selection. */
  duplicateSelection(): Entity[];
  setSelection(ids: readonly Entity[], mode?: "replace" | "add" | "toggle"): void;
  clearSelection(): void;
  selectAll(): void;
  /** Sibling-sequence sweep, one tx: the ids to the frame top/bottom (petition 8). */
  reorder(ids: readonly Entity[], mode: "top" | "bottom"): void;
  /**
   * Tape widgets down, or lift the tape (design-015 §5.1, *Marks on the Mat*
   * Q-e): writes the durable `Locked` tag on every id that is a widget of the
   * current frame whose state differs, in ONE transaction (one undo step; no
   * transaction at all when nothing changes). A taped widget is never moved or
   * resized by a gesture and the marquee passes over it; it stays selectable,
   * pickable and openable. Refuses on a read-only document like every write op.
   */
  setLocked(ids: readonly Entity[], locked: boolean): void;
  /**
   * Desktop-style Clean Up (kernel packLayout): tidy reading-order rows, one
   * undo step, 240ms glide (durationMs: 0 snaps). Scope: ids > selection ≥2 >
   * current nav frame. Returns the movers (empty = already tidy).
   */
  arrange(opts?: ArrangeOpts): Entity[];
  zoomToFit(ids?: readonly Entity[]): void;
  /**
   * The natural DEFAULT framing (2026-07-18): zoom-to-fit the current
   * frame's widgets inside the FIT_DEFAULTS band (never past 100%, never
   * below 50%, ∩ settings.zoom) — same band as the folder arrival camera.
   * Returns false (camera untouched) until a real viewport AND content
   * exist, so boot code can retry. zoomToFit stays the uncapped explicit
   * "show me everything".
   */
  frameContent(): boolean;
  zoomTo(zoom: number, anchor?: { x: number; y: number }): void;
  panTo(x: number, y: number): void;
  enterContainer(container: Entity, opts?: NavOpts): void;
  exitContainer(opts?: NavOpts): void;
  /** Pop several levels in ONE transition (breadcrumb jumps; design-006 §5). */
  exitTo(targetDepth: number, opts?: NavOpts): void;
  cancelActiveGestures(): void;
  /**
   * Pick an object up into the hand (design-015 §8, D4b): the ONE writer of the runtime `Held`
   * tag (with a fresh `HeldView`) — no camera moves, the renderer lifts the object to its reading
   * size and the desk behind goes out of focus. The object is selected as it is picked up (it
   * stays selected when put down, so ⏎ opens it again) and any live gesture is cancelled. Refused
   * — an Error, like `enterContainer` on a non-container — for an entity that is not a live object
   * of the current frame whose type declares `openable` (its kind has an `open` binding), and while
   * another object is held (put that one down first). Never a document write. The object's tool in
   * hand (`HeldTool`, D3t-a) comes with it: its type's `heldTool` of its props, else its first mode.
   */
  open(entity: Entity): void;
  /** Put the held object down (design-015 §8): `Held`, `HeldView` and `HeldTool` leave; the renderer flies it home. Nothing held: no-op. */
  putDown(): void;
  /**
   * Use a tool of the held bar (design-015 §8; D3t-a — widget/held-tools.ts): a `mode` becomes the held object's ACTIVE
   * tool (`HeldTool` — a runtime write, the user's fact; a `toggle` mode chosen again hands back the one before it), an
   * `action` runs its op once (its transaction, the document's undo or redo). False when nothing is held, the held type
   * names no such tool, or the tool is declared only.
   */
  useHeldTool(id: string): boolean;
  /**
   * Run a SELECTION MENU act (design-016 §5 · K-L2, K8a — widget/menu-actions.ts): the act `id` of the selected objects' types, each
   * declaring type's `run` handed its own selected objects. False when nothing selected declares it (the menu shows an act only when
   * every selected object's type does; an app's key reaches the ones that do).
   */
  runMenuAction(id: string): boolean;
}

export interface CanvasDocs {
  create(opts?: DocSessionOpts): DocSession;
  open(bytes: Uint8Array, opts?: DocSessionOpts): OpenDocResult;
  /**
   * §6.5 bootstrap + optional presence sugar over the same channel. `signal`/
   * `onSession` are facade-owned (supersede + re-bootstrap wiring) — track the
   * live session through `docs.current()`. Rejects if another document is
   * opened while the join is in flight.
   */
  join(
    channel: ByteChannel,
    opts?: Omit<JoinDocOpts, "presence" | "signal" | "onSession"> & {
      readonly presence?: { name: string; color: string };
    },
  ): Promise<JoinResult>;
  current(): DocSession | undefined;
  /**
   * A layer's word on a gesture's landing: `extend` runs INSIDE every gesture's committing transaction (a move, a consume,
   * a resize, a create…), after the gesture's own writes, with the intent that made them — so what it adds is the gesture's
   * undo step, not a second one (the desk sticks a note to a calendar's day this way: the pin and the slot land with the
   * move, one ⌘Z takes the whole drop back). A cancelled gesture commits nothing and so reaches no extender. Registered on
   * the engine, not a session: it serves every document this engine opens until the returned function is called.
   */
  extendCommits(extend: CommitExtender): () => void;
  /** Add compiled widget capability requirements before creating their content. */
  upgradeCapabilities(widgetTypeIds: readonly string[]): boolean;
  /**
   * Attach facade presence to an ALREADY-live document (petition I18) — for
   * hosts that own their document lifecycle (`create()`/`open()` + their own
   * transport) and therefore never call `join({presence})`. Creates the
   * session with the public `attachPresence(world, opts)`, installs the
   * presence publish + remote-cursor systems, and exposes it through
   * `docs.presence()` — which is also the seam the behavior runtime reads, so
   * a registered ephemeral behavior leaves dormancy on the next publish step.
   * The caller wires the transport itself: `presence().wire.apply(bytes)`
   * inbound, `presence().onOutbound(send)` outbound (transport-free core —
   * the standing `PresenceSession` contract). Refuses without a live document
   * and refuses while a presence session is already live (either sugar's).
   * Returns an idempotent, IDENTITY-BOUND inverse: it detaches THIS
   * attachment — leave tombstones flush through still-subscribed outbound
   * before wiring tears down (best-effort per subscriber: one that THROWS,
   * e.g. `ws.send` on a closing socket, forfeits its own delivery and those
   * peers fall back to TTL expiry; route `PresenceOpts.onFault` to observe) —
   * and cannot touch a replacement; `docs.close()` and engine disposal run
   * the same teardown automatically.
   */
  attachPresence(opts: PresenceOpts): () => void;
  /**
   * The live presence session (the `join({presence})` sugar's or
   * `attachPresence`'s), or undefined when doc-less / presence-less. An
   * INSPECTION seam — the devtools dock's ephemeral tab reads
   * `presence().eph` (DevtoolsOpts.presence) — never a sync path; same
   * contract as `DocSession.attachment`. Swaps with the doc lifecycle exactly
   * like `current()`: set by join/attach, cleared by close.
   */
  presence(): PresenceSession | undefined;
  close(): void;
  undo(): boolean;
  redo(): boolean;
  autosave(storage: AutosaveStorageWrite, opts?: Omit<AutosaveOpts, "storage" | "world">): Autosave;
}

/**
 * Stage presentation control (StageMode resource, 2026-07-19): app chrome
 * that covers/recedes the canvas takes a refcounted, NAMED background hold —
 * the disposer pattern makes overlay lifecycles leak-proof (release on
 * unmount), the name makes "why isn't the canvas animating?" answerable.
 * Rendering policy only — input/interactability stays the overlay's concern.
 */
export interface StageControl {
  /** Take a named background hold. Returns an IDEMPOTENT release. */
  background(name: string): () => void;
  isBackgrounded(): boolean;
  /** Live hold names, in take order (debug/devtools). */
  holds(): readonly string[];
}

/** Headless current-canvas surface consumed by trays, keymaps, and adapters. */
export interface CurrentCanvasScope {
  current(): CanvasSessionValue;
  type(): CanvasType;
  catalog(): readonly CanvasCatalogSection[];
  tools(): readonly Tool[];
  /** Stable, locally derived compatibility/policy diagnostics for the attached document. */
  diagnostics(): readonly CanvasDiagnostic[];
  subscribe(onChange: () => void): () => void;
}

export interface CanvasEngine {
  readonly world: World;
  readonly engine: Engine;
  /** Immutable definition authority for this engine instance. */
  readonly catalog: EngineCatalog;
  /** The one semantic authority used by all local placement paths. */
  readonly placement: PlacementAuthority;
  /** Resource-backed current CanvasType/catalog/tool projection. */
  readonly canvas: CurrentCanvasScope;
  /** Demand-driven semantic projections for visible container previews. */
  readonly previews: FramePreviewStore;
  /**
   * The behavior runtime (design-009 §6): attach/detach/has/read for
   * runtime-class behaviors, plus `list()` for devtools and the doctor.
   * DURABLE attachment is deliberately absent — it is a document op and goes
   * through `tx.attach` inside a transaction, so it syncs and undoes.
   */
  readonly behaviors: BehaviorRuntime;
  readonly stack: InteractionStack;
  readonly runtime: WidgetRuntime & { uninstall(): void };
  /** Trusted cross-package retention seam for cut-first canvas transitions. */
  readonly transitions: PresentationTransitionCoordinator;
  readonly nav: NestedCanvas;
  readonly ops: CanvasOps;
  readonly docs: CanvasDocs;
  readonly stage: StageControl;
  /**
   * The frame gate (2026-08-04) — `stage`'s stricter sibling. A background
   * hold is presentation policy over a LIVE world; a freeze stops the host
   * loop outright. Reach for `stage` when chrome RECEDES the canvas, `frame`
   * when chrome COVERS it. Passthrough of `engine.frame`, so there is one gate
   * whether you hold the facade or the raw engine.
   */
  readonly frame: FrameControl;
  /**
   * The app-owned GPU device when the app passed one (design-012 §4); undefined
   * otherwise. `dispose()` deliberately does NOT destroy it: the device outlives
   * layers by design, and its owner is the app that acquired it.
   */
  readonly compositorDevice?: EngineGpu;
  readonly budgets: {
    readonly framePreviewChildren: number;
    readonly framePreviewBytes: number;
  };
  /** step(now) passthrough — the app's rAF loop drives this. */
  step(now: number): void;
  dispose(): void;
}

/** The value a resource declaration carries (the facade's own resource mirror). */
type ResourceValue<R> = R extends Resource<infer S> ? S : never;

/** Sink whose target swaps per doc and stamps one generation-safe intent scope. */
function createForwardingSink(
  world: World,
  current: () => CanvasSessionValue,
): CommitSink & { target: CommitSink | undefined } {
  return {
    target: undefined,
    commit(intent: CommitIntent) {
      const session = current();
      if (session.state !== "attached" || this.target === undefined) return false;
      const captured = world.get(intent.gesture, CanvasIntentScope);
      const targetFrame = captured?.frame ?? session.frame;
      const normalized: CommitIntent = {
        ...intent,
        scope: intent.scope ?? {
          documentEpoch: captured?.documentEpoch ?? session.documentEpoch,
          canvasEpoch: captured?.canvasEpoch ?? session.epoch,
        },
        ...(intent.creates === undefined
          ? {}
          : {
              creates: intent.creates.map((create) => ({
                ...create,
                parent: create.parent ?? targetFrame,
              })),
            }),
      };
      return this.target.commit(normalized);
    },
  };
}

// Query singletons (module scope — defineQuery identity is the cache key).
const selectableWidgetsQ = defineQuery([Position, Size, Selectable, Active, WidgetEquipped]);
/** The current frame's visible widgets — `prepareTransition` finds the objects (no mount entry) here. */
const visibleWidgetsQ = defineQuery([PrefabId, WidgetEquipped, Active, Visible]);
/** Live glides — the history chokepoint's sweep set (petition I15). */
const tweenQ = defineQuery([Position, TransformTween]);
const insertGhostQ = defineQuery([InsertGhost]);

export function createCanvasEngine(opts: CanvasEngineOpts = {}): CanvasEngine {
  registerBuiltinTools();
  const catalog = compileEngineCatalog({
    ...(opts.widgets === undefined ? {} : { widgets: opts.widgets }),
    ...(opts.tools === undefined ? {} : { tools: opts.tools }),
    ...(opts.canvasTypes === undefined ? {} : { canvasTypes: opts.canvasTypes }),
    ...(opts.rootCanvas === undefined ? {} : { rootCanvas: opts.rootCanvas }),
    ...(opts.presentationFallback === undefined
      ? {}
      : { presentationFallback: opts.presentationFallback }),
    ...(opts.catalogContributions === undefined
      ? {}
      : { catalogContributions: opts.catalogContributions }),
    ...(opts.canvasRuntimeExtensions === undefined
      ? {}
      : { canvasRuntimeExtensions: opts.canvasRuntimeExtensions }),
    ...(opts.frameBehaviors === undefined ? {} : { frameBehaviors: opts.frameBehaviors }),
    ...(opts.frameProjections === undefined ? {} : { frameProjections: opts.frameProjections }),
  });

  const world = createWorld();
  const unbindCatalog = bindEngineCatalog(world, catalog);
  let session: DocSession | undefined;
  const canvasSession = createCanvasSessionController(world);
  const packEnabled = (id: string, version: number): boolean =>
    session?.versionReport().docPacks[id] === version;
  const engine = createEngine(world, {
    ...(opts.onGuestFault === undefined ? {} : { onGuestFault: opts.onGuestFault }),
    ...(opts.onReflectorFault === undefined ? {} : { onReflectorFault: opts.onReflectorFault }),
    ...(opts.onGuestNotice === undefined ? {} : { onGuestNotice: opts.onGuestNotice }),
  });
  const runtimeExtensionHost: CanvasRuntimeExtensionHost = installCanvasRuntimeExtensions({
    world,
    engine,
    catalog,
    session: () => canvasSession.current(),
  });
  const frameBehaviorHost: FrameBehaviorHost = installFrameBehaviors({
    world,
    engine,
    catalog,
    session: () => session,
    onAvailabilityChange: () => {
      if (canvasSession.current().state === "attached") canvasSession.bumpCapabilities();
    },
  });
  const placement = createPlacementAuthority({
    world,
    catalog,
    rootCanvasTypeId: () => {
      const report = session?.versionReport();
      return report?.rootIssue === undefined ? report?.rootCanvas?.id : undefined;
    },
    packEnabled,
    canvasWritable: (canvasTypeId) => frameBehaviorHost.isCanvasWritable(canvasTypeId),
  });
  const sink = createForwardingSink(world, () => canvasSession.current());
  /** An object that OPENS (design-015 §8): a live, Active widget of the frame whose type declares `openable`. */
  const isOpenable = (entity: Entity): boolean => {
    if (!world.isAlive(entity) || !world.hasTag(entity, Active)) return false;
    const typeId = world.get(entity, PrefabId)?.id;
    return typeof typeId === "string" && catalog.widget(typeId)?.openable === true;
  };
  /** The object in hand, or undefined. */
  const heldNow = (): Entity | undefined => heldEntity(world);
  /** THE PUT-DOWN (design-015 §8): the fact and the user's view (and tool, D3t-a) leave together; the renderer's flux flies the object home. */
  const putDown = (): void => {
    const held = heldNow();
    if (held === undefined) return;
    if (world.isAlive(held)) {
      if (world.has(held, HeldView)) world.removeComponent(held, HeldView);
      if (world.has(held, HeldTool)) world.removeComponent(held, HeldTool);
      world.removeTag(held, Held);
    }
  };
  /** The held bar's tools of an entity's type (D3t-a) — empty for anything that does not open. */
  const heldToolsOf = (entity: Entity): WidgetType["heldTools"] => {
    const typeId = world.get(entity, PrefabId)?.id;
    return typeof typeId === "string" ? (catalog.widget(typeId)?.heldTools ?? []) : [];
  };
  /** A widget's props as the world holds them now: its groups' cells, flat (D3t-a — what a held tool reads). */
  const propsOf = (entity: Entity): Record<string, unknown> => {
    const typeId = world.get(entity, PrefabId)?.id;
    const type = typeof typeId === "string" ? catalog.widget(typeId) : undefined;
    const props: Record<string, unknown> = {};
    for (const g of type?.groups ?? []) Object.assign(props, (world.get(entity, g.component) as Record<string, unknown> | undefined) ?? {});
    return props;
  };
  /** The mode in hand at a pick-up (D3t-a): the type's `heldTool` of the object's props, else its first mode, else none. */
  const firstHeldTool = (entity: Entity): string => {
    const typeId = world.get(entity, PrefabId)?.id;
    const type = typeof typeId === "string" ? catalog.widget(typeId) : undefined;
    if (type === undefined) return "";
    if (type.heldTool !== undefined) return type.heldTool(propsOf(entity));
    return type.heldTools.find((t) => t.kind === "mode")?.id ?? "";
  };
  const stack = installInteractionStack(engine, {
    sink,
    placement: {
      canIngress: (widgetTypeId, targetContainer) =>
        placement.canIngress(widgetTypeId, targetContainer).ok,
      canPlace: (widgetTypeId, targetFrame) => placement.canPlace(widgetTypeId, targetFrame).ok,
    },
    // the gesture's and the zoom-through's "may this be entered" — the nav's own test (design-015 §9)
    isContainer: (entity) => {
      if (!world.isAlive(entity) || !world.hasTag(entity, Container)) return false;
      const typeId = world.get(entity, PrefabId)?.id;
      return typeof typeId === "string" && catalog.widget(typeId)?.container !== undefined;
    },
    // the double-tap's "may this be picked up" (design-015 §8): its type declares an opening
    isOpenable: (entity) => isOpenable(entity),
  });
  const budgets = {
    framePreviewChildren:
      opts.budgets?.framePreviewChildren ?? FRAME_PREVIEW_DEFAULT_CHILDREN,
    framePreviewBytes: opts.budgets?.framePreviewBytes ?? FRAME_PREVIEW_DEFAULT_BYTES,
  };
  const runtime = installWidgetRuntime(engine);
  const transitions = createPresentationTransitionCoordinator(world, engine, {
    ...(opts.onGuestFault === undefined
      ? {}
      : {
          onFault: (id: string, error: unknown) =>
            opts.onGuestFault?.(`presentation-transition:${id}`, error),
        }),
  });
  const navIdentity = (
    frame: Entity | undefined,
    role: "from" | "to",
  ): { frame: Entity; typeId: string } => {
    const current = canvasSession.current();
    // An integrity pop may observe an already-cleared NavFrame edge. The
    // session still owns the exact departed entity/type until onSwitch runs.
    if (role === "from" && current.state === "attached") {
      if (frame === undefined || frame === current.frame) {
        return { frame: current.frame, typeId: current.typeId };
      }
    }
    if (frame === undefined) {
      return {
        frame: world.getResource(BoardRoot)?.root ?? (0 as Entity),
        typeId: session?.versionReport().rootCanvas?.id ?? "",
      };
    }
    const widgetTypeId = world.get(frame, PrefabId)?.id;
    return {
      frame,
      typeId:
        typeof widgetTypeId === "string"
          ? catalog.canvasForContainer(widgetTypeId)?.id ?? ""
          : "",
    };
  };
  const nav = createNestedCanvas(world, {
    index: stack.index,
    clearSpatialCaches: () => stack.clearCaches(),
    navGeometry: stack.navGeometry,
    isContainer: (entity) => {
      if (!world.isAlive(entity) || !world.hasTag(entity, Container)) return false;
      const typeId = world.get(entity, PrefabId)?.id;
      return typeof typeId === "string" && catalog.widget(typeId)?.container !== undefined;
    },
    beforeSwitch: () => {
      runtimeExtensionHost.invalidate();
      cancelActiveGestures(world);
      putDown();   // the hand lets go at a nav cut (design-015 §8, §9): the chrome belongs to the desk you are on
      stack.queue.drain();
      const ghosts: Entity[] = [];
      world.query(insertGhostQ).each((batch) => {
        for (const row of batch) ghosts.push(batch.entity(row));
      });
      for (const ghost of ghosts) world.destroy(ghost);
      clearSelection(world);
    },
    prepareTransition: (request) => {
      // A canvas type that DECLARES a ground (design-013 C2: a field declaration, not a program
      // id) requires the `ground` plane to prepare — the desk's layer registers the plane's
      // adapter, and without an owner every enter into a folder is a snap. So does a visible
      // OBJECT in the departing frame (design-015 §5.2): found in the world — pre-cut, `Active`
      // is still that frame's membership — each asks for `ground`, the one plane there is (D5b;
      // the `dom` and `gl` planes the mount store's snapshot used to ask for went with it).
      const fromGround = catalog.canvasType(request.fromTypeId)?.presentation?.ground;
      const toGround = catalog.canvasType(request.toTypeId)?.presentation?.ground;
      const required = new Set<PresentationPlane>();
      if (fromGround !== undefined || toGround !== undefined) required.add("ground");
      const widgetOf = (entity: Entity): WidgetType | undefined => {
        const widgetTypeId = world.get(entity, PrefabId)?.id;
        return typeof widgetTypeId === "string" ? catalog.widget(widgetTypeId) : undefined;
      };
      if (!required.has("ground")) {
        world.query(visibleWidgetsQ).each((batch) => {
          for (const row of batch) {
            if (widgetOf(batch.entity(row))?.object !== undefined) required.add("ground");
          }
        });
      }
      return transitions.prepare(
        Object.freeze({
          ...request,
          requiresFullT2: request.fromTypeId !== request.toTypeId,
          requiredPlanes: Object.freeze([...required]),
        }),
      );
    },
    abortTransition: (reason) => transitions.abort(reason),
    transitionIdentity: (fromFrame, toFrame) => {
      const from = navIdentity(fromFrame, "from");
      const to = navIdentity(toFrame, "to");
      return {
        documentEpoch: canvasSession.current().documentEpoch,
        fromFrame: from.frame,
        toFrame: to.frame,
        fromTypeId: from.typeId,
        toTypeId: to.typeId,
      };
    },
    onSwitch: (frame, depth, restoreTool) => {
      cancelActiveGestures(world);
      const targetFrame = frame ?? world.getResource(BoardRoot)?.root;
      if (targetFrame === undefined || !world.isAlive(targetFrame)) {
        transitions.abort("detached");
        canvasSession.detach();
        return;
      }
      const typeId =
        frame === undefined
          ? session?.versionReport().rootCanvas?.id ?? ""
          : (() => {
              const widgetTypeId = world.get(frame, PrefabId)?.id;
              return typeof widgetTypeId === "string"
                ? catalog.canvasForContainer(widgetTypeId)?.id ?? ""
                : "";
            })();
      canvasSession.switchFrame(targetFrame, typeId, depth);
      const legal = canvas.tools();
      const currentTool = world.getResource(ActiveTool)?.id ?? "select";
      const preferred = restoreTool ?? currentTool;
      const nextTool =
        legal.find((tool) => tool.id === preferred) ??
        legal.find((tool) => tool.id === catalog.defaultToolFor(typeId).id) ??
        legal.find((tool) => tool.id === "select") ??
        catalog.tool("select");
      if (nextTool !== undefined && nextTool.id !== currentTool) {
        writeRuntimeResource(world, ActiveTool, { id: nextTool.id });
      }
    },
  });
  engine.addSystems("react", nav.navIntegrity);

  /**
   * The nav op a system asked for INSIDE the tick (design-015 §9, D2b — the double-tap gesture,
   * the zoom-through; `NavIntent`), applied once the tick is over: the ops are structural and
   * run outside it. A `"cut"` states its own re-dressing fact (`NavRedress`) in the op.
   */
  let appliedIntent = 0;
  const applyNavIntent = (): void => {
    const intent = world.getResource(NavIntent);
    if (intent === undefined || intent.epoch === appliedIntent) return;
    appliedIntent = intent.epoch;
    const opts: NavOpts = { transition: intent.transition };
    if (intent.kind === "enter") {
      if (!world.isAlive(intent.target) || !world.hasTag(intent.target, Container)) return;
      const typeId = world.get(intent.target, PrefabId)?.id;
      if (typeof typeId !== "string" || catalog.widget(typeId)?.container === undefined) return;
      nav.enterContainer(intent.target, opts);
    } else if (currentNavFrame(world) !== undefined) {
      nav.exitContainer(opts);
    }
  };
  // on the ENGINE's own after-step hook, not a wrapper round `step`: a host loop (dom/loop.ts) may drive the raw engine
  const removeNavIntent = engine.afterStep(applyNavIntent);

  /**
   * The hand's request a system made INSIDE the tick (design-015 §8, D4b — the double-tap on an openable
   * object, the gesture ways back; `HeldIntent`), applied once the tick is over exactly as the nav's is:
   * `open` when the target still qualifies and nothing else is held, `putDown` whatever is held.
   */
  let appliedHeld = 0;
  const applyHeldIntent = (): void => {
    const intent = world.getResource(HeldIntent);
    if (intent === undefined || intent.epoch === appliedHeld) return;
    appliedHeld = intent.epoch;
    if (intent.kind === "open") {
      if (heldNow() !== undefined || !isOpenable(intent.target)) return;
      ops.open(intent.target);
    } else putDown();
  };
  const removeHeldIntent = engine.afterStep(applyHeldIntent);

  /**
   * The tray's HAND-OFF (design-017 §9; K5b — `TrayIntent`): a copy taken off the pegboard left the drawer inside the tick; once it is
   * over, `ops.insertByDrag` spawns the insert ghost under the same grab point (its `anchor` — no centre-snap), its synthetic down the
   * pointer's, flying home to the specimen's spot on a cancel — made with what the entry says one taken carries (`trayTakeProps`).
   * Refused (a read-only document, a frame that takes no such kind): nothing is spawned, and the renderer, seeing no ghost come, puts
   * the copy back.
   */
  let appliedTray = 0;
  const applyTrayIntent = (): void => {
    const intent = world.getResource(TrayIntent);
    if (intent === undefined || intent.epoch === appliedTray) return;
    appliedTray = intent.epoch;
    const type = intent.type ?? "";
    const entry = catalog.widget(type)?.tray;
    if (entry === undefined) return;
    const props = trayTakeProps(entry);
    try {
      ops.insertByDrag(type, {
        screenX: intent.x, screenY: intent.y, pointerId: intent.pointerId ?? "mouse", device: intent.device, buttons: intent.buttons,
        anchor: { u: intent.u, v: intent.v }, home: { x: intent.homeX, y: intent.homeY }, ...(props !== undefined ? { props } : {}),
      });
    } catch (err) {
      console.warn(`ice: the tray could not hand "${type}" to the desk —`, err instanceof Error ? err.message : err);
    }
  };
  const removeTrayIntent = engine.afterStep(applyTrayIntent);

  // Settings resources (design-005 §4): construction seeds; live-tunable after.
  //
  // THE FACADE OWNS THESE, NOT THE DOCUMENT (D-C4.5, Phase C review). A
  // document close runs `DocSession.close()` → strata `world.reset()`, whose
  // contract clears RESOURCES as well as entities — so every seed below has
  // to be written again on the far side of a close, or a mounted engine comes
  // out of a `docs.create()`/`open()` with no `Viewport` and no `Camera` and
  // neither ground host can build until the next ResizeObserver fire. The
  // values that come back are the LIVE ones, not the construction seeds: the
  // host's box and the user's view are not the document's, and the settings
  // are seeds that a host may have tuned since. `facadeResources` is that
  // mirror — it trails the world and only ever advances on a DEFINED read, so
  // a capture taken after a reset (`docs.join`'s re-bootstrap, where the reset
  // happens inside `joinDoc`) keeps the last good values instead of erasing
  // them.
  const st = opts.settings ?? {};
  const facadeResources: {
    camera: ResourceValue<typeof Camera>;
    viewport: ResourceValue<typeof Viewport>;
    activeTool: ResourceValue<typeof ActiveTool>;
    cameraLimits: ResourceValue<typeof CameraLimits>;
    gestures: ResourceValue<typeof GestureSettings>;
    pointers: ResourceValue<typeof PointerSettings>;
    snap: ResourceValue<typeof SnapConfig>;
    chrome: ResourceValue<typeof ChromeSettings>;
    zoomThrough: ResourceValue<typeof ZoomThroughSettings>;
    stage: ResourceValue<typeof StageMode> | undefined;
  } = {
    camera: { x: 0, y: 0, zoom: 1, gesturing: false },
    viewport: { w: 0, h: 0, dpr: 1 },
    // the ROOT canvas type's default tool is the one in hand at birth (design-015 D7, D-D7-C.2 — `select` when it names none): a
    // preset's root, like the desk's, is what `createCanvasEngine` makes, with no `setTool` after
    activeTool: { id: catalog.defaultToolFor(catalog.rootCanvas.id).id },
    cameraLimits: {
      minZoom: st.zoom?.min ?? CAMERA_DEFAULTS.minZoom,
      maxZoom: st.zoom?.max ?? CAMERA_DEFAULTS.maxZoom,
    },
    gestures: { ...GESTURE_DEFAULTS, ...st.gestures },
    pointers: { ...POINTER_DEFAULTS, ...st.pointers },
    snap: {
      enabled: st.snap?.enabled ?? SNAP_DEFAULTS.enabled,
      thresholdPx: st.snap?.thresholdPx ?? SNAP_DEFAULTS.thresholdPx,
    },
    chrome: {
      liftScale: st.chrome?.liftScale ?? CHROME_DEFAULTS.liftScale,
    },
    zoomThrough: {
      enabled: st.nav?.zoomThrough?.enabled ?? ZOOM_THROUGH_DEFAULTS.enabled,
      in: st.nav?.zoomThrough?.in ?? ZOOM_THROUGH_DEFAULTS.in,
      out: st.nav?.zoomThrough?.out ?? ZOOM_THROUGH_DEFAULTS.out,
      gate0: st.nav?.zoomThrough?.gate?.[0] ?? ZOOM_THROUGH_DEFAULTS.gate[0],
      gate1: st.nav?.zoomThrough?.gate?.[1] ?? ZOOM_THROUGH_DEFAULTS.gate[1],
    },
    // StageMode's truth is the out-of-ECS `stageHolds` map below, so the
    // mirror starts ABSENT: at construction nothing holds and the resource is
    // legitimately unset (every reader defaults to 0). It is captured and
    // restored like the rest once a hold exists — a doc switch under a live
    // overlay must not silently un-freeze the background.
    stage: undefined,
  };
  /** Read the world into the mirror. MUST run before a `world.reset()`. */
  const captureFacadeResources = (): void => {
    facadeResources.camera = world.getResource(Camera) ?? facadeResources.camera;
    facadeResources.viewport = world.getResource(Viewport) ?? facadeResources.viewport;
    facadeResources.activeTool = world.getResource(ActiveTool) ?? facadeResources.activeTool;
    facadeResources.cameraLimits = world.getResource(CameraLimits) ?? facadeResources.cameraLimits;
    facadeResources.gestures = world.getResource(GestureSettings) ?? facadeResources.gestures;
    facadeResources.pointers = world.getResource(PointerSettings) ?? facadeResources.pointers;
    facadeResources.snap = world.getResource(SnapConfig) ?? facadeResources.snap;
    facadeResources.chrome = world.getResource(ChromeSettings) ?? facadeResources.chrome;
    facadeResources.zoomThrough = world.getResource(ZoomThroughSettings) ?? facadeResources.zoomThrough;
    facadeResources.stage = world.getResource(StageMode) ?? facadeResources.stage;
  };
  /** Write the mirror into the world: construction, and after every reset. */
  const seedFacadeResources = (): void => {
    world.setResource(Camera, facadeResources.camera);
    world.setResource(Viewport, facadeResources.viewport);
    world.setResource(ActiveTool, facadeResources.activeTool);
    world.setResource(CameraLimits, facadeResources.cameraLimits);
    world.setResource(GestureSettings, facadeResources.gestures);
    world.setResource(PointerSettings, facadeResources.pointers);
    world.setResource(SnapConfig, facadeResources.snap);
    world.setResource(ChromeSettings, facadeResources.chrome);
    world.setResource(ZoomThroughSettings, facadeResources.zoomThrough);
    if (facadeResources.stage !== undefined) world.setResource(StageMode, facadeResources.stage);
  };
  seedFacadeResources();

  const resolvedCanvasType = (): CanvasType => {
    const current = canvasSession.current();
    if (current.state === "attached") {
      const resolved = catalog.canvasType(current.typeId);
      if (
        resolved !== undefined &&
        packEnabled(canvasPackId(resolved.id), resolved.semanticVersion)
      ) {
        return resolved;
      }
    }
    return catalog.presentationFallback;
  };

  let diagnosticSnapshot: CanvasDiagnosticSnapshot = Object.freeze({
    diagnostics: Object.freeze([]),
  });
  let diagnosticsDirty = false;
  const refreshCanvasDiagnostics = (): boolean => {
    const previous = JSON.stringify(diagnosticSnapshot.diagnostics.map((d) => [d.key, d.code, d.message]));
    diagnosticSnapshot =
      session === undefined
        ? Object.freeze({ diagnostics: Object.freeze([]) })
        : collectCanvasDiagnostics({
            world,
            store: session.store,
            catalog,
            report: session.versionReport(),
          });
    diagnosticsDirty = false;
    const next = JSON.stringify(diagnosticSnapshot.diagnostics.map((d) => [d.key, d.code, d.message]));
    return previous !== next;
  };

  let effectiveSurfaceKey = "";
  let effectiveCatalog: readonly CanvasCatalogSection[] = Object.freeze([]);
  let effectiveTools: readonly Tool[] = Object.freeze([]);
  const rebuildEffectiveSurface = (): void => {
    const current = canvasSession.current();
    const key = `${current.documentEpoch}:${current.epoch}:${current.typeId}`;
    if (key === effectiveSurfaceKey) return;
    effectiveSurfaceKey = key;
    if (current.state !== "attached") {
      effectiveCatalog = Object.freeze([]);
      effectiveTools = Object.freeze(
        catalog
          .toolsFor(catalog.presentationFallback.id)
          .filter((tool) => tool.draw === undefined),
      );
      return;
    }
    const resolved = catalog.canvasType(current.typeId);
    if (resolved === undefined || resolved !== resolvedCanvasType()) {
      effectiveCatalog = Object.freeze([]);
      effectiveTools = Object.freeze(
        catalog
          .toolsFor(catalog.presentationFallback.id)
          .filter((tool) => tool.draw === undefined),
      );
      return;
    }
    effectiveCatalog = Object.freeze(
      catalog.catalogFor(resolved.id).map((section) =>
        Object.freeze({
          ...section,
          items: Object.freeze(
            section.items.filter((widget) =>
              packEnabled(widget.prefab.id, widget.prefab.version ?? 1),
            ),
          ),
        }),
      ),
    );
    effectiveTools = Object.freeze(
      catalog.toolsFor(resolved.id).filter((tool) => {
        const widget = tool.draw === undefined ? undefined : catalog.widget(tool.draw.widgetType);
        return widget === undefined || packEnabled(widget.prefab.id, widget.prefab.version ?? 1);
      }),
    );
  };

  const canvas: CurrentCanvasScope = {
    current: () => canvasSession.current(),
    type: resolvedCanvasType,
    catalog() {
      rebuildEffectiveSurface();
      return effectiveCatalog;
    },
    tools() {
      rebuildEffectiveSurface();
      return effectiveTools;
    },
    diagnostics() {
      return diagnosticSnapshot.diagnostics;
    },
    subscribe: (onChange) => world.reactive.observeResource(CanvasSession, onChange),
  };

  const removeDiagnosticPublish = engine.onPublish(() => {
    if (!diagnosticsDirty) return;
    const changed = refreshCanvasDiagnostics();
    if (changed && canvasSession.current().state === "attached") {
      canvasSession.bumpCapabilities();
    }
  });

  const previews = createFramePreviewStore({
    world,
    catalog,
    session: () => ({
      documentEpoch: canvasSession.current().documentEpoch,
      ...(session === undefined ? {} : { store: session.store }),
    }),
    diagnostics: () => diagnosticSnapshot.diagnostics,
    budgets: {
      children: budgets.framePreviewChildren,
      bytes: budgets.framePreviewBytes,
    },
    ...(opts.onGuestFault === undefined
      ? {}
      : {
          onFault: (id: string, error: unknown) =>
            opts.onGuestFault?.(`frame-projection:${id}`, error),
        }),
  });

  // --- doc lifecycle ---------------------------------------------------------
  let presence: PresenceSession | undefined;
  let sessionVersionUnsub: (() => void) | undefined;
  let uninstallPresence: (() => void) | undefined;
  let joined: JoinResult | undefined; // the room handle — closeDoc must LEAVE, not just close
  let joinAbort: AbortController | undefined; // kills an in-flight join on supersede
  const liveAutosaves = new Set<Autosave>(); // facade-created; stopped at closeDoc

  const requireSession = (op: string): DocSession => {
    if (session === undefined) {
      throw new Error(`ice: ops.${op} needs a document — call engine.docs.create()/open()/join() first.`);
    }
    return session;
  };

  // Read-only is enforced at every SANCTIONED write surface, not only the
  // gesture sink (2026-07-13 review: the sink swap alone let facade ops and
  // undo/redo edit — and broadcast — a version-gated document).
  const requireWritable = (op: string): DocSession => {
    const s = requireSession(op);
    if (
      s.readOnly ||
      gateVerdict(s.versionReport()) !== "ok" ||
      diagnosticsDirty ||
      diagnosticSnapshot.authorityIssue !== undefined
    ) {
      throw new Error(`ice: ops.${op} — the document is read-only (version gate); writes are disabled.`);
    }
    return s;
  };

  const requireCurrentFrame = (op: string): Entity => {
    const current = canvasSession.current();
    if (
      current.state !== "attached" ||
      !world.isAlive(current.frame) ||
      current.typeId.length === 0
    ) {
      throw new Error(`ice: ops.${op} needs an attached, semantically resolved CanvasSession.`);
    }
    return current.frame;
  };

  const assertEditablePlacement = (entity: Entity, op: string): Entity => {
    if (!world.isAlive(entity) || !world.hasTag(entity, Active)) {
      throw new Error(`ice: ops.${op} only accepts entities in the current active CanvasFrame.`);
    }
    const parent = world.getRelation(entity, ChildOf);
    if (parent === undefined) {
      throw new Error(`ice: ops.${op} — entity has no direct CanvasFrame parent.`);
    }
    placement.assertReparent(entity, parent, `ops.${op}`);
    return parent;
  };
  const inCurrentSelectionScope = (entity: Entity): boolean =>
    world.isAlive(entity) &&
    (world.hasTag(entity, Active) || world.hasTag(entity, Wire));

  const versionScope = Object.freeze({
    localPacks: catalog.localPacks(),
    initialPacks: catalog.initialPacks(),
    packDependencies: catalog.packDependencies(),
  });

  const rejectCommit = (message: string): undefined => {
    opts.onGuestNotice?.(`Canvas placement rejected: ${message}`);
    return undefined;
  };

  const commitGuard = (intent: CommitIntent): CommitIntent | undefined => {
    const current = canvasSession.current();
    if (current.state !== "attached") return rejectCommit("no CanvasSession is attached");
    if (
      intent.scope === undefined ||
      intent.scope.documentEpoch !== current.documentEpoch ||
      intent.scope.canvasEpoch !== current.epoch
    ) {
      return rejectCommit("the intent belongs to a stale CanvasSession epoch");
    }
    if (
      session === undefined ||
      session.readOnly ||
      gateVerdict(session.versionReport()) !== "ok" ||
      diagnosticsDirty ||
      diagnosticSnapshot.authorityIssue !== undefined
    ) {
      return rejectCommit("the document capability gate is not writable");
    }
    const root = world.getResource(BoardRoot)?.root;
    const interactiveTarget = (target: Entity): boolean =>
      target === current.frame ||
      (world.hasTag(target, Active) && world.getRelation(target, ChildOf) === current.frame);
    for (const create of intent.creates ?? []) {
      if (create.parent === undefined) return rejectCommit("create has no explicit target frame");
      if (!interactiveTarget(create.parent)) {
        return rejectCommit("create target is outside the gesture's active CanvasFrame");
      }
      const decision =
        create.parent === root
          ? placement.canPlace(create.type, create.parent)
          : placement.canIngress(create.type, create.parent);
      if (!decision.ok) return rejectCommit(decision.message);
    }
    for (const reparent of intent.reparents ?? []) {
      if (!interactiveTarget(reparent.container)) {
        return rejectCommit("reparent target is outside the gesture's active CanvasFrame");
      }
      const decision = placement.validateReparent(reparent.entity, reparent.container);
      if (!decision.ok) return rejectCommit(decision.message);
    }
    for (const order of intent.orders ?? []) {
      if (order.parent !== current.frame) {
        return rejectCommit("sibling order target is not the gesture's active CanvasFrame");
      }
      const decision = placement.validateReparent(order.entity, order.parent);
      if (!decision.ok) return rejectCommit(decision.message);
    }
    const checked = new Set<Entity>();
    for (const write of intent.writes) {
      if (checked.has(write.entity) || world.get(write.entity, PrefabId) === undefined) continue;
      checked.add(write.entity);
      if (!world.hasTag(write.entity, Active)) {
        return rejectCommit("edited widget is no longer active in the gesture's CanvasFrame");
      }
      const parent = world.getRelation(write.entity, ChildOf);
      if (parent === undefined) return rejectCommit("edited widget has no direct frame parent");
      const decision = placement.validateReparent(write.entity, parent);
      if (!decision.ok) return rejectCommit(decision.message);
    }
    return intent;
  };

  // The layers' word on a gesture's landing (`docs.extendCommits`): every session this facade opens fans its gesture
  // transactions through the extenders registered here — a registration outlives the session it was made under.
  const commitExtenders = new Set<CommitExtender>();
  const commitExtend: CommitExtender = (intent, tx) => {
    for (const extend of [...commitExtenders]) extend(intent, tx);
  };

  const scopedDocOpts = (o: DocSessionOpts | undefined): DocSessionOpts => ({
    ...o,
    versionScope,
    rootCanvas: canvasIdentityOf(catalog.rootCanvas),
    commitGuard,
    commitExtend,
    canvasCatalog: catalog,
  });

  const adoptSession = (next: DocSession): DocSession => {
    const alreadyAdopted = session === next;
    session = next;
    sink.target = next.sink;
    if (alreadyAdopted) return next;
    sessionVersionUnsub?.();
    let versionSignature = JSON.stringify(next.versionReport());
    const versionUnsub = next.subscribeRemote(() => {
      // a peer's change lands at the next `world.sync()`: that frame must come (K7a — the loop may be asleep)
      engine.frame.wake("doc");
      diagnosticsDirty = true;
      const report = next.versionReport();
      const signature = JSON.stringify(report);
      if (signature === versionSignature || session !== next) return;
      versionSignature = signature;
      const current = canvasSession.current();
      if (current.state !== "attached") return;
      if (current.depth === 0) {
        canvasSession.switchFrame(current.frame, report.rootCanvas?.id ?? "", 0);
      } else {
        canvasSession.bumpCapabilities();
      }
      const legal = canvas.tools();
      const activeId = world.getResource(ActiveTool)?.id ?? "select";
      if (!legal.some((tool) => tool.id === activeId)) {
        const fallback = legal.find((tool) => tool.id === "select") ?? legal[0];
        if (fallback !== undefined) writeRuntimeResource(world, ActiveTool, { id: fallback.id });
      }
    });
    // …and a LOCAL commit made outside a step (a transaction, an undo, a redo — strata's values land at once, the structure at
    // the next sync): the outbound wire hears every one
    const outboundUnsub = next.store.subscribeOutbound(() => engine.frame.wake("doc"));
    sessionVersionUnsub = () => {
      versionUnsub();
      outboundUnsub();
    };
    const root = world.getResource(BoardRoot)?.root;
    if (root === undefined || !world.isAlive(root)) {
      canvasSession.detach();
    } else {
      canvasSession.attach(root, next.rootCanvas?.id ?? "");
    }
    refreshCanvasDiagnostics();
    previews.rebind();
    return next;
  };

  // ONE presence acquisition + ONE teardown, shared by the two doors (the
  // `join({presence})` sugar and `docs.attachPresence`, petition I18) — the
  // assignment is what the behavior runtime's forwarding reads per publish, so
  // both doors activate ephemeral behaviors identically. Teardown order is
  // load-bearing: systems out FIRST (no publish hook stages a facet into a
  // session mid-leave; the uninstall also reaps the derived remote cursors —
  // ghosts, on a still-open doc), THEN detach (leave tombstones flush through
  // still-subscribed outbound before the session's wiring dies).
  const acquirePresence = (o: PresenceOpts): PresenceSession => {
    // a peer's cursor arriving or aging out is the next frame's (K7a — a sleeping loop wakes for it)
    const p = attachPresence(world, { ...o, onRemote: () => { o.onRemote?.(); engine.frame.wake("presence"); } });
    presence = p;
    uninstallPresence = installPresence(engine, p, {
      keyOf: (e) => session?.store.keyOf(e),
    });
    return p;
  };

  // NEVER throws (review findings 1+4, 0.8.0): teardown must not stop
  // teardown. The fields clear FIRST so the seam pair can't desynchronize
  // under a throw and reentrant close/inverse calls see a settled state; each
  // half is then contained on its own — a host transport throwing inside the
  // leave flush must not abort the room leave, the session close, or the rest
  // of engine disposal behind it.
  const releasePresence = (): void => {
    const uninstall = uninstallPresence;
    const p = presence;
    uninstallPresence = undefined;
    presence = undefined;
    try {
      uninstall?.();
    } catch (err) {
      console.error("[ice] presence uninstall threw — teardown continues", err);
    }
    try {
      p?.detach();
    } catch (err) {
      console.error("[ice] presence detach threw — teardown continues", err);
    }
  };

  const closeDoc = (): void => {
    // BEFORE the close below resets the world: the facade's own resources are
    // not the document's (D-C4.5), so read the live values out first.
    captureFacadeResources();
    // A pending join dies here — left to resolve, it would attach a stale
    // session over whatever the caller opens next.
    joinAbort?.abort(new Error("ice: docs.join superseded — another document was opened while joining."));
    joinAbort = undefined;
    for (const a of [...liveAutosaves]) a.stop(); // before close: no export of a detached session
    liveAutosaves.clear();
    transitions.abort("detached");
    releasePresence();
    sessionVersionUnsub?.();
    sessionVersionUnsub = undefined;
    if (session !== undefined || joined !== undefined) {
      runtimeExtensionHost.invalidate();
      canvasSession.detach();
    }
    joined?.leave(); // leaves the ROOM: channel + outbound unsubs, then closes the session
    joined = undefined;
    session?.close(); // idempotent — a no-op when leave() above already closed it
    session = undefined;
    diagnosticsDirty = false;
    diagnosticSnapshot = Object.freeze({ diagnostics: Object.freeze([]) });
    sink.target = undefined;
    // DocSession.close/reset clears resources; the engine-owned monotone
    // counters live outside ECS and must be republished immediately, and the
    // facade's own seeds re-written with the values captured above (D-C4.5) —
    // a mounted engine keeps its viewport, its camera, its tool, its tuned
    // settings and its stage holds straight through the switch.
    canvasSession.republish();
    previews.rebind();
    seedFacadeResources();
  };

  /**
   * Undo/redo + THE HISTORY CHOKEPOINT (petition I15). Undo does not pass
   * through `guardedTransaction` — it is strata's own local batch — so a glide
   * in flight when ⌘Z lands would otherwise complete at the PRE-undo target and
   * strand the cell: runtime ≠ baseline with nothing banked, divergence that
   * never reconciles and poisons the cell against later remote updates. After
   * the history step, every live tween is retargeted onto its doc truth, so the
   * glide finishes on the undone value and the cell reconverges by landing.
   */
  const historyStep = (which: "undo" | "redo"): boolean => {
    const s = session;
    if (s === undefined) return false;
    const ok = which === "undo" ? s.store.undo() : s.store.redo();
    if (!ok) return false;
    const tweening: Entity[] = [];
    world.query(tweenQ).each((b) => {
      for (const r of b) tweening.push(b.entity(r));
    });
    if (tweening.length > 0) {
      retargetTweensToDoc(world, tweening, (e) => {
        const v = s.store.getComponent(e, Position);
        return v === undefined ? undefined : { x: v.x, y: v.y };
      });
    }
    return true;
  };

  const gatePolicy: DocSessionOpts["onGate"] =
    opts.policy?.versionGate === undefined
      ? undefined
      : (_report, verdict) => (verdict === "migrate" ? (opts.policy?.versionGate ?? verdict) : verdict);

  const docs: CanvasDocs = {
    extendCommits(extend) {
      commitExtenders.add(extend);
      return () => {
        commitExtenders.delete(extend);
      };
    },
    create(o) {
      closeDoc();
      return adoptSession(createDocSession(world, scopedDocOpts(o)));
    },
    open(bytes, o) {
      closeDoc();
      const result = openDocSession(world, bytes, {
        ...(gatePolicy !== undefined ? { onGate: gatePolicy } : {}),
        ...o,
        ...scopedDocOpts(undefined),
      });
      if (result.ok) adoptSession(result.session);
      else canvasSession.republish();
      return result;
    },
    async join(channel, o = {}) {
      closeDoc();
      const ac = new AbortController();
      joinAbort = ac;
      const { presence: presenceOpts, docOpts: requestedDocOpts, ...joinOpts } = o;
      if (presenceOpts !== undefined) {
        acquirePresence({ name: presenceOpts.name, color: presenceOpts.color });
      }
      let result: JoinResult;
      try {
        result = await joinDoc(world, channel, {
          docOpts: scopedDocOpts({
            ...(gatePolicy !== undefined ? { onGate: gatePolicy } : {}),
            ...requestedDocOpts,
          }),
          ...(presence !== undefined ? { presence } : {}),
          ...joinOpts,
          signal: ac.signal,
          // Re-bootstrap swaps the session inside joinDoc (PendingImportError
          // recovery) — re-target the forwarding sink or ops keep committing
          // into the quarantined session.
          onSession: (s) => {
            if (joinAbort !== ac) return; // superseded — a newer doc owns the sink
            if (s !== undefined) {
              adoptSession(s);
            } else {
              transitions.abort("detached");
              canvasSession.detach();
              sessionVersionUnsub?.();
              sessionVersionUnsub = undefined;
              session = undefined; // joinDoc already closed it
              sink.target = undefined;
              canvasSession.republish();
              // That close was a `world.reset()` INSIDE joinDoc, so the
              // facade's own resources are gone here too (D-C4.5). The mirror
              // only advances on a defined read, so it still carries the
              // values from before the re-bootstrap.
              seedFacadeResources();
            }
          },
        });
      } catch (err) {
        // A REJECTED join must not strand the presence session it acquired
        // (review finding 3, 0.8.0): the behavior runtime's seam reads
        // `presence`, not `session`, so a leftover would keep ephemeral
        // behaviors publishing into a room joinDoc already unsubscribed —
        // on a doc-less engine, with no inverse the caller ever received.
        // Release ONLY if this join still owns the flow: on a supersede the
        // newer door's closeDoc released ours already and may own a fresh one.
        if (joinAbort === ac) {
          joinAbort = undefined;
          releasePresence();
        }
        throw err;
      }
      // The await gap: user code in the same task may have opened another doc
      // after our resolve was queued — that newer doc owns the engine now.
      if (joinAbort !== ac) {
        result.leave();
        throw new Error("ice: docs.join superseded — another document was opened while joining.");
      }
      joined = result;
      adoptSession(result.session);
      return result;
    },
    current: () => session,
    upgradeCapabilities(widgetTypeIds) {
      const s = requireWritable("upgradeCapabilities");
      if (joined !== undefined) {
        throw new Error(
          "ice: docs.upgradeCapabilities is unavailable during a live room until peer capability negotiation is attached.",
        );
      }
      const packs: Record<string, number> = {};
      for (const typeId of widgetTypeIds) {
        const requirements = catalog.requirementsForWidget(typeId);
        if (requirements === undefined) {
          throw new Error(`ice: docs.upgradeCapabilities — unknown widget type "${typeId}".`);
        }
        Object.assign(packs, requirements);
      }
      const changed = s.upgradePacks(packs);
      if (changed) {
        refreshCanvasDiagnostics();
        canvasSession.bumpCapabilities();
      }
      return changed;
    },
    attachPresence(o) {
      if (session === undefined) {
        throw new Error(
          "ice: docs.attachPresence needs a live document — call docs.create()/open()/join() first.",
        );
      }
      if (presence !== undefined) {
        throw new Error(
          "ice: docs.attachPresence — a presence session is already live (join({presence}) or a prior attach); detach it (its inverse, or docs.close()) before attaching another.",
        );
      }
      const mine = acquirePresence(o);
      let done = false;
      return () => {
        if (done) return; // idempotent
        done = true;
        // Identity-bound: after close/dispose (which already released) or a
        // replacement attachment, this inverse owns nothing — a stale inverse
        // must never detach someone else's live session.
        if (presence !== mine) return;
        releasePresence();
      };
    },
    presence: () => presence,
    close: closeDoc,
    // Read-only documents must not mutate through history either — undo/redo
    // write the store exactly like an op does.
    undo: () =>
      session === undefined ||
      session.readOnly ||
      gateVerdict(session.versionReport()) !== "ok" ||
      diagnosticsDirty ||
      diagnosticSnapshot.authorityIssue !== undefined
        ? false
        : historyStep("undo"),
    redo: () =>
      session === undefined ||
      session.readOnly ||
      gateVerdict(session.versionReport()) !== "ok" ||
      diagnosticsDirty ||
      diagnosticSnapshot.authorityIssue !== undefined
        ? false
        : historyStep("redo"),
    autosave(storage, o) {
      const s = requireSession("autosave");
      const inner = startAutosave(s, { storage, world, ...o });
      // Track facade-created autosaves: an untracked one outlives closeDoc and
      // its next timer exports the DETACHED old session over the new document's
      // storage (2026-07-13 review).
      const handle: Autosave = {
        flush: () => inner.flush(),
        close: async () => {
          await inner.close();
          liveAutosaves.delete(handle);
        },
        state: () => inner.state(),
        stop: () => {
          liveAutosaves.delete(handle);
          inner.stop();
        },
      };
      liveAutosaves.add(handle);
      return handle;
    },
  };

  // --- the behavior runtime ---------------------------------------------------
  // The session seam is FORWARDING, exactly like the commit sink above: a
  // behavior's `ctx.commit` and its divergence-guarding live writer both have
  // to follow the document across open/close, and the runtime itself must
  // survive that (its instances are per-generation, not per-engine).
  const behaviors = createBehaviorRuntime({
    world,
    engine,
    session: () => session as BehaviorSession | undefined,
    // Presence attaches with `docs.join({presence})` OR `docs.attachPresence`
    // (petition I18) and detaches with the document / the attach inverse, so
    // this reads through per publish: an ephemeral behavior installed before
    // there is a presence session simply lies dormant until there is a peer
    // for it to be — and goes dormant again if the session detaches under it.
    presence: () => presence as BehaviorPresence | undefined,
    ...(opts.onBehaviorFault === undefined ? {} : { onFault: opts.onBehaviorFault }),
    ...(opts.onBehaviorLog === undefined ? {} : { onLog: opts.onBehaviorLog }),
  });
  // The engine registered its own three kind behaviours here first (design-013 D7's
  // `ice:surface.*`, the DOM/GPU choice) until design-015 D5b; an object presents on the
  // desk and nowhere else, so the app's are the only behaviours there are.
  for (const b of opts.behaviors ?? []) behaviors.register(b);

  // --- ops catalog -------------------------------------------------------------
  const widgetQuery = (): Entity[] => {
    const out: Entity[] = [];
    world.query(selectableWidgetsQ).each((b) => {
      for (const r of b) out.push(b.entity(r));
    });
    return out;
  };

  const ops: CanvasOps = {
    setTool(id) {
      const legal = canvas.tools();
      if (!legal.some((tool) => tool.id === id)) {
        throw new Error(`ice: ops.setTool — tool "${id}" is not legal in the current CanvasType.`);
      }
      cancelActiveGestures(world);
      writeRuntimeResource(world, ActiveTool, { id });
    },
    spawnWidget(type, o) {
      const s = requireWritable("spawnWidget");
      const targetFrame = o.parent ?? requireCurrentFrame("spawnWidget");
      placement.assertPlace(type, targetFrame, "ops.spawnWidget");
      const spawned = spawnWidget(s.store, world, type, { ...o, parent: targetFrame });
      // `Active` is DERIVED — `createActiveMembership` (nav/nested-canvas.ts)
      // stamps it inside the tick, and ops run outside the tick, so a widget
      // spawned into the open frame carries no membership until the next
      // `step()`. Every scope-filtered op (setSelection, deleteSelection) would
      // silently drop it in that window, and design-011 §16's `Selected ⇒
      // Active` makes membership the right thing to establish rather than the
      // filter the right thing to loosen. Stamp what the tick would compute for
      // THIS spawn — the entity is a member of `targetFrame` by construction —
      // and leave a spawn into a FOREIGN frame (an explicit `parent`) unstamped
      // so it stays correctly out of scope. `nested-canvas.cutVisibility` writes
      // these same tags from an op for the same reason; the next membership
      // pass re-derives and corrects either way.
      const current = canvasSession.current();
      if (
        current.state === "attached" &&
        targetFrame === current.frame &&
        !world.hasTag(spawned, Active)
      ) {
        world.addTag(spawned, Active);
      }
      return spawned;
    },
    layFromTray(type, at) {
      if (typeof at?.x !== "number" || typeof at.y !== "number" || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
        throw new Error(`ice: ops.layFromTray — the point is ${JSON.stringify(at) ?? String(at)}: { x, y }, a world point of the current frame, two finite numbers.`);
      }
      if (heldNow() !== undefined || !trayHung(world).includes(type)) return undefined;
      const widget = catalog.widget(type);
      const entry = widget?.tray;
      if (widget === undefined || entry === undefined) return undefined;
      // what the drag-off's create carries (l3-behave's promote of the insert ghost): the type, its natural size, the take's props
      const { w, h } = widget.defaultSize;
      const props = trayTakeProps(entry);
      const laid = ops.spawnWidget(type, { x: at.x - w / 2, y: at.y - h / 2, w, h, ...(props !== undefined ? { props } : {}) });
      ops.setSelection([laid]);
      closeTray(world);
      return laid;
    },
    insertByDrag(type, o) {
      // Writable-session gate UP FRONT: the ghost drag would otherwise run
      // beautifully and silently drop its create at commit (read-only sink).
      requireWritable("insertByDrag");
      const targetFrame = requireCurrentFrame("insertByDrag");
      placement.assertPlace(type, targetFrame, "ops.insertByDrag");
      return insertByDrag(world, stack.queue, type, o);
    },
    setWidgetProps(entity, props) {
      const s = requireWritable("setWidgetProps");
      assertEditablePlacement(entity, "setWidgetProps");
      setWidgetProps(s.store, world, entity, props);
    },
    deleteSelection() {
      const s = requireWritable("deleteSelection");
      const doomed = selectedEntities(world).filter(
        (e) => inCurrentSelectionScope(e) && s.store.keyOf(e) !== undefined,
      );
      if (doomed.length === 0) return;
      s.store.transaction((tx) => {
        for (const e of doomed) cascadeDestroy(tx, world, e);
      });
    },
    duplicateSelection() {
      const s = requireWritable("duplicateSelection");
      const sources = selectedEntities(world).filter(
        (e) => world.hasTag(e, Active) && s.store.keyOf(e) !== undefined,
      );
      if (sources.length === 0) return [];
      for (const source of sources) assertEditablePlacement(source, "duplicateSelection");
      const clones: Entity[] = [];
      guardedTransaction(s.store, world, (tx) => {
        for (const src of sources) {
          const type = world.get(src, PrefabId)?.id;
          const widget = typeof type === "string" ? catalog.widget(type) : undefined;
          if (widget === undefined) continue;
          const pos = world.get(src, Position) ?? { x: 0, y: 0 };
          const size = world.get(src, Size);
          const overrides: [unknown, unknown][] = [
            [Position, { x: pos.x + 16, y: pos.y + 16 }],
            ...(size !== undefined ? [[Size, { ...size }] as [unknown, unknown]] : []),
          ];
          for (const g of widget.groups) {
            const v = world.get(src, g.component);
            if (v !== undefined) overrides.push([g.component, { ...(v as Record<string, unknown>) }]);
          }
          const clone = tx.spawnPrefab(widget.prefab, overrides as never);
          // The clone joins its source's sequence right above it (petition 8;
          // the +16/+16 twin reads as "on top of" its source — and an edge-less
          // clone would be unordered entirely, the pre-flip latent bug). A
          // source without an edge (legacy doc) has nothing to inherit.
          const parent = world.getRelation(src, ChildOf);
          if (parent !== undefined) {
            placement.assertPlace(widget.type, parent, "ops.duplicateSelection");
            tx.setRelation(clone, ChildOf, parent, { after: src });
          }
          clones.push(clone);
        }
      });
      // The clones land at the next sync; select them once alive.
      setSelection(world, clones.filter((e) => world.isAlive(e)), "replace");
      return clones;
    },
    setSelection(ids, mode = "replace") {
      setSelection(
        world,
        ids.filter(inCurrentSelectionScope),
        mode,
      );
    },
    clearSelection() {
      clearSelection(world);
    },
    selectAll() {
      setSelection(world, widgetQuery(), "replace");
    },
    reorder(ids, mode) {
      const s = requireWritable("reorder");
      // Sibling-sequence sweep, one tx (petition 8): "top" appends each id to
      // its sequence tail — painted last = topmost, so later ids finish higher;
      // "bottom" prepends, later ids finish lower. Exactly the legacy
      // fractional-z sweep's outcome, keyed on sequence position instead.
      // TODO(design-005): relative modes ("above"/"below" an anchor) are a
      // {before}/{after} moveRelation away — deferred until the public ops
      // table names them.
      guardedTransaction(s.store, world, (tx) => {
        for (const e of ids) {
          if (s.store.keyOf(e) === undefined) continue;
          if (!world.hasTag(e, Active)) continue;
          assertEditablePlacement(e, "reorder");
          // No ChildOf edge (legacy doc) — no sequence to move within.
          if (world.getRelation(e, ChildOf) === undefined) continue;
          tx.moveRelation(e, ChildOf, mode === "top" ? "last" : "first");
        }
      });
    },
    setLocked(ids, locked) {
      const s = requireWritable("setLocked");
      // The tape (design-015 §5.1): the durable `Locked` tag, this op its one
      // writer. Scoped like `reorder` — doc-keyed widgets of the current frame —
      // and CHANGE-ONLY against the world every facade op reads (a transaction
      // lands there at the next sync): an id already in the asked state writes
      // nothing, and when none differs no transaction opens (no empty undo
      // step). Placement is asserted before the transaction, so a refusal writes
      // nothing at all.
      const targets: Entity[] = [];
      for (const e of new Set(ids)) {
        if (!world.isAlive(e) || !world.hasTag(e, Active) || s.store.keyOf(e) === undefined) continue;
        const typeId = world.get(e, PrefabId)?.id;
        if (typeof typeId !== "string" || catalog.widget(typeId) === undefined) continue;
        if (world.hasTag(e, Locked) === locked) continue;
        assertEditablePlacement(e, "setLocked");
        targets.push(e);
      }
      if (targets.length === 0) return;
      guardedTransaction(s.store, world, (tx) => {
        for (const e of targets) {
          if (locked) tx.addTag(e, Locked);
          else tx.removeTag(e, Locked);
        }
      });
    },
    arrange(opts) {
      const s = requireWritable("arrange");
      const scoped =
        opts?.ids === undefined
          ? opts
          : {
              ...opts,
              ids: opts.ids.filter(
                (entity) => world.isAlive(entity) && world.hasTag(entity, Active),
              ),
            };
      return arrangeWidgets(s.store, s.liveWriter, world, scoped);
    },
    zoomToFit(ids) {
      const targets = ids !== undefined && ids.length > 0 ? [...ids] : widgetQuery();
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const e of targets) {
        const p = world.get(e, Position);
        const s = world.get(e, Size);
        if (p === undefined || s === undefined) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.w);
        maxY = Math.max(maxY, p.y + s.h);
      }
      const vp = world.getResource(Viewport);
      if (!Number.isFinite(minX) || vp === undefined || vp.w === 0) return;
      const lim = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
      const pad = 80;
      const zoom = Math.min(
        lim.maxZoom,
        Math.max(lim.minZoom, Math.min(vp.w / (maxX - minX + pad * 2), vp.h / (maxY - minY + pad * 2))),
      );
      writeRuntimeResource(world, Camera, {
        x: minX - (vp.w / zoom - (maxX - minX)) / 2,
        y: minY - (vp.h / zoom - (maxY - minY)) / 2,
        zoom,
        gesturing: false,
      });
    },
    frameContent() {
      const targets = widgetQuery();
      const vp = world.getResource(Viewport);
      if (targets.length === 0 || vp === undefined || vp.w === 0) return false;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const e of targets) {
        const p = world.get(e, Position);
        const s = world.get(e, Size);
        if (p === undefined || s === undefined) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.w);
        maxY = Math.max(maxY, p.y + s.h);
        any = true;
      }
      if (!any) return false;
      const lim = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
      const cam = fitCamera({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, vp.w, vp.h, {
        pad: FIT_DEFAULTS.pad,
        // Band ∩ hard limits; on no overlap the hard limit wins (arrival rule).
        minZoom: Math.min(Math.max(FIT_DEFAULTS.minZoom, lim.minZoom), lim.maxZoom),
        maxZoom: Math.max(Math.min(FIT_DEFAULTS.maxZoom, lim.maxZoom), lim.minZoom),
      });
      writeRuntimeResource(world, Camera, { ...cam, gesturing: false });
      return true;
    },
    zoomTo(zoom, anchor) {
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      const vp = world.getResource(Viewport);
      const lim = world.getResource(CameraLimits) ?? CAMERA_DEFAULTS;
      const z = Math.min(lim.maxZoom, Math.max(lim.minZoom, zoom));
      const a = anchor ?? { x: (vp?.w ?? 0) / 2, y: (vp?.h ?? 0) / 2 };
      const next = zoomAtPoint(cam, a.x, a.y, z);
      writeRuntimeResource(world, Camera, { ...next, gesturing: false });
    },
    panTo(x, y) {
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };
      writeRuntimeResource(world, Camera, { x, y, zoom: cam.zoom, gesturing: false });
    },
    enterContainer: (c, opts) => nav.enterContainer(c, opts),
    exitContainer: (opts) => nav.exitContainer(opts),
    exitTo: (d, opts) => nav.exitTo(d, opts),
    cancelActiveGestures: () => cancelActiveGestures(world),
    open(entity) {
      // THE OPEN (design-015 §8): the one writer of `Held`. Runtime riders only — a free write from an op, as the
      // selection is; the document never learns what is in whose hand.
      if (!isOpenable(entity)) throw new Error("ice: open — the target is not a live object of this frame whose kind opens (its type declares no `openable`).");
      const held = heldNow();
      if (held !== undefined) {
        if (held === entity) return;
        throw new Error("ice: open — another object is in hand; put it down first (at most one object is held).");
      }
      cancelActiveGestures(world);
      setSelection(world, [entity], "replace");
      world.addComponent(entity, HeldView, { zoom: 1, panX: 0, panY: 0 });
      const tool = firstHeldTool(entity);
      world.addComponent(entity, HeldTool, { id: tool, prev: tool });
      world.addTag(entity, Held);
    },
    putDown,
    useHeldTool(id) {
      // THE HELD BAR (design-015 §8, D3t-a): a mode becomes the tool in hand — a runtime write, the user's fact, as the selection
      // is; an action runs its op, whose writes are the document's (its own transaction, or a step of the document's history)
      const held = heldNow();
      if (held === undefined || !world.isAlive(held)) return false;
      const tool = heldToolsOf(held).find((t) => t.id === id);
      if (tool === undefined || tool.kind === undefined) return false;
      if (tool.kind === "mode") {
        const cur = world.get(held, HeldTool) ?? { id: "", prev: "" };
        const next = cur.id !== id ? { id, prev: cur.id } : tool.toggle === true ? { id: cur.prev, prev: id } : undefined;
        if (next === undefined) return true;
        if (world.has(held, HeldTool)) world.edit(held).set(HeldTool, next);
        else world.addComponent(held, HeldTool, next);
        return true;
      }
      /** The session an action may write through, or undefined on a read-only document (the write ops' own test). */
      const writable = (): DocSession | undefined => {
        const s = session;
        return s === undefined || s.readOnly || gateVerdict(s.versionReport()) !== "ok" || diagnosticsDirty || diagnosticSnapshot.authorityIssue !== undefined ? undefined : s;
      };
      tool.run?.({
        world,
        entity: held,
        undo: () => docs.undo(),
        redo: () => docs.redo(),
        transact(fn, o) {
          const s = writable();
          if (s === undefined) return false;
          guardedTransaction(s.store, world, fn, o?.undoable === false ? { undoable: false } : undefined);
          return true;
        },
        props: () => propsOf(held),
        setProps(props, o) {
          const s = writable();
          if (s === undefined) return false;
          setWidgetProps(s.store, world, held, props, o?.undoable === false ? { undoable: false } : undefined);
          return true;
        },
      });
      return true;
    },
    runMenuAction(id) {
      // THE SELECTION MENU'S ACTS (K8a): each type that declares `id` runs it once over its own selected objects
      const byType = new Map<WidgetType, Entity[]>();
      for (const e of selectedEntities(world)) {
        const typeId = world.isAlive(e) ? world.get(e, PrefabId)?.id : undefined;
        const type = typeof typeId === "string" ? catalog.widget(typeId) : undefined;
        if (type === undefined || !type.menu.some((a) => a.id === id)) continue;
        const list = byType.get(type);
        if (list === undefined) byType.set(type, [e]);
        else list.push(e);
      }
      if (byType.size === 0) return false;
      /** The session an act may write through, or undefined on a read-only document (the write ops' own test). */
      const writable = (): DocSession | undefined => {
        const s = session;
        return s === undefined || s.readOnly || gateVerdict(s.versionReport()) !== "ok" || diagnosticsDirty || diagnosticSnapshot.authorityIssue !== undefined ? undefined : s;
      };
      for (const [type, entities] of byType) {
        type.menu.find((a) => a.id === id)?.run({
          world,
          entities,
          props: (e) => propsOf(e),
          setProps(e, props, o) {
            const s = writable();
            if (s === undefined || !world.isAlive(e)) return false;
            setWidgetProps(s.store, world, e, props, o?.undoable === false ? { undoable: false } : undefined);
            return true;
          },
          transact(fn, o) {
            const s = writable();
            if (s === undefined) return false;
            guardedTransaction(s.store, world, fn, o?.undoable === false ? { undoable: false } : undefined);
            return true;
          },
        });
      }
      return true;
    },
  };

  // --- stage holds (StageMode mirror; tokens live HERE, out-of-ECS) ---------
  const stageHolds = new Map<symbol, string>();
  const syncStage = (): void => {
    writeRuntimeResource(world, StageMode, { backgroundHolds: stageHolds.size });
  };
  const stage: StageControl = {
    background(name) {
      const token = Symbol(name);
      stageHolds.set(token, name);
      syncStage();
      let released = false;
      return () => {
        if (released) return; // idempotent — double-release must not eat another hold
        released = true;
        stageHolds.delete(token);
        syncStage();
      };
    },
    isBackgrounded: () => stageHolds.size > 0,
    holds: () => [...stageHolds.values()],
  };

  // --- frame freeze wiring (the gate lives on the engine; these are its two
  // stack-level consequences, installed once at construction) ---------------
  //
  // A gesture may not be left in flight across a freeze: its runtime edits are
  // uncommitted until the recognizer reaches JustEnded, and a parked loop never
  // gets there. So a freeze CANCELS between frames and the reporter below keeps
  // the settle walking until the recognizers are terminal — cancellation is a
  // one-tick resource the ctl:spawn sweep acts on NEXT tick, so this is a walk,
  // never a single frame.
  engine.frame.settleWhile("gestures", () => isMidGesture(world));
  engine.frame.onChange(() => {
    if (engine.frame.isFrozen()) {
      cancelActiveGestures(world);
      return;
    }
    // Thaw. The adapters never stopped enqueuing, so the queue holds facts
    // about a canvas nobody could interact with, stamped with a `tMs` that is
    // now minutes stale — replaying them would hand recognizers a burst of
    // impossible history. Drop them, exactly as the adapter drops a pointer
    // across a window blur (design-003 §8).
    stack.queue.drain();
  });

  return {
    world,
    engine,
    catalog,
    placement,
    canvas,
    previews,
    behaviors,
    stack,
    runtime,
    transitions,
    nav,
    ops,
    docs,
    stage,
    frame: engine.frame,
    // exactOptionalPropertyTypes: a `compositorDevice: undefined` property is
    // NOT the same as an absent one, and the optional field refuses the former.
    ...(opts.compositorDevice !== undefined ? { compositorDevice: opts.compositorDevice } : {}),
    budgets,
    step: (now) => engine.step(now),
    dispose() {
      removeNavIntent();
      removeHeldIntent();
      removeTrayIntent();
      previews.dispose();
      closeDoc();
      transitions.dispose();
      // Behaviors before guests: their dispose hooks may still want a live
      // world, and their breaker rows live in the guest registry that the next
      // line tears down.
      behaviors.dispose();
      removeDiagnosticPublish();
      runtimeExtensionHost.dispose();
      frameBehaviorHost?.dispose();
      // Guests first: their dispose may touch doc/runtime state, and a
      // suspended-but-registered guest still holds an instance to tear down.
      engine.disposeGuests();
      runtime.uninstall();
      stack.uninstall();
      unbindCatalog();
    },
  };
}
