/**
 * Remote-presence simulation — v2 remote.ts ported to v3 tick systems. The
 * stand-in for a real sync layer: writes the SAME data (a remote pointer's
 * WORLD position) a presence channel would, and simulates join/leave churn.
 * Swap this for a socket → nothing else changes.
 */
import { RemoteGoal, RemoteId, RemotePointer, RemoteSim, WorldPos, easeSettle } from "./components";
import { FrameInfo, defineQuery, defineTickSystem, type Entity, type World } from "@ice/core";

const MIN_USERS = 1;
const MAX_USERS = 5;
// The WORLD region the fake remotes wander in — covers the demo widgets
// (target.ts), so remote cursors appear among the content and track it under
// pan/zoom. (A real channel would send actual coords.)
const WORLD = { x0: 100, y0: 120, x1: 980, y1: 780 };
const randIn = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

const remoteQ = defineQuery([WorldPos, RemoteGoal, RemoteId]);

/** Spawn one fake remote user (WORLD coords). */
export function spawnRemotePointer(world: World, userId: number, x: number, y: number): void {
  world.spawn({
    components: [
      [WorldPos, { x, y }],
      [RemoteGoal, { x, y, nextMs: 0 }],
      [RemoteId, { n: userId }],
    ],
    tags: [RemotePointer],
  });
}

export function spawnRemotePointers(world: World, n: number): void {
  for (let i = 0; i < n; i++) spawnRemotePointer(world, i, 220 + i * 150, 220);
  world.setResource(RemoteSim, { nextUserId: n, nextChurnMs: 0 });
}

export function createRemoteSystems(world: World) {
  /** input — join/leave churn every few seconds (v2 remotePresence). */
  const remotePresence = defineTickSystem(
    (ctx) => {
      const now = ctx.getResource(FrameInfo)?.now ?? 0;
      const sim = ctx.getResource(RemoteSim);
      if (sim === undefined) return;
      if (sim.nextChurnMs === 0) {
        world.setResource(RemoteSim, { ...sim, nextChurnMs: now + 3500 }); // first churn ~3.5s in
        return;
      }
      if (now < sim.nextChurnMs) return;

      const remotes: Entity[] = [];
      ctx.query(remoteQ).each((b) => {
        for (const r of b) remotes.push(b.entity(r));
      });
      const count = remotes.length;
      const join = count <= MIN_USERS ? true : count >= MAX_USERS ? false : Math.random() < 0.55;
      let nextUserId = sim.nextUserId;
      if (join) {
        // ctx.spawn so the placement rides the phase flush like every system spawn.
        const c = ctx.spawn({
          components: [
            [WorldPos, { x: randIn(WORLD.x0, WORLD.x1), y: randIn(WORLD.y0, WORLD.y1) }],
            [RemoteGoal, { x: 0, y: 0, nextMs: 0 }],
            [RemoteId, { n: nextUserId }],
          ],
          tags: [RemotePointer],
        });
        void c;
        nextUserId += 1;
      } else {
        const victim = remotes[Math.floor(Math.random() * remotes.length)];
        if (victim !== undefined) ctx.destroy(victim); // its cursor shrinks to 0 and self-reaps
      }
      world.setResource(RemoteSim, {
        nextUserId,
        nextChurnMs: now + 2500 + Math.random() * 4000,
      });
    },
    { name: "plRemotePresence" },
  );

  /** input — wander: each remote eases toward a fresh random goal every ~1.5–3.5s (v2 fakeRemoteDriver). */
  const fakeRemoteDriver = defineTickSystem(
    (ctx) => {
      const info = ctx.getResource(FrameInfo);
      const now = info?.now ?? 0;
      const dt = info?.dt ?? 16;
      ctx.query(remoteQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const t = ctx.read(e, WorldPos);
          let goal = ctx.read(e, RemoteGoal);
          if (now >= goal.nextMs) {
            goal = {
              x: randIn(WORLD.x0, WORLD.x1), // WORLD coords — the shared canvas
              y: randIn(WORLD.y0, WORLD.y1),
              nextMs: now + 1500 + Math.random() * 2000,
            };
            ctx.edit(e).set(RemoteGoal, goal);
          }
          const nx = easeSettle(t.x, goal.x, dt, 360);
          const ny = easeSettle(t.y, goal.y, dt, 360);
          // settled between goals → no write, keeps the change buffer clean
          if (nx !== null || ny !== null) {
            ctx.edit(e).set(WorldPos, { x: nx ?? t.x, y: ny ?? t.y });
          }
        }
      });
    },
    { name: "plFakeRemoteDriver", access: { write: [WorldPos, RemoteGoal] } },
  );

  return { remotePresence, fakeRemoteDriver };
}
