/**
 * The engine devtools panel (design-005 §4, M10).
 *
 * A standalone, dependency-free DOM panel that reads the world OUTSIDE the tick
 * — a verified-unrestricted read (reads are never gated; only writes are) — on a
 * fixed interval (250ms default). It is deliberately NOT a reflector: it never
 * registers with the reflector registry, never writes ECS, and refreshes on its
 * own timer rather than post-notify. Four engine tabs (design-005 §4):
 *
 *   POINTERS      live L0 pointers + L2 recognizers (kind, phase, watches, claims, routes)
 *   PLANES        reflectors flushed last frame + key entity-class counts
 *   SOVEREIGNTY   per-prefab store class + live count; a selected type's per-component badges
 *   LOOP          per-system run/skip/µs from engine telemetry, sorted by cost
 *
 * Telemetry: attach arms `engine.enableTelemetry()` by default (idempotent). The
 * LOOP tab and the PLANES reflector-flushed list both read `engine.lastFrame()`,
 * which is only populated once telemetry is armed and one step has run. Pass
 * `{ telemetry: false }` to leave it off — those two feeds then read as empty.
 *
 * Rendering is intentionally un-optimized: each refresh rebuilds the active tab's
 * content from scratch (via createElement + textContent — never innerHTML, since
 * pointer/prefab ids and component names are user/pack strings) once per 250ms.
 * That churn is a non-issue for a dev panel and keeps the reconcile trivial.
 *
 * Doc-sovereignty seams: the panel never imports doc internals. `keyOf` maps an
 * entity to its durable key (shown in the sovereignty detail header) and
 * `cellInDoc` reports whether a given component cell is actually committed to the
 * doc (badge "doc"); without them the badge falls back to the prefab registry's
 * static eligible set ("doc?" vs "rt").
 */
import {
  ClaimedBy,
  type Component,
  CursorVisual,
  Drag,
  defineQuery,
  type Engine,
  type Entity,
  type FrameTelemetry,
  GesturePhases,
  HandleSpec,
  LocalPointer,
  LongPress,
  Pinch,
  Pointer,
  PointerButtons,
  PointerScreen,
  Port,
  Position,
  type Prefab,
  PrefabId,
  prefabs,
  type Query,
  RoutedConnect,
  RoutedMarquee,
  RoutedMove,
  RoutedPan,
  RoutedResize,
  schemaMeta,
  Size,
  type Tag,
  Tap,
  Watches,
  WheelPan,
  WheelZoom,
  Wire,
  type World,
} from "@ice/core";

export interface DevtoolsOpts {
  /** Where to mount the panel (default: document.body). */
  readonly container?: HTMLElement;
  /** Refresh cadence in ms (default: 250). */
  readonly intervalMs?: number;
  /** Entity → durable key, for the sovereignty detail header (no doc import needed). */
  readonly keyOf?: (e: Entity) => unknown;
  /** True when component `c`'s cell on `e` is actually committed to the doc (badge "doc"). */
  readonly cellInDoc?: (e: Entity, c: Component) => boolean;
  /** Arm engine telemetry on attach (default: true — the LOOP/PLANES feeds need it). */
  readonly telemetry?: boolean;
}

export interface DevtoolsHandle {
  /** Remove the panel from the DOM and stop the refresh timer. */
  detach(): void;
}

// --- tabs ---

const TABS = ["pointers", "planes", "sovereignty", "loop"] as const;
type TabId = (typeof TABS)[number];
const TAB_LABELS: Record<TabId, string> = {
  pointers: "POINTERS",
  planes: "PLANES",
  sovereignty: "SOVEREIGNTY",
  loop: "LOOP",
};

// --- queries (defined once; catalog reads only) ---

const pointerQ = defineQuery([Pointer]);
const prefabIdQ = defineQuery([PrefabId]);
const widgetQ = defineQuery([PrefabId, Position, Size]);
const portQ = defineQuery([Port]);
const wireQ = defineQuery([Wire]);
const handleQ = defineQuery([HandleSpec]);
const cursorQ = defineQuery([CursorVisual]);

/** Recognizer identity IS the kind component's presence (design-003 §4.2). */
const RECOGNIZER_KINDS: ReadonlyArray<{ label: string; q: Query }> = [
  { label: "Drag", q: defineQuery([Drag]) },
  { label: "Tap", q: defineQuery([Tap]) },
  { label: "LongPress", q: defineQuery([LongPress]) },
  { label: "Pinch", q: defineQuery([Pinch]) },
  { label: "WheelPan", q: defineQuery([WheelPan]) },
  { label: "WheelZoom", q: defineQuery([WheelZoom]) },
];

const ROUTE_TAGS: ReadonlyArray<{ label: string; tag: Tag }> = [
  { label: "move", tag: RoutedMove },
  { label: "resize", tag: RoutedResize },
  { label: "connect", tag: RoutedConnect },
  { label: "marquee", tag: RoutedMarquee },
  { label: "pan", tag: RoutedPan },
];

// --- palette (dark, fixed) ---

const C = {
  bg: "#16181d",
  panel: "#1c1f26",
  border: "#2a2e37",
  text: "#cdd3de",
  dim: "#8b93a1",
  accent: "#5aa9e6",
  head: "#0f1115",
};
const BADGE = { doc: "#2f6d43", eligible: "#2a5f87", runtime: "#3a3f49", tag: "#4a3a68" };

// --- small DOM builders ---

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style?: Partial<CSSStyleDeclaration>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(doc: Document, text: string): HTMLDivElement {
  return el(doc, "div", {
    padding: "2px 6px",
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }, text);
}

function badge(doc: Document, label: string, color: string): HTMLSpanElement {
  return el(doc, "span", {
    display: "inline-block",
    padding: "0 4px",
    marginLeft: "4px",
    borderRadius: "3px",
    background: color,
    color: C.text,
    fontSize: "9px",
    verticalAlign: "middle",
  }, label);
}

function heading(doc: Document, text: string): HTMLDivElement {
  return el(doc, "div", {
    padding: "4px 6px",
    color: C.dim,
    textTransform: "uppercase",
    fontSize: "9px",
    letterSpacing: "0.06em",
    position: "sticky",
    top: "0",
    background: C.panel,
  }, text);
}

function empty(doc: Document, text: string): HTMLDivElement {
  return el(doc, "div", { padding: "8px 6px", color: C.dim, fontStyle: "italic" }, text);
}

// --- render context ---

interface PanelState {
  active: TabId;
  collapsed: boolean;
  selectedPrefab: string | null;
  /** Reflector names seen flushed across frames — a stable list grows as they fire. */
  readonly seenReflectors: Set<string>;
}

interface RenderCtx {
  readonly doc: Document;
  readonly world: World;
  readonly engine: Engine;
  readonly opts: DevtoolsOpts;
  readonly state: PanelState;
}

// --- POINTERS tab ---

function renderPointers({ doc, world }: RenderCtx): HTMLElement[] {
  const out: HTMLElement[] = [heading(doc, "pointers")];
  const pointers = world.entities(pointerQ);
  if (pointers.length === 0) out.push(empty(doc, "no live pointers"));
  for (const e of pointers) {
    const id = world.readField(e, Pointer, "id") ?? "?";
    const device = world.readField(e, Pointer, "device") ?? "?";
    const local = world.hasTag(e, LocalPointer) ? "·local" : "";
    const sx = world.has(e, PointerScreen) ? world.readField(e, PointerScreen, "x") : undefined;
    const sy = world.has(e, PointerScreen) ? world.readField(e, PointerScreen, "y") : undefined;
    const btns = world.has(e, PointerButtons) ? world.readField(e, PointerButtons, "buttons") : undefined;
    const claim = world.getRelation(e, ClaimedBy);
    const at = sx === undefined ? "" : ` (${fmt(sx)},${fmt(sy ?? 0)})`;
    const b = btns ? ` btn=${btns}` : "";
    const c = claim === undefined ? "" : ` →claim #${claim}`;
    const r = row(doc, `#${e} ${device}${local} "${id}"${at}${b}${c}`);
    r.dataset.row = "pointer";
    out.push(r);
  }

  out.push(heading(doc, "recognizers"));
  let anyRec = false;
  for (const kind of RECOGNIZER_KINDS) {
    for (const e of world.entities(kind.q)) {
      anyRec = true;
      const phase = GesturePhases.current(world, e) ?? "—";
      const watches = world.getRelations(e, Watches);
      const claims = world.getReverse(e, ClaimedBy);
      const routes = ROUTE_TAGS.filter((rt) => world.hasTag(e, rt.tag)).map((rt) => rt.label);
      const w = watches.length ? ` watches:[${watches.map((p) => `#${p}`).join(",")}]` : "";
      const cl = claims.length ? ` claims:[${claims.map((p) => `#${p}`).join(",")}]` : "";
      const ro = routes.length ? ` routes:${routes.join("+")}` : "";
      const r = row(doc, `#${e} ${kind.label} [${phase}]${w}${cl}${ro}`);
      r.dataset.row = "recognizer";
      out.push(r);
    }
  }
  if (!anyRec) out.push(empty(doc, "no live recognizers"));
  return out;
}

// --- PLANES tab ---

function renderPlanes({ doc, world, engine, state }: RenderCtx): HTMLElement[] {
  const out: HTMLElement[] = [heading(doc, "reflectors (flushed last frame)")];
  const frame = engine.lastFrame();
  const flushedNow = new Set(frame?.reflectorsFlushed ?? []);
  for (const name of flushedNow) state.seenReflectors.add(name);
  if (state.seenReflectors.size === 0) {
    out.push(empty(doc, frame ? "no reflectors registered" : "enable telemetry + step to list reflectors"));
  }
  for (const name of [...state.seenReflectors].sort()) {
    const r = row(doc, name);
    r.appendChild(
      flushedNow.has(name) ? badge(doc, "flushed", BADGE.eligible) : badge(doc, "idle", BADGE.runtime),
    );
    r.dataset.row = "reflector";
    out.push(r);
  }

  out.push(heading(doc, "entity counts"));
  const counts: ReadonlyArray<[string, number]> = [
    ["widgets", world.count(widgetQ)],
    ["ports", world.count(portQ)],
    ["wires", world.count(wireQ)],
    ["chrome handles", world.count(handleQ)],
    ["cursors", world.count(cursorQ)],
  ];
  for (const [label, n] of counts) {
    const r = row(doc, `${label}: ${n}`);
    r.dataset.row = "count";
    out.push(r);
  }
  return out;
}

// --- SOVEREIGNTY tab ---

function renderSovereignty(ctx: RenderCtx): HTMLElement[] {
  const { doc, world, state } = ctx;
  const out: HTMLElement[] = [heading(doc, "prefabs (click a row to inspect)")];

  // Bucket live PrefabId'd entities by their prefab id (count + a first live handle).
  const buckets = new Map<string, { count: number; first: Entity }>();
  for (const e of world.entities(prefabIdQ)) {
    const id = world.readField(e, PrefabId, "id");
    if (id === undefined || id === null) continue;
    const b = buckets.get(id);
    if (b) b.count++;
    else buckets.set(id, { count: 1, first: e });
  }

  const all = prefabs.all();
  if (all.length === 0) out.push(empty(doc, "no prefabs registered"));
  for (const p of all) {
    const bucket = buckets.get(p.id);
    const n = bucket?.count ?? 0;
    const r = el(doc, "div", {
      padding: "2px 6px",
      borderBottom: `1px solid ${C.border}`,
      cursor: "pointer",
      background: state.selectedPrefab === p.id ? C.head : "transparent",
    });
    r.textContent = `${p.id}  ×${n}`;
    r.appendChild(badge(doc, p.store, storeColor(p.store)));
    r.dataset.row = "prefab";
    r.dataset.prefab = p.id;
    out.push(r);
  }

  // Narrow through a const: `heading()` between the null check and use would
  // otherwise invalidate the narrowing of the mutable `state.selectedPrefab`.
  const sel = state.selectedPrefab;
  if (sel !== null) {
    const p = prefabs.get(sel);
    const bucket = buckets.get(sel);
    out.push(heading(doc, `components — ${sel}`));
    if (p === undefined || bucket === undefined) {
      out.push(empty(doc, "no live entity of this type"));
    } else {
      out.push(...renderEntityCells(ctx, p, bucket.first));
    }
  }
  return out;
}

/**
 * The selected entity's per-component sovereignty badges. The candidate set is
 * the prefab's `eligible` components (essential ∪ optional ∪ PrefabId) probed by
 * `world.has` — the public introspection surface. That set IS the doc-eligible
 * set for a durable prefab, so the badge reads straight off it:
 *   durable + cellInDoc(e,c) → "doc"  · durable → "doc?"  · runtime/ephemeral → "rt".
 * (Runtime cells attached BEYOND the prefab's declared set aren't enumerable
 * through the public World type, so they don't appear — a known v1 limitation.)
 */
function renderEntityCells(ctx: RenderCtx, p: Prefab, e: Entity): HTMLElement[] {
  const { doc, world, opts } = ctx;
  const out: HTMLElement[] = [];
  out.push(row(doc, opts.keyOf ? `entity #${e}   key: ${String(opts.keyOf(e))}` : `entity #${e}`));

  const durable = p.store === "durable";
  for (const c of p.eligible) {
    if (!world.has(e, c)) continue;
    const name = schemaMeta.component(c)?.name ?? "(component)";
    const r = row(doc, name);
    if (durable && opts.cellInDoc?.(e, c) === true) r.appendChild(badge(doc, "doc", BADGE.doc));
    else if (durable) r.appendChild(badge(doc, "doc?", BADGE.eligible));
    else r.appendChild(badge(doc, "rt", BADGE.runtime));
    r.dataset.row = "component";
    out.push(r);
  }
  return out;
}

function storeColor(store: string): string {
  if (store === "durable") return BADGE.doc;
  if (store === "runtime") return BADGE.eligible;
  return BADGE.tag;
}

// --- LOOP tab ---

function renderLoop({ doc, engine }: RenderCtx): HTMLElement[] {
  const frame = engine.lastFrame();
  if (frame === undefined) {
    return [heading(doc, "loop"), empty(doc, "no telemetry yet — arm it and step the engine")];
  }
  const out: HTMLElement[] = [heading(doc, "loop")];
  const ran = frame.systems.filter((s) => s.ran).length;
  const total = frame.systems.length;
  out.push(row(doc, `tick #${frame.tick}  ${fmt(frame.totalMicros)}µs  ran ${ran}/${total}`));

  out.push(heading(doc, "systems (by cost)"));
  const sorted = [...frame.systems].sort((a, b) => b.micros - a.micros);
  if (sorted.length === 0) out.push(empty(doc, "no systems registered"));
  for (const s of sorted) {
    const mark = s.ran ? "●" : "○";
    const r = row(doc, `${mark} ${s.phase}/${s.system}  ${fmt(s.micros)}µs`);
    r.style.color = s.ran ? C.text : C.dim;
    r.dataset.row = "system";
    out.push(r);
  }

  if (frame.phaseFlushMicros.size > 0) {
    out.push(heading(doc, "phase flush"));
    for (const [phase, micros] of frame.phaseFlushMicros) {
      const r = row(doc, `${phase}  ${fmt(micros)}µs`);
      r.dataset.row = "phase";
      out.push(r);
    }
  }
  return out;
}

const RENDERERS: Record<TabId, (ctx: RenderCtx) => HTMLElement[]> = {
  pointers: renderPointers,
  planes: renderPlanes,
  sovereignty: renderSovereignty,
  loop: renderLoop,
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// --- attach ---

export function attachDevtools(engine: Engine, opts: DevtoolsOpts = {}): DevtoolsHandle {
  const world = engine.world;
  const container = opts.container ?? document.body;
  const doc = container.ownerDocument ?? document;
  if (opts.telemetry !== false) engine.enableTelemetry();

  const state: PanelState = {
    active: "pointers",
    collapsed: false,
    selectedPrefab: null,
    seenReflectors: new Set(),
  };
  let detached = false;

  const root = el(doc, "div", {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    width: "360px",
    maxHeight: "70vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: C.bg,
    color: C.text,
    font: "11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
    border: `1px solid ${C.border}`,
    borderRadius: "6px",
    boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
    zIndex: "2147483000",
  });
  root.dataset.iceDevtools = "";

  // Header: title + collapse toggle.
  const header = el(doc, "div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px",
    background: C.head,
    borderBottom: `1px solid ${C.border}`,
    cursor: "default",
    userSelect: "none",
  });
  header.appendChild(el(doc, "span", { color: C.accent, fontWeight: "600" }, "ice devtools"));
  const collapseBtn = el(doc, "button", {
    background: "transparent",
    border: "none",
    color: C.text,
    cursor: "pointer",
    font: "inherit",
    padding: "0 4px",
  }, "▾");
  collapseBtn.dataset.collapse = "";
  header.appendChild(collapseBtn);
  root.appendChild(header);

  // Tab bar (persistent buttons — only the content below is rebuilt).
  const tabBar = el(doc, "div", {
    display: "flex",
    borderBottom: `1px solid ${C.border}`,
    background: C.panel,
  });
  const tabButtons = new Map<TabId, HTMLButtonElement>();
  for (const id of TABS) {
    const btn = el(doc, "button", {
      flex: "1",
      padding: "4px 2px",
      background: "transparent",
      border: "none",
      borderRight: `1px solid ${C.border}`,
      color: C.dim,
      cursor: "pointer",
      font: "inherit",
      fontSize: "9px",
      letterSpacing: "0.04em",
    }, TAB_LABELS[id]);
    btn.dataset.tab = id;
    btn.addEventListener("click", () => {
      state.active = id;
      render();
    });
    tabButtons.set(id, btn);
    tabBar.appendChild(btn);
  }
  root.appendChild(tabBar);

  const content = el(doc, "div", { flex: "1", overflowY: "auto", overflowX: "hidden" });
  root.appendChild(content);

  // Delegated click: selecting a prefab row (content is rebuilt every render).
  content.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement | null;
    const prefabRow = target?.closest<HTMLElement>("[data-prefab]");
    if (prefabRow?.dataset.prefab) {
      state.selectedPrefab = prefabRow.dataset.prefab;
      render();
    }
  });

  collapseBtn.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    render();
  });

  const ctx: RenderCtx = { doc, world, engine, opts, state };

  function render(): void {
    if (detached) return;
    for (const [id, btn] of tabButtons) {
      const on = id === state.active && !state.collapsed;
      btn.style.color = on ? C.text : C.dim;
      btn.style.background = on ? C.bg : "transparent";
    }
    collapseBtn.textContent = state.collapsed ? "▸" : "▾";
    if (state.collapsed) {
      tabBar.style.display = "none";
      content.style.display = "none";
      return;
    }
    tabBar.style.display = "flex";
    content.style.display = "block";
    content.replaceChildren(...RENDERERS[state.active](ctx));
  }

  container.appendChild(root);
  render();
  const timer = setInterval(render, opts.intervalMs ?? 250);

  return {
    detach(): void {
      if (detached) return;
      detached = true;
      clearInterval(timer);
      root.remove();
    },
  };
}
