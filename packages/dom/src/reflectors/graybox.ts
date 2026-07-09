/**
 * The gray-box reflector (design-002 §5 reflector doctrine; M3 exit gate).
 *
 * A minimal enter/update/exit reconciler: it mirrors every `Position` + `Size`
 * entity to an absolutely-positioned div inside the content plane, laying each
 * out in WORLD units (`left/top/width/height` in world coordinates) — the
 * plane's single camera transform (see plane-transform.ts) does the screen
 * mapping, so this reflector never touches the camera and never reads layout
 * (Law 10). It is the stand-in for real widget rendering until the widget
 * runtime lands (M4+); "gray box" = deterministic per-entity fill, no content.
 *
 * Reconciliation, dirty-driven on the `Position`/`Size` query (design-002 §5):
 *  - enter: create a div (fill hashed from the entity handle), write geometry,
 *    stage it in a DocumentFragment (one plane append per flush — 10k mounts do
 *    not thrash layout);
 *  - update: compare against a per-entity geometry cache and rewrite ONLY the
 *    entities whose world geometry actually changed;
 *  - exit: remove divs for entities absent from this flush.
 *
 * `styleWrites()` counts entities whose geometry was (re)written this flush (one
 * per enter, one per changed entity, zero for unchanged) — the churn instrument
 * the M3 tests assert: change one entity ⇒ exactly one style write. `nodeCount()`
 * is the live div count. Because the reflector is dirty-driven, a static frame
 * does not flush at all, so neither counter moves.
 */
import { defineQuery, type Entity, Position, type ReflectorDef, Size, type World } from "@ice/core";
import type { CanvasHost } from "../host";

const grayboxQuery = defineQuery([Position, Size]);

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Deterministic fill from the entity handle (a packed u32) — stable across flushes. */
function fillFor(entity: Entity): string {
  const n: number = entity;
  const hash = (Math.imul(n, 2654435761) >>> 0) % 360;
  return `hsl(${hash}, 55%, 55%)`;
}

function writeGeom(div: HTMLDivElement, x: number, y: number, w: number, h: number): void {
  div.style.left = `${x}px`;
  div.style.top = `${y}px`;
  div.style.width = `${w}px`;
  div.style.height = `${h}px`;
}

export function createGrayboxReflector(
  host: CanvasHost,
): ReflectorDef & { styleWrites(): number; nodeCount(): number } {
  const divs = new Map<Entity, HTMLDivElement>();
  const geom = new Map<Entity, Geom>();
  const seen = new Set<Entity>();
  const doc = host.container.ownerDocument;
  let styleWrites = 0;

  return {
    name: "graybox",
    observe: { queries: [{ q: grayboxQuery, cols: [Position, Size] }] },
    flush(world: World) {
      seen.clear();
      let fragment: DocumentFragment | null = null;

      world.query(grayboxQuery).each((batch) => {
        const px = batch.col(Position).x;
        const py = batch.col(Position).y;
        const sw = batch.col(Size).w;
        const sh = batch.col(Size).h;
        for (const r of batch) {
          const entity = batch.entity(r);
          seen.add(entity);
          const x = px[r] as number;
          const y = py[r] as number;
          const w = sw[r] as number;
          const h = sh[r] as number;

          const existing = divs.get(entity);
          if (existing === undefined) {
            const div = doc.createElement("div");
            div.style.position = "absolute";
            div.style.background = fillFor(entity);
            writeGeom(div, x, y, w, h);
            styleWrites++;
            divs.set(entity, div);
            geom.set(entity, { x, y, w, h });
            if (fragment === null) fragment = doc.createDocumentFragment();
            fragment.appendChild(div);
            continue;
          }

          const prev = geom.get(entity);
          if (prev === undefined) {
            writeGeom(existing, x, y, w, h);
            styleWrites++;
            geom.set(entity, { x, y, w, h });
          } else if (prev.x !== x || prev.y !== y || prev.w !== w || prev.h !== h) {
            writeGeom(existing, x, y, w, h);
            styleWrites++;
            prev.x = x;
            prev.y = y;
            prev.w = w;
            prev.h = h;
          }
        }
      });

      if (fragment !== null) host.contentPlane.appendChild(fragment);

      for (const [entity, div] of divs) {
        if (seen.has(entity)) continue;
        div.remove();
        divs.delete(entity);
        geom.delete(entity);
      }
    },
    styleWrites: () => styleWrites,
    nodeCount: () => divs.size,
  };
}
