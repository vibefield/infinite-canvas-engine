/**
 * The presence publish hook (design-002 §1 publish step; design-001 §5.6).
 *
 * Publish is the POST-TICK, PRE-NOTIFY presence I/O home: the tick is over, so
 * ephemeral structural mutation is legal here (and ONLY here), and `world.*`
 * reads are settled. This hook derives the local peer's outbound facets from the
 * frame's runtime state and stages them on the ephemeral store — CHANGE-ONLY, so
 * an idle frame writes nothing and the throttle sends nothing:
 *
 *  - `PresenceCursor` from the local MOUSE pointer's `PointerWorld` (design-003
 *    §2). No local mouse pointer ⇒ SKIP (the facet stays as last published).
 *    With it (petition I42): `away` — the mouse is out of the host
 *    (`PointerOutside`, a `leave` fact's) or the host said so
 *    (`PresenceSession.setAway`) — and `canvas`, the canvas the coordinates
 *    belong to (`presenceCanvasOf`: "" at the root, else the entered
 *    container's durable key). The host's away and the canvas still move a
 *    facet already published when there is no mouse to read.
 *  - `SelectionSummary` from the `Selected` set: count + union bbox + a JSON key
 *    list (durable keys via the injected `keyOf`, capped at 32 — design-001
 *    §5.6). Present ONLY while the selection is non-empty; the facet is REMOVED
 *    when the selection empties (facet presence is the signal).
 *
 * All ephemeral mutations run AFTER the query walks complete (collect-then-write),
 * so no structural `eph.*` fires mid-iteration.
 */
import { defineQuery } from "@vibecook/strata-ecs";
import type { Entity, World } from "@vibecook/strata-ecs";
import type { PublishHook } from "../engine/engine";
import {
  BoardRoot,
  LocalPointer,
  Pointer,
  PointerOutside,
  PointerWorld,
  Position,
  PresenceCursor,
  Selected,
  SelectionSummary,
  Size,
} from "../catalog";
import { currentNavFrame } from "../nav/nested-canvas";
import { selectedEntities } from "../ops/selection";
import type { PresenceSession } from "./presence-kit";

/** design-001 §5.6: peers outline the listed widgets; beyond the cap they draw the bbox only. */
const SELECTION_KEY_CAP = 32;
/** u16 ceiling for `SelectionSummary.count`. */
const COUNT_MAX = 65535;

const localMouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);

export interface PresencePublishOpts {
  /** Durable key for a selected entity — the doc session's `store.keyOf`. Absent ⇒ no keys carried. */
  readonly keyOf?: (e: Entity) => string | undefined;
  /** Max selection keys carried (default {@link SELECTION_KEY_CAP}). */
  readonly maxKeys?: number;
}

interface CursorFacet {
  x: number;
  y: number;
  device: "mouse" | "touch" | "pen";
  away: boolean;
  canvas: string;
}

/**
 * The canvas a peer's cursor coordinates belong to, as `PresenceCursor.canvas` names it (petition I42; design-001 §5.1 — the
 * desk's coordinates are FRAME-LOCAL): "" at the root; the ENTERED container's durable key (`keyOf`, the doc session's
 * `store.keyOf`); a container no document keys (never committed) `~<peerId>/<entity>` — never "", and never another peer's, so a
 * receiver in it draws no one and no one draws its owner there. The publish writes it and a receiver compares its own to it.
 */
export function presenceCanvasOf(world: World, peerId: string, keyOf?: (e: Entity) => string | undefined): string {
  const frame = currentNavFrame(world);
  if (frame === undefined || frame === world.getResource(BoardRoot)?.root) return "";
  return keyOf?.(frame) ?? `~${peerId}/${frame}`;
}

interface SummaryFacet {
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
  keys: string;
}

/**
 * Build the publish hook that maintains `session.localPeer`'s cursor + selection
 * facets. Register it with `engine.onPublish` (installPresence does this).
 */
export function createPresencePublish(
  world: World,
  session: PresenceSession,
  opts: PresencePublishOpts = {},
): PublishHook {
  const { eph } = session;
  const keyOf = opts.keyOf;
  const cap = opts.maxKeys ?? SELECTION_KEY_CAP;

  let cursorPresent = false;
  let lastCursor: CursorFacet | undefined;
  let summaryPresent = false;
  let lastSummary: SummaryFacet | undefined;
  // `session.localPeer` is a GETTER — a world reset re-mints it (the
  // presence-kit self-heal). Read through per publish; when the identity
  // swaps, drop the change-suppression caches too: the fresh peer carries NO
  // facets, so an "unchanged" cursor must still be re-added.
  let localPeer = session.localPeer;

  // The engine hands the hook its world; it is `session`'s world by construction
  // (installPresence registers on the same engine), so we read the captured one.
  return () => {
    if (session.localPeer !== localPeer) {
      localPeer = session.localPeer;
      cursorPresent = false;
      lastCursor = undefined;
      summaryPresent = false;
      lastSummary = undefined;
    }
    publishCursor(world);
    publishSelection(world);
  };

  function publishCursor(w: World): void {
    // The local mouse pointer is the presence cursor. Collect during the walk,
    // mutate after (structural eph.* is illegal mid-iteration).
    let mouse: { x: number; y: number; outside: boolean } | undefined;
    w.query(localMouseQ).each((b) => {
      for (const r of b) {
        if (mouse !== undefined) break;
        const e = b.entity(r);
        if (w.read(e, Pointer).device !== "mouse") continue;
        const pw = w.read(e, PointerWorld);
        mouse = { x: pw.x, y: pw.y, outside: w.hasTag(e, PointerOutside) };
      }
    });

    // no local mouse ⇒ the facet's point stays as last published (none published: nothing to say); the host's away and the
    // canvas still move it (I42)
    const at = mouse ?? (cursorPresent ? lastCursor : undefined);
    if (at === undefined) return;
    const cursor: CursorFacet = {
      x: at.x,
      y: at.y,
      device: "mouse",
      away: mouse?.outside === true || session.away() !== null,
      canvas: presenceCanvasOf(w, session.peerId, keyOf),
    };
    if (cursorPresent && lastCursor !== undefined && cursorEquals(lastCursor, cursor)) {
      return; // unchanged ⇒ no write, no throttle traffic
    }
    if (cursorPresent) eph.edit(localPeer).set(PresenceCursor, cursor);
    else eph.addComponent(localPeer, PresenceCursor, cursor);
    cursorPresent = true;
    lastCursor = cursor;
  }

  function publishSelection(w: World): void {
    const selected = selectedEntities(w);
    if (selected.length === 0) {
      if (summaryPresent) {
        eph.removeComponent(localPeer, SelectionSummary); // present only while non-empty
        summaryPresent = false;
        lastSummary = undefined;
      }
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let anyPositioned = false;
    const keys: string[] = [];
    for (const e of selected) {
      if (keyOf !== undefined && keys.length < cap) {
        const key = keyOf(e);
        if (key !== undefined) keys.push(key); // runtime-only (never-committed) entities have no key
      }
      if (!w.has(e, Position)) continue;
      const p = w.read(e, Position);
      const s = w.get(e, Size);
      const width = s?.w ?? 0;
      const height = s?.h ?? 0;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + width);
      maxY = Math.max(maxY, p.y + height);
      anyPositioned = true;
    }

    const summary: SummaryFacet = {
      count: Math.min(selected.length, COUNT_MAX),
      x: anyPositioned ? minX : 0,
      y: anyPositioned ? minY : 0,
      w: anyPositioned ? maxX - minX : 0,
      h: anyPositioned ? maxY - minY : 0,
      keys: JSON.stringify(keys),
    };

    if (summaryPresent && lastSummary !== undefined && summaryEquals(lastSummary, summary)) return;
    if (summaryPresent) eph.edit(localPeer).set(SelectionSummary, summary);
    else eph.addComponent(localPeer, SelectionSummary, summary);
    summaryPresent = true;
    lastSummary = summary;
  }
}

function cursorEquals(a: CursorFacet, b: CursorFacet): boolean {
  return a.x === b.x && a.y === b.y && a.device === b.device && a.away === b.away && a.canvas === b.canvas;
}

function summaryEquals(a: SummaryFacet, b: SummaryFacet): boolean {
  return a.count === b.count && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.keys === b.keys;
}
