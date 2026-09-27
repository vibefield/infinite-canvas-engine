// The desk's ENGINE (design-015 §9, D2a-core's settings; D2a-world): `createCanvasEngine` over the
// shipped preset — `DESK_ENGINE` from `@ice/objects` (D7, D-D7-C.1 — its own package since K4b: the desk's objects, infinite
// zoom, the prototype's wheel zooming about the pointer, the zoom-through, and the desk's SELECT tool —
// a drag on the bare mat PANS, shift draws the marquee — as the root canvas type's default). Until D7
// the preset lived here, so the published quickstart could not do what the README said; the app now
// takes exactly what a third party takes, and adds its room and its people.

import { type BootstrapClock, broadcastChannelByteChannel, type ByteChannel, type CanvasEngine, createCanvasEngine, type JoinResult, webSocketByteChannel } from "@ice/core";
import { DESK_ENGINE, deskSelect, PRESENCE_INKS } from "@ice/objects";

const param = (name: string): string | undefined => (typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get(name) ?? undefined);

/** `?room=<name>`: the desk joins that room's document (D2c's two-tab witness); absent, a fresh document. */
export const deskRoom = (): string | undefined => param("room");
/** `?relay=ws://host:port`: the room rides the ws relay (`pnpm relay`, design-015 D-D10) instead of a same-origin BroadcastChannel (D5a). */
export const deskRelay = (): string | undefined => param("relay");

/** A person at the desk as the room sees them (core's presence identity): a name, and the colour their hand is drawn in (D-D5a.1). */
export interface DeskIdentity {
  readonly name: string;
  readonly color: string;
}

/** The presence palette: the shipped palette's person inks (`PRESENCE_INKS` — what dom's remote-cursors reflector paints a peer in). */
export const PRESENCE_COLORS = PRESENCE_INKS;
const PRESENCE_NAMES = ["Otter", "Heron", "Marmot", "Lynx", "Falcon", "Badger", "Gecko", "Wren", "Vole", "Puffin"] as const;

/** `?name=` and `?color=` pin this desk's identity (a rig's two hands); otherwise a name and a colour drawn at random. */
export function deskIdentity(): DeskIdentity {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;
  return { name: param("name") ?? pick(PRESENCE_NAMES), color: param("color") ?? pick(PRESENCE_COLORS) };
}

export interface DeskRoomOptions {
  /** The room; default `?room=`. None: no join — the engine's fresh local document stands. */
  readonly room?: string;
  /** A ws relay's base URL; default `?relay=`. Absent: a same-origin BroadcastChannel keyed by the room. */
  readonly relay?: string;
  /** An injected byte channel (the units' linked pair) — overrides the room's own. */
  readonly channel?: ByteChannel;
  /** The bootstrap's hello-timeout clock (the units' fake one); default real timers. */
  readonly clock?: BootstrapClock;
  /** Who this desk is in the room; default `deskIdentity()`. */
  readonly identity?: DeskIdentity;
}

/**
 * The desk's document in a ROOM (design-015 D-D10's `?room=`: over a same-origin BroadcastChannel — two
 * tabs, no server — or, with `?relay=`, the ws relay — two machines): joined through core's bootstrap
 * with PRESENCE on the same channel (the peers' hands and selections — the marks draw them, D-D5a.1), the
 * desk's tool in hand once it attaches. The room is the truth: nothing here reads or writes storage.
 * Resolves undefined at once for a desk with no room (its fresh document was made with the engine).
 */
export async function joinDeskRoom(engine: CanvasEngine, opts: DeskRoomOptions = {}): Promise<JoinResult | undefined> {
  const room = opts.room ?? deskRoom();
  if (room === undefined) return undefined;
  const relay = opts.relay ?? deskRelay();
  const channel = opts.channel ?? (relay !== undefined ? webSocketByteChannel(new WebSocket(`${relay}/${encodeURIComponent(room)}`)) : broadcastChannelByteChannel(`ice-desk:${room}`));
  const joined = await engine.docs.join(channel, { presence: opts.identity ?? deskIdentity(), ...(opts.clock !== undefined ? { clock: opts.clock } : {}) });
  engine.ops.setTool(deskSelect.id);
  return joined;
}

/**
 * The faults the engine CONTAINED on this page (design-015 D7): a reflector's throw (its frame skipped) and a guest's (the breaker's),
 * each also on the console as core logs it by default. `window.__desk.faults` is this list; every rig's "no page errors" row holds it
 * empty — a kind's record throwing on some frames skips those frames and stays otherwise invisible.
 */
export const DESK_FAULTS: string[] = [];
const faultText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A desk engine with a fresh document — none yet in a room (`joinDeskRoom` brings the room's) — the desk's tool in hand; its contained faults into `faults`. */
export function createDeskEngine(room: string | undefined = deskRoom(), faults: string[] = DESK_FAULTS): CanvasEngine {
  const engine = createCanvasEngine({
    ...DESK_ENGINE,
    onReflectorFault: (name, err) => { faults.push(`reflector "${name}": ${faultText(err)}`); console.error(`[ice] reflector "${name}" threw — skipped this frame`, err); },
    onGuestFault: (id, err) => { faults.push(`guest "${id}": ${faultText(err)}`); console.error(`[ice] guest "${id}" faulted`, err); },
  });
  if (room !== undefined) return engine;
  engine.docs.create();
  engine.ops.setTool(deskSelect.id);
  return engine;
}
