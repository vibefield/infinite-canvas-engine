// The desk's ENGINE (design-015 §9, D2a-core's settings; D2a-world): `createCanvasEngine` with the
// desk's objects, infinite zoom, the prototype's wheel (a plain wheel zooms about the pointer by
// exp(−Δ · 0.0016)), and the desk's SELECT tool — a drag on the bare mat PANS, shift draws the
// marquee (D-D11) — as the root canvas type's default. Core registers no desk tool or settings; the
// app does (the brief's pinned detail).

import { type BootstrapClock, broadcastChannelByteChannel, type ByteChannel, type CanvasEngine, createCanvasEngine, defineCanvasType, defineTool, type JoinResult, type Tool, tools, webSocketByteChannel } from "@ice/core";
import { DESK_OBJECTS } from "@ice/desk/objects";
import { MARKS } from "@ice/desk/theme";

function builtin(id: string): Tool {
  const tool = tools.get(id);
  if (tool === undefined) throw new Error(`desk: missing built-in tool ${id}`);
  return tool;
}

/** The desk's select tool: the bare mat pans, shift-drag draws the vellum marquee; a drag on an object moves it. */
export const deskSelect: Tool = defineTool({ id: "desk.select", route: { canvasDrag: "pan", canvasDragShift: "marquee" } });

/** The tools the engine compiles — a typed engine must name `select` even when no canvas allows it. */
export const DESK_TOOLS: readonly Tool[] = [builtin("select"), deskSelect, builtin("pan")];

/** The desk as a canvas type: its objects, its two tools, the natural arrival band (FIT: pad 80, zoom ½–1). */
export const DeskCanvas = defineCanvasType({
  id: "desk.desk",
  semanticVersion: 1,
  semantic: { placement: { widgets: [...DESK_OBJECTS] } },
  presentation: {
    tools: { allowed: [deskSelect, builtin("pan")], default: deskSelect },
    camera: { arrival: "fit", padding: 80, minZoom: 0.5, maxZoom: 1 },
  },
});

/** design-015 §9: the mat's lattice is scale-free — the zoom is infinite in both directions. */
export const ZOOM_MIN = 1e-8;
export const ZOOM_MAX = 1e8;

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

/** The presence palette: the desk's hand inks (theme.ts) — they read on the lit mat and under the Moon, none of them the pencil's own blue (that is YOUR hand). */
export const PRESENCE_COLORS = MARKS.hand.inks;
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

/** A desk engine with a fresh document — none yet in a room (`joinDeskRoom` brings the room's) — the desk's tool in hand. */
export function createDeskEngine(room: string | undefined = deskRoom()): CanvasEngine {
  const engine = createCanvasEngine({
    widgets: [...DESK_OBJECTS],
    tools: DESK_TOOLS,
    canvasTypes: [DeskCanvas],
    rootCanvas: DeskCanvas,
    presentationFallback: DeskCanvas,
    // design-015 §9: the zoom-through is ON for the desk (a wheel that leaves a face covering the view cuts into it)
    settings: { zoom: { min: ZOOM_MIN, max: ZOOM_MAX }, gestures: { wheel: "zoom" }, nav: { zoomThrough: { enabled: true } } },
  });
  if (room !== undefined) return engine;
  engine.docs.create();
  engine.ops.setTool(deskSelect.id);
  return engine;
}
