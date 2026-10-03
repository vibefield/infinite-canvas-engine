// `window.__desk.room` — the ROOM's doors for the rigs (D5a: the M5 two-tab rows and M9's live collab witness).
// A room's tabs share one document but not their entity ids, so an object crosses by its durable KEY (the same in
// every tab); a background tab's world projects nothing without a frame, so what its DOCUMENT holds for an object
// it already projected is read through the key↔handle bijection (strata's handle-addressed `getComponent` reads the
// document, not the world — a value a peer committed is there at once). A NEW object needs one frame to be
// projected before a key resolves. `commits()` counts this tab's local commits as the transport sees them (each one
// is one outbound update — a gesture that lands as ONE commit counts one). `peers()` is the room's other people as
// this tab's world holds them (petition I26's witness: what `usePresencePeers` lists, and the hand core derived for each).

import { type CanvasEngine, CursorVisual, type DocSession, type Entity, Follows, Local, Not, Position, PresenceInfo, PresencePeer, Size, defineQuery } from "@ice/core";

const remotePeersQ = defineQuery([PresencePeer, Not(Local)]);
const handQ = defineQuery([CursorVisual, Position]);

export interface RoomApi {
  /** An object's durable key in this tab's document (the same in every tab of the room), or null. */
  key(id: number): string | null;
  /** The entity this tab's WORLD projected for a key, or null (not projected yet, or gone). */
  resolve(key: string): number | null;
  /** What this tab's DOCUMENT holds for a key it projected — its rect — read without a frame; null when the document has none. */
  doc(key: string): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
  /** This tab's local commits since the first call (each one outbound update); the first call arms the count. */
  commits(): number;
  /**
   * The room's other people as this tab's WORLD holds them (petition I26): each remote peer's name and colour — what `usePresencePeers`
   * lists — and its hand, the world point of the `CursorVisual "remote"` core derived for it (null before it has one). Whether the page
   * DRAWS that hand is the host's (`deskLayer({ cursors })`); this reads the world, never the page.
   */
  peers(): readonly { readonly name: string | null; readonly color: string | null; readonly hand: { readonly x: number; readonly y: number } | null }[];
}

export function roomApi(engine: CanvasEngine): RoomApi {
  const store = (): DocSession["store"] | undefined => engine.docs.current()?.store;
  let counted: DocSession | undefined;
  let commits = 0;
  return {
    key: (id) => store()?.keyOf(id as Entity) ?? null,
    resolve(key) {
      const e = store()?.resolve(key as never);
      return e === undefined || !engine.world.isAlive(e) ? null : (e as number);
    },
    doc(key) {
      const s = store();
      const e = s?.resolve(key as never);
      if (s === undefined || e === undefined) return null;
      const p = s.getComponent(e, Position);
      const z = s.getComponent(e, Size);
      return p === undefined || z === undefined ? null : { x: p.x, y: p.y, w: z.w, h: z.h };
    },
    commits() {
      const s = engine.docs.current();
      if (s !== undefined && s !== counted) {
        counted = s;
        s.store.subscribeOutbound(() => { commits += 1; });
      }
      return commits;
    },
    peers() {
      const w = engine.world;
      const hands = new Map<Entity, { x: number; y: number }>();
      w.query(handQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const peer = w.get(e, CursorVisual)?.kind === "remote" ? w.getRelation(e, Follows) : undefined;
          if (peer !== undefined) { const p = w.read(e, Position); hands.set(peer, { x: p.x, y: p.y }); }
        }
      });
      const out: { name: string | null; color: string | null; hand: { x: number; y: number } | null }[] = [];
      w.query(remotePeersQ).each((b) => {
        for (const r of b) {
          const e = b.entity(r);
          const info = w.get(e, PresenceInfo);
          out.push({ name: info?.name ?? null, color: info?.color ?? null, hand: hands.get(e) ?? null });
        }
      });
      return out;
    },
  };
}
