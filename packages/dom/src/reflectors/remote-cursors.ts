/**
 * P5 — remote cursors (design-004 §1: screen-space DOM, "remote cursors are
 * always custom nodes"; design-003 §7).
 *
 * Renders one pooled node per REMOTE cursor entity (`CursorVisual` kind
 * "remote" + world `Position`, derived by core's remote-cursors system from
 * presence peers; `Follows` names the peer whose `PresenceInfo` supplies
 * color + label). Screen-space by design: an acknowledged small-N
 * camera→position consumer (design-002 §5 rescope), recomputed on camera or
 * cursor dirt only. The plane mounts LAST in the container, above chrome;
 * `pointer-events: none` throughout — cursors are never hit-testable.
 */
import {
  Camera,
  CursorVisual,
  Follows,
  Position,
  PresenceInfo,
  defineQuery,
  type Entity,
  type ReflectorDef,
  type World,
} from "@ice/core";
import { worldToScreen } from "@ice/kernel";
import type { CanvasHost } from "../host";

const remoteCursorQ = defineQuery([Position, CursorVisual]);

export interface RemoteCursorsReflector {
  readonly reflector: ReflectorDef;
  /** Remove the plane + pool (doc close / HMR). */
  destroy(): void;
}

export function createRemoteCursorsReflector(host: CanvasHost, world: World): RemoteCursorsReflector {
  const doc = host.container.ownerDocument;
  const plane = doc.createElement("div");
  Object.assign(plane.style, {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  host.container.appendChild(plane); // last child ⇒ topmost (P5 over P4)

  interface Node {
    root: HTMLDivElement;
    label: HTMLDivElement;
    color: string;
    name: string;
    x: number;
    y: number;
  }
  const pool = new Map<Entity, Node>();

  const ensure = (e: Entity): Node => {
    let n = pool.get(e);
    if (n !== undefined) return n;
    const root = doc.createElement("div");
    Object.assign(root.style, {
      position: "absolute",
      left: "0",
      top: "0",
      willChange: "transform",
      pointerEvents: "none",
    } as Partial<CSSStyleDeclaration>);
    // Arrow glyph + name chip (color applied on first style pass).
    const arrow = doc.createElement("div");
    Object.assign(arrow.style, {
      width: "0",
      height: "0",
      borderLeft: "6px solid transparent",
      borderRight: "6px solid transparent",
      borderBottom: "14px solid currentColor",
      transform: "rotate(-32deg)",
    } as Partial<CSSStyleDeclaration>);
    const label = doc.createElement("div");
    Object.assign(label.style, {
      marginTop: "2px",
      marginLeft: "8px",
      padding: "1px 6px",
      borderRadius: "8px",
      font: "11px system-ui, sans-serif",
      color: "#fff",
      whiteSpace: "nowrap",
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(arrow);
    root.appendChild(label);
    plane.appendChild(root);
    n = { root, label, color: "", name: "", x: Number.NaN, y: Number.NaN };
    pool.set(e, n);
    return n;
  };

  const reflector: ReflectorDef = {
    name: "remoteCursors",
    observe: {
      resources: [Camera],
      queries: [{ q: remoteCursorQ, cols: [Position, CursorVisual] }],
    },
    flush: (w) => {
      const cam = w.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
      const seen = new Set<Entity>();
      w.query(remoteCursorQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (w.get(e, CursorVisual)?.kind !== "remote") continue;
          seen.add(e);
          const p = w.read(e, Position);
          const s = worldToScreen(p.x, p.y, cam);
          const n = ensure(e);
          if (n.x !== s.x || n.y !== s.y) {
            n.root.style.transform = `translate(${s.x}px, ${s.y}px)`;
            n.x = s.x;
            n.y = s.y;
          }
          const peer = w.getRelation(e, Follows);
          const info = peer !== undefined ? w.get(peer, PresenceInfo) : undefined;
          const color = info?.color ?? "#7a8aa0";
          const name = info?.name ?? "";
          if (n.color !== color) {
            n.root.style.color = color;
            n.label.style.background = color;
            n.color = color;
          }
          if (n.name !== name) {
            n.label.textContent = name;
            n.label.style.display = name === "" ? "none" : "block";
            n.name = name;
          }
        }
      });
      for (const [e, n] of pool) {
        if (!seen.has(e)) {
          n.root.remove();
          pool.delete(e);
        }
      }
    },
  };

  return {
    reflector,
    destroy() {
      pool.clear();
      plane.remove();
    },
  };
}
