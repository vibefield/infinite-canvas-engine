// The DESK LAYER — what a host mounts (design-015 §3, plan D-D0.6; D2a-world): `deskLayer(opts)`
// returns a factory structurally assignable to `@ice/dom`'s `LayerFactory` (D5b: `createDeskHost`,
// wrapped by `@ice/react`'s `<Desk layer={deskLayer({ … })}>`, mounts the desk exactly as
// `<InfiniteCanvas ground={…}>` mounted the ground until D5 turned the host into `<Desk>` by
// deletion). This is the host half — the one module beside host/surface.ts that may touch the DOM:
// it prepends its canvas to the container, acquires its OWN device (`navigator.gpu`, or the `gpu` handed in),
// installs the submit instrument before anything can submit, makes the swap chain, compiles the
// ground from the app's object kinds (`Ground.create` — `available()` is false until it resolves),
// reads the OS's reduced-motion preference into the ambient, and hands the DOM-free reflector
// (compose/reflector.ts) what it needs: a `ground()` slot, a canvas sizer. It registers ONE
// reflector, sets the interaction stack's pick source (`framePick.current`) over the kinds' mirrors
// and clears it at dispose, and registers the `ground` transition plane so a nav flight can prepare.
//
// The parity hooks live on the HANDLE, never in durable props (the brief's pinned detail):
// `pinMat` (the clocks, the plate, the gobo's opacity, the wind), `pinRaster` (a committed ink
// raster on one note), `clearRasters`, `setPlate` / `setNoise` / `setGlyphs` (the product never
// fed the mat before — the render map's finding #2; the blue noise is the desk's own, the plates
// are the app's generated ones), `configureMat` (the rulers as the app's mat config). Instruments:
// `submits()`, `stats()`, `wakes()`, `geometryOf`, `fluxOf`, `lastInputs`.
//
// The TEXT (D2c, design-015 §6.1): each object kind's own state on this desk (`kind.local(host)` —
// the note's WRITING, over the root paper pass's pages and the app's text raster, `opts.text`) is made
// here and threaded through the builder; the ONE focused editor (host/editor.ts) sits in the
// container and writes through the note's typing session (objects/typing.ts) into `opts.docs`. The
// drawing reflector is wrapped, not changed: before it, every kind's local is ticked on ONE clock
// (`performance.now()` — the rAF clock lags wall time headless) and may wake an `ink` frame (a wipe,
// a blink, a face landing); after it, the editor follows the drawn note. A committed raster is
// pinned through the writing, so a note that leaves the desk gives its rect back (the page-slot leak).
//
// And the desk's chrome (D4a): the ground is made with the marks pass, the builder reads the interaction
// stack's marquee preview through the context's `readMarquee`, and the handle's `selection` is the one
// source a screen-space selection menu is placed from — the marks' box around the selection as drawn,
// published after every frame it changed.

import { Camera, type Entity, type FramePickSlot, type GridConfig as CoreGridConfig, type HeldPoseSlot, type HeldPoseSource, type MarqueeBuffer, type NavFace, type NavGeometrySlot, NavTransition, type PresentationTransitionAdapter, type ReflectorDef, Viewport, type WidgetType, type World } from "@ice/core";
import { flightCamera } from "../nav/flight";
import { type Ambient, type AmbientMode, type AmbientPin, createAmbient } from "../compose/ambient";
import { createDeskBuilder, type DeskBuilder, type HeldBuild, type HoldPin } from "../compose/builder";
import { HOLD_SHADER_FILES, holdShaders } from "../hold/shaders";
import type { SelectionAnchor } from "../compose/marks";
import { createPickSource } from "../compose/pick";
import { createDeskReflector, type DeskReflector, type DeskReflectorStats, type DeskWakes } from "../compose/reflector";
import { acquire } from "../engine/device";
import { Ground, type GroundFrameInputs } from "../ground";
import type { KindProgram } from "../kind";
import type { ObjectFlux, ObjectKind } from "../kinds/world";
import { DEFAULT_GRID, type GridConfig } from "../mat/grid";
import type { GlyphAtlasMeta, MatConfig, PlateName } from "../mat/layout";
import { MAT_SHADER_FILES, matShaders } from "../mat/shaders";
import { MARKS_SHADER_FILES, marksShaders } from "../marks/shaders";
import { objectKindOf } from "../object";
import type { ObjectSprings } from "../springs";
import { blueNoise } from "../assets/blue-noise.gen";
import { PAPER_KIND, type PaperWriting } from "../kinds/paper";
import type { KindLocal } from "../kinds/world";
import { worldChildren } from "../compose/children";
import type { BlobStore } from "../photo/blobs";
import { decodePicture } from "./picture";
import { createNoteTyping, type NoteTyping, type TypingDocs } from "../objects/typing";
import { createPhotoCarry } from "../objects/carry";
import { PHOTO_KIND, type Prints } from "../kinds/photo";
import type { TextRaster } from "../paper/raster";
import { DEFAULT_FACE, DEFAULT_HAND_LAW, type Writing } from "../paper/writing";
import { createNoteEditor, type NoteEditor } from "./editor";
import { PEN_FACES } from "./ink";
import type { InsideView } from "../minimat/inside";
import { shaderText } from "../shaders";
import { instrumentSubmits, type SubmitInstrument } from "../submit-instrument";
import type { GroundTheme, Palette } from "../theme";
import { surface } from "./surface";

export interface DeskLayerOptions {
  /** The theme in force at the mount (the app's `themeFrom(name, palette)`). */
  readonly theme: GroundTheme;
  /** The app's palette — what each kind's `theme()` reads its look from (`PaperPalette`, `MiniMatPalette`). */
  readonly palette: Palette;
  /**
   * The OBJECT widget types this desk draws, beyond the engine catalog's own: their kinds are registered
   * with the ground and join the builder's journal. The catalog's object types are always included.
   */
  readonly objects?: readonly WidgetType[];
  /** Render-only kinds to register beside the objects' (a program with no world half yet). */
  readonly kinds?: readonly KindProgram[];
  /** The ambient policy (design-015 §4.6): `idle` by default. */
  readonly ambient?: AmbientMode;
  /** How long after the last touch the wind blows, ms (20 000). */
  readonly ambientIdleMs?: number;
  /** The root's grid at the mount: the mat's config (its gobo, its rulers) and the lattice's fade-in. */
  readonly grid?: GridConfig;
  /** The objects' springs (springs.ts `SPRINGS`): the builder reads these numbers every frame, so a host that keeps the object may tune them live (the dev panel — D5a). */
  readonly springs?: ObjectSprings;
  /** The device pixel ratio the canvas is capped at (2). */
  readonly maxDpr?: number;
  /** `navigator.gpu` unless a host hands another. */
  readonly gpu?: GPU;
  /** Called once with the layer's OWN device, before anything submits — after the submit instrument is installed. */
  readonly onDevice?: (device: GPUDevice) => void;
  /** The layer's name in the reflector roster. */
  readonly name?: string;
  /** The app's text raster (`inkRaster({ faces: penFaces({ … }) })`, D2c): absent, no note is written live — the pinned rasters only. */
  readonly text?: TextRaster;
  /** The document a note's typing session commits into — the facade's `engine.docs` (D2c); absent, typing stays runtime-only. */
  readonly docs?: TypingDocs;
  /** A typing session ends after this long without input, ms (1000). */
  readonly idleMs?: number;
  /** The app's byte store (D3w, D-D12): a print's picture by the hash its `blob` prop names; absent, prints draw their paper alone. */
  readonly blobs?: BlobStore;
}

/** The pinned still a parity scene states: the clocks, the plate and the gobo's opacity, the wind (0 = a still). */
export interface MatPin extends AmbientPin {
  readonly plate?: PlateName;
  readonly opacity?: number;
  readonly wind?: number;
}

export interface DeskLayerStatus { readonly state: "pending" | "ready" | "failed"; readonly message?: string }

/** The mount context — the fields of `@ice/dom`'s `LayerContext` this layer reads, mirrored structurally (dom never imports the desk). */
export interface DeskLayerContext {
  readonly host: { readonly container: HTMLElement };
  readonly world: World;
  readonly framePick?: FramePickSlot;
  /** The nav geometry seam (design-015 §9, D2b): the desk sets its word on its containers' drawn faces here, clears it at dispose. */
  readonly navGeometry?: NavGeometrySlot;
  /** The held pose seam (design-015 §8, D4b): the desk publishes where the object in hand is ON SCREEN as it drew it; core's held input maps every pointer through it. */
  readonly heldPose?: HeldPoseSlot;
  readonly transitions?: { register(adapter: PresentationTransitionAdapter): () => void };
  readonly catalog?: { widgetTypes(): readonly WidgetType[] };
  /** The interaction stack's marquee preview (`stack.marqueeBuffer`, out of the ECS): the vellum the marks draw (D4a). */
  readonly readMarquee?: () => MarqueeBuffer;
}

/** The selection menu's source (D4a): the marks' anchor as of the last frame, and a subscription that fires when it changes. */
export interface SelectionSource {
  anchor(): SelectionAnchor;
  subscribe(listener: () => void): () => void;
}

/** A note's writing as a still states it for the far LOD (kinds/paper.ts `PaperWriting`): the text's left edge, its em, each line's baseline and width, note units. */
export type GreekPin = PaperWriting;

export interface DeskLayerHandle {
  /** The drawing reflector — the facade registers it right after the plane transform, where the ground layer has always gone. */
  readonly reflector: ReflectorDef & { available(): boolean };
  /** A host's grid re-tune (the old ground's magnet grid, the retired react `grid` prop): the desk keeps only its fade-in. */
  configureGrid(cfg: Partial<CoreGridConfig>): void;
  dispose(): void;
  /** The canvas in the ground slot. */
  readonly canvas: HTMLCanvasElement;
  /** The device is acquired and `Ground.create` resolved. */
  available(): boolean;
  status(): DeskLayerStatus;
  /** The layer's OWN device once acquired. */
  device(): GPUDevice | undefined;
  /** The ground once made (a rig's door to a pass: `ground()?.pass("paper")`). */
  ground(): Ground | null;
  /** The theme changed (and, with it, the palette): the looks are remade, the next frame re-renders. */
  setTheme(theme: GroundTheme, palette?: Palette): void;
  /** The mat's config over the current one (the rulers, the gobo): the root's grid. */
  configureMat(mat: Partial<MatConfig>): void;
  /** The lattice's fade-in window. */
  configureFadeIn(fadeIn: GridConfig["fadeIn"]): void;
  /** A 512² rgba8 plate into slot `c` or `b` — the app's generated plates (never the study's). */
  setPlate(name: PlateName, bytes: Uint8Array<ArrayBuffer>): void;
  /** The 128² blue-noise tile; the desk's own is uploaded at the mount. */
  setNoise(bytes: Uint8Array<ArrayBuffer>): void;
  /** The rulers' and the mini mats' glyph atlas (RULER.md). */
  setGlyphs(bytes: Uint8Array<ArrayBuffer>, meta: GlyphAtlasMeta): void;
  /** Pin the mat for a still (a parity scene): the clocks, the plate, the gobo's opacity; `wind` > 0 unpins the clocks. `null` unpins everything. */
  pinMat(pin: MatPin | null): void;
  /** Pin a committed ink raster on a note (r8 rows, `w × h`): allocated in the paper pass's pages in call order. Returns false when the pages are full or the pass is not here. */
  pinRaster(entity: Entity, bytes: Uint8Array<ArrayBuffer>, meta: { readonly w: number; readonly h: number }): boolean;
  /** Every raster forgotten and the pages carved afresh (a scene reload — the oracle's `reset(true)`). */
  clearRasters(): void;
  /** Pin a note's writing lines for its far-LOD chip (a still states them; the live text's layout is D2c's); `undefined` unpins. */
  pinGreek(entity: Entity, writing: GreekPin | undefined): void;
  /** Pin an object's spring targets for a still (a scene's `held` = `{ lift: 1 }`, never a `Grab`); `undefined` unpins. */
  pinFlux(entity: Entity, targets: Partial<Pick<ObjectFlux, "lift" | "hover" | "ring">> | undefined): void;
  /** Every flux pin lifted. */
  clearFlux(): void;
  /** Live insides on or off (the oracle's `portals: false` — every face draws its far LOD alone). */
  setPortals(on: boolean): void;
  /**
   * A kind's LAW, live (D5a — the dev panel's door): every object of `kind` resolves under `law` from the next build and the
   * root's pass (its slots after it) draws with it; a kind with no live law ignores it. The host owns the law it hands in.
   */
  tuneLaw(kind: string, law: unknown): void;
  /** Pin the root's dressing (the oracle's `lodZoom`); `null` unpins. */
  pinLodZoom(zoom: number | null): void;
  /** Hold every spring and ghost where it is — a still of a moving frame (a rig's flight pin). */
  freeze(on: boolean): void;
  /** Hold the re-dressing ramp at its start (the prototype harness's `redressPinned`). */
  holdRedress(on: boolean): void;
  /** THE HAND PINNED for a still (D4b): the carry amount at `e`, the kind's open motion snapped; `null` unpins. The object itself is picked up through `ops.open`. */
  pinHold(pin: HoldPin | null): void;
  /** The object in hand as of the last frame (D4b) — a rig's witness: its carry, its frame on screen, whether settled or flying home. */
  hand(): HeldBuild | undefined;
  /** THE SEAM's answer for a container under the camera (the live one unless given) — a rig's witness (`DeskBuilder.navFace`). */
  navFace(entity: Entity, cam?: { readonly x: number; readonly y: number; readonly zoom: number }): NavFace | undefined;
  /** The last build's view of a container's inside (a rig's witness). */
  insideViewOf(entity: Entity): InsideView | undefined;
  /**
   * The camera of the flight on now at progress `p` (the prototype's `flightAt`: the endpoints c0 and c1 themselves,
   * `flightCamera` between) — what a rig's flight pin writes each tick; `undefined` when no flight drives.
   */
  flightCameraAt(p: number): { readonly x: number; readonly y: number; readonly zoom: number } | undefined;
  /** The ambient policy, live: the mode, the idle window. */
  setAmbient(mode: AmbientMode, idleMs?: number): void;
  ambient(): Ambient;
  /** The submit instrument on the layer's device (installed before anything submits); undefined before the device. */
  submits(): SubmitInstrument | undefined;
  redraws(): number;
  stats(): DeskReflectorStats;
  wakes(): DeskWakes;
  geometryOf(e: Entity): unknown | undefined;
  fluxOf(e: Entity): ObjectFlux | undefined;
  lastInputs(): GroundFrameInputs | null;
  /** The frame dirty and not yet drawn, or a kind still moving on its own (a print in the air — D3w): a rig's settle witness. */
  dirty(): boolean;
  readonly builder: DeskBuilder;
  /** The note's writing on this desk (D2c): its layouts, rasters, caret and wipe — `undefined` when no note kind is registered. */
  writing(): Writing | undefined;
  /** A kind's own state on this desk by kind name (D3w: a print's body, a book's or a pad's pinned pose) — `undefined` when it keeps none. */
  local(name: string): KindLocal | undefined;
  /** The one focused editor (D2c) — `undefined` when no note kind is registered. */
  editor(): NoteEditor | undefined;
  /** The note's typing session (D2c): the claim, the live cell, the commit. */
  readonly typing: NoteTyping;
  /** Where the selection menu goes (D4a): the marks' box around the selection, published after each frame it moved. */
  readonly selection: SelectionSource;
  /**
   * The DOM-free reflector behind `reflector` — named `desk`, never `compose`: react's retired
   * `GroundLayerHandle.compose?` was the ground's COMPOSE handle (the composited profile read its
   * `sourceCanvas` seam off it, until D5b), and the desk was never one. The slot stays absent.
   */
  readonly desk: DeskReflector;
}

export type DeskLayerFactory = (ctx: DeskLayerContext) => DeskLayerHandle;

/** The object kinds behind widget types, deduplicated by name. */
function kindsOf(types: readonly WidgetType[], extra: readonly KindProgram[]): { kinds: KindProgram[]; objectKinds: ObjectKind[] } {
  const byName = new Map<string, KindProgram>();
  const objectKinds: ObjectKind[] = [];
  for (const t of types) {
    const k = objectKindOf(t);
    if (k === undefined || byName.has(k.name)) continue;
    byName.set(k.name, k);
    objectKinds.push(k);
  }
  for (const k of extra) if (!byName.has(k.name)) byName.set(k.name, k);
  return { kinds: [...byName.values()], objectKinds };
}

export function deskLayer(opts: DeskLayerOptions): DeskLayerFactory {
  return (ctx) => {
    const { host, world } = ctx;
    const doc = host.container.ownerDocument;
    const view = doc.defaultView;
    // the OBJECT types: the catalog's, plus the app's — their kinds are the ground's registry
    const types = new Set<WidgetType>([...(ctx.catalog?.widgetTypes() ?? []).filter((t) => t.object !== undefined), ...(opts.objects ?? [])]);
    const { kinds, objectKinds } = kindsOf([...types], opts.kinds ?? []);
    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    canvas.style.pointerEvents = "none";   // the router owns picking; the canvas is never a DOM hit target
    host.container.prepend(canvas);   // the container's first child: everything screen-space paints over it

    let ground: Ground | null = null;
    let ownDevice: GPUDevice | null = null;
    let instrument: SubmitInstrument | undefined;
    let status: DeskLayerStatus = { state: "pending" };
    let disposed = false;
    let ended = false;
    let grid: GridConfig = opts.grid ?? DEFAULT_GRID;

    // reduced motion ⇒ still (design-015 §4.6), read from the OS at the mount and followed live
    const motionQuery = view?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    const ambient = createAmbient({
      ...(opts.ambient !== undefined ? { mode: opts.ambient } : {}),
      ...(opts.ambientIdleMs !== undefined ? { idleMs: opts.ambientIdleMs } : {}),
      reducedMotion: motionQuery?.matches === true,
    });
    const syncMotion = (): void => { ambient.configure({ reducedMotion: motionQuery?.matches === true }); compose.wake("ambient"); };
    motionQuery?.addEventListener("change", syncMotion);

    // each kind's own state on this desk (the note's writing): made once, over its root pass once the ground is here
    const locals = new Map<string, KindLocal>();
    const children = worldChildren(world);   // …and its DATA children (D3w): the host reads them, never the kind
    for (const k of objectKinds) {
      const local = k.local?.({ pass: () => ground?.pass(k.name), text: opts.text, children, blobs: opts.blobs, decode: decodePicture });
      if (local !== undefined) locals.set(k.name, local);
    }
    const writing = (): Writing | undefined => locals.get(PAPER_KIND) as Writing | undefined;
    const readMarquee = ctx.readMarquee;
    const builder = createDeskBuilder(world, { objects: [...types], locals, ...(opts.springs !== undefined ? { springs: opts.springs } : {}), ...(readMarquee !== undefined ? { marquee: readMarquee } : {}) });
    // the selection menu's source: the anchor published whenever a frame moved it — the marks' word, and the hand's (D4b: with an
    // object in hand the menu travels to the foot and becomes the held bar; it hides while the object flies home)
    const anchorOf = (): SelectionAnchor => {
      const a = builder.anchor();
      const h = builder.hand();
      if (h === undefined) return a;
      return { ...a, held: { tools: builder.kindOf(h.entity)?.open?.tools ?? [], landing: h.landing, settled: h.settled } };
    };
    const listeners = new Set<() => void>();
    let published = "";
    const publish = (): void => {
      const a = anchorOf();
      const key = JSON.stringify(a);
      if (key === published) return;
      published = key;
      for (const l of [...listeners]) l();
    };
    const compose = createDeskReflector({
      onFrame: publish,
      world, builder, kinds: objectKinds, ambient,
      ground: () => ground,
      attach: { resize: (w, h) => { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } } },
      theme: opts.theme, palette: opts.palette, grid,
      ...(opts.maxDpr !== undefined ? { maxDpr: opts.maxDpr } : {}),
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });

    // the note's typing session and the ONE focused editor, in the container (screen space) — D2c
    const typing = createNoteTyping({ world, docs: opts.docs ?? { current: () => undefined } });
    const face = PEN_FACES[DEFAULT_FACE] ?? { family: "Caveat", weight: 500 };
    const editor = locals.has(PAPER_KIND)
      ? createNoteEditor({
          container: host.container, world, typing, writing, geometryOf: (e) => builder.geometryOf(e),
          isNote: (e) => builder.kindOf(e)?.name === PAPER_KIND, font: face, hand: DEFAULT_HAND_LAW,
          wake: () => compose.wake("ink"),
          ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
        })
      : undefined;
    // the prints' carry (D3w): the hands onto the photo kind's bodies, each rest ONE transaction out of the frame
    const carry = locals.has(PHOTO_KIND)
      ? createPhotoCarry({
          world, docs: opts.docs ?? { current: () => undefined }, prints: () => locals.get(PHOTO_KIND) as Prints | undefined, isPrint: (e) => builder.kindOf(e)?.name === PHOTO_KIND,
          refused: (e) => builder.meetTape(e),   // a taped print answers a drag with the tape's give (D4a)
        })
      : undefined;
    // the drawing reflector, wrapped: the kinds' flux ticked before it on one clock, the editor placed after it
    let moving = false;
    const inner = compose.reflector;
    const reflector: ReflectorDef & { available(): boolean } = {
      ...inner,
      flush(w) {
        const now = performance.now();
        carry?.follow(now);
        let want = false;
        for (const local of locals.values()) if (local.tick?.(now) === true) want = true;
        if (want) compose.wake("ink");
        moving = want;   // D3w: a kind's own motion (a print in the air) keeps the desk from reading quiet between its frames
        inner.flush(w);
        editor?.follow();
      },
    };

    // the pick source (design-015 §4.5): the kinds' mirrors on the builder's geometry — set now, `undefined` for what it cannot see yet (B9)
    const pick = createPickSource(builder);
    const framePick = ctx.framePick;
    if (framePick !== undefined) framePick.current = pick;
    // the nav geometry seam (design-015 §9): the desk's word on its containers' faces AS DRAWN — core's nav, the zoom-through and the
    // drop-into read it; the cut is exact only on the face as drawn
    const navSource = { face: (container: Entity, cam: { readonly x: number; readonly y: number; readonly zoom: number }) => builder.navFace(container, cam) };
    const navGeometry = ctx.navGeometry;
    if (navGeometry !== undefined) navGeometry.current = navSource;
    // the held pose seam (design-015 §8, D4b): where the object in hand is on screen, as the last frame drew it — the frame the
    // builder made; nothing while it flies home (the desk is the desk's again)
    const poseSource: HeldPoseSource = { frame: (e) => { const h = builder.hand(); return h !== undefined && h.entity === e && !h.landing ? h.frame : undefined; } };
    const heldPose = ctx.heldPose;
    if (heldPose !== undefined) heldPose.current = poseSource;
    // the ground plane's transition adapter: prepared the moment it is asked — the desk's second slot is built from the world (D2b)
    const detachTransition = ctx.transitions?.register({ id: "@ice/desk", plane: "ground", prepare: () => null }) ?? null;

    const fail = (what: string, e: unknown): void => {
      status = { state: "failed", message: `${what}: ${e instanceof Error ? e.message : String(e)}` };
      console.error(`[ice] desk: ${what}`, e);
    };
    /** The layer is over (a lost device): nothing renders again, the canvas leaves, `available()` is false. */
    const endLayer = (): void => {
      if (ended) return;
      ended = true;
      const g = ground;
      ground = null;
      g?.dispose();
      canvas.remove();
    };
    const gpu = opts.gpu ?? (typeof navigator !== "undefined" ? navigator.gpu : undefined);
    const boot: Promise<void> = gpu === undefined
      ? Promise.reject(new Error("WebGPU is unavailable here (no navigator.gpu)"))
      : acquire({
          gpu,
          label: "desk",
          onLost: (info) => { if (disposed || ended) return; fail("the device was lost", new Error(`${info.reason}: ${info.message}`)); endLayer(); },
          onError: (error) => { console.error("[ice] desk: uncaptured GPU error", error.message); },
        }).then(async (g) => {
          if (disposed) { g.device.destroy(); throw new Error("disposed before the device arrived"); }
          ownDevice = g.device;
          instrument = instrumentSubmits(g.device);   // before anything can submit: the idle-zero witness counts from boot
          opts.onDevice?.(g.device);
          const made = await Ground.create({ device: g.device, surface: surface(g.device, canvas), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds, marks: marksShaders(shaderText(MARKS_SHADER_FILES)), hold: holdShaders(shaderText(HOLD_SHADER_FILES)) });
          if (disposed || ended) { made.dispose(); return; }
          made.mat.setNoise(blueNoise());   // the desk's own noise; the plates are the app's (`setPlate`)
          made.grid = grid;
          ground = made;
          status = { state: "ready" };
          compose.ready();
        });
    boot.catch((e: unknown) => { if (!disposed) fail("no desk — the adapter, the device or the pipelines were refused", e); });

    const setGrid = (next: GridConfig): void => { grid = next; if (ground !== null) ground.grid = next; compose.configureGrid(next); };

    return {
      reflector,
      configureGrid(cfg) { if (cfg.fadeIn !== undefined) setGrid({ ...grid, fadeIn: [cfg.fadeIn[0], cfg.fadeIn[1]] }); },
      canvas,
      available: () => ground !== null && status.state === "ready",
      status: () => status,
      device: () => ownDevice ?? undefined,
      ground: () => ground,
      setTheme: (t, p) => compose.setTheme(t, p),
      configureMat: (mat) => setGrid({ ...grid, mat: { ...grid.mat, ...mat, ...(mat.gobo !== undefined ? { gobo: { ...grid.mat.gobo, ...mat.gobo } } : {}), ...(mat.ruler !== undefined ? { ruler: { ...grid.mat.ruler, ...mat.ruler } } : {}) } }),
      configureFadeIn: (fadeIn) => setGrid({ ...grid, fadeIn }),
      setPlate(name, bytes) { ground?.mat.setPlate(name, bytes); compose.wake("pin"); },
      setNoise(bytes) { ground?.mat.setNoise(bytes); compose.wake("pin"); },
      setGlyphs(bytes, meta) { ground?.mat.setGlyphs(bytes, meta); compose.wake("pin"); },
      pinMat(pin) {
        if (pin === null) { ambient.pin(null); compose.wake("pin"); return; }
        const still = (pin.wind ?? 0) <= 0;
        ambient.pin(still ? { ...(pin.time !== undefined ? { time: pin.time } : {}), ...(pin.goboTime !== undefined ? { goboTime: pin.goboTime } : {}), ...(pin.noise !== undefined ? { noise: pin.noise } : {}) } : null);
        if (pin.plate !== undefined || pin.opacity !== undefined) {
          setGrid({ ...grid, mat: { ...grid.mat, gobo: { ...grid.mat.gobo, ...(pin.plate !== undefined ? { plate: pin.plate } : {}), ...(pin.opacity !== undefined ? { opacity: pin.opacity } : {}) } } });
        }
        compose.wake("pin");
      },
      pinRaster(entity, bytes, meta) {
        // through the note's writing: allocated NOW, in call order (the oracle's texels), and given back when the note leaves the desk
        const ok = writing()?.pin(entity, bytes, meta) ?? false;
        compose.wake("pin");
        return ok;
      },
      clearRasters() {
        writing()?.reset();
        compose.wake("pin");
      },
      pinGreek(entity, lines) {
        // the greeked lines alone ride the builder's asset (the committed raster lives in the note's writing since D2c)
        builder.pin(entity, lines === undefined ? undefined : { greek: lines });
        compose.wake("pin");
      },
      pinFlux(entity, targets) { builder.pinFlux(entity, targets); compose.wake("pin"); },
      clearFlux() { builder.clearFlux(); compose.wake("pin"); },
      pinHold: (pin) => compose.pinBuild({ hold: pin }),
      hand: () => builder.hand(),
      setPortals: (on) => compose.pinBuild({ portals: on }),
      tuneLaw(kind, law) {
        for (const t of types) { const k = objectKindOf(t); if (k?.name === kind) k.tune?.(law); }
        ground?.root.kinds.get(kind)?.pass.setLaw?.(law);
        compose.wake("pin");
      },
      pinLodZoom: (zoom) => compose.pinBuild({ lodZoom: zoom }),
      freeze: (on) => compose.pinBuild({ freeze: on }),
      holdRedress: (on) => compose.pinBuild({ holdRedress: on }),
      navFace(entity, cam) {
        const c = cam ?? world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
        return builder.navFace(entity, { x: c.x, y: c.y, zoom: c.zoom });
      },
      insideViewOf: (e) => builder.insideViewOf(e),
      flightCameraAt(p) {
        const t = world.getResource(NavTransition);
        const vp = world.getResource(Viewport);
        if (t === undefined || !t.active || vp === undefined) return undefined;
        const c0 = { x: t.c0x, y: t.c0y, zoom: t.c0z };
        const c1 = { x: t.c1x, y: t.c1y, zoom: t.c1z };
        return p <= 0 ? c0 : p >= 1 ? c1 : flightCamera(c0, c1, p, vp.w, vp.h);
      },
      setAmbient(mode, idleMs) { ambient.configure({ mode, ...(idleMs !== undefined ? { idleMs } : {}) }); compose.wake("ambient"); },
      ambient: () => ambient,
      submits: () => instrument,
      redraws: () => compose.redraws(),
      stats: () => compose.stats(),
      wakes: () => compose.wakes(),
      geometryOf: (e) => builder.geometryOf(e),
      fluxOf: (e) => builder.fluxOf(e),
      lastInputs: () => compose.lastInputs(),
      dirty: () => compose.dirty() || moving,
      builder,
      writing,
      local: (name) => locals.get(name),
      editor: () => editor,
      typing,
      selection: {
        anchor: () => anchorOf(),
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      },
      desk: compose,
      dispose() {
        disposed = true;
        listeners.clear();
        editor?.dispose();
        for (const local of locals.values()) local.dispose?.();
        motionQuery?.removeEventListener("change", syncMotion);
        if (framePick !== undefined && framePick.current === pick) framePick.current = null;
        if (navGeometry !== undefined && navGeometry.current === navSource) navGeometry.current = null;
        if (heldPose !== undefined && heldPose.current === poseSource) heldPose.current = null;
        detachTransition?.();
        compose.dispose();
        builder.dispose();
        canvas.remove();
        ground?.dispose();
        ground = null;
        if (ownDevice !== null) { ownDevice.destroy(); ownDevice = null; }   // the layer's own device: destroyed last
      },
    };
  };
}
