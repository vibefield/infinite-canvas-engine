/**
 * The view — v2 CursorLayer.tsx ported to v3: the loop body is now a
 * REGISTERED REFLECTOR (the engine's only sanctioned DOM writer, post-notify),
 * and `startRafLoop(engine)` drives the frame contract instead of a hand
 *-rolled tick. The dot grid is @ice/dom's grid reflector — v1's shader
 * verbatim, tuned for #0d1117 exactly like the prototype.
 *
 * Coordinate note (unchanged from v2): the LOCAL cursor follows my own screen
 * pointer and is drawn directly; REMOTE cursors are WORLD-anchored (shared
 * canvas) and project through MY camera, so they pan/zoom with the content.
 */
import { useEffect, useRef } from "react";
import {
  Camera,
  CursorVisual,
  Follows,
  HandleSpec,
  LocalPointer,
  Pointer,
  PointerScreen,
  Position,
  Selected,
  SelectionBox,
  Size,
  StackZ,
  Targets,
  Viewport,
  defineQuery,
  type Entity,
  type World,
} from "@ice/core";
import { attachPointerAdapter, createCanvasHost, createGridReflector, startRafLoop } from "@ice/dom";
import { attachDevtools } from "@ice/devtools";
import { worldToScreen } from "@ice/kernel";
import { zoomToFit } from "./camera";
import { Cur, RING_RADIUS_PX, RemoteInfo, WidgetVisual } from "./components";
import { ObserverPanel } from "./ObserverPanel";
import { createPointerWorld, type PointerWorld } from "./world";
import { ZoomPill } from "./ZoomPill";

type CursorNode = { el: HTMLDivElement; kind: "local" | "remote" };

function makeRing(): CursorNode {
  const el = document.createElement("div");
  el.className = "cur ring";
  return { el, kind: "local" };
}

function makeRemote(color: string, label: string): CursorNode {
  const el = document.createElement("div");
  el.className = "cur remote";
  el.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="${color}" aria-hidden="true"><path d="M1.5 1.5 L1.5 16 L5.4 12.2 L8.1 18.5 L10.6 17.4 L7.9 11.3 L13.5 11.3 Z"/></svg><span class="lbl" style="background:${color}">${label}</span>`;
  return { el, kind: "remote" };
}

function hexToRgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cursorQ = defineQuery([Cur, CursorVisual]);
const widgetQ = defineQuery([Position, Size, StackZ, WidgetVisual]);
const localPtrQ = defineQuery([Pointer, PointerScreen, LocalPointer]);
const boxQ = defineQuery([SelectionBox]);
const handleQ = defineQuery([HandleSpec, Position, Size]);

export function CursorLayer() {
  const stageRef = useRef<HTMLDivElement>(null);
  // The world is created once and lives in a ref so it's available on the first
  // render (the observer reads it) and survives StrictMode's effect remount.
  const pwRef = useRef<PointerWorld | null>(null);
  if (!pwRef.current) pwRef.current = createPointerWorld();
  const pw = pwRef.current;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { world, engine, stack } = pw;

    const host = createCanvasHost(stage);

    // dot grid — v1's shader verbatim via @ice/dom, tuned for #0d1117.
    const grid = createGridReflector(host, { dotColor: [0.42, 0.45, 0.5] });
    const unregGrid = engine.registerReflector(grid);

    let fitted = false;
    const syncViewport = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      world.setResource(Viewport, { w, h, dpr });
      if (!fitted && w > 0 && h > 0) {
        fitted = true; // fit once, on the first known viewport — a later resize won't reset the view
        zoomToFit(world);
      }
    };
    syncViewport();
    const ro = new ResizeObserver(syncViewport);
    ro.observe(stage);

    const nodes = new Map<Entity, CursorNode>();
    const widgetNodes = new Map<Entity, HTMLDivElement>();
    const chromeNodes = new Map<Entity, HTMLDivElement>();
    let selboxNode: HTMLDivElement | null = null;
    let marqueeNode: HTMLDivElement | null = null;

    const flush = (w: World): void => {
      const cam = w.getResource(Camera) ?? { x: 0, y: 0, zoom: 1, gesturing: false };

      // targeted widgets — each local pointer's disc-picked hover target
      const targeted = new Set<Entity>();
      w.query(localPtrQ).each((b) => {
        for (const r of b) {
          const tgt = w.getRelation(b.entity(r), Targets);
          if (tgt !== undefined) targeted.add(tgt);
        }
      });

      // cursors — local drawn at screen coords; remote projected through MY camera
      const seen = new Set<Entity>();
      w.query(cursorQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          seen.add(e);
          let node = nodes.get(e);
          if (!node) {
            if (w.read(e, CursorVisual).kind === "local") {
              node = makeRing();
            } else {
              const info = w.has(e, RemoteInfo) ? w.read(e, RemoteInfo) : undefined;
              node = makeRemote(info?.color ?? "#ffffff", info?.label ?? "");
            }
            stage.appendChild(node.el);
            nodes.set(e, node);
          }
          const cur = w.read(e, Cur);
          const sp = node.kind === "remote" ? worldToScreen(cur.x, cur.y, cam) : { x: cur.x, y: cur.y };
          const center = node.kind === "local" ? "translate(-50%,-50%)" : "translate(-2px,-2px)";
          node.el.style.transform = `translate3d(${sp.x}px,${sp.y}px,0) ${center} scale(${cur.scale})`;
          if (node.kind === "local") {
            node.el.style.width = `${2 * RING_RADIUS_PX}px`;
            node.el.style.height = `${2 * RING_RADIUS_PX}px`;
            node.el.classList.toggle("pressed", w.read(e, CursorVisual).pressed);
          }
        }
      });
      for (const [e, node] of nodes) {
        if (!seen.has(e)) {
          node.el.remove();
          nodes.delete(e);
        }
      }

      // widgets — WORLD boxes (top-left Position + Size) projected through the camera
      const seenW = new Set<Entity>();
      w.query(widgetQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          seenW.add(e);
          let node = widgetNodes.get(e);
          if (!node) {
            const v = w.read(e, WidgetVisual);
            const color = v.color ?? "#888888"; // string fields type string | null
            node = document.createElement("div");
            node.className = "widget";
            node.style.color = color;
            node.style.borderColor = color;
            node.style.background = hexToRgba(color, 0.14);
            node.innerHTML = `<span class="wlabel">${v.label ?? ""}</span>`;
            stage.appendChild(node);
            widgetNodes.set(e, node);
          }
          const p = w.read(e, Position);
          const s = w.read(e, Size);
          const sc = worldToScreen(p.x, p.y, cam);
          node.style.width = `${s.w * cam.zoom}px`;
          node.style.height = `${s.h * cam.zoom}px`;
          node.style.transform = `translate3d(${sc.x}px,${sc.y}px,0)`;
          node.classList.toggle("targeted", targeted.has(e));
          node.classList.toggle("selected", w.hasTag(e, Selected));
        }
      });
      for (const [e, node] of widgetNodes) {
        if (!seenW.has(e)) {
          node.remove();
          widgetNodes.delete(e);
        }
      }

      // selection chrome — the box entity carries its rect as the SelectionBox VALUE;
      // handles are world AABBs (screen-constant size), drawn as fixed 9px squares.
      const box = w.firstOf(boxQ);
      if (box !== undefined) {
        const sb = w.read(box, SelectionBox);
        if (!selboxNode) {
          selboxNode = document.createElement("div");
          selboxNode.className = "selbox";
          stage.appendChild(selboxNode);
        }
        const sc = worldToScreen(sb.x, sb.y, cam);
        selboxNode.style.width = `${sb.w * cam.zoom}px`;
        selboxNode.style.height = `${sb.h * cam.zoom}px`;
        selboxNode.style.transform = `translate3d(${sc.x}px,${sc.y}px,0)`;
      } else if (selboxNode) {
        selboxNode.remove();
        selboxNode = null;
      }
      const seenC = new Set<Entity>();
      w.query(handleQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          seenC.add(e);
          let node = chromeNodes.get(e);
          if (!node) {
            node = document.createElement("div");
            node.className = "handle";
            stage.appendChild(node);
            chromeNodes.set(e, node);
          }
          const p = w.read(e, Position);
          const s = w.read(e, Size);
          const sc = worldToScreen(p.x + s.w / 2, p.y + s.h / 2, cam); // handle centre
          node.style.transform = `translate3d(${sc.x}px,${sc.y}px,0) translate(-50%,-50%)`;
        }
      });
      for (const [e, node] of chromeNodes) {
        if (!seenC.has(e)) {
          node.remove();
          chromeNodes.delete(e);
        }
      }

      // marquee rubber-band — the out-of-ECS preview buffer's WORLD rect → screen box
      const mq = stack.marqueeBuffer.rect;
      if (mq) {
        if (!marqueeNode) {
          marqueeNode = document.createElement("div");
          marqueeNode.className = "marquee";
          stage.appendChild(marqueeNode);
        }
        const p0 = worldToScreen(mq.x, mq.y, cam);
        marqueeNode.style.transform = `translate3d(${p0.x}px,${p0.y}px,0)`;
        marqueeNode.style.width = `${mq.w * cam.zoom}px`;
        marqueeNode.style.height = `${mq.h * cam.zoom}px`;
      } else if (marqueeNode) {
        marqueeNode.remove();
        marqueeNode = null;
      }
    };

    const unregStage = engine.registerReflector({ name: "plStage", always: true, flush });
    const removeAdapter = attachPointerAdapter(host, stack.queue);
    // No engine.enableTelemetry(): the strata observer arms its own
    // world-observer telemetry only while attached (its systems tab feed).
    const stopRaf = startRafLoop(engine);

    // Devtools PROFILER HUD only: this app already mounts its own strata observer
    // (<ObserverPanel/>), so { observer: false } avoids a second, duplicate panel.
    // attachDevtools arms its own telemetry for the profiler (independent of the
    // observer's world-observer telemetry noted above).
    const devtools = attachDevtools(engine, { observer: false });

    return () => {
      devtools.detach();
      stopRaf();
      removeAdapter();
      unregStage();
      unregGrid();
      grid.dispose(); // unregister stops flushes; dispose removes the canvas + RO (StrictMode double-grid)
      ro.disconnect();
      for (const node of nodes.values()) node.el.remove();
      nodes.clear();
      for (const node of widgetNodes.values()) node.remove();
      widgetNodes.clear();
      for (const node of chromeNodes.values()) node.remove();
      chromeNodes.clear();
      if (selboxNode) selboxNode.remove();
      if (marqueeNode) marqueeNode.remove();
      host.dispose(); // removes the (unused) content plane + host-owned styles
    };
  }, [pw]);

  return (
    <>
      <div ref={stageRef} className="proto-stage" />
      <ZoomPill world={pw.world} />
      <ObserverPanel world={pw.world} />
    </>
  );
}
