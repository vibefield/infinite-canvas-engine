/**
 * The widget tray (2026-07-19, James: "a tray container that when toggled on
 * it slide in from the bottom of the screen, and all kinds of widgets are well
 * organized there in grid layout … if you want any, you drag that one into
 * the canvas").
 *
 * Rendered INSIDE the canvas container (an <InfiniteCanvas> child) at
 * z-index 1 — the deliberate plane sandwich: resting widgets (content plane,
 * z-auto) slide UNDER the tray, while the one being dragged rides the lifted
 * plane (z-index 2, planes.ts) and floats OVER it on the way out.
 *
 * The drag-out is `ops.insertByDrag` (ghost adoption): the tile's pointerdown
 * `stopPropagation()`s (the sanctioned widget-content boundary — the native
 * down must not double-land) and hands the press to the engine, which spawns
 * the full-size ghost under the pointer and runs the ordinary drag stack —
 * lift, snap, folder drop targets. Release over the TRAY cancels (the
 * "put it back" gesture): a window-level pointerup inside the panel rect sets
 * CancelRequest at event time, and the ctl:spawn cancel sweep outruns the
 * queued up by phase order. Escape cancels via the engine keymap already.
 *
 * Tiles are STATIC previews (preview.ts silhouettes — the folder-mini rule),
 * never live widget mounts: cheap, non-interactive, scroll-friendly.
 */
import {
  InsertGhost,
  defineQuery,
  widgets as widgetRegistry,
  type CanvasEngine,
  type WidgetType,
} from "@ice/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { CARD_RADIUS } from "../widgets/CardShell";
import { previewBackground } from "../widgets/preview";

const ghostQ = defineQuery([InsertGhost]);

/** Tile label overrides; everything else derives from the type id. */
const LABELS: Record<string, string> = {
  "card-container": "Folder",
  "comment-card": "Comment",
  "debug-resizable": "Debug",
  "crystal-widget": "Crystal",
  "floating-cube-widget": "Cube",
};

function labelOf(type: string): string {
  const hit = LABELS[type];
  if (hit !== undefined) return hit;
  return type
    .replace(/-(card|widget|node)$/, (m) => (m === "-node" ? " node" : ""))
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Silhouette box: defaultSize fit into the tile art area, radius scaled. */
function silhouette(def: WidgetType): { w: number; h: number; r: number } {
  const s = Math.min(74 / def.defaultSize.w, 54 / def.defaultSize.h);
  return { w: def.defaultSize.w * s, h: def.defaultSize.h * s, r: Math.max(4, CARD_RADIUS * s) };
}

function Tile({ ce, def }: { ce: CanvasEngine; def: WidgetType }) {
  const sil = silhouette(def);
  const ref = useRef<HTMLDivElement>(null);

  // NATIVE pointerdown, not React's: React delegates at the REACT ROOT, which
  // sits ABOVE the canvas container — a synthetic-event stopPropagation fires
  // after the adapter's container listener already saw the down, so the real
  // down lands flagged, HandledByWidget latches the tick, and the folded
  // synthetic down is skipped too (the ghost strands; field-debugged
  // 2026-07-19). A native listener ON the tile stops the bubble BEFORE the
  // container — the sanctioned widget-content boundary, as designed.
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      e.stopPropagation(); // the down is the TILE's — never a canvas fact
      e.preventDefault();
      const container = el.closest("[data-ice-canvas]");
      if (container === null) return;
      const rect = container.getBoundingClientRect();
      const pointerId = e.pointerType === "touch" ? `touch:${e.pointerId}` : e.pointerType === "pen" ? "pen" : "mouse";
      const device = e.pointerType === "touch" ? ("touch" as const) : e.pointerType === "pen" ? ("pen" as const) : ("mouse" as const);
      ce.ops.insertByDrag(def.type, {
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
        pointerId,
        device,
        buttons: e.buttons || 1,
      });
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [ce, def.type]);

  return (
    // A plain div ON PURPOSE: this is a press-to-DRAG surface, not a button —
    // a native <button> would opt its own downs out of the canvas contract,
    // and there is no click action to expose to keyboard users (keyboard
    // insert is a future affordance, not a broken one).
    <div
      ref={ref}
      data-tray-tile={def.type}
      className="group flex cursor-grab flex-col items-center gap-1.5 rounded-xl p-2 transition-colors hover:bg-black/5 active:cursor-grabbing dark:hover:bg-white/10"
      style={{ touchAction: "none", userSelect: "none" }}
      title={`Drag onto the canvas to add a ${labelOf(def.type)}`}
    >
      <div className="flex h-[54px] w-[74px] items-center justify-center">
        <div
          className="transition-transform duration-150 group-hover:-translate-y-0.5 group-active:scale-90"
          style={{
            width: sil.w,
            height: sil.h,
            borderRadius: sil.r,
            background: previewBackground(def.type, def.surface),
            boxShadow: "0 4px 10px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.06)",
          }}
        />
      </div>
      <span className="max-w-[84px] truncate text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
        {labelOf(def.type)}
      </span>
    </div>
  );
}

export function WidgetTray({ ce }: { ce: CanvasEngine }) {
  const [open, setOpen] = useState(false);
  const [ghostLive, setGhostLive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const defs = useMemo(() => widgetRegistry.all(), []);

  // Chrome-grade ghost poll (CardShell's 60ms pattern): drives the
  // "release here to put it back" affordance while an insert drag is live.
  useEffect(() => {
    const id = setInterval(() => {
      let live = false;
      ce.world.query(ghostQ).each((b) => {
        if (b.count > 0) live = true;
      });
      setGhostLive(live);
    }, 60);
    return () => clearInterval(id);
  }, [ce]);

  // Release over the tray = cancel (the put-back). Window-level: container
  // capture retargets the up to the container, but it still BUBBLES to window
  // with real coordinates. The event-time CancelRequest wins over the queued
  // up by phase order (ctl:spawn sweep runs before ctl:recognize).
  useEffect(() => {
    const onUp = (e: PointerEvent): void => {
      const panel = panelRef.current;
      if (panel === null) return;
      let live = false;
      ce.world.query(ghostQ).each((b) => {
        if (b.count > 0) live = true;
      });
      if (!live) return;
      const r = panel.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        ce.ops.cancelActiveGestures();
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [ce]);

  // B toggles the tray (v/h/c are engine tool shortcuts; b is free).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== "b" && e.key !== "B") || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* The toggle pill — above the lifted plane like the rest of the chrome. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`absolute bottom-4 left-1/2 z-10 flex h-10 -translate-x-1/2 items-center gap-2 rounded-full px-4 text-sm font-medium shadow-lg transition-all ${
          open
            ? "bg-neutral-800 text-white dark:bg-white dark:text-neutral-900"
            : "bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
        }`}
        style={{ transform: `translate(-50%, ${open ? "-236px" : "0px"})` }}
        title="Widget tray (B)"
      >
        ❖ Widgets
        <span className="rounded bg-black/10 px-1 text-[10px] leading-4 dark:bg-white/20">B</span>
      </button>

      {/* The tray sheet — z-index 1: BETWEEN the content plane (resting
          widgets slide under) and the lifted plane (the dragged one floats
          over). data-canvas-interactive keeps stray presses out of the
          engine's recognizers (design-002 §8 opt-out). */}
      <div
        ref={panelRef}
        data-canvas-interactive=""
        className="absolute bottom-0 left-1/2 w-[min(880px,calc(100%-32px))] rounded-t-[22px] bg-white/90 shadow-[0_-12px_48px_rgba(0,0,0,0.25)] backdrop-blur-xl dark:bg-neutral-900/90"
        style={{
          zIndex: 1,
          transform: `translate(-50%, ${open ? "0%" : "112%"})`,
          transition: "transform 340ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
        onWheel={(e) => e.stopPropagation()} // scroll the tray, never zoom the canvas
      >
        <div className="flex items-center justify-between px-5 pt-3.5 pb-1">
          <span className="text-[13px] font-semibold tracking-tight text-neutral-800 dark:text-neutral-100">
            Widgets
          </span>
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {ghostLive ? "release here to put it back" : "drag a widget onto the canvas"}
          </span>
        </div>
        <div
          className="grid gap-1 overflow-y-auto px-4 pt-1 pb-5 transition-opacity"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
            maxHeight: 196,
            opacity: ghostLive ? 0.45 : 1,
          }}
        >
          {defs.map((def) => (
            <Tile key={def.type} ce={ce} def={def} />
          ))}
        </div>
      </div>
    </>
  );
}
