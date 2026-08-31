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
 * ── PARKING, and why it is not "visible only" ─────────────────────────────
 * hic-bench §3 measured three policies on the same board. Writing only the
 * VISIBLE hosts is a correctness DEFECT, not an optimisation: off-screen hosts
 * keep transforms from an earlier camera, those stale hit regions sit on top of
 * the visible ones, and they stole 25 of 28 clicks. Two policies fix it
 * completely — write all N every frame (28/28), or PARK off-screen hosts
 * off-viewport as they leave (28/28).
 *
 * Parking is what this ships: one write per departure instead of 1.46 µs × N
 * every frame at 120 Hz, and it composes with the far-zoom picture tiers that
 * drop hosts entirely. A parked host is moved far outside the viewport, so it
 * can intercept nothing, and it is written exactly once — on the frame it
 * leaves — not tracked thereafter.
 *
 * Parking costs the compositor nothing: measured 2026-08-31
 * (`scripts/hic-paint-record.mjs`), a host parked at (−100000, −100000) still
 * copies 100 % of its pixels, because an element's paint record does not
 * depend on where its transform puts it. So a parked card can still be
 * composited if something wants it, and the atlas needs no special case.
 *
 * `park: false` restores the write-all-N policy — the other complete fix,
 * kept because it is the one the bench measured most directly and because a
 * regression rig needs to be able to run both.
 */
import {
  Camera,
  MeasuredSize,
  Position,
  Size,
  Viewport,
  defineQuery,
  type Entity,
  type ReflectorDef,
  type World,
} from "@ice/core";

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

export interface DomWritebackOptions {
  /**
   * Park off-screen hosts instead of tracking them every frame. Default true.
   * `false` writes ALL N every frame — the other complete fix (see the header);
   * what is never allowed is writing only the visible ones.
   */
  readonly park?: boolean;
  /**
   * How far outside the viewport, in CSS px, a host may sit before it is
   * parked. A margin keeps a card that is straddling the edge live, so a slow
   * pan does not park and unpark it on alternating frames.
   */
  readonly parkMargin?: number;
}

export interface DomWritebackReflector extends ReflectorDef {
  /**
   * THE §4.2 GUARD, from the side that knows the answer.
   *
   * Writing a host's transform makes Chromium raise a paint event naming that
   * host — measured, a 600-frame pan named 9,001 hosts across 389 paint events
   * and re-uploaded the board 9,028 times, which is the full-board path
   * design-012 §8 gate 2 forbids arriving through the back door.
   *
   * `changedElements` names the DRAWABLE and never the descendant that
   * mutated, so there is no structural way to tell "we moved it" from "its
   * content changed". This is the temporal answer: the reflector flags each
   * host it writes, and the dirt consumer CONSUMES that flag — one paint event
   * per write. A second event naming the same host before the next write is
   * therefore not ours, and uploads.
   *
   * It errs toward uploading, deliberately: a needless copy is 0.21 ms, and a
   * suppressed one is a card showing stale pixels indefinitely.
   *
   * Returns true if this host's paint event is attributable to a placement
   * write (and clears the flag).
   */
  consumeTransformWrite(host: Element): boolean;
  /** Host placements written so far (the churn instrument). */
  writes(): number;
  /** Hosts currently parked off-viewport. */
  parked(): number;
  /** Park/unpark transitions so far — one write each; the parking instrument. */
  parkWrites(): number;
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
  /** Written off-viewport; not tracked again until it returns. */
  parked: boolean;
}

/**
 * Far enough outside any viewport that a parked host cannot intercept a click,
 * and finite so the transform stays a plain translation (the bench's own
 * mitigation used this exact value).
 */
const PARK_AT = -100000;

const geometryQuery = defineQuery([Position, Size]);
const measuredQuery = defineQuery([MeasuredSize]);

export function createDomWritebackReflector(
  hosts: DomWritebackHosts,
  world: World,
  options: DomWritebackOptions = {},
): DomWritebackReflector {
  const park = options.park ?? true;
  const parkMargin = options.parkMargin ?? 64;
  const placed = new Map<Entity, Placed>();
  /**
   * Hosts written since each was last named by a paint event — the §4.2 guard's
   * state. A Set, not a counter: a host is flagged by its most recent write and
   * consumed by the next event naming it, so a long pan cannot bank credit that
   * would later swallow a real content change.
   */
  const transformWritten = new Set<Element>();
  let writes = 0;
  let parkWrites = 0;
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
      const view = world.getResource(Viewport);
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
        //
        // THIS SIZE IS ONE HALF OF A KNOWN DISAGREEMENT (2026-08-31). Measured
        // (`apps/widgetlab-desktop/scripts/zoom-drift.mjs`), an L1 host
        // rasterises at exactly this CSS box × the source canvas's backing
        // scale — while the compositor sizes that host's atlas slot at
        // world × dpr × BAND and holds the band while this zoom climbs to 2×
        // it, so a drifted card's extent-less copy writes past its slot.
        // Nothing here is wrong and nothing here is the fix: the host's CSS
        // box IS its screen box, and it may not be anything else while it is
        // the hit-testing truth. The errata and the open ruling live with the
        // side that picks the slot — `ground/compositor/dom-source-binder`.
        const tx = ((p?.x ?? 0) - cam.x) * zoom;
        const ty = ((p?.y ?? 0) - cam.y) * zoom;
        const w = (s?.w ?? 0) * zoom;
        const h = (s?.h ?? 0) * zoom;

        // Off-screen? Only when parking is on AND a viewport is known — with
        // no Viewport resource there is no "off-screen" to speak of, and
        // guessing one would park live cards.
        const offscreen =
          park &&
          view !== undefined &&
          (tx + w < -parkMargin ||
            ty + h < -parkMargin ||
            tx > view.w + parkMargin ||
            ty > view.h + parkMargin);

        const prev = placed.get(entity);

        if (offscreen) {
          // ONE write on departure, then nothing until it comes back. This is
          // the whole saving over write-all-N, and it is safe precisely
          // because a parked host is nowhere near the pointer.
          if (prev?.parked === true) continue;
          el.style.transform = `matrix(1,0,0,1,${PARK_AT},${PARK_AT})`;
          transformWritten.add(el);
          placed.set(entity, { tx, ty, w, h, parked: true });
          writes++;
          parkWrites++;
          continue;
        }

        // Returning from parked: the cached tx/ty describe where it WOULD have
        // been, not what is on the element, so the write must happen even if
        // the numbers match.
        const returning = prev?.parked === true;
        if (!returning && prev !== undefined && prev.tx === tx && prev.ty === ty && prev.w === w && prev.h === h) {
          continue;
        }
        if (returning || prev === undefined || prev.w !== w || prev.h !== h) {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        }
        // The absolute placement. Template string, not DOMMatrix (§3).
        el.style.transform = `matrix(1,0,0,1,${tx},${ty})`;
        transformWritten.add(el);
        placed.set(entity, { tx, ty, w, h, parked: false });
        writes++;
        if (returning) parkWrites++;
      }

      // Forget hosts that left L1 so a later promotion re-writes rather than
      // trusting a cache from a different custody.
      for (const entity of placed.keys()) {
        if (!live.has(entity)) placed.delete(entity);
      }
    },

    consumeTransformWrite: (host) => transformWritten.delete(host),
    writes: () => writes,
    parkWrites: () => parkWrites,
    parked: () => {
      let n = 0;
      for (const p of placed.values()) if (p.parked) n++;
      return n;
    },
    quiet: () => quiet,
    invalidate() {
      dirty = true;
      lastRevision = -1;
      placed.clear();
      transformWritten.clear();
    },
    dispose() {
      for (const u of unsubs) u();
      unsubs.length = 0;
      placed.clear();
      transformWritten.clear();
    },
  };
}
