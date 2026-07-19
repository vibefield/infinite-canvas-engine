/**
 * L2 — recognizer lifecycle + per-kind FSMs (design-003 §4.1–§4.2).
 *
 * `ctl:spawn`  — cancelSweep (consumes the one-tick CancelRequest) →
 *                recognizerSpawn (tool profiles; pinch on 2nd touch suspends
 *                singles; wheel recognizers are `Simultaneous`) →
 *                recognizerIntegrity (requiredWatches counts, capture death,
 *                suspension lift). Newborns are identity-only until the
 *                ctl:spawn flush, so integrity naturally skips them until the
 *                next frame — by which time their edges are placed.
 * `ctl:recognize` — per-kind systems. Transitions go through the PhaseSet via
 *                `ctx` (visible at this phase's flush — arbitration reads them
 *                the same frame); field updates are immediate `edit().set`
 *                under declared `access.write`.
 *
 * All timing reads FrameInfo.CLOCK — the accumulated CLAMPED-dt gesture clock
 * (2026-07-17, supersedes both raw FrameInfo.now and the 2026-07-12
 * event-timestamp anchor): rAF `now` lags wall time by up to SECONDS under
 * throttling/headless/software rendering while event.timeStamp does not, so
 * any window mixing the two evaluates garbage; `clock` is monotonic, stalls
 * contribute ≤ dtClampMs (the stall-protection intent), and no event
 * timestamp ever enters window math. All thresholds read the GestureSettings
 * RESOURCE (live-tunable, design-005 §4) with the GESTURE_DEFAULTS constants
 * as the unset fallback. Gesture math is screen-space totals + zoom-at-claim
 * — never live PointerWorld (design-002 §2 staleness rule).
 */
import type { Entity, SystemCtx, World } from "@vibecook/strata-ecs";
import { Any, Not, defineQuery, defineSystem, type System, type Tag } from "@vibecook/strata-ecs";
import {
  Camera,
  CancelRequest,
  Captures,
  ClaimedBy,
  Down,
  Drag,
  GesturePhases,
  GestureSuspended,
  HadCapture,
  InsertGhost,
  HadRequiresFail,
  HadSequence,
  HandledByWidget,
  LocalPointer,
  LongPress,
  LongPressDrag,
  MultiTap,
  Pinch,
  Pointer,
  PointerButtons,
  PointerScreen,
  PointerWheel,
  RequiresFail,
  Sequence,
  SnapState,
  Simultaneous,
  Tap,
  TouchesExact,
  Watches,
  WentCancelled,
  WentDown,
  WentUp,
  WheelPan,
  WheelZoom,
} from "../catalog";
import { ActiveTool } from "../catalog/camera-derived";
import { FrameInfo } from "../engine/frame-info";
import { GestureSettings } from "../catalog/settings-resources";
import { tools } from "../tools/define-tool";
import { GESTURE_DEFAULTS } from "../settings/defaults";

export type SingleKindName = "tap" | "longPress" | "drag";

/** Tool id → single-pointer recognizer set spawned per down (design-003 §4.1). */
export type SpawnProfiles = Readonly<Record<string, readonly SingleKindName[]>>;

export const DEFAULT_SPAWN_PROFILES: SpawnProfiles = {
  select: ["tap", "longPress", "drag"],
  pan: ["drag"],
};

const anyKindQ = defineQuery([Any(Tap, LongPress, Drag, Pinch, WheelPan, WheelZoom)]);
const downQ = defineQuery([Pointer, WentDown, Not(HandledByWidget), LocalPointer]);
const heldTouchQ = defineQuery([Pointer, PointerButtons, LocalPointer]);
const wheelSourceQ = defineQuery([Pointer, PointerWheel, LocalPointer]);
const tapQ = defineQuery([Tap, Not(GestureSuspended)]);
const longPressQ = defineQuery([LongPress, Not(GestureSuspended)]);
const dragQ = defineQuery([Drag, Not(GestureSuspended)]);
const pinchQ = defineQuery([Pinch]);
const wheelKindQ = defineQuery([Any(WheelPan, WheelZoom)]);
const pendingTapQ = defineQuery([Tap, GesturePhases.tags.Pending]);
const pendingQ = defineQuery([Any(Tap, LongPress, Drag, Pinch), GesturePhases.tags.Pending]);

const P = GesturePhases;

/** Live-tunable gesture settings (design-005 §4): resource first, const fallback. */
function gs(ctx: SystemCtx): Readonly<Record<keyof typeof GESTURE_DEFAULTS, number>> {
  return ctx.getResource(GestureSettings) ?? GESTURE_DEFAULTS;
}

/** The gesture clock (see the header — NEVER FrameInfo.now for window math). */
function clk(ctx: SystemCtx): number {
  return ctx.getResource(FrameInfo)?.clock ?? 0;
}


/** A recognizer is in a phase from which no further recognition can happen. */
function isTerminal(ctx: SystemCtx | World, e: Entity): boolean {
  if (ctx.hasTag(e, P.tags.Failed) || ctx.hasTag(e, P.tags.Cancelled) || ctx.hasTag(e, P.tags.Ended)) {
    return true;
  }
  // Recognized is terminal for Tap only — LongPress keeps a continuous tail.
  return ctx.hasTag(e, P.tags.Recognized) && ctx.has(e, Tap);
}

function requiredWatches(ctx: SystemCtx | World, e: Entity): number {
  return ctx.has(e, Pinch) ? 2 : 1;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export interface L2Deps {
  readonly world: World;
  readonly profiles?: SpawnProfiles;
}

export interface L2Systems {
  cancelSweep: System;
  recognizerSpawn: System;
  /** Same design slot as recognizerSpawn (design-002 §2) over the wheel-source query. */
  wheelSpawn: System;
  recognizerIntegrity: System;
  tapSystem: System;
  longPressSystem: System;
  dragSystem: System;
  pinchSystem: System;
  wheelSystem: System;
  /** Resolves Pending `Sequence`/`RequiresFail` edges; last in `ctl:recognize`. */
  dependencySystem: System;
}

export function createL2Systems({ world, profiles = DEFAULT_SPAWN_PROFILES }: L2Deps): L2Systems {
  /** Non-terminal recognizers watching `pointer` (live reverse edges). */
  const watchersOf = (ctx: SystemCtx, pointer: Entity): Entity[] =>
    ctx.getReverse(pointer, Watches).filter((rec) => !isTerminal(ctx, rec));

  const cancelSweep = defineSystem(
    anyKindQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        if (isTerminal(ctx, e)) continue;
        P.set(ctx, e, "Cancelled");
      }
    },
    {
      name: "cancelSweep",
      runIf: (ctx) => ctx.getResource(CancelRequest)?.active === true,
    },
  );

  const recognizerSpawn = defineSystem(
    downQ,
    (b, ctx) => {
      const now = clk(ctx);
      const tool = ctx.getResource(ActiveTool)?.id ?? "select";
      // Explicit profiles (test/app override) → tool registry (design-005 §3)
      // → select. Tools parameterize L2 spawn purely through config.
      const profile = profiles[tool] ?? tools.get(tool)?.spawnProfile ?? DEFAULT_SPAWN_PROFILES.select ?? [];

      for (const r of b) {
        const pointer = b.entity(r);

        // Skip pointers already claimed by a live, non-terminal recognizer.
        const claimant = ctx.getRelation(pointer, ClaimedBy);
        if (claimant !== undefined && !isTerminal(ctx, claimant)) continue;

        const screen = ctx.read(pointer, PointerScreen);
        const captureTarget = ctx.getRelation(pointer, TouchesExact);
        // Gesture timing anchors on the CLOCK at ingest. The 2026-07-12
        // event-timestamp anchor is retired (2026-07-17): event.timeStamp and
        // rAF now are DIFFERENT clocks under throttling (measured seconds of
        // skew), and the stall protection it bought is now the clock's own
        // property — a stalled frame contributes at most dtClampMs.
        const downMs = now;

        // Pinch rule: this down makes it TWO local touch pointers held — spawn a
        // Pinch watching both and suspend both pointers' single-pointer
        // recognizers (spawn this pointer's singles pre-suspended).
        let pinchPartner: Entity | undefined;
        if (ctx.read(pointer, Pointer).device === "touch") {
          world.query(heldTouchQ).each((pb) => {
            for (const pr of pb) {
              const other = pb.entity(pr);
              if (other === pointer) continue;
              if (world.read(other, Pointer).device !== "touch") continue;
              if (world.read(other, PointerButtons).buttons === 0) continue;
              // A partner already claimed by a live gesture never forms a pinch —
              // two touches dragging two widgets stay two independent gestures
              // (design-003 §9); pinch is for two FREE fingers.
              const partnerClaim = ctx.getRelation(other, ClaimedBy);
              if (partnerClaim !== undefined && !isTerminal(ctx, partnerClaim)) continue;
              pinchPartner = other;
            }
          });
        }
        const suspendedAtBirth = pinchPartner !== undefined;

        // iOS hold-to-lift (LongPressDrag capability, 2026-07-12): the widget's
        // Drag recognizer spawns PARKED (Pending + Sequence → this down's
        // LongPress). The dependency system hands off when the hold passes;
        // early movement fails the LongPress and the parked Drag dies with it
        // — taps and widget-internal interactions stay instant. Requires the
        // profile to spawn longPress BEFORE drag (the default select order).
        const holdToDrag =
          captureTarget !== undefined &&
          ctx.hasTag(captureTarget, LongPressDrag) &&
          profile.includes("longPress");
        let lpRec: Entity | undefined;

        // Multi-tap REJOIN (v2 findPendingTap): a down on a MultiTap target near a
        // Pending tap's last down re-points that tap at the new pointer (count
        // preserved) instead of spawning fresh. Edge-parked Pendings never rejoin.
        let rejoined = false;
        if (captureTarget !== undefined && ctx.has(captureTarget, MultiTap)) {
          const mt = ctx.read(captureTarget, MultiTap);
          ctx.query(pendingTapQ).each((pb) => {
            for (const pr of pb) {
              if (rejoined) return;
              const cand = pb.entity(pr);
              if (ctx.getRelation(cand, Captures) !== captureTarget) continue;
              if (ctx.hasTag(cand, HadSequence) || ctx.hasTag(cand, HadRequiresFail)) continue;
              if (ctx.read(cand, Tap).count >= mt.max) continue;
              const d = ctx.read(cand, Down);
              if (dist(screen.x, screen.y, d.x, d.y) > mt.slopPx) continue;
              ctx.removeRelation(cand, Watches); // old finger lifted — re-point at the new one
              ctx.addRelation(cand, Watches, pointer);
              ctx.edit(cand).set(Down, { x: screen.x, y: screen.y, ms: now });
              if (suspendedAtBirth) ctx.addTag(cand, GestureSuspended);
              P.set(ctx, cand, "Possible"); // Pending → Possible; count preserved
              rejoined = true;
              return;
            }
          });
        }

        const spawnSingle = (kind: SingleKindName): Entity => {
          // A parked drag enters Pending (edge-gated) instead of Possible.
          const park = kind === "drag" && holdToDrag && lpRec !== undefined;
          const basePhase = park ? P.tags.Pending : P.tags.Possible;
          const baseTags = park ? [basePhase, HadSequence] : [basePhase];
          const tags = suspendedAtBirth ? ([...baseTags, GestureSuspended] as const) : (baseTags as readonly Tag[]);
          let rec: Entity;
          if (kind === "tap") {
            rec = ctx.spawn({
              components: [
                [Tap, { downAt: downMs }],
                [Down, { x: screen.x, y: screen.y, ms: downMs }],
              ],
              tags: [...tags],
            });
          } else if (kind === "longPress") {
            rec = ctx.spawn({
              components: [
                [LongPress, { downAt: downMs, startX: screen.x, startY: screen.y, curX: screen.x, curY: screen.y }],
                [Down, { x: screen.x, y: screen.y, ms: downMs }],
              ],
              tags: [...tags],
            });
          } else {
            rec = ctx.spawn({
              components: [
                [
                  Drag,
                  { startX: screen.x, startY: screen.y, totalX: 0, totalY: 0, velX: 0, velY: 0, zoomAtClaim: 1 },
                ],
                [SnapState, { dx: 0, dy: 0 }], // essential at spawn — writers never race an attach
                [Down, { x: screen.x, y: screen.y, ms: downMs }],
              ],
              tags: [...tags],
            });
          }
          ctx.addRelation(rec, Watches, pointer);
          if (captureTarget !== undefined) {
            ctx.setRelation(rec, Captures, captureTarget);
            ctx.addTag(rec, HadCapture);
          }
          if (park && lpRec !== undefined) ctx.setRelation(rec, Sequence, lpRec);
          return rec;
        };

        for (const kind of profile) {
          if (kind === "tap" && rejoined) continue; // the rejoined Pending tap IS this down's tap
          const rec = spawnSingle(kind);
          if (kind === "longPress") lpRec = rec;
        }

        if (pinchPartner !== undefined) {
          const partnerScreen = ctx.read(pinchPartner, PointerScreen);
          const spread = dist(screen.x, screen.y, partnerScreen.x, partnerScreen.y);
          const cx = (screen.x + partnerScreen.x) / 2;
          const cy = (screen.y + partnerScreen.y) / 2;
          const pinch = ctx.spawn({
            components: [
              [
                Pinch,
                {
                  startDist: spread,
                  startZoom: ctx.getResource(Camera)?.zoom ?? 1,
                  cx,
                  cy,
                  zoomAtClaim: ctx.getResource(Camera)?.zoom ?? 1,
                },
              ],
              [Down, { x: cx, y: cy, ms: now }],
            ],
            tags: [P.tags.Possible],
          });
          ctx.addRelation(pinch, Watches, pointer);
          ctx.addRelation(pinch, Watches, pinchPartner);
          // Suspend the partner's existing singles ("suspend, don't kill").
          for (const rec of watchersOf(ctx, pinchPartner)) {
            if (!ctx.has(rec, Pinch)) ctx.addTag(rec, GestureSuspended);
          }
        }
      }
    },
    // The multi-tap REJOIN rebases a Pending tap's Down (edit().set above); spawns
    // are structural, not value writes. Sole declared Down writer in ctl:spawn
    // (cancelSweep/wheelSpawn/recognizerIntegrity write no cells) → no same-phase
    // co-writer, so no orderIndependent attestation.
    { name: "recognizerSpawn", access: { write: [Down] } },
  );

  // Wheel recognizer spawn rides the same ctl:spawn slot: wheel deltas landed
  // this tick (values — visible) and no live wheel recognizer watches the pointer.
  const wheelSpawn = defineSystem(
    wheelSourceQ,
    (b, ctx) => {
      const now = clk(ctx);
      for (const r of b) {
        const pointer = b.entity(r);
        const wheel = ctx.read(pointer, PointerWheel);
        const zooming = wheel.pinch !== 0;
        const panning = wheel.dx !== 0 || wheel.dy !== 0;
        if (!zooming && !panning) continue;
        const hasLive = ctx
          .getReverse(pointer, Watches)
          .some((rec) => (ctx.has(rec, WheelPan) || ctx.has(rec, WheelZoom)) && !isTerminal(ctx, rec));
        if (hasLive) continue;
        const screen = ctx.read(pointer, PointerScreen);
        const rec = zooming
          ? ctx.spawn({
              components: [
                [WheelZoom, { pinch: 0, anchorX: screen.x, anchorY: screen.y }],
                [Down, { x: screen.x, y: screen.y, ms: now }], // Down.ms = last wheel activity (silence timer)
              ],
              tags: [P.tags.Possible, Simultaneous],
            })
          : ctx.spawn({
              components: [
                [WheelPan, { dx: 0, dy: 0, anchorX: screen.x, anchorY: screen.y }],
                [Down, { x: screen.x, y: screen.y, ms: now }],
              ],
              tags: [P.tags.Possible, Simultaneous],
            });
        ctx.addRelation(rec, Watches, pointer);
      }
    },
    { name: "wheelSpawn" },
  );

  const recognizerIntegrity = defineSystem(
    anyKindQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        if (isTerminal(ctx, e)) continue;

        // Suspension lift: no live non-terminal Pinch shares any watched pointer.
        if (ctx.hasTag(e, GestureSuspended) && !ctx.has(e, Pinch)) {
          const pointers = ctx.getRelations(e, Watches);
          const suspenderAlive = pointers.some((p) =>
            ctx.getReverse(p, Watches).some((rec) => ctx.has(rec, Pinch) && !isTerminal(ctx, rec)),
          );
          if (!suspenderAlive) ctx.removeTag(e, GestureSuspended);
        }

        // Required-watches count (edges to despawned pointers auto-clear). A
        // Pending recognizer is ALLOWED to outlive its watched pointer — a
        // multi-tap awaiting the next tap, or an edge-parked recognizer before
        // its source (v2 rule); only capture death cancels those (below).
        if (!ctx.hasTag(e, P.tags.Pending) && ctx.getRelations(e, Watches).length !== requiredWatches(ctx, e)) {
          P.set(ctx, e, "Cancelled");
          continue;
        }

        // Capture death — incl. remote despawns (edge auto-clears; HadCapture remembers).
        if (ctx.hasTag(e, HadCapture) && ctx.getRelation(e, Captures) === undefined) {
          P.set(ctx, e, "Cancelled");
        }
      }
    },
    { name: "recognizerIntegrity" },
  );

  // --- per-kind FSMs (ctl:recognize) ---

  const tapSystem = defineSystem(
    tapQ,
    (b, ctx) => {
      const now = clk(ctx);
      for (const r of b) {
        const e = b.entity(r);
        const pending = ctx.hasTag(e, P.tags.Pending);
        if (!ctx.hasTag(e, P.tags.Possible) && !pending) continue;

        if (pending) {
          // Edge-parked Pending (Sequence/RequiresFail) belongs to the dependency
          // system — never window-expire it here (v2 rule).
          if (ctx.hasTag(e, HadSequence) || ctx.hasTag(e, HadRequiresFail)) continue;
          // Multi-tap Pending: await a rejoin (recognizerSpawn) or the window closing.
          const down = ctx.read(e, Down);
          const cap = ctx.getRelation(e, Captures);
          const windowMs =
            cap !== undefined && ctx.has(cap, MultiTap)
              ? ctx.read(cap, MultiTap).windowMs
              : gs(ctx).multiTapWindowMs;
          if (now - down.ms > windowMs) P.set(ctx, e, "Recognized"); // window closed → final count stands
          continue;
        }

        const pointer = ctx.getRelations(e, Watches)[0];
        if (pointer === undefined) continue; // integrity cancels next frame
        if (ctx.hasTag(pointer, WentCancelled)) {
          P.set(ctx, e, "Cancelled");
          continue;
        }
        const down = ctx.read(e, Down);
        const screen = ctx.read(pointer, PointerScreen);
        const moved = dist(down.x, down.y, screen.x, screen.y);
        if (moved > gs(ctx).tapSlopPx) {
          P.set(ctx, e, "Failed");
          continue;
        }
        // Hold measured from Down.ms, not Tap.downAt: a rejoined multi-tap rebases
        // Down per tap while downAt keeps the FIRST down (the gesture's birth).
        const held = now - down.ms;
        if (ctx.hasTag(pointer, WentUp)) {
          if (held > gs(ctx).tapMaxMs) {
            P.set(ctx, e, "Failed");
            continue;
          }
          // Clean release — count it (v2): at the target count → Recognized now;
          // under it → park Pending (never reaped) until rejoin or window close.
          const tap = ctx.read(e, Tap);
          const cap = ctx.getRelation(e, Captures);
          const max = cap !== undefined && ctx.has(cap, MultiTap) ? ctx.read(cap, MultiTap).max : 1;
          const count = tap.count + 1;
          ctx.edit(e).set(Tap, { ...tap, count });
          if (count >= max) {
            P.set(ctx, e, "Recognized");
          } else {
            ctx.edit(e).set(Down, { ...down, ms: now }); // restart the inter-tap window from release
            P.set(ctx, e, "Pending");
          }
        } else if (held > gs(ctx).tapMaxMs) {
          P.set(ctx, e, "Failed");
        }
      }
    },
    // Down co-writers in ctl:recognize (tap park / wheel activity / dependency
    // rebase) touch DISJOINT rows — tap rows, wheel rows, edge-parked rows.
    { name: "tapSystem", access: { write: [Tap, Down], orderIndependent: [Down] } },
  );

  const longPressSystem = defineSystem(
    longPressQ,
    (b, ctx) => {
      const now = clk(ctx);
      for (const r of b) {
        const e = b.entity(r);
        const pointer = ctx.getRelations(e, Watches)[0];
        if (pointer === undefined) continue;
        const screen = ctx.read(pointer, PointerScreen);
        const lp = ctx.read(e, LongPress);

        if (ctx.hasTag(pointer, WentCancelled)) {
          P.set(ctx, e, "Cancelled");
          continue;
        }

        if (ctx.hasTag(e, P.tags.Possible)) {
          if (ctx.hasTag(pointer, WentUp)) {
            P.set(ctx, e, "Failed"); // released before the hold
            continue;
          }
          if (dist(lp.startX, lp.startY, screen.x, screen.y) > gs(ctx).longPressSlopPx) {
            P.set(ctx, e, "Failed");
            continue;
          }
          if (now - lp.downAt >= gs(ctx).longPressMs) {
            ctx.edit(e).set(LongPress, { ...lp, curX: screen.x, curY: screen.y });
            P.set(ctx, e, "Recognized"); // discrete claim; continuous tail follows
          }
          continue;
        }

        if (ctx.hasTag(e, P.tags.Recognized)) {
          ctx.edit(e).set(LongPress, { ...lp, curX: screen.x, curY: screen.y }); // the tail
          if (ctx.hasTag(pointer, WentUp)) P.set(ctx, e, "Ended");
        }
      }
    },
    { name: "longPressSystem", access: { write: [LongPress] } },
  );

  const dragSystem = defineSystem(
    dragQ,
    (b, ctx) => {
      const dtMs = ctx.getResource(FrameInfo)?.dt ?? 16;
      for (const r of b) {
        const e = b.entity(r);
        const pointer = ctx.getRelations(e, Watches)[0];
        if (pointer === undefined) continue;
        const screen = ctx.read(pointer, PointerScreen);
        const d = ctx.read(e, Drag);

        if (ctx.hasTag(pointer, WentCancelled)) {
          P.set(ctx, e, "Cancelled");
          continue;
        }

        if (ctx.hasTag(e, P.tags.Possible)) {
          const down = ctx.read(e, Down);
          // Adopted insert drags (tray ghosts, 2026-07-19) have NO tap-vs-drag
          // ambiguity — the user is already mid-drag when the synthetic down
          // lands, so the dead zone only adds anchor drift (the ghost sits
          // still while the pointer travels the slop). First move activates.
          const cap = ctx.getRelation(e, Captures);
          const ghostDrag = cap !== undefined && ctx.has(cap, InsertGhost);
          const slopPx = ghostDrag ? 0 : gs(ctx).dragSlopPx;
          if (dist(down.x, down.y, screen.x, screen.y) > slopPx) {
            // Origin measured FROM DEAD-ZONE EXIT (no jump on promote) —
            // EXCEPT ghost drags: the ghost spawned anchored AT the down, so
            // every pixel since the down belongs to it. PointerScreen is the
            // tick's FOLDED latest, so an exit-origin bakes in whatever
            // travel folded into the activation tick (46px at a starved
            // 2fps, 2–8px on a fast real-browser flick — the anchor-drift
            // field bug, 2026-07-19). The down IS the anchor; use it.
            ctx.edit(e).set(Drag, {
              startX: ghostDrag ? down.x : screen.x,
              startY: ghostDrag ? down.y : screen.y,
              totalX: 0,
              totalY: 0,
              velX: 0,
              velY: 0,
              zoomAtClaim: ctx.getResource(Camera)?.zoom ?? 1,
            });
            P.set(ctx, e, "Active");
          } else if (ctx.hasTag(pointer, WentUp)) {
            P.set(ctx, e, "Failed"); // released inside the dead zone
          }
          continue;
        }

        if (ctx.hasTag(e, P.tags.Active)) {
          const totalX = screen.x - d.startX;
          const totalY = screen.y - d.startY;
          const frameDx = totalX - d.totalX;
          const frameDy = totalY - d.totalY;
          const dtS = Math.max(dtMs, 1) / 1000;
          const alpha = 0.3; // EMA release velocity (v2 constant)
          ctx.edit(e).set(Drag, {
            ...d,
            totalX,
            totalY,
            velX: d.velX + alpha * (frameDx / dtS - d.velX),
            velY: d.velY + alpha * (frameDy / dtS - d.velY),
          });
          if (ctx.hasTag(pointer, WentUp)) P.set(ctx, e, "Ended");
        }
      }
    },
    { name: "dragSystem", access: { write: [Drag] } },
  );

  const pinchSystem = defineSystem(
    pinchQ,
    (b, ctx) => {
      for (const r of b) {
        const e = b.entity(r);
        const pointers = ctx.getRelations(e, Watches);
        if (pointers.length !== 2) continue; // integrity cancels
        const [pa, pb] = pointers as [Entity, Entity];
        if (ctx.hasTag(pa, WentCancelled) || ctx.hasTag(pb, WentCancelled)) {
          P.set(ctx, e, "Cancelled");
          continue;
        }
        const sa = ctx.read(pa, PointerScreen);
        const sb = ctx.read(pb, PointerScreen);
        const spread = dist(sa.x, sa.y, sb.x, sb.y);
        const cx = (sa.x + sb.x) / 2;
        const cy = (sa.y + sb.y) / 2;
        const pin = ctx.read(e, Pinch);
        const anyUp = ctx.hasTag(pa, WentUp) || ctx.hasTag(pb, WentUp);

        if (ctx.hasTag(e, P.tags.Possible)) {
          if (anyUp) {
            P.set(ctx, e, "Cancelled"); // lost a finger pre-activation
            continue;
          }
          if (Math.abs(spread - pin.startDist) > gs(ctx).pinchSlopPx) {
            const zoom = ctx.getResource(Camera)?.zoom ?? 1;
            // Re-baseline at activation (v2): the dead-zone spread never zooms.
            ctx.edit(e).set(Pinch, { startDist: spread, startZoom: zoom, cx, cy, zoomAtClaim: zoom });
            P.set(ctx, e, "Active");
          }
          continue;
        }

        if (ctx.hasTag(e, P.tags.Active)) {
          ctx.edit(e).set(Pinch, { ...pin, cx, cy });
          if (anyUp) P.set(ctx, e, "Ended");
        }
      }
    },
    { name: "pinchSystem", access: { write: [Pinch] } },
  );

  const wheelSystem = defineSystem(
    wheelKindQ,
    (b, ctx) => {
      const now = clk(ctx);
      for (const r of b) {
        const e = b.entity(r);
        if (isTerminal(ctx, e)) continue;
        const pointer = ctx.getRelations(e, Watches)[0];
        if (pointer === undefined) continue;
        const wheel = ctx.read(pointer, PointerWheel);
        const screen = ctx.read(pointer, PointerScreen);
        const down = ctx.read(e, Down);
        const isZoom = ctx.has(e, WheelZoom);
        const active = isZoom ? wheel.pinch !== 0 : wheel.dx !== 0 || wheel.dy !== 0;

        if (active) {
          if (isZoom) {
            ctx.edit(e).set(WheelZoom, { pinch: wheel.pinch, anchorX: screen.x, anchorY: screen.y });
          } else {
            ctx.edit(e).set(WheelPan, { dx: wheel.dx, dy: wheel.dy, anchorX: screen.x, anchorY: screen.y });
          }
          ctx.edit(e).set(Down, { x: screen.x, y: screen.y, ms: now }); // last-activity timer
          if (ctx.hasTag(e, P.tags.Possible)) P.set(ctx, e, "Active");
        } else {
          // Zero the per-frame deltas so cameraControl never re-applies stale ones.
          if (isZoom) {
            const z = ctx.read(e, WheelZoom);
            if (z.pinch !== 0) ctx.edit(e).set(WheelZoom, { ...z, pinch: 0 });
          } else {
            const p = ctx.read(e, WheelPan);
            if (p.dx !== 0 || p.dy !== 0) ctx.edit(e).set(WheelPan, { ...p, dx: 0, dy: 0 });
          }
          if (ctx.hasTag(e, P.tags.Active) && now - down.ms > gs(ctx).wheelEndSilenceMs) {
            P.set(ctx, e, "Ended");
          }
        }
      }
    },
    { name: "wheelSystem", access: { write: [WheelPan, WheelZoom, Down], orderIndependent: [Down] } },
  );

  // dependency (last in ctl:recognize; v2 dependencySystem) — resolve the Pending
  // EDGE cases. `RequiresFail` gates the EXIT (finish once `other` fails);
  // `Sequence` gates the ENTRANCE (wait for `after` to pass, then hand off,
  // rebasing Down). A multi-tap Pending has neither edge → untouched (tapSystem
  // owns its window). TIMING (differs from v2's immediate-write model): phase
  // flips flush at the ctl:recognize boundary, so this system observes a
  // target's SAME-GROUP transition one frame later via its persistent tag —
  // safe because reap waits terminal+1 (cleanup.ts), and this system's own
  // flips flush before ctl:arbitrate reads their Just* markers this frame.
  const dependencySystem = defineSystem(
    pendingQ,
    (b, ctx) => {
      const now = clk(ctx);
      for (const r of b) {
        const e = b.entity(r);
        if (ctx.hasTag(e, HadRequiresFail)) {
          const other = ctx.getRelation(e, RequiresFail);
          if (other === undefined) {
            P.set(ctx, e, "Failed"); // orphaned edge (target despawned; edge auto-cleared)
          } else if (ctx.hasTag(other, P.tags.Failed) || ctx.hasTag(other, P.tags.Cancelled)) {
            // `other` failed → this may finish: discrete (Tap) → Recognized, continuous → Active.
            P.set(ctx, e, ctx.has(e, Tap) ? "Recognized" : "Active");
          } else if (ctx.hasTag(other, P.tags.Recognized) || ctx.hasTag(other, P.tags.Active)) {
            P.set(ctx, e, "Failed"); // `other` won → this loses
          } // else still waiting (other Possible/Pending)
          continue;
        }
        if (ctx.hasTag(e, HadSequence)) {
          const after = ctx.getRelation(e, Sequence);
          if (after === undefined) {
            P.set(ctx, e, "Failed");
          } else if (ctx.hasTag(after, P.tags.Active) || ctx.hasTag(after, P.tags.Recognized)) {
            // Hand off: rebase Down to the current pointer, enter, and RETIRE the
            // source — else it keeps its pointer claimed and arbitration would
            // fail this freshly-handed-off recognizer (v2 rule).
            const p = ctx.getRelations(e, Watches)[0];
            if (p !== undefined) {
              const screen = ctx.read(p, PointerScreen);
              ctx.edit(e).set(Down, { x: screen.x, y: screen.y, ms: now });
            }
            P.set(ctx, e, "Possible");
            // v2 retired an ACTIVE source; v3 must retire any still-live one —
            // LongPress claims at Recognized and keeps a continuous tail, and
            // arbitration's claim is first-wins (a live source would hold the
            // pointer against the handed-off recognizer forever).
            if (!isTerminal(ctx, after)) P.set(ctx, after, "Ended");
          } else if (ctx.hasTag(after, P.tags.Failed) || ctx.hasTag(after, P.tags.Cancelled)) {
            P.set(ctx, e, "Failed");
          } // else still waiting
        }
      }
    },
    { name: "dependencySystem", access: { write: [Down], orderIndependent: [Down] } },
  );

  return {
    cancelSweep,
    recognizerSpawn,
    wheelSpawn,
    recognizerIntegrity,
    tapSystem,
    longPressSystem,
    dragSystem,
    pinchSystem,
    wheelSystem,
    dependencySystem,
  };
}
