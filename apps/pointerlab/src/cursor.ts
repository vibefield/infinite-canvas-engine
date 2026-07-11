/**
 * Cursor presentation concern — v2 cursor.ts ported to v3 tick systems. A
 * cursor is a composition: `Cur` (kinematics) + `CursorVisual` (catalog) +
 * `Follows → target` (+ `RemoteInfo` for remote identity). All whole-frame
 * walks → `defineTickSystem` (house rule) with `ctx.query` inner walks;
 * every write is change-only (easeSettle returns null when settled).
 */
import {
  Cur,
  DOT_SCALE,
  RemoteId,
  RemoteInfo,
  WidgetVisual,
  WorldPos,
  easeSettle,
} from "./components";
import {
  CursorVisual,
  Follows,
  FrameInfo,
  LocalPointer,
  Pointer,
  PointerButtons,
  PointerScreen,
  Targets,
  defineQuery,
  defineTickSystem,
  type Entity,
  type SystemCtx,
} from "@ice/core";

const PALETTE = ["#f178d4", "#5b9cff", "#3fd07f", "#ffb86e", "#c08bff"];
const NAMES = ["Ava", "Kai", "Mio", "Zoe", "Rin"];

const localPointerQ = defineQuery([Pointer, PointerScreen, LocalPointer]);
const remotePointerQ = defineQuery([WorldPos, RemoteId]);
const curQ = defineQuery([Cur, CursorVisual]);

/** The followed target's position: local pointer → screen coords; remote pointer → world coords. */
function targetPos(ctx: SystemCtx, target: Entity): { x: number; y: number } | undefined {
  if (ctx.has(target, PointerScreen)) return ctx.read(target, PointerScreen);
  if (ctx.has(target, WorldPos)) return ctx.read(target, WorldPos);
  return undefined;
}

export function createCursorSystems() {
  /** react — spawn a cursor for any pointer (local or fake-remote) that has none yet. */
  const cursorSpawn = defineTickSystem(
    (ctx) => {
      ctx.query(localPointerQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (ctx.getReverse(p, Follows).length > 0) continue;
          const at = ctx.read(p, PointerScreen);
          const c = ctx.spawn({
            components: [
              [Cur, { x: at.x, y: at.y, scale: 0, tau: 55 }],
              [CursorVisual, { kind: "local", pressed: false }],
            ],
          });
          ctx.setRelation(c, Follows, p);
        }
      });
      ctx.query(remotePointerQ).each((b) => {
        for (const r of b) {
          const p = b.entity(r);
          if (ctx.getReverse(p, Follows).length > 0) continue;
          const at = ctx.read(p, WorldPos);
          const i = ctx.read(p, RemoteId).n;
          const c = ctx.spawn({
            components: [
              [Cur, { x: at.x, y: at.y, scale: 0, tau: 90 }],
              [CursorVisual, { kind: "remote", pressed: false }],
              [
                RemoteInfo,
                {
                  color: PALETTE[i % PALETTE.length] ?? "#ffffff",
                  label: NAMES[i % NAMES.length] ?? "",
                },
              ],
            ],
          });
          ctx.setRelation(c, Follows, p);
        }
      });
    },
    { name: "plCursorSpawn" },
  );

  /** simulate — the reusable follow spring (v2 followerSystem): ease Cur toward its target. */
  const follower = defineTickSystem(
    (ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const target = ctx.getRelation(e, Follows);
          if (target === undefined) continue; // target gone — hold position; reap handles it
          const goal = targetPos(ctx, target);
          if (goal === undefined) continue;
          const cur = ctx.read(e, Cur);
          const nx = easeSettle(cur.x, goal.x, dt, cur.tau);
          const ny = easeSettle(cur.y, goal.y, dt, cur.tau);
          if (nx === null && ny === null) continue; // settled — skip the write
          ctx.edit(e).set(Cur, { ...cur, x: nx ?? cur.x, y: ny ?? cur.y });
        }
      });
    },
    { name: "plFollower", access: { write: [Cur], orderIndependent: [Cur] } },
  );

  /** simulate — local visual: ring↔dot morph over widgets + pressed flag (v2 localCursorVisual). */
  const localVisual = defineTickSystem(
    (ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const vis = ctx.read(e, CursorVisual);
          if (vis.kind !== "local") continue;
          const cur = ctx.read(e, Cur);
          const target = ctx.getRelation(e, Follows);
          const present = target !== undefined;
          // Over a content widget? Targets is the disc-picked hover target — already
          // debounced by picking's release dead-band, so the morph doesn't flicker.
          const hover = present ? ctx.getRelation(target, Targets) : undefined;
          const overWidget = hover !== undefined && ctx.has(hover, WidgetVisual);
          const goal = !present ? 0 : overWidget ? DOT_SCALE : 1;
          const ns = easeSettle(cur.scale, goal, dt, 90);
          if (ns !== null) ctx.edit(e).set(Cur, { ...cur, scale: ns });
          const pressed =
            present && ctx.has(target, PointerButtons) && ctx.read(target, PointerButtons).buttons !== 0;
          if (vis.pressed !== pressed) ctx.edit(e).set(CursorVisual, { ...vis, pressed });
        }
      });
    },
    { name: "plLocalCursorVisual", access: { write: [Cur, CursorVisual], orderIndependent: [Cur] } },
  );

  /** simulate — remote visual: grow-in / shrink-out on join/leave (v2 remoteCursorVisual). */
  const remoteVisual = defineTickSystem(
    (ctx) => {
      const dt = ctx.getResource(FrameInfo)?.dt ?? 16;
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (ctx.read(e, CursorVisual).kind !== "remote") continue;
          const cur = ctx.read(e, Cur);
          const present = ctx.getRelation(e, Follows) !== undefined;
          const ns = easeSettle(cur.scale, present ? 1 : 0, dt, 110);
          if (ns !== null) ctx.edit(e).set(Cur, { ...cur, scale: ns });
        }
      });
    },
    { name: "plRemoteCursorVisual", access: { write: [Cur], orderIndependent: [Cur] } },
  );

  /** cleanup — a cursor whose target despawned shrinks to 0 and reaps itself (v2 cursorReap). */
  const cursorReap = defineTickSystem(
    (ctx) => {
      ctx.query(curQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          if (ctx.getRelation(e, Follows) !== undefined) continue; // edge auto-cleared on despawn
          if (ctx.read(e, Cur).scale < 0.02) ctx.destroy(e);
        }
      });
    },
    { name: "plCursorReap" },
  );

  return { cursorSpawn, follower, localVisual, remoteVisual, cursorReap };
}
