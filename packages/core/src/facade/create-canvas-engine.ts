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
 * Budgets: `keepMounted` feeds the widget runtime; `fboBytes` is carried
 * for the GL layer (GLViews reads it via the react facade). Port budgets
 * remain reviewed constants (RUNTIME_BUDGETS) in v1 — recorded.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { createWorld, defineQuery } from "@vibecook/strata-ecs";
import { fitCamera, zoomAtPoint } from "@ice/kernel";
import {
  ActiveTool,
  Camera,
  CameraLimits,
  ChildOf,
  ChromeSettings,
  GestureSettings,
  MeasuredSize,
  PointerSettings,
  Position,
  Selectable,
  Size,
  SnapConfig,
  StageMode,
  TransformTween,
  Viewport,
} from "../catalog";
import { Active } from "../catalog/camera-derived";
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
import { createNestedCanvas, type NavOpts, type NestedCanvas } from "../nav/nested-canvas";
import { cancelActiveGestures } from "../ops/gestures";
import { arrangeWidgets, type ArrangeOpts } from "../ops/arrange";
import { insertByDrag, type InsertByDragOpts } from "../ops/insert";
import { cascadeDestroy } from "../ops/cascade";
import { clearSelection, selectedEntities, setSelection } from "../ops/selection";
import { installWidgetRuntime, type WidgetRuntime } from "../widget/mount-store";
import { spawnWidget, type SpawnWidgetOpts } from "../widget/spawn";
import { setWidgetProps } from "../widget/set-props";
import { WidgetEquipped, widgets } from "../widget/define-widget";
import { registerBuiltinTools, tools, type Tool } from "../tools/define-tool";
import { PrefabId } from "../schema/prefab";
import { createDocSession, openDocSession, type DocSession, type DocSessionOpts, type OpenDocResult } from "../doc/doc-kit";
import { joinDoc, type JoinDocOpts, type JoinResult } from "../doc/bootstrap";
import type { ByteChannel } from "../doc/channels";
import { startAutosave, type Autosave, type AutosaveOpts, type AutosaveStorageWrite } from "../doc/autosave";
import { attachPresence, type PresenceOpts, type PresenceSession } from "../presence/presence-kit";
import { installPresence } from "../presence/remote-cursors";
import type { MeasureQueue } from "../input/measure-queue";
import {
  CAMERA_DEFAULTS,
  CHROME_DEFAULTS,
  FIT_DEFAULTS,
  GESTURE_DEFAULTS,
  POINTER_DEFAULTS,
  RUNTIME_BUDGETS,
  SNAP_DEFAULTS,
} from "../settings/defaults";

export interface CanvasEngineOpts {
  /** Registered widget types (definition happens at defineWidget; this list is validated). */
  readonly widgets?: readonly { readonly type: string }[];
  /** Registered tools (definition happens at defineTool; validated). */
  readonly tools?: readonly Tool[];
  /**
   * Behaviors this engine runs (design-009). Definition is the import
   * side-effect; listing them here COMPILES and installs them — a behavior that
   * is defined but never registered costs nothing and does nothing, which is
   * what makes "a plugin declared it" and "this engine runs it" separable.
   */
  readonly behaviors?: readonly AnyBehaviorDef[];
  /** Generic guest breaker routing for hosts that use the published facade. */
  readonly onGuestFault?: (id: string, error: unknown) => void;
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
    readonly keepMounted?: number;
    readonly fboBytes?: number;
  };
  readonly settings?: {
    readonly zoom?: { readonly min?: number; readonly max?: number };
    readonly gestures?: Partial<Record<keyof typeof GESTURE_DEFAULTS, number>>;
    readonly pointers?: Partial<Record<keyof typeof POINTER_DEFAULTS, number>>;
    readonly snap?: { readonly enabled?: boolean; readonly thresholdPx?: number };
    /** Selection-chrome knobs: liftScale = the app's visual drag-lift scale (union box wraps it). */
    readonly chrome?: { readonly liftScale?: number };
  };
  readonly policy?: {
    /** The gate verdict a "migrate"-classified doc downgrades to when migration is off/fails. */
    readonly versionGate?: "reject" | "readOnly" | "migrate";
  };
  /** The dom measure adapter's queue (wireMeasurement provides; optional headless). */
  readonly measureQueue?: MeasureQueue;
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

export interface CanvasEngine {
  readonly world: World;
  readonly engine: Engine;
  /**
   * The behavior runtime (design-009 §6): attach/detach/has/read for
   * runtime-class behaviors, plus `list()` for devtools and the doctor.
   * DURABLE attachment is deliberately absent — it is a document op and goes
   * through `tx.attach` inside a transaction, so it syncs and undoes.
   */
  readonly behaviors: BehaviorRuntime;
  readonly stack: InteractionStack;
  readonly runtime: WidgetRuntime & { uninstall(): void };
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
  readonly budgets: { readonly keepMounted: number; readonly fboBytes: number };
  /** step(now) passthrough — the app's rAF loop drives this. */
  step(now: number): void;
  dispose(): void;
}

/** Sink whose target swaps per doc session (records nothing when doc-less). */
function createForwardingSink(): CommitSink & { target: CommitSink | undefined } {
  return {
    target: undefined,
    commit(intent: CommitIntent) {
      this.target?.commit(intent);
    },
  };
}

// Query singletons (module scope — defineQuery identity is the cache key).
const selectableWidgetsQ = defineQuery([Position, Size, Selectable, Active, WidgetEquipped]);
/** Live glides — the history chokepoint's sweep set (petition I15). */
const tweenQ = defineQuery([Position, TransformTween]);

export function createCanvasEngine(opts: CanvasEngineOpts = {}): CanvasEngine {
  registerBuiltinTools();
  // Validate the declared lists against the registries (definition is the
  // import side-effect; the lists exist so a typo fails at construction).
  for (const w of opts.widgets ?? []) {
    if (widgets.get(w.type) === undefined) {
      throw new Error(`ice: createCanvasEngine — widget type "${w.type}" is not defined.`);
    }
  }
  for (const t of opts.tools ?? []) {
    if (tools.get(t.id) === undefined) {
      throw new Error(`ice: createCanvasEngine — tool "${t.id}" is not defined.`);
    }
  }

  const world = createWorld();
  const engine = createEngine(world, {
    ...(opts.onGuestFault === undefined ? {} : { onGuestFault: opts.onGuestFault }),
    ...(opts.onGuestNotice === undefined ? {} : { onGuestNotice: opts.onGuestNotice }),
  });
  const sink = createForwardingSink();
  const stack = installInteractionStack(engine, { sink });
  const budgets = {
    keepMounted: opts.budgets?.keepMounted ?? RUNTIME_BUDGETS.keepMountedWidgets,
    fboBytes: opts.budgets?.fboBytes ?? RUNTIME_BUDGETS.fboBytes,
  };
  const runtime = installWidgetRuntime(engine, {
    keepMounted: budgets.keepMounted,
    ...(opts.measureQueue !== undefined ? { measureQueue: opts.measureQueue } : {}),
  });
  const nav = createNestedCanvas(world, {
    index: stack.index,
    clearSpatialCaches: () => stack.clearCaches(),
  });
  engine.addSystems("react", nav.navIntegrity);

  // Settings resources (design-005 §4): construction seeds; live-tunable after.
  const st = opts.settings ?? {};
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  world.setResource(Viewport, { w: 0, h: 0, dpr: 1 });
  world.setResource(ActiveTool, { id: "select" });
  world.setResource(CameraLimits, {
    minZoom: st.zoom?.min ?? CAMERA_DEFAULTS.minZoom,
    maxZoom: st.zoom?.max ?? CAMERA_DEFAULTS.maxZoom,
  });
  world.setResource(GestureSettings, { ...GESTURE_DEFAULTS, ...st.gestures });
  world.setResource(PointerSettings, { ...POINTER_DEFAULTS, ...st.pointers });
  world.setResource(SnapConfig, {
    enabled: st.snap?.enabled ?? SNAP_DEFAULTS.enabled,
    thresholdPx: st.snap?.thresholdPx ?? SNAP_DEFAULTS.thresholdPx,
  });
  world.setResource(ChromeSettings, {
    liftScale: st.chrome?.liftScale ?? CHROME_DEFAULTS.liftScale,
  });

  // --- doc lifecycle ---------------------------------------------------------
  let session: DocSession | undefined;
  let presence: PresenceSession | undefined;
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
    if (s.readOnly) {
      throw new Error(`ice: ops.${op} — the document is read-only (version gate); writes are disabled.`);
    }
    return s;
  };

  const adoptSession = (next: DocSession): DocSession => {
    session = next;
    sink.target = next.sink;
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
    const p = attachPresence(world, o);
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
    // A pending join dies here — left to resolve, it would attach a stale
    // session over whatever the caller opens next.
    joinAbort?.abort(new Error("ice: docs.join superseded — another document was opened while joining."));
    joinAbort = undefined;
    for (const a of [...liveAutosaves]) a.stop(); // before close: no export of a detached session
    liveAutosaves.clear();
    releasePresence();
    joined?.leave(); // leaves the ROOM: channel + outbound unsubs, then closes the session
    joined = undefined;
    session?.close(); // idempotent — a no-op when leave() above already closed it
    session = undefined;
    sink.target = undefined;
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
    create(o) {
      closeDoc();
      return adoptSession(createDocSession(world, o));
    },
    open(bytes, o) {
      closeDoc();
      const result = openDocSession(world, bytes, {
        ...(gatePolicy !== undefined ? { onGate: gatePolicy } : {}),
        ...o,
      });
      if (result.ok) adoptSession(result.session);
      return result;
    },
    async join(channel, o = {}) {
      closeDoc();
      const ac = new AbortController();
      joinAbort = ac;
      const { presence: presenceOpts, ...joinOpts } = o;
      if (presenceOpts !== undefined) {
        acquirePresence({ name: presenceOpts.name, color: presenceOpts.color });
      }
      let result: JoinResult;
      try {
        result = await joinDoc(world, channel, {
          ...(gatePolicy !== undefined ? { docOpts: { onGate: gatePolicy } } : {}),
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
              session = undefined; // joinDoc already closed it
              sink.target = undefined;
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
    undo: () => (session === undefined || session.readOnly ? false : historyStep("undo")),
    redo: () => (session === undefined || session.readOnly ? false : historyStep("redo")),
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
      cancelActiveGestures(world);
      writeRuntimeResource(world, ActiveTool, { id });
    },
    spawnWidget(type, o) {
      const s = requireWritable("spawnWidget");
      return spawnWidget(s.store, world, type, o);
    },
    insertByDrag(type, o) {
      // Writable-session gate UP FRONT: the ghost drag would otherwise run
      // beautifully and silently drop its create at commit (read-only sink).
      requireWritable("insertByDrag");
      return insertByDrag(world, stack.queue, type, o);
    },
    setWidgetProps(entity, props) {
      const s = requireWritable("setWidgetProps");
      setWidgetProps(s.store, world, entity, props);
    },
    deleteSelection() {
      const s = requireWritable("deleteSelection");
      const doomed = selectedEntities(world).filter((e) => s.store.keyOf(e) !== undefined);
      if (doomed.length === 0) return;
      s.store.transaction((tx) => {
        for (const e of doomed) cascadeDestroy(tx, world, e);
      });
    },
    duplicateSelection() {
      const s = requireWritable("duplicateSelection");
      const sources = selectedEntities(world).filter((e) => s.store.keyOf(e) !== undefined);
      if (sources.length === 0) return [];
      const clones: Entity[] = [];
      guardedTransaction(s.store, world, (tx) => {
        for (const src of sources) {
          const type = world.get(src, PrefabId)?.id;
          const widget = typeof type === "string" ? widgets.get(type) : undefined;
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
          if (parent !== undefined) tx.setRelation(clone, ChildOf, parent, { after: src });
          clones.push(clone);
        }
      });
      // The clones land at the next sync; select them once alive.
      setSelection(world, clones.filter((e) => world.isAlive(e)), "replace");
      return clones;
    },
    setSelection(ids, mode = "replace") {
      setSelection(world, [...ids], mode);
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
          // No ChildOf edge (legacy doc) — no sequence to move within.
          if (world.getRelation(e, ChildOf) === undefined) continue;
          tx.moveRelation(e, ChildOf, mode === "top" ? "last" : "first");
        }
      });
    },
    arrange(opts) {
      const s = requireWritable("arrange");
      return arrangeWidgets(s.store, s.liveWriter, world, opts);
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
        const m = world.get(e, MeasuredSize);
        const s = m !== undefined && m.w > 0 ? m : world.get(e, Size);
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
    behaviors,
    stack,
    runtime,
    nav,
    ops,
    docs,
    stage,
    frame: engine.frame,
    budgets,
    step: (now) => engine.step(now),
    dispose() {
      closeDoc();
      // Behaviors before guests: their dispose hooks may still want a live
      // world, and their breaker rows live in the guest registry that the next
      // line tears down.
      behaviors.dispose();
      // Guests first: their dispose may touch doc/runtime state, and a
      // suspended-but-registered guest still holds an instance to tear down.
      engine.disposeGuests();
      runtime.uninstall();
      stack.uninstall();
    },
  };
}
