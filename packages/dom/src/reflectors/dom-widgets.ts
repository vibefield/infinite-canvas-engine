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
  StackZ,
  defineQuery,
  widgets,
  type Entity,
  type MountEntry,
  type ReflectorDef,
  type WidgetMountStore,
  type World,
} from "@ice/core";

/** The two planes a host can live in (design-004 §1: P1 content, P3 lifted). */
export interface DomWidgetsHost {
  readonly contentPlane: HTMLElement;
  readonly liftedPlane: HTMLElement;
}

interface HostRec {
  /** The absolute-positioned, world-unit host div; re-parents content↔lifted on promote. */
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
  /** Last-applied parent: true = lifted plane, false = content plane. */
  lifted: boolean;
  /** Last-applied `Opacity.a` (1 = the no-component default, style cleared). */
  opacity: number;
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
const stackZQuery = defineQuery([StackZ]);

function writeGeom(el: HTMLDivElement, x: number, y: number, w: number, h: number): void {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
}

export interface DomWidgetsReflector extends ReflectorDef {
  /** The entity's content element (the `data-ice-content` portal target), or undefined if not hosted. */
  hostFor(entity: Entity): HTMLElement | undefined;
  /** Live host count (= mounted widgets, visible + kept-mounted). */
  hostCount(): number;
  /** Geometry writes so far — one per enter, one per changed host, zero for unchanged (churn instrument). */
  geometryWrites(): number;
  /** Tear down the private observers (call when unregistering the reflector before the world dies). */
  dispose(): void;
}

export function createDomWidgetsReflector(
  host: DomWidgetsHost,
  world: World,
  store: WidgetMountStore,
): DomWidgetsReflector {
  const doc = host.contentPlane.ownerDocument;
  const hosts = new Map<Entity, HostRec>();
  let lastSnapshot: readonly MountEntry[] | undefined;
  let geometryWrites = 0;
  /** True while any host is lifted → all content is inerted (pinned drag contract). */
  let inert = false;

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
    // Within-plane stacking IS StackZ (design-004 §1 "StackZ orders normally"
    // — unimplemented until 2026-07-18, James: the comment box painted over
    // its members; DOM paint order was silently mount order).
    world.reactive.observeQuery(stackZQuery, () => { orderDirty = true; }, { cols: [StackZ] }),
  ];

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
    const lifted = world.has(e, Grab) && promotable(e);
    (lifted ? host.liftedPlane : host.contentPlane).appendChild(el);
    return { host: el, content, x: g.x, y: g.y, w: g.w, h: g.h, hidden: false, lifted, opacity };
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
      rec.host.remove(); // React unmounts via the store; the host div goes too
      hosts.delete(e);
      membershipChanged = true;
    }
    return membershipChanged;
  }

  /** Change-only geometry rewrite over the live hosts (graybox pattern). */
  function updateGeometry(): void {
    for (const [e, rec] of hosts) {
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
   * Within-plane stacking = StackZ (design-004 §1). DOM paint order is the
   * plane's child order, so each plane's hosts are kept DOM-sorted by
   * (StackZ asc, entity asc) — a low-z comment box paints UNDER the members
   * it wraps even though its host mounted last. Reorder is change-only (a
   * DOM sequence already in z order touches nothing) and skips a plane while
   * it contains the focused element (re-appending would blur a mid-rename
   * input; the next dirt re-asserts the order).
   */
  function updateOrder(): void {
    for (const plane of [host.contentPlane, host.liftedPlane]) {
      const active = doc.activeElement;
      if (active !== null && active !== doc.body && plane.contains(active)) continue;
      const mine: Array<{ el: HTMLDivElement; z: number; e: Entity }> = [];
      for (const [e, rec] of hosts) {
        if (rec.host.parentNode !== plane) continue;
        mine.push({ el: rec.host, z: world.get(e, StackZ)?.z ?? 0, e });
      }
      if (mine.length < 2) continue;
      const target = [...mine].sort((a, b) => a.z - b.z || Number(a.e) - Number(b.e));
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
      for (const m of target) plane.appendChild(m.el); // moves, in z order
    }
  }

  /** Change-only opacity rewrite over the live hosts (graybox pattern). */
  function updateOpacity(): void {
    for (const [e, rec] of hosts) {
      const o = readOpacity(e);
      if (o !== rec.opacity) {
        // 1 clears the property — the no-component host carries no inline style.
        rec.host.style.opacity = o === 1 ? "" : String(o);
        rec.opacity = o;
      }
    }
  }

  /** Re-parent promoted hosts content↔lifted and toggle the global inert state. */
  function updatePromote(): void {
    let anyLifted = false;
    for (const [e, rec] of hosts) {
      const grabbed = world.has(e, Grab);
      const shouldLift = grabbed && promotable(e);
      if (shouldLift) anyLifted = true;
      if (shouldLift !== rec.lifted) {
        rec.lifted = shouldLift;
        // appendChild MOVES the existing node between planes — the React portal
        // (targeting the content child) survives the move.
        (shouldLift ? host.liftedPlane : host.contentPlane).appendChild(rec.host);
        orderDirty = true; // the move appended LAST — re-assert StackZ order
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
      if (geometryDirty) {
        geometryDirty = false;
        updateGeometry();
      }
      if (opacityDirty) {
        opacityDirty = false;
        updateOpacity();
      }
      // Membership changes can add/remove a lifted host → recompute inert even
      // without a Grab stamp (e.g. a lifted widget despawns mid-drag).
      if (promoteDirty || membershipChanged) {
        promoteDirty = false;
        updatePromote();
      }
      // AFTER promote: a re-parent appends last and must re-assert z order;
      // a fresh mount (createHost appends last) rides membershipChanged.
      if (orderDirty || membershipChanged) {
        orderDirty = false;
        updateOrder();
      }
    },
    hostFor: (entity) => hosts.get(entity)?.content,
    hostCount: () => hosts.size,
    geometryWrites: () => geometryWrites,
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
    },
  };
}
