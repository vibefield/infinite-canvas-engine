/**
 * The devtools dock — ONE draggable window hosting all three tools
 * (2026-07-13, James: "make the 3 tools into one draggable panel").
 *
 * strata's observer + profiler and our GL panel each mount `position: fixed`
 * into their own corner. The dock does NOT re-implement any of them (standing
 * rule: wrap first-party tools): it is a fixed, draggable shell with three
 * stacked slots; each tool mounts into its slot via its own `container`
 * option, and dock-scoped CSS de-windows them (`position: static`, full
 * width, no border/shadow) so they read as sections of one panel. Their own
 * behavior is untouched — the observer keeps its tabs/collapse/vertical
 * resize (its header drag goes inert: left/top are ignored at static), the
 * profiler + GL strips keep their click-to-expand.
 *
 * Slot order is fixed by the dock, not by mount order: profiler and GL are
 * one-line summary strips, the observer is the deep-dive — strips on top.
 * Layout (x/y/width/open) persists to localStorage, same as the observer:
 * schema edits full-reload the page by design; the dock must stay put.
 */

export type DockCorner = "tl" | "tr" | "bl" | "br";

export type DockSlotId = "profiler" | "gl" | "observer";

export interface DockOptions {
  /** Where the dock mounts (default: document.body). */
  readonly container?: HTMLElement;
  /** Initial corner when nothing is persisted yet (default "tr"). */
  readonly corner?: DockCorner;
  /** Header title (default "ice devtools"). */
  readonly title?: string;
  /** Initial width in px when nothing is persisted yet (default 420). */
  readonly width?: number;
}

export interface Dock {
  readonly el: HTMLElement;
  /** The mount element for one tool. Empty slots are display:none via CSS. */
  slot(id: DockSlotId): HTMLElement;
  dispose(): void;
}

const LS_KEY = "ice-dock:layout";
const STYLE_ID = "ice-dock-style";
const MARGIN = 8;
const KEEP = 90; // px that must stay on screen so the header is always grabbable
const SLOT_ORDER: readonly DockSlotId[] = ["profiler", "gl", "observer"];

interface Layout {
  x?: number;
  y?: number;
  w?: number;
  open?: boolean;
}

function loadLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Layout;
  } catch {
    return {};
  }
}

function saveLayout(patch: Layout): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...loadLayout(), ...patch }));
  } catch {
    /* private mode / quota — non-fatal for a dev tool */
  }
}

// strata-obs's window chrome, verbatim, plus the de-windowing overrides for
// the hosted tools. `!important` beats both the tools' own stylesheets and
// the observer's inline width restored from ITS localStorage layout.
const CSS = `
.ice-dock { position: fixed; z-index: 99999; width: 420px; min-width: 340px; max-width: 92vw;
  background: rgba(13,17,23,.96); border: 1px solid #30363d; border-radius: 10px;
  color: #e6edf3; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: 0 8px 28px rgba(0,0,0,.45); overflow: hidden; resize: horizontal; }
.ice-dock * { box-sizing: border-box; }
.ice-dock.collapsed { resize: none; }
.ice-dock.dragging { opacity: .92; cursor: grabbing; }
.ice-dock-head { display: flex; align-items: center; gap: 7px; padding: 7px 10px; cursor: grab;
  background: rgba(22,27,34,.96); user-select: none; }
.ice-dock-grip { color: #484f58; }
.ice-dock-name { font-weight: 700; color: #56d4dd; }
.ice-dock-btn { background: none; border: none; color: #8b949e; cursor: pointer; font: inherit;
  padding: 2px 6px; margin-left: auto; }
.ice-dock-btn:hover { color: #e6edf3; }
.ice-dock-body { max-height: calc(100vh - 96px); overflow-y: auto; }
.ice-dock.collapsed .ice-dock-body { display: none; }
.ice-dock-slot { border-top: 1px solid #30363d; }
.ice-dock-slot:empty { display: none; }

/* De-window the hosted tools — the dock is the window now. */
.ice-dock .strata-obs, .ice-dock .strata-prof, .ice-dock .ice-gl {
  position: static !important; width: auto !important; min-width: 0 !important;
  border: none !important; border-radius: 0 !important; box-shadow: none !important; }
.ice-dock .strata-obs { resize: vertical !important; }
.ice-dock .strata-obs-head { cursor: default; }
.ice-dock .strata-prof-body, .ice-dock .ice-gl-body { min-width: 0; }
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function createDock(opts: DockOptions = {}): Dock {
  const container = opts.container ?? document.body;
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  injectStyle(doc);

  const clampPos = (x: number, y: number, w: number): { x: number; y: number } => {
    const maxX = win.innerWidth - KEEP;
    const minX = Math.min(MARGIN, MARGIN - (w - KEEP));
    const maxY = win.innerHeight - 34;
    return { x: Math.min(Math.max(x, minX), maxX), y: Math.min(Math.max(y, MARGIN), maxY) };
  };

  const root = doc.createElement("div");
  root.className = "ice-dock";

  const head = doc.createElement("div");
  head.className = "ice-dock-head";
  const grip = doc.createElement("span");
  grip.className = "ice-dock-grip";
  grip.setAttribute("aria-hidden", "true");
  grip.textContent = "⠿";
  const name = doc.createElement("span");
  name.className = "ice-dock-name";
  name.textContent = opts.title ?? "ice devtools";
  const collapse = doc.createElement("button");
  collapse.type = "button";
  collapse.className = "ice-dock-btn";
  collapse.title = "Collapse";
  head.append(grip, name, collapse);

  const body = doc.createElement("div");
  body.className = "ice-dock-body";
  const slots = new Map<DockSlotId, HTMLElement>();
  for (const id of SLOT_ORDER) {
    const s = doc.createElement("div");
    s.className = "ice-dock-slot";
    s.dataset.slot = id;
    body.appendChild(s);
    slots.set(id, s);
  }

  root.append(head, body);
  container.appendChild(root);

  // restore layout: width, then position (clamped), then open state
  const l = loadLayout();
  const w = typeof l.w === "number" ? l.w : (opts.width ?? 420);
  root.style.width = `${w}px`;
  const corner = opts.corner ?? "tr";
  const fx = corner === "tl" || corner === "bl" ? 16 : win.innerWidth - w - 16;
  const fy = corner === "tl" || corner === "tr" ? 16 : win.innerHeight - 220;
  const p = clampPos(l.x ?? fx, l.y ?? fy, w);
  root.style.left = `${p.x}px`;
  root.style.top = `${p.y}px`;
  let open = l.open ?? true;
  const applyOpen = (): void => {
    root.classList.toggle("collapsed", !open);
    collapse.textContent = open ? "▾" : "▸";
  };
  applyOpen();
  collapse.addEventListener("click", () => {
    open = !open;
    saveLayout({ open });
    applyOpen();
  });

  let drag: { id: number; sx: number; sy: number; ox: number; oy: number } | null = null;
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button") !== null) return; // let buttons be buttons
    const r = root.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    if (typeof head.setPointerCapture === "function") {
      try {
        head.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events (tests) have no active pointer */
      }
    }
    root.classList.add("dragging");
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    if (drag?.id !== e.pointerId) return;
    const q = clampPos(drag.ox + (e.clientX - drag.sx), drag.oy + (e.clientY - drag.sy), root.offsetWidth);
    root.style.left = `${q.x}px`;
    root.style.top = `${q.y}px`;
  });
  const endDrag = (e: PointerEvent): void => {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    root.classList.remove("dragging");
    const r = root.getBoundingClientRect();
    saveLayout({ x: r.left, y: r.top });
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);

  const onWinResize = (): void => {
    const r = root.getBoundingClientRect();
    const q = clampPos(r.left, r.top, root.offsetWidth);
    root.style.left = `${q.x}px`;
    root.style.top = `${q.y}px`;
  };
  win.addEventListener("resize", onWinResize);
  const ro = new ResizeObserver(() => {
    saveLayout({ w: root.offsetWidth });
  });
  ro.observe(root);

  let disposed = false;
  return {
    el: root,
    slot(id) {
      // SLOT_ORDER covers the full DockSlotId union — the map is total.
      return slots.get(id) as HTMLElement;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      win.removeEventListener("resize", onWinResize);
      ro.disconnect();
      root.remove();
    },
  };
}
