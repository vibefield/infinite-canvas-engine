/**
 * `domWriteback` — absolute placements for L1 hosts (design-012 §5, plan §4.3).
 *
 * Inside a `layoutsubtree` canvas a child's `left`/`top` do NOT position its
 * hit region: the transform REPLACES layout, and with `transform: none` every
 * host's `getBoundingClientRect()` is (0,0) (hic-bench §3 — the rig had this
 * wrong first and the probe caught it). So a camera write-back is the ABSOLUTE
 * SCREEN PLACEMENT of the host, never a delta from a layout position, and the
 * host is sized in SCREEN CSS px rather than in the world units a
 * camera-transformed plane would scale for it.
 *
 * Two measured laws are already honoured here:
 *
 *  - **Template-string matrices, not `DOMMatrix.toString()`** — 1.46 µs vs
 *    3.02 µs per card for identical placement (hic-bench §3), 2.07× cheaper.
 *  - **Never defer the write-back during a gesture.** Deferring saves 2 paint
 *    events/frame and ~0.3 ms and costs every click for the duration: 0/24
 *    landed mid-pan, with hit regions up to 881 px off. This reflector writes
 *    on the frame the camera moves, always.
 *
 * S2 SCOPE, stated. This writes ALL canvas-side hosts every camera frame,
 * which is one of the two complete fixes hic-bench measured for stale hit
 * regions (28/28, against 3/28 for visible-only). The other — PARKING
 * off-screen hosts off-viewport — is the cheaper one on large boards and lands
 * at S3 with the regression corpus, together with the §4.2 guard that stops
 * the 2 write-back paint events per frame from being read as upload dirt.
 * Until then the honest description of this file is "write all N", not
 * "visible only", because visible-only is the variant that steals clicks.
 */
import { Camera, MeasuredSize, Position, Size, defineQuery, type Entity, type ReflectorDef, type World } from "@ice/core";

/** Where the hosts to place live, and which entities are canvas-side. */
export interface DomWritebackHosts {
  /** The host element for an entity, or undefined when it is not hosted. */
  hostElementFor(entity: Entity): HTMLElement | undefined;
  /** The entities whose hosts are currently immediate children of L1. */
  compositedEntities(): Iterable<Entity>;
  /**
   * Bumped whenever that set changes. Promotion is neither camera dirt nor
   * geometry dirt, so without this a card promoted while the board is still
   * would keep `transform: none` — and inside `layoutsubtree` that is not
   * "wherever it was", it is (0,0), stacked on every other unplaced host.
   * Polled here, inside the gate, so it costs one integer compare per frame.
   */
  compositedRevision(): number;
}

export interface DomWritebackReflector extends ReflectorDef {
  /** Host placements written so far (the churn instrument). */
  writes(): number;
  /** Flushes that wrote nothing because nothing moved. */
  quiet(): number;
  /** Force a full rewrite on the next flush (a host changed custody). */
  invalidate(): void;
  dispose(): void;
}

interface Placed {
  tx: number;
  ty: number;
  w: number;
  h: number;
}

const geometryQuery = defineQuery([Position, Size]);
const measuredQuery = defineQuery([MeasuredSize]);

export function createDomWritebackReflector(
  hosts: DomWritebackHosts,
  world: World,
): DomWritebackReflector {
  const placed = new Map<Entity, Placed>();
  let writes = 0;
  let quiet = 0;
  let dirty = true;
  let lastRevision = -1;

  const unsubs: Array<() => void> = [
    // Camera motion is what makes an absolute placement stale — the plane
    // hosts get one O(1) transform for this, canvas hosts get N.
    world.reactive.observeResource(Camera, () => {
      dirty = true;
    }),
    world.reactive.observeQuery(geometryQuery, () => { dirty = true; }, { cols: [Position, Size] }),
    world.reactive.observeQuery(measuredQuery, () => { dirty = true; }, { cols: [MeasuredSize] }),
  ];

  return {
    name: "domWriteback",
    // Self-gated: the every-frame cost with no composited host and a still
    // camera is one boolean check, and the loop below is skipped entirely.
    always: true,

    flush(_w: World) {
      const revision = hosts.compositedRevision();
      if (!dirty && revision === lastRevision) {
        quiet++;
        return;
      }
      dirty = false;
      lastRevision = revision;

      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
      const zoom = cam.zoom;
      const live = new Set<Entity>();

      for (const entity of hosts.compositedEntities()) {
        const el = hosts.hostElementFor(entity);
        if (el === undefined) continue;
        live.add(entity);

        const p = world.get(entity, Position);
        const measured = world.get(entity, MeasuredSize);
        const s = measured !== undefined && measured.w > 0 ? measured : world.get(entity, Size);
        // Screen CSS px. Device px are the compositor's business; the DOM's
        // own coordinate space is CSS, and the copy applies dpr itself.
        const tx = ((p?.x ?? 0) - cam.x) * zoom;
        const ty = ((p?.y ?? 0) - cam.y) * zoom;
        const w = (s?.w ?? 0) * zoom;
        const h = (s?.h ?? 0) * zoom;

        const prev = placed.get(entity);
        if (prev !== undefined && prev.tx === tx && prev.ty === ty && prev.w === w && prev.h === h) {
          continue;
        }
        if (prev === undefined || prev.w !== w || prev.h !== h) {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        }
        // The absolute placement. Template string, not DOMMatrix (§3).
        el.style.transform = `matrix(1,0,0,1,${tx},${ty})`;
        placed.set(entity, { tx, ty, w, h });
        writes++;
      }

      // Forget hosts that left L1 so a later promotion re-writes rather than
      // trusting a cache from a different custody.
      for (const entity of placed.keys()) {
        if (!live.has(entity)) placed.delete(entity);
      }
    },

    writes: () => writes,
    quiet: () => quiet,
    invalidate() {
      dirty = true;
      lastRevision = -1;
      placed.clear();
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      placed.clear();
    },
  };
}
