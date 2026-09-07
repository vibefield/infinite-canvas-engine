/**
 * INPUT through a promoted card — the old leg's `input` rig, PORTED to the new
 * profile at B8 (design-013 §8 B8, R7).
 *
 * The old rig (`scripts/composited-input.mjs` over `composited-board.html`) was
 * the S3 exit of design-012 and the one piece of coverage no `next-*` rig had
 * picked up: nothing on the new leg graded hit truth, camera-tracking of a
 * promoted host, or a pure pan's upload cost. Those questions do not belong to
 * the old compositor — they belong to the L1 source canvas and to whoever owns
 * a canvas-side host's geometry, which on this leg is DomRender (B4 R6). So the
 * rows are re-expressed against `groundCompose` + `compositedProfile`:
 *
 *   1. TRANSFORM COMPOSE — inside `layoutsubtree` the placement matrix replaces
 *      layout, so a promoted host's client rect must equal the card's screen
 *      rect through a pan. Measured as the worst per-frame offset, in CSS px.
 *   2. STALE HIT REGIONS — `elementFromPoint` at a moving card's centre must
 *      name that card's host on EVERY frame of the gesture. The old leg's
 *      defect was a write-back that deferred during a gesture: clicks landed
 *      0/24. Here the geometry writer runs in the roster every frame, and this
 *      is what says so.
 *   3. A PURE PAN UPLOADS ZERO BYTES — the camera moving is not content
 *      changing. The host's own placement write raises a paint event naming the
 *      host (measured 2026-08-31; see `@ice/dom`'s `source-canvas.ts` header),
 *      so the writer has to keep its own writes out of the upload path. 600
 *      frames, 0 copies, while the ground really does redraw.
 *   4. NATIVE INPUT — a synthesised click focuses the REAL `<input>` inside the
 *      unpainted host, and typing reaches it. Hit-testing, focus, caret and IME
 *      are the platform's, with no router: that is the whole point of L1.
 *   5. THE GUARD IS A FILTER, NOT A MUTE — typing is content, so it must reach
 *      the copy path. An arm that suppressed everything would pass row 3 too.
 *
 * Input is driven ONLY through this app's own `webContents.sendInputEvent`
 * (the driver). Nothing here touches the machine's real input stack.
 *
 * Mounted from `composited-input.html`, driven by
 * `scripts/composited-input.mjs`.
 */
import {
  acquireCompositorDevice,
  Camera,
  type EngineGpu,
  type Entity,
  Position,
  Size,
  SurfaceTarget,
  defineWidget,
  p,
  spawnWidget,
} from "@ice/core";
import { instrumentSubmits, type SubmitInstrument } from "@ice/ground";
import { groundCompose, type GroundComposeContext, type GroundComposeHandle } from "@ice/ground/compose";
import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { cuttingMat, needleGlyph, vfFrame } from "@ice/ground/packs";
import { compositedProfile, InfiniteCanvas, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { createDemoEngine } from "../App";

type RGB = readonly [number, number, number];

/** The board in world units. Wide apart so no card's slot neighbours another's. */
const CARD = { w: 260, h: 150 } as const;
const GRID = { x: 60, y: 60, dx: 320, dy: 220 } as const;
const cardRect = (i: number) => ({ x: GRID.x + (i % 3) * GRID.dx, y: GRID.y + Math.floor(i / 3) * GRID.dy, w: CARD.w, h: CARD.h });

const PALETTE: readonly RGB[] = [
  [40, 84, 148],
  [148, 64, 40],
  [48, 120, 84],
  [120, 48, 120],
  [140, 120, 40],
  [60, 60, 132],
];
const rgbCss = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * A card with a REAL text input in it. The input is the subject of rows 4 and
 * 5: it is focused by a synthesised click through the unpainted host, typed
 * into, and its value read back — all of it the platform's own machinery.
 */
function InputView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<{ index: number }>(world, entity, "b8-input");
  const i = Math.max(0, Math.round(props?.index ?? 0)) % PALETTE.length;
  const bg = PALETTE[i] as RGB;
  return (
    <div style={{ width: "100%", height: "100%", background: rgbCss(bg), boxSizing: "border-box" }}>
      <input
        data-rig-input={String(i)}
        style={{ position: "absolute", left: "24px", top: "56px", width: "180px", height: "34px", font: "16px system-ui", border: "0", padding: "0 8px" }}
      />
    </div>
  );
}

const InputCard = defineWidget({
  type: "b8-input",
  surface: "dom",
  component: InputView,
  defaultSize: { w: CARD.w, h: CARD.h },
  props: { index: p.number({ default: 0 }) },
});

interface Mounted {
  readonly profile: string;
  readonly canvases: number;
  readonly sourceCanvases: number;
  readonly available: boolean;
  readonly gpuErrors: number;
  readonly viewport: string;
}
interface Tracked {
  readonly frames: number;
  /** Worst |host rect origin − expected screen origin| over the sweep, in CSS px. */
  readonly maxOffset: number;
  /** Worst |host rect size − expected screen size| over the sweep, in CSS px. */
  readonly maxSizeError: number;
  /** Frames on which the host's own client rect was measured at all. */
  readonly sampled: number;
  /** The host at rest, with NO placement matrix of its own, sits at the canvas origin. */
  readonly inertRect: { x: number; y: number };
}
interface Hits {
  readonly checked: number;
  readonly landed: number;
  readonly maxOffset: number;
  readonly examples: readonly { frame: number; want: string; got: string }[];
}
interface Pan {
  readonly frames: number;
  readonly copies: number;
  readonly dirtied: number;
  /** Of `dirtied`, the marks the §4.2 guard dropped as this module's own placement writes. */
  readonly selfDirt: number;
  readonly redraws: number;
  readonly submits: number;
  readonly resized: number;
  readonly pendingAtStart: number;
  readonly parked: number;
  readonly refused: number;
}
interface InputRig {
  readonly ready: Promise<void>;
  mount(): Promise<Mounted>;
  board(n: number): Promise<{ cards: number; promoted: number; onCanvas: number; copies: number }>;
  transformTracks(frames: number): Promise<Tracked>;
  midGestureHits(samples: number): Promise<Hits>;
  panUpload(frames: number): Promise<Pan>;
  /** The input's hit rect in CSS px, for the driver's synthesised click. */
  focusTarget(i: number): Promise<{ x: number; y: number; w: number; h: number }>;
  inputState(): Promise<{ focused: boolean; activeInsideCanvas: boolean; value: string }>;
  dirtCounters(): Promise<{ dirtied: number; copies: number }>;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await frame(); };

function mountInputRig(): InputRig {
  let gpu: EngineGpu | undefined;
  let instrument: SubmitInstrument | undefined;
  let handle: GroundComposeHandle | null = null;
  let engine: ReturnType<typeof createDemoEngine> | undefined;
  const rootEl = document.getElementById("root") as HTMLElement;
  let cards: Entity[] = [];
  let zoom = 1;

  const ready = (async () => {
    gpu = await acquireCompositorDevice();
    instrument = instrumentSubmits(gpu.device);
    engine = createDemoEngine(gpu, [InputCard]);
    const factory = groundCompose({ device: gpu.device, theme: THEMES.dark, card: vfFrame(), grids: [needleGlyph, cuttingMat] });
    const ground = (ctx: GroundComposeContext) => { handle = factory(ctx); return handle; };
    createRoot(rootEl).render(<InfiniteCanvas engine={engine} ground={ground} profile={compositedProfile} className="h-full w-full" />);
    await frames(2);
  })();

  const must = <T,>(v: T | null | undefined, what: string): T => { if (v === null || v === undefined) throw new Error(`rig: no ${what}`); return v; };
  const ce = () => must(engine, "engine");
  const stats = () => handle?.compose.domRender?.stats();
  const copies = () => stats()?.copies ?? 0;
  const submits = () => instrument?.total() ?? 0;
  const redraws = () => handle?.compose.redraws() ?? 0;
  const hostOf = (e: Entity): HTMLElement | null => document.querySelector(`[data-ice-entity="${String(e)}"]`);
  const l1 = (): HTMLCanvasElement | null => rootEl.querySelector("canvas[data-ice-source-canvas]");
  const until = async (pred: () => boolean, max = 300) => { for (let i = 0; i < max && !pred(); i++) await frame(); return pred(); };
  /** Where the card's top-left sits on screen, in CSS px, under the current camera. */
  const expectOrigin = (card: Entity) => {
    const world = ce().world;
    const cam = must(world.getResource(Camera), "Camera");
    const pos = must(world.get(card, Position), "Position");
    const canvas = must(l1(), "the L1 canvas").getBoundingClientRect();
    return { x: canvas.left + (pos.x - cam.x) * cam.zoom, y: canvas.top + (pos.y - cam.y) * cam.zoom };
  };
  const expectSize = (card: Entity) => {
    const world = ce().world;
    const cam = must(world.getResource(Camera), "Camera");
    const size = must(world.get(card, Size), "Size");
    return { w: size.w * cam.zoom, h: size.h * cam.zoom };
  };
  const pan = (x: number, y: number, gesturing: boolean) => {
    ce().world.setResource(Camera, { x, y, zoom, gesturing });
  };

  return {
    ready,
    async mount() {
      await ready;
      await until(() => (handle?.compose.available() ?? false) && redraws() > 0);
      return {
        profile: compositedProfile.name,
        canvases: rootEl.querySelectorAll("canvas:not([data-ice-source-canvas])").length,
        sourceCanvases: rootEl.querySelectorAll("canvas[data-ice-source-canvas]").length,
        available: handle?.compose.available() ?? false,
        gpuErrors: gpu?.errors().length ?? 0,
        viewport: `${rootEl.clientWidth}x${rootEl.clientHeight}`,
      };
    },
    async board(n) {
      const e = ce();
      const world = e.world;
      const session = e.docs.create();
      zoom = 1;
      pan(0, 0, false);
      cards = [];
      for (let i = 0; i < n; i++) {
        const r = cardRect(i);
        cards.push(spawnWidget(session.store, world, "b8-input", { ...r, undoable: false, props: { index: i } }));
      }
      world.sync();
      await frames(6);
      await until(() => hostOf(must(cards[0], "card 0")) !== null);
      // Promote every card: the PIXEL arm's write (no Grab, so no lift and no
      // shadow — this rig measures placement and hits, never a picture).
      for (const c of cards) world.edit(c).set(SurfaceTarget, { target: "gpu" });
      await until(() => cards.every((c) => handle?.compose.residency.isWritten(c) === true), 300);
      await frames(4);
      const canvas = l1();
      return {
        cards: cards.length,
        promoted: cards.filter((c) => world.get(c, SurfaceTarget)?.target === "gpu").length,
        onCanvas: cards.filter((c) => hostOf(c)?.parentElement === canvas).length,
        copies: copies(),
      };
    },
    async transformTracks(n) {
      const card = must(cards[0], "card 0");
      const host = must(hostOf(card), "the host");
      // The INERT reading first: with the placement matrix cleared, a
      // `layoutsubtree` child sits at the canvas origin whatever its left/top
      // says — which is why the writer uses a matrix at all. (Restored below by
      // the next flush, which is change-only against `placed`, so the sweep is
      // measured after a real write.)
      host.style.transform = "none";
      await frames(2);
      const canvas = must(l1(), "the L1 canvas").getBoundingClientRect();
      const bare = host.getBoundingClientRect();
      const inertRect = { x: Math.round(bare.left - canvas.left), y: Math.round(bare.top - canvas.top) };

      let maxOffset = 0;
      let maxSizeError = 0;
      let sampled = 0;
      for (let i = 1; i <= n; i++) {
        pan(Math.sin(i / 19) * 260, Math.cos(i / 23) * 150, true);
        await frame();
        const r = host.getBoundingClientRect();
        const want = expectOrigin(card);
        const size = expectSize(card);
        maxOffset = Math.max(maxOffset, Math.abs(r.left - want.x), Math.abs(r.top - want.y));
        maxSizeError = Math.max(maxSizeError, Math.abs(r.width - size.w), Math.abs(r.height - size.h));
        sampled++;
      }
      pan(0, 0, false);
      await frames(3);
      return { frames: n, maxOffset, maxSizeError, sampled, inertRect };
    },
    async midGestureHits(samples) {
      const card = must(cards[0], "card 0");
      const host = must(hostOf(card), "the host");
      let checked = 0;
      let landed = 0;
      let maxOffset = 0;
      const examples: { frame: number; want: string; got: string }[] = [];
      for (let i = 1; i <= samples; i++) {
        // A real gesture: the camera moves and `gesturing` is true, which is
        // exactly when the old leg's write-back deferred and every click missed.
        pan(Math.sin(i / 5) * 150, Math.cos(i / 7) * 95, true);
        await frame();
        const want = expectOrigin(card);
        const size = expectSize(card);
        const cx = Math.round(want.x + size.w / 2);
        const cy = Math.round(want.y + size.h / 2);
        const hit = document.elementFromPoint(cx, cy);
        const r = host.getBoundingClientRect();
        maxOffset = Math.max(maxOffset, Math.abs(r.left - want.x), Math.abs(r.top - want.y));
        checked++;
        const ok = hit !== null && (hit === host || host.contains(hit));
        if (ok) landed++;
        else if (examples.length < 3) examples.push({ frame: i, want: `${cx},${cy}`, got: hit === null ? "(nothing)" : `${hit.tagName}${hit.getAttribute("data-ice-entity") ?? ""}` });
      }
      pan(0, 0, false);
      await frames(3);
      return { checked, landed, maxOffset, examples };
    },
    async panUpload(n) {
      // Start on a DRAINED board: an arm that begins owing copies is charged
      // for the previous one.
      await until(() => (stats()?.pending ?? 1) === 0, 120);
      const pendingAtStart = stats()?.pending ?? -1;
      const c0 = copies();
      const d0 = stats()?.dirtied ?? 0;
      const sd0 = stats()?.selfDirt ?? 0;
      const rz0 = stats()?.resized ?? 0;
      const rf0 = stats()?.refused ?? 0;
      const r0 = redraws();
      const s0 = submits();
      for (let i = 1; i <= n; i++) {
        pan(Math.sin(i / 40) * 220, Math.cos(i / 55) * 160, true);
        await frame();
      }
      pan(0, 0, false);
      await frames(3);
      return {
        frames: n,
        copies: copies() - c0,
        dirtied: (stats()?.dirtied ?? 0) - d0,
        selfDirt: (stats()?.selfDirt ?? 0) - sd0,
        redraws: redraws() - r0,
        submits: submits() - s0,
        resized: (stats()?.resized ?? 0) - rz0,
        refused: (stats()?.refused ?? 0) - rf0,
        pendingAtStart,
        parked: stats()?.parked ?? -1,
      };
    },
    async focusTarget(i) {
      const card = must(cards[i], `card ${i}`);
      const host = must(hostOf(card), "the host");
      const el = must(host.querySelector("input"), "the input");
      await frames(2);
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    async inputState() {
      await frames(2);
      const active = document.activeElement;
      const canvas = l1();
      const isInput = active !== null && active.tagName === "INPUT";
      return {
        focused: isInput,
        activeInsideCanvas: isInput && canvas !== null && canvas.contains(active),
        value: isInput ? (active as HTMLInputElement).value : "",
      };
    },
    async dirtCounters() {
      await frames(4);
      return { dirtied: stats()?.dirtied ?? 0, copies: copies() };
    },
  };
}

declare global {
  interface Window { __inputRig?: InputRig }
}
window.__inputRig = mountInputRig();
