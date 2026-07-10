/**
 * The chrome reflector (design-004 §5 chrome plane P4; post-notify, SCREEN-space).
 *
 * Draws the engine's pooled chrome entities plus the out-of-ECS marquee buffer
 * into a dedicated, non-transformed overlay plane above the content plane:
 *  - each `SelectionBox` entity → a 1px outline rect (its world x,y,w,h mapped to
 *    screen via `worldToScreen` × zoom);
 *  - each `HandleSpec` entity → an 8×8 screen-px square CENTERED on the handle's
 *    world AABB center (the handle's world size is zoom-scaled for picking; the
 *    drawn size is screen-constant);
 *  - the `marqueeBuffer.rect` (world) → a rect while non-null.
 *
 * P4 is screen-space by design (design-004 §2 rescope): unlike the content plane
 * (one camera transform), chrome is recomputed per camera change — small N. This
 * reflector therefore reads the `Camera` resource directly (an acknowledged
 * small-N screen-space camera consumer).
 *
 * `always: true`, not observer-driven: the marquee buffer has no ECS stamp to
 * observe, so the reflector must get a chance every frame. A cheap early-out
 * keeps it idle-free — it returns immediately when there is nothing to draw AND
 * nothing was drawn last frame (so a cleared selection still gets one flush to
 * remove its nodes). Style writes are change-only (per-node geometry cache) and
 * counted by `writes()` — the churn instrument, mirroring the other reflectors.
 *
 * Law 10: reflectors write output only, never read layout or write ECS — this
 * flush touches only the overlay plane's node styles.
 */
import {
  Camera,
  defineQuery,
  type Entity,
  HandleSpec,
  type MarqueeBuffer,
  Position,
  type ReflectorDef,
  SelectionBox,
  Size,
  type World,
} from "@ice/core";
import { worldToScreen } from "@ice/kernel";
import type { CanvasHost } from "../host";

/** On-screen handle square edge (px) — the hit target (world size) is larger. */
const HANDLE_DRAW_PX = 8;

const boxQ = defineQuery([SelectionBox]);
const handleQ = defineQuery([HandleSpec, Position, Size]);

function makeNode(doc: Document, extra: Record<string, string>): HTMLDivElement {
  const node = doc.createElement("div");
  Object.assign(node.style, { position: "absolute", boxSizing: "border-box", pointerEvents: "none" }, extra);
  return node;
}

export function createChromeReflector(
  host: CanvasHost,
  // Signature carries `world` (design-004 chrome install shape); the flush is
  // handed the same world by the registry, so we read it there, not from closure.
  _world: World,
  marqueeBuffer: MarqueeBuffer,
): ReflectorDef & { writes(): number } {
  const doc = host.container.ownerDocument;
  // The screen-space overlay plane — appended after the content plane, so it
  // paints above it (P4 over P1) without a camera transform of its own.
  const plane = makeNode(doc, { left: "0", top: "0", width: "0", height: "0" });
  host.container.appendChild(plane);

  const boxNodes = new Map<Entity, HTMLDivElement>();
  const handleNodes = new Map<Entity, HTMLDivElement>();
  let marqueeNode: HTMLDivElement | null = null;

  const boxCache = new Map<Entity, string>();
  const handleCache = new Map<Entity, string>();
  let marqueeCache: string | null = null;
  let drewLast = false;

  const seenBox = new Set<Entity>();
  const seenHandle = new Set<Entity>();

  let writes = 0;

  const writeRect = (node: HTMLDivElement, left: number, top: number, w: number, h: number): void => {
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    writes++;
  };

  return {
    name: "chrome",
    always: true,
    observe: {
      queries: [
        { q: boxQ, cols: [SelectionBox] },
        { q: handleQ, cols: [Position, Size] },
      ],
      resources: [Camera],
    },
    flush(w: World) {
      const cam = w.getResource(Camera);
      if (cam === undefined) return;

      const marqueeRect = marqueeBuffer.rect;
      // Cheap early-out: nothing to draw and nothing drawn last frame ⇒ skip the
      // full reconcile. `firstOf` is O(1)-ish (first matching archetype).
      const hasContent =
        marqueeRect !== null ||
        w.firstOf(boxQ) !== undefined ||
        w.firstOf(handleQ) !== undefined;
      if (!hasContent && !drewLast) return;

      seenBox.clear();
      seenHandle.clear();

      // Selection boxes: world rect → screen outline.
      w.query(boxQ).each((batch) => {
        const bx = batch.col(SelectionBox).x;
        const by = batch.col(SelectionBox).y;
        const bw = batch.col(SelectionBox).w;
        const bh = batch.col(SelectionBox).h;
        for (const r of batch) {
          const e = batch.entity(r);
          seenBox.add(e);
          const tl = worldToScreen(bx[r] as number, by[r] as number, cam);
          const sw = (bw[r] as number) * cam.zoom;
          const sh = (bh[r] as number) * cam.zoom;
          const key = `${tl.x}:${tl.y}:${sw}:${sh}`;
          let node = boxNodes.get(e);
          if (node === undefined) {
            node = makeNode(doc, { border: "1px solid #4a90d9" });
            node.dataset.chrome = "box";
            boxNodes.set(e, node);
            plane.appendChild(node);
          }
          if (boxCache.get(e) !== key) {
            writeRect(node, tl.x, tl.y, sw, sh);
            boxCache.set(e, key);
          }
        }
      });
      for (const [e, node] of boxNodes) {
        if (seenBox.has(e)) continue;
        node.remove();
        boxNodes.delete(e);
        boxCache.delete(e);
      }

      // Handles: world AABB center → screen, draw a fixed 8×8 square around it.
      w.query(handleQ).each((batch) => {
        const px = batch.col(Position).x;
        const py = batch.col(Position).y;
        const sw = batch.col(Size).w;
        const sh = batch.col(Size).h;
        for (const r of batch) {
          const e = batch.entity(r);
          seenHandle.add(e);
          const cx = (px[r] as number) + (sw[r] as number) / 2;
          const cy = (py[r] as number) + (sh[r] as number) / 2;
          const sc = worldToScreen(cx, cy, cam);
          const left = sc.x - HANDLE_DRAW_PX / 2;
          const top = sc.y - HANDLE_DRAW_PX / 2;
          const key = `${left}:${top}`;
          let node = handleNodes.get(e);
          if (node === undefined) {
            node = makeNode(doc, {
              width: `${HANDLE_DRAW_PX}px`,
              height: `${HANDLE_DRAW_PX}px`,
              background: "#fff",
              border: "1px solid #4a90d9",
            });
            node.dataset.chrome = "handle";
            handleNodes.set(e, node);
            plane.appendChild(node);
          }
          if (handleCache.get(e) !== key) {
            node.style.left = `${left}px`;
            node.style.top = `${top}px`;
            writes++;
            handleCache.set(e, key);
          }
        }
      });
      for (const [e, node] of handleNodes) {
        if (seenHandle.has(e)) continue;
        node.remove();
        handleNodes.delete(e);
        handleCache.delete(e);
      }

      // Marquee: from the out-of-ECS buffer, drawn while non-null.
      if (marqueeRect !== null) {
        const tl = worldToScreen(marqueeRect.x, marqueeRect.y, cam);
        const mw = marqueeRect.w * cam.zoom;
        const mh = marqueeRect.h * cam.zoom;
        const key = `${tl.x}:${tl.y}:${mw}:${mh}`;
        if (marqueeNode === null) {
          marqueeNode = makeNode(doc, { border: "1px dashed #4a90d9", background: "rgba(74,144,217,0.1)" });
          marqueeNode.dataset.chrome = "marquee";
          plane.appendChild(marqueeNode);
        }
        if (marqueeCache !== key) {
          writeRect(marqueeNode, tl.x, tl.y, mw, mh);
          marqueeCache = key;
        }
      } else if (marqueeNode !== null) {
        marqueeNode.remove();
        marqueeNode = null;
        marqueeCache = null;
      }

      drewLast = boxNodes.size > 0 || handleNodes.size > 0 || marqueeNode !== null;
    },
    writes: () => writes,
  };
}
