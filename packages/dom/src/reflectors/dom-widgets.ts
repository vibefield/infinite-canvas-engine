/**
 * The DOM widget HOST reflector (design-004 §2 host pipeline; design-002 §5
 * `domWidgets`).
 *
 * This is the reflector-owned HALF of the widget runtime: it reconciles a host
 * `<div>` per mounted widget against the engine's mount store and paints its
 * world-unit geometry. The OTHER half — the React portal list — is owned by a
 * hook subscribed to the SAME store (design-004 §2, decision 3); this file never
 * touches React. Each host carries an inner `data-ice-content` element that the
 * portal targets, so the two halves meet only at that node.
 *
 * Store, not query: membership (enter/exit) and the culled-but-kept-mounted
 * `hidden` flag are ENGINE-side decisions (cull + keep-mounted LRU, mount-store.ts)
 * published through a `useSyncExternalStore` snapshot. That store has NO ECS stamp
 * for a reflector `observe` to watch, so — like the cursor reflector — this one is
 * `always: true` and does its own cheap dirt detection:
 *  - **membership**: `store.getSnapshot()` identity is O(1); the snapshot changes
 *    IFF membership or a hidden flag changed, so an unchanged snapshot skips the
 *    reconcile entirely;
 *  - **geometry**: a private observer on `[Position, Size]` sets a dirty flag, so
 *    the (change-only) geometry pass runs only when a widget actually moved/resized
 *    — a still scene touches no DOM. Effective size is `MeasuredSize` where present
 *    and non-zero, else `Size` (design-004 §2). (MeasuredSize changes ride a
 *    dedicated observer; the note below is historical:
 *    picked up on the next Position/Size stamp or membership change; the ResizeObserver
 *    measurement path — a later slice — will arm its own dirt.)
 *  - **opacity**: a private observer on `[Opacity]` (attach/detach/value) sets a
 *    dirty flag; the change-only pass writes `style.opacity` on the host (absent
 *    component = 1 = property cleared). The GL twin is the composite quad's
 *    `uOpacity` — a gl widget's host here carries only its DOM chrome, so the
 *    two halves fade from the same cell.
 *  - **drag-promote** (P3): a private observer on `[Grab]` membership sets a dirty
 *    flag; a host whose entity holds `Grab` re-parents content→lifted plane and back
 *    on release. Re-parenting MOVES the host node (with its content child), which
 *    PRESERVES the React portal — the portal targets the content node, and moving a
 *    portal's container node does not remount it, so widget React state survives the
 *    lift. While ANY host is lifted, every host's content element is inerted
 *    (`pointer-events: none`, the pinned inert-during-drag contract, design-004 §4).
 *    STRATIFIED ONLY, and deliberately: design-012 §7 retires "P3 lifted plane,
 *    portal-preserving reparent, inert-during-drag class toggles" in the
 *    composited profile, because there a drag is a per-quad GPU fact at true z
 *    and card-level hit truth stays native on the L1 host (§5 Q4). A composited
 *    card is therefore never `lifted` — see `placementOf` — so this clause
 *    simply has nothing to fire on, which is the ratified answer and not a gap.
 *
 * Law 10: reflectors run post-notify, write output only, never read layout or
 * write ECS — this flush touches only host `<div>` style/attributes/parentage.
 */
import {
  Grab,
  MeasuredSize,
  Opacity,
  Position,
  PrefabId,
  Size,
  compareStackOrder,
  createSiblingOrderIndex,
  defineQuery,
  widgets,
  type CompositorSourceRegistry,
  type Entity,
  type MountEntry,
  type PresentationRetainer,
  type PresentationTransitionAdapter,
  type PresentationTransitionFrame,
  type ReflectorDef,
  type WidgetMountStore,
  type World,
} from "@ice/core";
import { planeCssTransform } from "@ice/kernel";
import { CLAIM_OWNS_ESCAPE, KEYBOARD_CLAIM_ATTR } from "../input-ownership";
import { DEFAULT_PRESENTATION, type PresentationRegistry } from "../presentation-mode";

/**
 * Where a host can live (design-004 §1: P1 content, P3 lifted; design-012 §5:
 * the L1 source canvas). `sourceCanvas` is present only in the composited
 * profile — without it every host is a plane host and this file is the code it
 * always was.
 */
export interface DomWidgetsHost {
  readonly contentPlane: HTMLElement;
  readonly liftedPlane: HTMLElement;
  /**
   * L1. Composited hosts become IMMEDIATE children of it — never nested in a
   * wrapper — because `copyElementImageToTexture` refuses anything deeper
   * ("Only immediate children of the <canvas> element can be passed").
   */
  readonly sourceCanvas?: HTMLElement;
}

/** The parent a host currently belongs to. */
type HostPlacement = "content" | "lifted" | "canvas";

export interface DomWidgetsOptions {
  /**
   * Per-widget presentation policy. Absent ⇒ every widget is `live-dom` and
   * nothing reaches L1 — the stratified behaviour.
   */
  readonly presentation?: PresentationRegistry;
  /**
   * The compositor's source registry. A host is registered as a `dom` source
   * in the SAME flush that parents it under the canvas, and unregistered in
   * the same flush that takes it away — the two must not drift, or the
   * compositor holds an element the copy will refuse.
   */
  readonly sources?: CompositorSourceRegistry;
}

interface HostRec {
  /** The absolute-positioned host div; re-parents between the planes and L1. */
  readonly host: HTMLDivElement;
  /** The `data-ice-content` portal target (React mounts INTO this). */
  readonly content: HTMLDivElement;
  // Geometry cache — the change-only guard (graybox pattern).
  x: number;
  y: number;
  w: number;
  h: number;
  /** Last-applied `display:none` (culled-but-kept-mounted) state. */
  hidden: boolean;
  /** Last-applied parent. */
  placement: HostPlacement;
  /** Last-applied `Opacity.a` (1 = the no-component default, style cleared). */
  opacity: number;
  /**
   * Live compositor-source registration, while this host is canvas-side.
   * Explicitly `| undefined` rather than optional: `exactOptionalPropertyTypes`
   * is on, and this field is cleared by assignment on every demotion.
   */
  unregister: (() => void) | undefined;
}

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

const geometryQuery = defineQuery([Position, Size]);
const measuredQuery = defineQuery([MeasuredSize]);
const grabQuery = defineQuery([Grab]);
const opacityQuery = defineQuery([Opacity]);

function writeGeom(el: HTMLDivElement, x: number, y: number, w: number, h: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

export interface DomWidgetsReflector extends ReflectorDef {
  /** The entity's content element (the `data-ice-content` portal target), or undefined if not hosted. */
  hostFor(entity: Entity): HTMLElement | undefined;
  /**
   * The entity's HOST element — the node that reparents between the planes and
   * L1, and the one the compositor copies from. Distinct from `hostFor`, which
   * is the inner portal target: the copy addresses immediate canvas children,
   * so it must never be handed the content div.
   */
  hostElementFor(entity: Entity): HTMLElement | undefined;
  /** Where each host currently lives (composited-profile instrument). */
  canvasHostCount(): number;
  /**
   * The entities whose hosts are immediate children of L1 right now — the set
   * `domWriteback` places and the compositor draws. In L1 CHILD ORDER, which
   * is sibling order (petition 8), so a consumer that needs paint order gets
   * it without re-deriving one.
   */
  compositedEntities(): Entity[];
  /**
   * Bumped whenever that set changes — a promotion, a demotion, or a
   * composited host mounting or leaving.
   *
   * `domWriteback` is self-gated on camera/geometry dirt, and a promotion is
   * NEITHER: a card promoted while the camera is still would otherwise sit
   * unplaced (in `layoutsubtree`, with no transform, at (0,0)) until something
   * unrelated moved. This is the O(1) wake for that, and it is a counter
   * rather than a callback so a consumer can poll it inside its own gate.
   */
  compositedRevision(): number;
  /** Live host count (= mounted widgets, visible + kept-mounted). */
  hostCount(): number;
  /** Geometry writes so far — one per enter, one per changed host, zero for unchanged (churn instrument). */
  geometryWrites(): number;
  /** Trusted pre-cut T2 adapter over already-mounted host nodes only. */
  transitionAdapter(): PresentationTransitionAdapter;
  /** Tear down the private observers (call when unregistering the reflector before the world dies). */
  dispose(): void;
}

export function createDomWidgetsReflector(
  host: DomWidgetsHost,
  world: World,
  store: WidgetMountStore,
  opts: DomWidgetsOptions = {},
): DomWidgetsReflector {
  const doc = host.contentPlane.ownerDocument;
  const sourceCanvas = host.sourceCanvas;
  const hosts = new Map<Entity, HostRec>();
  // The pull-based frame ordinal cache (petition 8): sibling sequence →
  // entity → position, stamp-checked so updateOrder rebuilds only when the
  // frame parent's order actually moved.
  const order = createSiblingOrderIndex(world);
  let lastSnapshot: readonly MountEntry[] | undefined;
  let geometryWrites = 0;
  /** Bumped whenever the canvas-side host set changes (see compositedRevision). */
  let compositedRevision = 0;
  /** True while any host is lifted → all content is inerted (pinned drag contract). */
  let inert = false;
  const departingHosts = new Set<Entity>();

  // Private dirt flags — the store carries no ECS stamp, so geometry/promote work
  // is gated by observers rather than the registry's (unused under `always`) dirt.
  let geometryDirty = false;
  let promoteDirty = false;
  let opacityDirty = false;
  let orderDirty = false;
  const unsubs: Array<() => void> = [
    world.reactive.observeQuery(geometryQuery, () => { geometryDirty = true; }, { cols: [Position, Size] }),
    // MeasuredSize rides its own observer: adding it to geometryQuery's cols
    // would require it in the query and drop widgets without the rider.
    world.reactive.observeQuery(measuredQuery, () => { geometryDirty = true; }, { cols: [MeasuredSize] }),
    world.reactive.observeQuery(grabQuery, () => { promoteDirty = true; }, { cols: [] }),
    // Opacity is an optional rider like MeasuredSize: membership (attach/detach)
    // and value changes both arm the flag; detach resets the host to the
    // default via the `?? 1` read.
    world.reactive.observeQuery(opacityQuery, () => { opacityDirty = true; }, { cols: [Opacity] }),
    // Within-plane stacking IS the frame's ChildOf sibling sequence (petition
    // 8, superseding the StackZ sort that fixed the 2026-07-18 comment-box
    // paint bug). The wake names the relation (Related grammar — pure
    // reorders fire it); the ordinal cache's stamp check in updateOrder
    // keeps other-frame churn cheap.
    order.observe(() => { orderDirty = true; }),
  ];
  // Presentation changes reparent exactly like a drag-promote does, so they
  // arm the same flag and take the same path (plan §2: ONE door).
  if (opts.presentation !== undefined) {
    unsubs.push(opts.presentation.onChange(() => { promoteDirty = true; }));
  }

  /**
   * GL widgets' hosts carry DOM CHROME that must stay in the content plane
   * (P1, UNDER the GL canvas) even while grabbed — promoting to P3 would
   * cover the widget's own 3D content with its opaque card. The GL side pops
   * the grabbed quad renderOrder-top within P2 instead (design-004 §1).
   */
  function promotable(e: Entity): boolean {
    const type = world.get(e, PrefabId)?.id;
    return typeof type !== "string" || widgets.get(type)?.surface !== "gl";
  }

  /**
   * Which parent this entity's host belongs under, right now.
   *
   * Composited wins over lifted: a composited card's lift is a per-quad GPU
   * fact at true z (design-012 §7 — P3 is what the composited profile retires),
   * so moving it into P3 would be the stratified answer to a question the
   * compositor is already answering. Without a source canvas — the stratified
   * profile — this collapses to the content/lifted decision it always was.
   */
  function placementOf(e: Entity): HostPlacement {
    if (sourceCanvas !== undefined && opts.presentation?.get(e) === "composited") return "canvas";
    return world.has(e, Grab) && promotable(e) ? "lifted" : "content";
  }

  function parentFor(placement: HostPlacement): HTMLElement {
    if (placement === "canvas" && sourceCanvas !== undefined) return sourceCanvas;
    return placement === "lifted" ? host.liftedPlane : host.contentPlane;
  }

  /**
   * Register/unregister the host as a `dom` compositor source, in lockstep
   * with its parentage. Called only where the node has ALREADY been moved:
   * the compositor may hold an element only while that element is an immediate
   * child of the canvas, or the copy is refused at the platform.
   */
  function syncSource(e: Entity, rec: HostRec): void {
    const wantsSource = rec.placement === "canvas" && opts.sources !== undefined;
    if (wantsSource && rec.unregister === undefined) {
      rec.unregister = opts.sources?.register(e, { kind: "dom", host: rec.host });
    } else if (!wantsSource && rec.unregister !== undefined) {
      rec.unregister();
      rec.unregister = undefined;
    }
  }

  /** Every path that changes canvas membership routes through here. */
  function noteCompositedChange(): void {
    compositedRevision++;
  }

  function readGeom(e: Entity): Geom {
    const p = world.get(e, Position);
    const measured = world.get(e, MeasuredSize);
    const s = measured !== undefined && measured.w > 0 ? measured : world.get(e, Size);
    return { x: p?.x ?? 0, y: p?.y ?? 0, w: s?.w ?? 0, h: s?.h ?? 0 };
  }

  function readOpacity(e: Entity): number {
    return world.get(e, Opacity)?.a ?? 1;
  }

  function createHost(e: Entity): HostRec {
    const el = doc.createElement("div");
    el.style.position = "absolute";
    el.setAttribute("data-ice-entity", String(e));

    // Keyboard claim marker (design-007 §3.1, petition I1) — REGISTRY truth,
    // read like `promotable` reads `surface` (no equip-tag timing to race).
    // Static-on-host: the marker declares "this subtree claims keyboard when
    // focused"; readers gate on the EVENT-TARGET chain, and a keydown targets
    // `document.activeElement`, so the standdown engages exactly while focus
    // is inside. `tabindex=-1` makes the host itself click-focusable (the
    // fallback focus node when no proxy/editable is under the pointer);
    // `outline:none` because the P4 selection chrome is the affordance, not a
    // UA focus ring on a bare card div.
    const typeId = world.get(e, PrefabId)?.id;
    const widgetType = typeof typeId === "string" ? widgets.get(typeId) : undefined;
    if (widgetType?.keyboard === "exclusive") {
      el.setAttribute(KEYBOARD_CLAIM_ATTR, widgetType.keyboardEscape === "widget" ? CLAIM_OWNS_ESCAPE : "");
      el.tabIndex = -1;
      el.style.outline = "none";
    }

    // The DECLARED presentation (design-012 §6.3; `defineWidget({presentation})`
    // landed at S8), applied here because `placementOf` is read four lines
    // below: seeding the mode and choosing the parent become one step, so a
    // pinned-composited card is a canvas child on its FIRST frame rather than
    // being promoted on its second and reparented after one wasted paint.
    //
    // `dom` surfaces only. A GL widget's host is its DOM CHROME and belongs in
    // the content plane under the island (design-004 §1's sandwich) — Q4's
    // empty canvas host for gl/video kinds is specified but unbuilt, and
    // seeding "composited" here would move the chrome under the L1 canvas,
    // where `syncSource` would register it as a `dom` source over the top of
    // the island's own `gl` registration (both are keyed by entity).
    if (widgetType?.surface === "dom" && opts.presentation !== undefined) {
      const declared = widgetType.presentation.default;
      if (declared !== DEFAULT_PRESENTATION) opts.presentation.set(e, declared);
    }

    const content = doc.createElement("div");
    content.setAttribute("data-ice-content", "");
    content.style.width = "100%";
    content.style.height = "100%";
    el.appendChild(content);

    const g = readGeom(e);
    writeGeom(el, g.x, g.y, g.w, g.h);
    geometryWrites++;
    const opacity = readOpacity(e);
    if (opacity !== 1) el.style.opacity = String(opacity);
    const placement = placementOf(e);
    parentFor(placement).appendChild(el);
    const rec: HostRec = {
      host: el,
      content,
      x: g.x,
      y: g.y,
      w: g.w,
      h: g.h,
      hidden: false,
      placement,
      opacity,
      unregister: undefined,
    };
    // The node is parented; only now may it become a compositor source.
    syncSource(e, rec);
    if (placement === "canvas") noteCompositedChange();
    return rec;
  }

  /** Enter/exit/hidden reconcile against the store snapshot. Returns whether membership changed. */
  function reconcile(snapshot: readonly MountEntry[]): boolean {
    let membershipChanged = false;
    const present = new Set<Entity>();
    for (const entry of snapshot) {
      present.add(entry.entity);
      let rec = hosts.get(entry.entity);
      if (rec === undefined) {
        rec = createHost(entry.entity);
        hosts.set(entry.entity, rec);
        membershipChanged = true;
      }
      if (entry.hidden !== rec.hidden) {
        rec.hidden = entry.hidden;
        rec.host.style.display = entry.hidden ? "none" : ""; // cull ≠ unmount
      }
    }
    for (const [e, rec] of hosts) {
      if (present.has(e)) continue;
      // Drop the compositor's handle BEFORE the node leaves the document: a
      // registered source whose element is detached is one the copy refuses.
      rec.unregister?.();
      rec.unregister = undefined;
      if (rec.placement === "canvas") noteCompositedChange();
      rec.host.remove(); // React unmounts via the store; the host div goes too
      hosts.delete(e);
      // The MODE goes with the host. The registry is keyed by entity and
      // outlives this reflector, so a mode left behind is an entry nothing
      // will ever clear: it grows with every despawn, and — because entity
      // ids RECYCLE — a later widget can inherit a "composited" it never
      // asked for and never demote out of it (policy demotes only what it
      // promoted). `createHost` seeds a declared default on the way back in,
      // so a kept-mounted host evicted by the LRU loses nothing here either.
      opts.presentation?.clear(e);
      membershipChanged = true;
    }
    return membershipChanged;
  }

  /**
   * Change-only geometry rewrite over the live PLANE hosts (graybox pattern).
   *
   * Canvas-side hosts are skipped on purpose: inside a `layoutsubtree` canvas
   * `left`/`top` do not position anything (the transform REPLACES layout —
   * hic-bench §3), and the host must be sized in SCREEN CSS px rather than the
   * world units a camera-transformed plane scales for it. Their whole geometry
   * — placement and size — belongs to the `domWriteback` reflector.
   */
  function updateGeometry(): void {
    for (const [e, rec] of hosts) {
      if (departingHosts.has(e) || rec.placement === "canvas") continue;
      const g = readGeom(e);
      if (g.x !== rec.x || g.y !== rec.y || g.w !== rec.w || g.h !== rec.h) {
        writeGeom(rec.host, g.x, g.y, g.w, g.h);
        rec.x = g.x;
        rec.y = g.y;
        rec.w = g.w;
        rec.h = g.h;
        geometryWrites++;
      }
    }
  }

  /**
   * Within-plane stacking = the frame parent's ChildOf sibling sequence
   * (petition 8; design-004 §1 amendment). DOM paint order is the plane's
   * child order, so each plane's hosts are kept DOM-sorted by their sibling
   * ordinal — a comment box placed "first" paints UNDER the members it wraps
   * even though its host mounted last. Hosts without an ordinal (no ChildOf
   * edge — a pre-schema-2 read-only doc, or a kept-mounted other-frame host)
   * use the legacy (StackZ asc, entity asc) fallback among themselves and
   * sort ABOVE the ordinal set (compareStackOrder's documented choice; mixed
   * planes are nominally impossible post-migration). Reorder is change-only
   * (a DOM sequence already in order touches nothing) and skips a plane while
   * it contains the focused element (re-appending would blur a mid-rename
   * input — and, since design-007, the STEADY state of a focused
   * keyboard-claiming host). Returns whether every plane applied: a skipped
   * plane must keep the caller's dirt armed, or an order change landing while
   * a terminal holds focus would be consumed-but-dropped and never re-assert
   * at blur (2026-08-09 review finding).
   */
  function updateOrder(): boolean {
    const ordinals = order.ordinals();
    let allApplied = true;
    // L1 joins the sorted parents: sibling order is the paint order the
    // compositor reads (petition 8), and it reads it from the canvas's child
    // sequence exactly as a plane's paint order is its child sequence.
    const parents =
      sourceCanvas === undefined
        ? [host.contentPlane, host.liftedPlane]
        : [host.contentPlane, host.liftedPlane, sourceCanvas];
    for (const plane of parents) {
      const active = doc.activeElement;
      if (active !== null && active !== doc.body && plane.contains(active)) {
        allApplied = false; // blur-safety skip — retry on the next flush
        continue;
      }
      const mine: Array<{ el: HTMLDivElement; e: Entity }> = [];
      for (const [e, rec] of hosts) {
        if (rec.host.parentNode !== plane) continue;
        mine.push({ el: rec.host, e });
      }
      if (mine.length < 2) continue;
      const target = [...mine].sort((a, b) => compareStackOrder(world, ordinals, a.e, b.e));
      // Change-only: compare the CURRENT sibling sequence of our hosts.
      let cursor = 0;
      let inOrder = true;
      for (let i = 0; i < plane.children.length; i++) {
        const child = plane.children.item(i);
        if (cursor >= target.length || child === null) break;
        if (child === (target[cursor] as { el: HTMLDivElement }).el) cursor += 1;
        else if (mine.some((m) => m.el === child)) {
          inOrder = false;
          break;
        }
      }
      if (inOrder && cursor === target.length) continue;
      for (const m of target) plane.appendChild(m.el); // moves, in sibling order
    }
    return allApplied;
  }

  /** Change-only opacity rewrite over the live hosts (graybox pattern). */
  function updateOpacity(): void {
    for (const [e, rec] of hosts) {
      if (departingHosts.has(e)) continue;
      const o = readOpacity(e);
      if (o !== rec.opacity) {
        // 1 clears the property — the no-component host carries no inline style.
        rec.host.style.opacity = o === 1 ? "" : String(o);
        rec.opacity = o;
      }
    }
  }

  /**
   * Re-parent hosts between the content plane, the lifted plane and L1, and
   * toggle the global inert state.
   *
   * The reparent is the promotion mechanism (plan §2): `appendChild` MOVES the
   * existing node, and moving a portal's CONTAINER does not remount React, so
   * a widget's state — scroll offset, uncommitted input, hook state — survives
   * a promotion to composited exactly as it survives a drag-lift today. That
   * is why promotion needs no remount path and why the same node is the hit
   * truth in both modes.
   */
  function updatePromote(): void {
    let anyLifted = false;
    for (const [e, rec] of hosts) {
      if (departingHosts.has(e)) continue;
      const grabbed = world.has(e, Grab);
      const placement = placementOf(e);
      if (placement === "lifted") anyLifted = true;
      const shouldLift = placement === "lifted";
      if (placement !== rec.placement) {
        // Unregister BEFORE the move when leaving the canvas, register AFTER
        // it when arriving: the compositor must never hold an element that is
        // not, at that moment, an immediate child of the canvas.
        if (rec.placement === "canvas") {
          rec.unregister?.();
          rec.unregister = undefined;
        }
        const wasCanvas = rec.placement === "canvas";
        rec.placement = placement;
        parentFor(placement).appendChild(rec.host);
        syncSource(e, rec);
        if (wasCanvas || placement === "canvas") noteCompositedChange();
        orderDirty = true; // the move appended LAST — re-assert sibling order
        // Hand geometry custody over cleanly. Each owner writes properties the
        // other must not see left behind: a plane host with a stale absolute
        // transform would sit at a screen position instead of a world one, and
        // a canvas host with world-unit width/height would be copied at the
        // wrong size.
        if (wasCanvas !== (placement === "canvas")) {
          rec.host.style.transform = "";
          // Force the receiving owner to rewrite rather than trust its cache.
          rec.x = Number.NaN;
          geometryDirty = true;
        }
      }
      // A grabbed GL widget's chrome host stays in P1 (see promotable) but must
      // still stack over its P1 NEIGHBORS while dragged — the within-plane
      // z-pop, mirroring the quad's renderOrder-top within P2. (Neighbor GL
      // content can still overdraw the dragged card's gradient — the v1
      // uDraggedRect situation; an accepted transient until the app compositor
      // hook lands, design-005.)
      if (grabbed && !shouldLift) {
        if (rec.host.style.zIndex !== "1000") rec.host.style.zIndex = "1000";
      } else if (rec.host.style.zIndex !== "") {
        rec.host.style.zIndex = "";
      }
    }
    if (anyLifted !== inert) {
      inert = anyLifted;
      // PLANE-LEVEL inert (review finding — design-004 §1/§4 contract): two
      // writes cover every widget, including the lifted one and any host that
      // enters mid-drag; events fall through to the container, so canvas
      // facts keep flowing while content handlers go quiet.
      host.contentPlane.style.pointerEvents = inert ? "none" : "";
      host.liftedPlane.style.pointerEvents = inert ? "none" : "";
    }
  }

  return {
    name: "domWidgets",
    always: true, // store membership has no ECS stamp; the flush self-gates cheaply
    flush(_world: World) {
      const snapshot = store.getSnapshot();
      let membershipChanged = false;
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        membershipChanged = reconcile(snapshot);
      }
      // PARENTAGE BEFORE GEOMETRY. A promotion or demotion changes WHICH
      // writer owns a host's geometry — plane hosts are placed in world units
      // by `updateGeometry`, canvas hosts in screen px by `domWriteback` — and
      // it arms `geometryDirty` for the receiving writer. Running the geometry
      // pass first would consume that dirt one flush too early and leave a
      // demoted card at its old size for a frame, which is a visible flash on
      // every demotion rather than a subtle bookkeeping detail.
      //
      // Membership changes can also add/remove a lifted host → recompute inert
      // even without a Grab stamp (e.g. a lifted widget despawns mid-drag).
      if (promoteDirty || membershipChanged) {
        promoteDirty = false;
        updatePromote();
      }
      if (geometryDirty) {
        geometryDirty = false;
        updateGeometry();
      }
      if (opacityDirty) {
        opacityDirty = false;
        updateOpacity();
      }
      // AFTER promote: a re-parent appends last and must re-assert z order;
      // a fresh mount (createHost appends last) rides membershipChanged. A
      // plane parked by the focused element keeps the dirt ARMED — the flush
      // is `always`, so the first post-blur pass re-asserts the order.
      if (orderDirty || membershipChanged) {
        orderDirty = !updateOrder();
      }
    },
    hostFor: (entity) => hosts.get(entity)?.content,
    hostElementFor: (entity) => hosts.get(entity)?.host,
    canvasHostCount: () => {
      let n = 0;
      for (const rec of hosts.values()) if (rec.placement === "canvas") n++;
      return n;
    },
    compositedRevision: () => compositedRevision,
    compositedEntities() {
      const out: Entity[] = [];
      if (sourceCanvas === undefined) return out;
      // Read the DOM's own child sequence rather than the map's insertion
      // order: `updateOrder` keeps that sequence in sibling order, so this is
      // paint order by construction and cannot drift from what was sorted.
      const byNode = new Map<Element, Entity>();
      for (const [e, rec] of hosts) {
        if (rec.placement === "canvas") byNode.set(rec.host, e);
      }
      for (const child of Array.from(sourceCanvas.children)) {
        const e = byNode.get(child);
        if (e !== undefined) out.push(e);
      }
      return out;
    },
    hostCount: () => hosts.size,
    geometryWrites: () => geometryWrites,
    transitionAdapter() {
      return {
        id: "@ice/dom/widgets",
        plane: "dom",
        prepare(descriptor) {
          const retain = store.retainForTransition;
          if (retain === undefined) {
            throw new Error("ice: DOM transition retention needs a retainable mount store.");
          }
          const ordered: Entity[] = [];
          const entityByHost = new Map<HTMLDivElement, Entity>();
          for (const [entity, rec] of hosts) entityByHost.set(rec.host, entity);
          for (const plane of [host.contentPlane, host.liftedPlane]) {
            for (const child of Array.from(plane.children)) {
              const entity = entityByHost.get(child as HTMLDivElement);
              const rec = entity === undefined ? undefined : hosts.get(entity);
              if (entity !== undefined && rec !== undefined && !rec.hidden && !departingHosts.has(entity)) {
                ordered.push(entity);
              }
            }
          }

          // Revoke focus before taking ownership or moving a node. `blur` is a
          // user-code boundary and can synchronously start another navigation;
          // that newer prepare may move these hosts and mark them departing.
          const activeElement = doc.activeElement;
          if (activeElement !== null) {
            for (const entity of ordered) {
              const rec = hosts.get(entity);
              if (rec?.host.contains(activeElement)) {
                (activeElement as HTMLElement).blur?.();
                break;
              }
            }
          }
          const eligible = ordered.filter((entity) => {
            const rec = hosts.get(entity);
            return rec !== undefined && !rec.hidden && !departingHosts.has(entity);
          });
          const hold = retain(eligible);
          // `retain` synchronously notifies external-store subscribers. One
          // may start a newer navigation that already took these hosts; never
          // let this now-stale prepare steal them back from its departing
          // plane when the callback returns.
          const movable = hold.entities.filter((entity) => {
            const rec = hosts.get(entity);
            return rec !== undefined && !rec.hidden && !departingHosts.has(entity);
          });
          if (movable.length === 0) {
            hold.release();
            return null;
          }

          const departing = doc.createElement("div");
          departing.setAttribute("data-ice-departing-dom", "");
          departing.setAttribute("aria-hidden", "true");
          departing.setAttribute("inert", "");
          Object.assign(departing.style, {
            position: "absolute",
            left: "0",
            top: "0",
            transformOrigin: "0 0",
            willChange: "transform, opacity",
            pointerEvents: "none",
            opacity: "1",
          });
          const retained = new Set(movable);
          const moved = new Set<Entity>();
          try {
            if (descriptor.kind === "enter") {
              const parent = host.contentPlane.parentNode;
              if (parent === null) {
                throw new Error("ice: cannot retain DOM presentation from a detached content plane.");
              }
              parent.insertBefore(departing, host.contentPlane);
            } else {
              departing.style.zIndex = "1";
              const parent = host.liftedPlane.parentNode;
              if (parent === null) {
                throw new Error("ice: cannot retain DOM presentation from a detached lifted plane.");
              }
              parent.insertBefore(departing, host.liftedPlane);
            }

            for (const entity of movable) {
              const rec = hosts.get(entity);
              if (rec === undefined) continue;
              departingHosts.add(entity);
              moved.add(entity);
              // A retained host leaves the canvas for the departing container,
              // so it stops being a legal copy source for the duration. The
              // outgoing frame is presented from the retainer's own CSS
              // transform, which is the point of retention; `release` re-syncs.
              rec.unregister?.();
              rec.unregister = undefined;
              departing.appendChild(rec.host);
            }
            const initial = planeCssTransform(descriptor.fromCamera);
            departing.style.transform = `translate(${initial.tx}px, ${initial.ty}px) scale(${initial.scale})`;
          } catch (error) {
            for (const entity of moved) {
              const rec = hosts.get(entity);
              if (rec === undefined) continue;
              departingHosts.delete(entity);
              parentFor(rec.placement).appendChild(rec.host);
              syncSource(entity, rec);
            }
            departing.remove();
            hold.release();
            orderDirty = true;
            promoteDirty = true;
            throw error;
          }

          let released = false;
          const release = (): void => {
            if (released) return;
            released = true;
            // Hide before moving back so a stale main-plane transform can
            // never flash one outgoing host at destination coordinates.
            for (const entity of retained) {
              const rec = hosts.get(entity);
              if (rec === undefined) continue;
              rec.host.style.display = "none";
              departingHosts.delete(entity);
              parentFor(rec.placement).appendChild(rec.host);
              syncSource(entity, rec);
            }
            departing.remove();
            host.contentPlane.style.opacity = "";
            host.liftedPlane.style.opacity = "";
            hold.release();
            const snapshot = new Map(
              store.getSnapshot().map((entry) => [entry.entity, entry] as const),
            );
            for (const entity of retained) {
              const rec = hosts.get(entity);
              if (rec === undefined) continue;
              const entry = snapshot.get(entity);
              rec.hidden = entry?.hidden ?? true;
              rec.host.style.display = rec.hidden ? "none" : "";
            }
            orderDirty = true;
            promoteDirty = true;
          };

          const retainer: PresentationRetainer = {
            update(frame: PresentationTransitionFrame) {
              const transform = planeCssTransform(frame.outgoingCamera);
              departing.style.transform = `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`;
              departing.style.opacity = String(frame.outgoingOpacity);
              const incoming = frame.incomingOpacity >= 1 ? "" : String(frame.incomingOpacity);
              host.contentPlane.style.opacity = incoming;
              host.liftedPlane.style.opacity = incoming;
            },
            release,
          };
          return retainer;
        },
      };
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      // The compositor outlives this reflector (the device does too), so a
      // left-behind registration would keep it copying from hosts nothing
      // owns any more.
      for (const rec of hosts.values()) {
        rec.unregister?.();
        rec.unregister = undefined;
      }
    },
  };
}
