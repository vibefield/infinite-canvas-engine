// The lab host: a browser page that owns the clock and the dirty flags, holds
// the card model (rect + motion state), resolves each card's frame geometry on
// the CPU every frame, and asks the ground for one frame whenever something
// changed. Everything the harnesses need is on `window.__ground`.
//
// Nested canvases: a folder card holds a SCENE of its own (cards in the
// folder's frame-local coordinates, its own grid). A folder whose face passes
// the gate shows that inside THROUGH its face — a live portal (PORTAL.md):
// the inside's grid and cards under the camera the fly-in will start from.
// Double-click a folder to fly in, double-click empty field (or Escape) to
// fly out — the design-006 portal zoom, cut-first: the frame switches at
// once, the camera flies from the portal's own camera (so nothing inside the
// face changes at the cut), and the ground draws both frames as one tree for
// the ~420 ms the flight lasts (src/nav/flight.ts, ground.ts). The host owns
// the flight's clock, as it owns every other.

import { CONTENT_CHOICES, type CameraState, type CardMotion, type ContentChoice, DEFAULT_FIELD_CONFIG, FOLDER_FACE, type FaceInsets, type FadeIn, type FieldConfig, type FieldSource, type Flight, GROUND_SHADERS, type GlyphRange, type GridGlyph, Ground, type HotPin, type LivePortal, NO_PART, OPEN_RANGE, type OutgoingInputs, PORTAL_CHAIN, type PartState, type PortalInputs, type Presentation, type RGB, type Rect, THROUGH_IN, THROUGH_OUT, type TestResidency, type ThemeName, ZOOM_MAX, ZOOM_MIN, acquire, arrivalCamera, boundsOf, clipOf, departedCamera, enterFlight, exitFlight, faceCovers, faceRadius as faceRadiusOf, faceRect, flightAt, flightOpacity, newMotion, pinMotion, portalAffine, portalContent, portalOf, solveFlightStart, stepFlight, stepMotion, testResidency, toMotion, visibleRect } from "@ice/ground/compose";
// The product's look is in the PACKS (design-014): the lab registers all three — the needle and the cutting mat as grid programs, VibeField's frame as the card program.
import { type FrameStyle, type Geometry, HERO_MATRIX, type Hit, MAT_GLYPH, type PlateName, STYLES, type VfFramePack, cuttingMat, matLightOf, matPassOf, needleGlyph, overlaps, pick, secondOrder, stepSecondOrder, styleViolations, tilted, vfFrame, withMat } from "@ice/ground/packs";
import { PRODUCT_GRID, THEMES, surface, type SurfaceName } from "@ice/ground/oracle/fixtures/vf-theme";
import { buildStyle, COLOR_ROLES, defaultHeatTweaks, defaultMatTweaks, defaultNavTweaks, defaultNightTweaks, defaultParams, defaultPortalTweaks, fitBand, flightTuning, matConfigOf, type Params, restoreParams, snapshotParams, styleTweaksOf, themeColor, themeWith } from "./params";
import { mountPanel, type Section } from "./panel";
// The gobo plates and the content-test plate are the HOST's assets (the product's look, a fixture in the package's oracle; the compose entry ships none of it); the blue noise is the engine's.
import goboCUrl from "@ice/ground/oracle/fixtures/assets/gobo-c.rgba?url";
import goboBUrl from "@ice/ground/oracle/fixtures/assets/gobo-b.rgba?url";
import noiseUrl from "@ice/ground/assets/blue-noise.rgba?url";
import contentUrl from "@ice/ground/oracle/fixtures/assets/content-test.rgba?url";

export interface Card {
  x: number; y: number;      // world centre — in the card's OWN scene's frame
  w: number; h: number;      // CONTENT size, world units
  r: number;                 // CONTENT corner radius
  strength: number;
  /** §2.2 the card's committed surface — its own colour in either theme. */
  surface: RGB;
  surfaceName: SurfaceName;
  motion: CardMotion;
  /** Last resolved geometry — what is on screen, what gets hit-tested. */
  geometry: Geometry | null;
  /** What the interior shows: the plate, or the test plate through a page layer / an own texture (card/content.ts). */
  content: ContentChoice;
  /** A folder's inside — made the first time it is needed: as a live portal, or a fly-in (`insideOf`). */
  child?: Scene;
  /** The FACE a folder shows its inside through — its content rect inset (the product folder's pad and bar, nav/portal.ts `FOLDER_FACE`); absent = the whole content rect. */
  face?: FaceInsets;
}

/**
 * One canvas frame: its cards (frame-local coordinates) and its grid. `null` glyph = the
 * root's, from the panel. `redress`: after a zoom-through cut this frame's grid is still
 * dressed for the zoom it was cut at, and eases to what it should be (PORTAL.md §9).
 */
export interface Scene { cards: Card[]; glyph: GridGlyph | null; redress?: { readonly from: number; readonly at: number } }

const canvas = document.getElementById("gpu") as HTMLCanvasElement;
const statsEl = document.getElementById("stats") as HTMLElement;
const failEl = document.getElementById("fail") as HTMLElement;
const fail = (e: unknown) => { failEl.hidden = false; failEl.textContent = String((e as Error)?.stack ?? e); };

const state = {
  camX: 0, camY: 0, zoom: 1,
  cssW: 1, cssH: 1, dpr: 1,
  pointerX: 0, pointerY: 0, pointerOn: true, pinned: false, pointerDown: false,
  hoverX: -1e9, hoverY: -1e9,   // the live pointer, for hit-testing — never pinned
  theme: (document.documentElement.classList.contains("dark") ? "dark" : "light") as ThemeName,
  themePinned: false,   // `d` pins; until then the OS preference leads
  /** The effective frame style — rebuilt from `P.style` whenever the panel touches it. */
  style: buildStyle(defaultParams().style) as FrameStyle,
  exactFrames: false,
  drawFrames: true,     // harness toggle: field-only frames for the A/B against the old prototype
  /** The cutting mat's clocks and tilt — the host owns them (the engine sees a MatFrame). */
  matTime: 0, goboTime: 0, noise: [0, 0] as [number, number], goboMatrix: HERO_MATRIX,
  matPinned: false,     // a harness scene pins the clocks and the tilt for a deterministic still
  navPinned: false,     // a harness scene pins a flight at one progress
  redressPinned: false, // a harness holds a frame's dressing where a zoom-through cut left it (PORTAL.md §9)
  /** The lab's drop model (GLOW.md §1): what a dragged card lights — by surface (folder accepts, deep rejects), or forced. */
  dropPolicy: "surface" as DropPolicy,
  assetsReady: false,   // the plates and the blue noise are uploaded
  contentReady: false,  // the test residency (page array + own textures) is built
  needsDraw: true,
  fps: 0, frames: 0, fpsStamp: performance.now(), cpuMs: 0, lastTick: performance.now(),
  frameCount: 0,        // monotonic — what a harness counts; `frames` is the fps window's
  stepDt: 0,            // this frame's dt, for the springs the card program steps inside `resolve`
};
/**
 * THE tunables (lab/params.ts): the product's grid, the size presets, the rung mode, the
 * frame style, the springs, the §5/§7 material, the line weights, colour overrides. The
 * panel edits this object; `apply()` projects it; localStorage keeps it across reloads.
 */
const STORE = "ground-lab-params";
let P: Params = (() => { try { const raw = localStorage.getItem(STORE); return raw ? restoreParams(JSON.parse(raw)) : defaultParams(); } catch { return defaultParams(); } })();
/**
 * VibeField's frame as the ground's CARD PROGRAM (design-014): made once and
 * kept, because it owns each card's own springs — the two buttons' hover and
 * press, and the lock — under the card object as their key. Its `style` and
 * `heat` are settable, and the panel writes them through `apply()`. The lock's
 * spring tuning reads the live panel rows.
 */
const pack: VfFramePack = vfFrame({
  style: state.style,
  heat: P.heat,
  tuning: { get lockHz() { return P.motion.lockHz; }, get lockDamp() { return P.motion.lockDamp; } },
});
/** The effective frame style, in both places that read it: the lab's state (the panel note, the stats line) and the pack that draws it. */
function setStyle(s: FrameStyle) { state.style = s; pack.style = s; }
/** The root frame; `scene` is the frame the camera is in, `cards` ITS array (the one every hit-test and draw reads). */
const root: Scene = { cards: [], glyph: null };
let scene: Scene = root;
let cards: Card[] = root.cards;
/** The nav stack: the frame we left, the folder we went through, and the camera to come back to. */
const stack: Array<{ parent: Scene; container: Card; cam: CameraState }> = [];
/** The flight under way, with the DEPARTED frame it still draws. */
let flight: { f: Flight; departed: Scene; container: Card } | null = null;
/** The test residency both hosts build from lab/assets/content-test.rgba — null until the bytes land. */
let residency: TestResidency | null = null;
let panel: { refresh: () => void; toggle: () => void; readonly open: boolean } = { refresh() {}, toggle() {}, open: false };
let serial = 1;
let drag: { card: Card; dx: number; dy: number } | null = null;
let panning: { x: number; y: number } | null = null;
let armed: { card: Card; hit: Hit } | null = null;   // pointer went down on a button

const markDraw = () => { state.needsDraw = true; };
/** The projector's mouse follower (the reference's second-order dynamics), fed the live pointer in NDC. */
const tilt = secondOrder();

const theme = () => themeWith(state.theme, P.colors, P.night, P.mat.ground);
/** A frame's grid: its own, or (the root) the panel's. */
const glyphOf = (s: Scene): GridGlyph => s.glyph ?? P.field.glyph;
const setGlyph = (s: Scene, g: GridGlyph) => { if (s === root) P.field.glyph = g; else s.glyph = g; };

function configFor(glyph: GridGlyph): FieldConfig {
  const f = P.field;
  const open = f.range === "open";
  return withMat({
    ...DEFAULT_FIELD_CONFIG,
    glyph, reach: f.reach, halfLen: f.halfLen, halfWidth: f.halfWidth,
    polarity: f.polarity, alwaysAlign: f.alwaysAlign,
    ink: theme().fieldInk, inkAlpha: f.inkAlpha,
    dotRadius: open ? OPEN_RANGE : f.dotRadius, needleHalfLen: open ? OPEN_RANGE : f.needleHalfLen, needleHalfWidth: open ? OPEN_RANGE : f.needleHalfWidth,
    fadeIn: f.fadeIn,
    fineSchedule: f.fineSchedule,
  }, matConfigOf(P.mat));
}
const config = () => configFor(glyphOf(scene));

/** Project the params into what the passes read; called by the panel and the keys. */
function apply() {
  setStyle(buildStyle(P.style));
  pack.heat = P.heat;
  try { localStorage.setItem(STORE, JSON.stringify(P)); } catch { /* private mode */ }
  markDraw();
}

// ---------------------------------------------------------------- theme

/** Stamp `.dark` and `data-theme` together — the product's theme.ts law (03·A §6). */
function setTheme(t: ThemeName) {
  state.theme = t;
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.setAttribute("data-theme", t);
  markDraw();
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => { if (!state.themePinned) setTheme(e.matches ? "dark" : "light"); });

// ---------------------------------------------------------------- cards

/** DESIGN.md §4 the iOS size grid: small · medium · large, radius 22, pitch 174 (gap 19). */
const IOS = { sizes: [[155, 155], [329, 155], [329, 345]] as const, radius: 22, pitch: 174 };
const SURFACE_NAMES: SurfaceName[] = ["card", "deep", "note", "folder"];

const camera = (): CameraState => ({ x: state.camX, y: state.camY, zoom: state.zoom });
const setCamera = (c: CameraState) => { state.camX = c.x; state.camY = c.y; state.zoom = c.zoom; };
const viewport = () => ({ width: state.cssW, height: state.cssH });
const pointerWorld = () => ({ x: state.camX + state.pointerX / state.zoom, y: state.camY + state.pointerY / state.zoom });
const hoverWorld = () => ({ x: state.camX + state.hoverX / state.zoom, y: state.camY + state.hoverY / state.zoom });
function centreWorld() { return { x: state.camX + state.cssW / (2 * state.zoom), y: state.camY + state.cssH / (2 * state.zoom) }; }

/** A STILL's pins, as a scene states them: a held (lifted) card; a card lit by a source (the lifted card's silhouette, world), the tier, the presence (1). */
type Pins = { held?: boolean; hot?: HotPin };
type CardSpec = Partial<Pick<Card, "x" | "y" | "w" | "h" | "strength">> & { r?: number; surface?: SurfaceName; selected?: boolean; content?: ContentChoice; inside?: { cards: CardSpec[]; glyph: GridGlyph } } & Pins;
function makeCard(p: CardSpec, at: { x: number; y: number }, i: number): Card {
  const name = p.surface ?? "card";
  return {
    x: p.x ?? at.x + (i % 5) * 34, y: p.y ?? at.y + (i % 4) * 26,
    w: p.w ?? IOS.sizes[1][0], h: p.h ?? IOS.sizes[1][1], r: p.r ?? IOS.radius, strength: p.strength ?? P.field.strength,
    surface: surface(name), surfaceName: name, motion: pinMotion(newMotion(p.selected ?? false), p), geometry: null, content: p.content ?? "plate",
    ...(name === "folder" ? { face: FOLDER_FACE } : {}),
    // a scene states a folder's inside, at any depth (the oracle's nested scene); the interactive lab makes one on first use
    ...(p.inside ? { child: makeChild(P.field.glyph, p.inside.cards, p.inside.glyph) } : {}),
  };
}

function addCard(p: CardSpec = {}): Card {
  const card = makeCard(p, centreWorld(), cards.length);
  serial += 1; cards.push(card); markDraw(); return card;
}

/** A scene's cards leave the board: the pack forgets their springs, so its table never grows past what is on screen. */
function forgetScene(s: Scene) { for (const c of s.cards) { pack.forget(c); if (c.child) forgetScene(c.child); } }

/** Lay n cards out on the §4 size grid: one card per 2×2-cell slot, centred on the view. */
function scatter(n: number) {
  forgetScene(scene);
  cards.length = 0;
  const c = centreWorld();
  const slot = IOS.pitch * 2;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const ox = c.x - (cols * slot) / 2;
  const oy = c.y - (rows * slot) / 2;
  for (let i = 0; i < n; i++) {
    const k = (i * 7) % 10;
    const [w, h] = IOS.sizes[k < 5 ? 0 : k < 8 ? 1 : 2];
    const name: SurfaceName = i % 9 === 4 ? "note" : i % 11 === 7 ? "deep" : i % 13 === 9 ? "folder" : "card";
    addCard({ x: ox + (i % cols) * slot + w / 2, y: oy + Math.floor(i / cols) * slot + h / 2, w, h, surface: name });
  }
}

/**
 * The card program's PART channel for one card (card/program.ts `PartState`):
 * what the pointer is over and what it pressed, by the pack's own part names.
 * Hit-tested against the geometry ON SCREEN — last frame's, as it always was.
 */
function partOf(c: Card, w: { readonly x: number; readonly y: number }): PartState {
  const G = c.geometry;
  const h = G ? pick(G, w.x, w.y) : "outside";
  const hover = h === "close" || h === "lock" ? h : null;
  const press = state.pointerDown && armed?.card === c && (armed.hit === "close" || armed.hit === "lock") ? armed.hit : null;
  return { hover, press };
}

/**
 * Resolve a list's geometry for THIS frame — the pack's `resolve`, which also
 * steps that card's own springs by `dt` toward the part channel's targets. So
 * it runs EXACTLY once per card per frame: the interactive frame with the
 * tick's dt and the live part channel, every other list (a portal's inside,
 * the departed frame, a harness still) at rest.
 */
function resolveList(list: readonly Card[], opts: { dt?: number; live?: boolean; out?: { live: boolean } } = {}): void {
  const dt = opts.dt ?? 0;
  const w = opts.live ? hoverWorld() : null;
  for (const c of list) {
    c.geometry = pack.resolve({
      card: { centre: [c.x, c.y], contentHalf: [c.w * 0.5, c.h * 0.5], radius: c.r },
      motion: toMotion(c.motion, P.material.lift.scale),
      material: P.material,
      dt, part: w ? partOf(c, w) : NO_PART, key: c,
      ...(opts.out ? { out: opts.out } : {}),
    });
  }
}

function hitAt(wx: number, wy: number): { card: Card; hit: Hit } | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i] as Card;
    if (!c.geometry || c.motion.gone) continue;
    const h = pick(c.geometry, wx, wy);
    if (h !== "outside") return { card: c, hit: h };
  }
  return null;
}

function select(card: Card | null) { for (const c of cards) c.motion.selected = c === card; markDraw(); }

function zoomAt(cssX: number, cssY: number, next: number) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const wx = state.camX + cssX / state.zoom;
  const wy = state.camY + cssY / state.zoom;
  state.zoom = z; state.camX = wx - cssX / z; state.camY = wy - cssY / z;
  markDraw();
}

/** The field sees each card's OUTER rounded rect as resolved — it breathes with the reveal. */
function sourcesOf(list: readonly Card[], cam: CameraState): FieldSource[] {
  const z = cam.zoom;
  const out: FieldSource[] = [];
  for (const c of list) {
    const G = c.geometry; if (!G || c.motion.gone) continue;
    out.push({ cx: (G.centre[0] - cam.x) * z, cy: (G.centre[1] - cam.y) * z, hx: G.half[0] * z, hy: G.half[1] * z, r: G.outerR * z, strength: c.strength });
  }
  return out;
}
/** The frames the ground draws for a list, in paint order; a card in `holes` is a container with a live portal — its face is the slot beneath, the band round it the plate (content.ts `portalContent`). */
const framesOf = (list: readonly Card[], holes?: ReadonlySet<Card>) => state.drawFrames ? list.filter((c) => c.geometry && !c.motion.gone).map((c) => ({ geometry: c.geometry as Geometry, surface: c.surface, content: holes?.has(c) ? portalContent(portalFaceOf(c)) : residency?.content(c.content) })) : [];
/** A card's index among the frames `framesOf` lists — what a nested slot's `at` names. */
const indexIn = (list: readonly Card[], card: Card): number => list.filter((c) => c.geometry && !c.motion.gone).indexOf(card);
/** The mat's clocks this frame — the root's; a portal's mat rides them, so it is a still while the root is (PORTAL.md §2.8). */
const matFrame = () => ({ time: state.matTime, goboTime: state.goboTime, goboMatrix: state.goboMatrix, noise: state.noise });
/** …in the field frame's pack slot: a grid program's per-frame clocks ride `ext[glyph]` (design-014). */
const matExt = () => ({ [MAT_GLYPH]: matFrame() });

/**
 * The zoom a frame's grid is dressed for right now (PORTAL.md §9): `to` — the arrival for a
 * portal, the current zoom for the root — unless a zoom-through cut left it dressed for
 * `redress.from`, in which case it eases there → `to` in log space over `redressMs`.
 */
function lodZoomOf(s: Scene, to: number): number {
  const r = s.redress;
  if (!r || !P.portal.dress) return to;
  // the CUT frame renders at `from` exactly (the portal's own dressing — the frame nobody can tell from the one before); the ramp starts on the next
  if (r.at === 0 || state.redressPinned) { if (r.at === 0) s.redress = { from: r.from, at: performance.now() }; markDraw(); return r.from; }
  const u = Math.min(1, (performance.now() - r.at) / Math.max(P.portal.redressMs, 1));
  // biome-ignore lint/performance/noDelete: the property must be ABSENT (`exactOptionalPropertyTypes`; the readers test truthiness) — once per redress, not a hot path
  if (u >= 1) { delete s.redress; return to; }
  const e = u * u * (3 - 2 * u);
  markDraw();   // the ramp keeps the loop awake until it lands
  return Math.exp(Math.log(r.from) + (Math.log(to) - Math.log(r.from)) * e);
}
/** Set a card's interior; the choices cycle on `i`. */
function setContent(card: Card, choice: ContentChoice) { card.content = choice; markDraw(); }

// ---------------------------------------------------------------- nested canvases

/** A card's CONTENT rect (design-006 §8.5: the body). */
const rectOf = (c: Card): Rect => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, width: c.w, height: c.h });
/** The FACE a folder shows its inside through — the content rect inset by its `face` (PORTAL.md §10) — and the face's corner radius. */
const faceOf = (c: Card): Rect => (c.face ? faceRect(rectOf(c), c.face) : rectOf(c));
const faceRadius = (c: Card): number => (c.face ? faceRadiusOf(rectOf(c), c.face, c.r) : c.r);
/** The hole's face in the card's own frame (content.ts `PortalFace`) — what a container's record carries. */
const portalFaceOf = (c: Card) => { const K = faceOf(c); return { cx: K.x + K.width / 2, cy: K.y + K.height / 2, hx: K.width / 2, hy: K.height / 2, r: faceRadius(c) }; };
const contentOf = (s: Scene): Rect | null => boundsOf(s.cards.filter((c) => !c.motion.gone).map(rectOf));

// ---------------------------------------------------------------- the drop model

/**
 * ICE's dropSystem in miniature (GLOW.md §1): while a card is dragged, the TOPMOST
 * drop-evaluating card its rect overlaps is the target — a folder accepts (a Container
 * whose Accepts match), a `deep` card is Solid and rejects, the rest evaluate nothing
 * and never shadow one that does. The target's motion gets the signal, its tier and
 * the light SOURCE — the dragged card's silhouette as drawn (its lifted half extents
 * and radius, at its live position) — on every move; moving off or letting go clears
 * the signal, and the source is held for the fade-out.
 */
type DropPolicy = "surface" | "accept" | "reject" | "none";
function tierOf(c: Card): number | null {
  const p = state.dropPolicy;
  if (p === "none") return null;
  if (p === "accept") return 1;
  if (p === "reject") return 0;
  return c.surfaceName === "folder" ? 1 : c.surfaceName === "deep" ? 0 : null;
}
function updateDrop() {
  let target: Card | null = null;
  if (drag) {
    const d = rectOf(drag.card);
    for (let i = cards.length - 1; i >= 0; i--) {
      const c = cards[i] as Card;
      if (c === drag.card || c.motion.gone || tierOf(c) === null) continue;
      if (overlaps(d, rectOf(c))) { target = c; break; }
    }
  }
  for (const c of cards) {
    if (drag && c === target) {
      const d = drag.card;
      const G = d.geometry;
      c.motion.hotTarget = true; c.motion.hotTier = tierOf(c) as NonNullable<ReturnType<typeof tierOf>>;
      c.motion.hotAt = [d.x, d.y]; c.motion.hotHalf = G ? [G.half[0], G.half[1]] : [d.w / 2, d.h / 2]; c.motion.hotR = G ? G.outerR : d.r;
    } else c.motion.hotTarget = false;
  }
  markDraw();
}

/** The grid a new folder's inside gets: the next along from its parent's, or the panel's pick. */
function childGlyph(parent: GridGlyph): GridGlyph {
  const pick = P.nav.childGlyph;
  if (pick !== "cycle") return pick;
  return parent === "dot" ? "mat" : parent === "mat" ? "needle" : "dot";
}

/** A folder's inside, made the first time it is needed: four cards on the §4 grid around the frame's origin, one of them a folder. */
function makeChild(parent: GridGlyph, specs?: readonly CardSpec[], glyph: GridGlyph = childGlyph(parent)): Scene {
  const s: Scene = { cards: [], glyph };
  const list = specs ?? [
    { x: 0, y: 0, w: 329, h: 155 }, { x: 428, y: 0, w: 155, h: 155, surface: "note" },
    { x: 0, y: 348, w: 329, h: 345, surface: "folder" }, { x: 428, y: 250, w: 155, h: 155, surface: "deep" },
  ];
  list.forEach((p, i) => s.cards.push(makeCard(p, { x: 0, y: 0 }, i)));
  return s;
}

/** The inside of a folder in `parent`'s frame, made on first use. */
function insideOf(card: Card, parent: Scene): Scene { if (!card.child) card.child = makeChild(glyphOf(parent)); return card.child; }

/**
 * The live portals of a frame's folders under `cam` (PORTAL.md §2.1): every
 * folder whose face passes the gate, largest first up to the cap, its inside
 * resolved at rest under the camera the fly-in would start from — and, through
 * that inside, ITS folders' portals in turn (the gate ends the recursion where
 * faces get too small; `depth` is a belt). `exclude` is the container a flight
 * is showing through already. Returns the slots' inputs and the containers
 * that are now holes.
 */
function portalsOf(list: readonly Card[], parent: Scene, cam: CameraState, exclude?: Card, depth = 0): { inputs: PortalInputs[]; holes: Set<Card> } {
  const inputs: PortalInputs[] = [];
  const holes = new Set<Card>();
  if (!P.portal.on || depth > PORTAL_CHAIN - 2) return { inputs, holes };   // the belt: a chain of at most PORTAL_CHAIN faces, the flight's included
  const vp = viewport();
  const cands: { card: Card; live: LivePortal }[] = [];
  for (const c of list) {
    if (c.surfaceName !== "folder" || c.motion.gone || c === exclude || !c.geometry) continue;
    const live = portalOf(faceOf(c), faceRadius(c), () => contentOf(insideOf(c, parent)), cam, vp, fitBand(P.nav), P.portal.gate);   // the inside is made only past the gate
    if (live) cands.push({ card: c, live });
  }
  cands.sort((a, b) => b.live.clip.hx * b.live.clip.hy - a.live.clip.hx * a.live.clip.hy);
  for (const { card, live } of cands.slice(0, P.portal.cap)) {
    const inside = card.child as NonNullable<typeof card.child>;
    resolveList(inside.cards);
    holes.add(card);
    const sub = portalsOf(inside.cards, inside, live.cam, undefined, depth + 1);
    inputs.push({
      view: { camX: live.cam.x, camY: live.cam.y, zoom: live.cam.zoom, width: state.cssW, height: state.cssH, dpr: state.dpr, box: live.box },
      pointer: { x: 0, y: 0, on: false },
      ext: matExt(),
      // dressed for its arrival: the inside as it will look when entered, scaled (PORTAL.md §9)
      ...(P.portal.dress ? { lodZoom: lodZoomOf(inside, live.arrival.zoom) } : {}),
      present: { opacity: live.presence, portal: live.clip },
      config: configFor(glyphOf(inside)),
      sources: sourcesOf(inside.cards, live.cam),
      frames: framesOf(inside.cards, sub.holes),
      ...(sub.inputs.length ? { portals: sub.inputs } : {}),
      at: indexIn(list, card), plate: card.surface,
    });
  }
  return { inputs, holes };
}

function abortFlight() { if (flight) { flight.f.active = false; flight = null; markDraw(); } }

/**
 * Fly into a folder — or cut: `motion` false lands on the arrival; a `through` cut lands on
 * the live portal's own camera with the inside still dressed for its arrival, then re-dresses
 * (PORTAL.md §8–9: the zoom-through, a cut nobody can see). Returns false for a card that is no folder.
 */
function enter(card: Card, motion = true, through = false): boolean {
  if (card.surfaceName !== "folder" || card.motion.gone) return false;
  const inside = insideOf(card, scene);
  abortFlight();
  select(null);   // the frame we leave keeps no selection ring while it fades (ICE hides chrome on a nav cut)
  const camPre = camera();
  const vp = viewport();
  const parent = scene;
  // The live portal's camera under camPre: the flight starts from it EXACTLY, so the arriving slot's first frame is the portal's last (PORTAL.md §2.4).
  const live = P.portal.on ? portalOf(faceOf(card), faceRadius(card), contentOf(inside), camPre, vp, fitBand(P.nav), P.portal.gate) : null;
  stack.push({ parent, container: card, cam: camPre });
  scene = inside; cards = scene.cards;
  drag = null; armed = null; select(null);
  if (through && live) { setCamera(live.cam); scene.redress = { from: live.arrival.zoom, at: 0 }; }
  else if (motion) {
    const f = enterFlight(faceOf(card), contentOf(scene), camPre, vp, flightTuning(P.nav), fitBand(P.nav), live?.cam);
    setCamera(f.c0);
    flight = { f, departed: parent, container: card };
  } else setCamera(arrivalCamera(contentOf(scene), vp, fitBand(P.nav)));
  markDraw();
  return true;
}

/**
 * Fly back out to the parent frame — or cut: `motion` false lands on the saved camera; a
 * `through` cut lands on the parent camera under which the inside renders as it does now
 * (the continuity solve), the inside's portal still dressed for the zoom it was left at.
 * Returns false at the root.
 */
function exit(motion = true, through = false): boolean {
  const top = stack.pop();
  if (!top) return false;
  abortFlight();
  const camPre = camera();
  const vp = viewport();
  const inner = scene;
  scene = top.parent; cards = scene.cards;
  drag = null; armed = null; select(null);
  if (through) {
    const M = portalAffine(visibleRect(arrivalCamera(contentOf(inner), vp, fitBand(P.nav)), vp.width, vp.height), faceOf(top.container));
    setCamera(solveFlightStart(M, camPre));
    inner.redress = { from: camPre.zoom, at: 0 };
  } else if (motion) {
    const f = exitFlight(faceOf(top.container), contentOf(inner), camPre, top.cam, vp, flightTuning(P.nav), fitBand(P.nav));
    setCamera(f.c0);
    flight = { f, departed: inner, container: top.container };
  } else setCamera(top.cam);
  markDraw();
  return true;
}

/** The zoom-through, after a zoom IN: the first folder whose face covers the view is entered as a cut. Returns the folder, or null. */
function enterThrough(): Card | null {
  if (!P.portal.through || !P.portal.on || flight) return null;
  const vp = viewport();
  const cam = camera();
  // the TOPMOST covering folder: paint order runs upward, so the last face that covers the view is the one in view
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i] as Card;
    if (c.surfaceName !== "folder" || c.motion.gone) continue;
    const live = portalOf(faceOf(c), faceRadius(c), () => contentOf(insideOf(c, scene)), cam, vp, fitBand(P.nav), P.portal.gate);
    if (live && faceCovers(live.clip, vp, THROUGH_IN)) { enter(c, false, true); return c; }
  }
  return null;
}

/** The zoom-through, after a zoom OUT: leave as a cut once the container's face no longer covers the view. Returns whether it left. */
function exitThrough(): boolean {
  if (!P.portal.through || !P.portal.on || flight) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  const vp = viewport();
  const M = portalAffine(visibleRect(arrivalCamera(contentOf(scene), vp, fitBand(P.nav)), vp.width, vp.height), faceOf(top.container));
  const cPar = solveFlightStart(M, camera());
  if (faceCovers(clipOf(faceOf(top.container), faceRadius(top.container), cPar), vp, -THROUGH_OUT)) return false;
  return exit(false, true);
}

/** Advance the flight; true while it is on (and once more for the landing frame). */
function stepNav(dt: number): boolean {
  if (!flight || state.navPinned) return false;
  setCamera(stepFlight(flight.f, dt, viewport(), flightTuning(P.nav)));
  if (!flight.f.active) flight = null;
  return true;
}

/**
 * What the ground draws beside the arriving frame this frame, and how the arriving
 * one presents. A portal flight is ONE tree (ground.ts): the child frame through the
 * parent's container (`at`), the container a hole, the parent's other folders keeping
 * their live portals; a frozen flight is a dissolve of two whole slots.
 */
function flightInputs(): { present?: Presentation; outgoing?: OutgoingInputs } {
  if (!flight || !flight.f.active) return {};
  const f = flight.f;
  const cam = camera();
  const enter = f.kind === "enter";
  const op = flightOpacity(f.kind, f.p, f.frozen);
  const outCam = departedCamera(f, cam);
  // The portal lives in the PARENT frame: the departed one on enter, the arriving one on exit. A frozen flight has none — it is a dissolve.
  const clip = f.frozen ? undefined : clipOf(faceOf(flight.container), faceRadius(flight.container), enter ? outCam : cam);
  resolveList(flight.departed.cards);
  // the departed frame's own live portals: the parent's other folders on enter (never the one being entered), the inside's on exit
  const dp = portalsOf(flight.departed.cards, flight.departed, outCam, enter ? flight.container : undefined);
  const holes = new Set(dp.holes);
  if (clip && enter) holes.add(flight.container);
  // enter: one tree through the container; exit: the inside over the whole parent, whose live portal shows the same pixels beneath (ground.ts `at`)
  const at = clip && enter ? indexIn(flight.departed.cards, flight.container) : -1;
  return {
    present: { opacity: op.incoming, ...(clip && enter ? { portal: clip } : {}) },
    outgoing: {
      view: { camX: outCam.x, camY: outCam.y, zoom: outCam.zoom, width: state.cssW, height: state.cssH, dpr: state.dpr },
      pointer: { x: 0, y: 0, on: false },
      ext: matExt(),
      // the departed frame keeps the dressing it had at the cut (PORTAL.md §9)
      ...(P.portal.dress ? { lodZoom: f.camPre.zoom } : {}),
      present: { opacity: op.outgoing, ...(clip && !enter ? { portal: clip } : {}) },
      config: configFor(glyphOf(flight.departed)),
      sources: sourcesOf(flight.departed.cards, outCam),
      frames: framesOf(flight.departed.cards, holes),
      ...(dp.inputs.length ? { portals: dp.inputs } : {}),
      order: enter ? "under" : "over",
      ...(at >= 0 ? { at } : {}),
    },
  };
}

// ---------------------------------------------------------------- input

function bindInput() {
  window.addEventListener("pointermove", (e) => {
    if (drag) { drag.card.x = state.camX + e.clientX / state.zoom + drag.dx; drag.card.y = state.camY + e.clientY / state.zoom + drag.dy; updateDrop(); return; }
    if (panning) { state.camX -= (e.clientX - panning.x) / state.zoom; state.camY -= (e.clientY - panning.y) / state.zoom; panning = { x: e.clientX, y: e.clientY }; markDraw(); return; }
    state.hoverX = e.clientX; state.hoverY = e.clientY;
    if (!state.pinned) { state.pointerX = e.clientX; state.pointerY = e.clientY; }
    const w = { x: state.camX + e.clientX / state.zoom, y: state.camY + e.clientY / state.zoom };
    const h = hitAt(w.x, w.y);
    canvas.style.cursor = h ? (h.hit === "close" || h.hit === "lock" ? "pointer" : "grab") : "default";
    markDraw();   // hover springs and the analytic cursor both want a frame
  });
  window.addEventListener("pointerup", (e) => {
    state.pointerDown = false;
    if (armed) {
      const w = { x: state.camX + e.clientX / state.zoom, y: state.camY + e.clientY / state.zoom };
      const h = hitAt(w.x, w.y);
      if (h && h.card === armed.card && h.hit === armed.hit) {
        if (h.hit === "close") { armed.card.motion.deleting = true; }
        else if (h.hit === "lock") { pack.setLocked(armed.card, !pack.springsOf(armed.card).locked); }   // the lock is the pack's now, not the engine's motion (design-014)
      }
      armed = null;
    }
    if (drag) { drag.card.motion.held = false; drag = null; updateDrop(); }   // §7: the lift ends with the hold; the heat clears, its point held
    panning = null; markDraw();
  });
  canvas.addEventListener("pointerdown", (e) => {
    state.pointerDown = true;
    const w = { x: state.camX + e.clientX / state.zoom, y: state.camY + e.clientY / state.zoom };
    const h = hitAt(w.x, w.y);
    if (h && (h.hit === "close" || h.hit === "lock")) { armed = h; markDraw(); return; }   // route by position, never by hover
    if (h) {
      cards.splice(cards.indexOf(h.card), 1); cards.push(h.card); select(h.card);
      canvas.setPointerCapture(e.pointerId);
      drag = { card: h.card, dx: h.card.x - w.x, dy: h.card.y - w.y };
      h.card.motion.held = true;   // §7 lift: scale, lifted shadow, 0.75 opacity — one number drives all three
      return;
    }
    abortFlight();   // touch always wins (design-006 §4): a pan yields the camera at once
    panning = { x: e.clientX, y: e.clientY }; select(null);
  });
  canvas.addEventListener("dblclick", (e) => {
    const w = { x: state.camX + e.clientX / state.zoom, y: state.camY + e.clientY / state.zoom };
    const h = hitAt(w.x, w.y);
    if (h) { if (h.hit === "close" || h.hit === "lock") return; enter(h.card); }
    else exit();
    panel.refresh();
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); abortFlight(); zoomAt(e.clientX, e.clientY, state.zoom * Math.exp(-e.deltaY * 0.0016));
    // the zoom-through (PORTAL.md §8): a zoom in that leaves a face covering the view enters it; a zoom out that uncovers the container's face leaves
    if (e.deltaY < 0) { if (enterThrough()) panel.refresh(); } else if (exitThrough()) panel.refresh();
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "SELECT") return;   // the panel owns its keys
    const k = e.key;
    if (k === "`") { panel.toggle(); return; }
    if (k === "o") setGlyph(scene, glyphOf(scene) === "dot" ? "needle" : glyphOf(scene) === "needle" ? "mat" : "dot");
    else if (k === "n") { const w = pointerWorld(); addCard({ x: w.x, y: w.y }); }
    else if (k === "Backspace") { const c = cards.find((c) => c.motion.selected); if (c) c.motion.deleting = true; }
    else if (k === "Enter") { const c = cards.find((c) => c.motion.selected); if (c) enter(c); }
    else if (k === "Escape") exit();
    else if (k === "s") scatter(48);
    else if (k === "S") scatter(256);
    else if (k === "m") state.pointerOn = !state.pointerOn;
    else if (k === "p") state.pinned = !state.pinned;
    else if (k === "t") P.field.polarity = P.field.polarity === 1 ? -1 : 1;
    else if (k === "a") P.field.alwaysAlign = !P.field.alwaysAlign;
    else if (k === "f") P.field.fineSchedule = P.field.fineSchedule === "auto" ? "instanced" : P.field.fineSchedule === "instanced" ? "fullscreen" : "auto";
    else if (k === "e") state.exactFrames = !state.exactFrames;
    else if (k === "x") { const names = Object.keys(STYLES) as (keyof typeof STYLES)[]; const i = names.indexOf(P.style.base); const next = names[(i + 1) % names.length] as keyof typeof STYLES; P.style = styleTweaksOf(STYLES[next], next); }
    else if (k === "d") { state.themePinned = true; setTheme(state.theme === "dark" ? "light" : "dark"); }
    else if (k === "g") P.field.range = P.field.range === "preset" ? "open" : "preset";
    else if (k === "c") { const c = cards.find((c) => c.motion.selected); if (c) { c.surfaceName = SURFACE_NAMES[(SURFACE_NAMES.indexOf(c.surfaceName) + 1) % SURFACE_NAMES.length] as SurfaceName; c.surface = surface(c.surfaceName); } }
    else if (k === "i") { const c = cards.find((c) => c.motion.selected); if (c) setContent(c, CONTENT_CHOICES[(CONTENT_CHOICES.indexOf(c.content) + 1) % CONTENT_CHOICES.length] as ContentChoice); }
    else if (k === "r") { abortFlight(); state.camX = 0; state.camY = 0; state.zoom = 1; }
    else return;
    apply(); panel.refresh();
  });
}

// ---------------------------------------------------------------- boot

async function start() {
  if (!navigator.gpu) { fail("WebGPU is not available here — check chrome://gpu"); return; }
  let ground: Ground;
  try {
    // The HOST owns the device (ICE's `acquireCompositorDevice()` at the fold); the ground is handed it.
    const gpu = await acquire({ gpu: navigator.gpu, label: "ground", onLost: (info) => fail(`device lost: ${info.reason} — ${info.message}`), onError: (err) => fail(`GPU error: ${err.message}`) });
    ground = await Ground.create({
      device: gpu.device, canvas,
      ...GROUND_SHADERS,
      // the three packs the product's look is made of (design-014): the frame as the card program, the needle and the mat beside the engine's dot
      card: pack, grids: [needleGlyph, cuttingMat],
    });
  } catch (e) { fail(e); return; }

  // The mat's assets — raw rgba bytes, the same the Node oracle reads from disk.
  const bytesOf = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
  Promise.all([bytesOf(goboCUrl), bytesOf(goboBUrl), bytesOf(noiseUrl)]).then(([c, b, n]) => {
    // the mat's pass behind the field's surface slot — the pack owns it, the host uploads through it
    const mat = matPassOf(ground.field);
    if (!mat) throw new Error("the cutting mat pack is not registered — Ground.create({ grids })");
    mat.setPlate("c", c); mat.setPlate("b", b); mat.setNoise(n);
    state.assetsReady = true; markDraw();
  }).catch(fail);
  // The content term's test residency — the same bytes, the same layers and uvs, as the Node oracle builds.
  bytesOf(contentUrl).then((bytes) => {
    residency = testResidency(ground.device, bytes);
    ground.frames.setPages(residency.pagesView);
    state.contentReady = true; markDraw();
  }).catch(fail);

  function fit() {
    const f = ground.fit(2);
    state.cssW = f.cssWidth; state.cssH = f.cssHeight; state.dpr = f.dpr;
    if (!state.pinned) { state.pointerX = f.cssWidth * 0.5; state.pointerY = f.cssHeight * 0.5; }
    markDraw();
  }

  /**
   * Advance every card's ENGINE springs by dt — the reveal, the lift, the
   * hover and the §7 heat; returns true while any is still moving. The pack's
   * own springs (the buttons, the lock) step in `resolveList` instead, since
   * `pack.resolve` runs them, and `state.stepDt` carries this frame's dt there.
   */
  function step(dt: number): boolean {
    let live = false;
    state.stepDt = dt;
    for (const c of cards) live = stepMotion(c.motion, dt, P.motion) || live;
    // the light SOURCE follows the dragged card's silhouette as it lifts and reveals — its springs run on after the last move
    if (drag) { const d = drag.card; const G = d.geometry; for (const c of cards) if (c.motion.hotTarget) { c.motion.hotAt = [d.x, d.y]; if (G) { c.motion.hotHalf = [G.half[0], G.half[1]]; c.motion.hotR = G.outerR; } } }
    for (let i = cards.length - 1; i >= 0; i--) { const c = cards[i] as Card; if (c.motion.gone) { pack.forget(c); cards.splice(i, 1); } }
    return live;
  }

  /**
   * The mat's clocks and tilt. The tilt follows the live pointer through the
   * second-order filter and rotates the projector (the reference's trick);
   * with wind > 0 the grain drifts, the gobo blows and the blue noise re-rolls
   * every frame, so the loop stays awake; at wind 0 the mat is a still that
   * renders on demand, and only an unsettled tilt asks for more frames.
   */
  function stepMat(dt: number): boolean {
    const matOn = glyphOf(scene) === "mat" || (flight?.f.active === true && glyphOf(flight.departed) === "mat");
    if (!matOn || state.matPinned) return false;
    // the live pointer in NDC; before it has ever been seen (the −1e9 sentinel) the projector stays untilted
    const seen = state.hoverX > -1e8;
    tilt.target = seen ? [Math.min(Math.max((state.hoverX / state.cssW) * 2 - 1, -1), 1), Math.min(Math.max(-((state.hoverY / state.cssH) * 2 - 1), -1), 1)] : [0, 0];
    stepSecondOrder(tilt, dt);
    const i = P.mat.tilt;
    const v = tilt.velocity;
    state.goboMatrix = tilted(HERO_MATRIX, tilt.value[0] * i, tilt.value[1] * i, (v[0] + v[1]) * 0.35 * i);
    if (P.mat.wind > 0) {
      state.matTime += dt;
      state.goboTime += dt * (P.mat.wind + (v[0] + v[1]) * 0.5);
      state.noise = [Math.random(), Math.random()];
      return true;
    }
    return Math.abs(tilt.value[0] - tilt.target[0]) + Math.abs(tilt.value[1] - tilt.target[1]) + Math.abs(v[0]) + Math.abs(v[1]) > 1e-4;
  }

  const fmt = (r: GlyphRange) => `${r[0]}–${r[1]}`;
  const rangeLabel = () => P.field.range === "open" ? "range open" : glyphOf(scene) === "dot" ? `dot r ${fmt(P.field.dotRadius)} px` : `needle ${fmt(P.field.needleHalfLen)} × ${fmt(P.field.needleHalfWidth)} px`;

  function render() {
    ground.fieldConfig = config();
    ground.frames.exact = state.exactFrames;
    ground.frames.lines = P.lines;
    // the card program's own tuning rides the pack, not the pass (design-014); a scene or a poked param can't leave it stale
    pack.style = state.style; pack.heat = P.heat;
    // the interactive frame is the one list whose own springs step: this frame's dt, the live part channel, and a sink that keeps the loop awake while they move
    const springs = { live: false };
    resolveList(cards, { dt: state.stepDt, live: true, out: springs });
    if (springs.live) state.needsDraw = true;
    const cam = camera();
    const nav = flightInputs();
    // this frame's live portals (during an exit the container's is among them: the departed inside lands on it)
    const rp = portalsOf(cards, scene, cam);
    const holes = rp.holes;
    // the root's dressing: its landing while a flight is on, the zoom it was cut at while it re-dresses, else its own zoom
    const rootLod = !P.portal.dress ? undefined : flight?.f.active ? flight.f.c1.zoom : scene.redress ? lodZoomOf(scene, cam.zoom) : undefined;
    return ground.render({
      view: { camX: cam.x, camY: cam.y, zoom: cam.zoom, width: state.cssW, height: state.cssH, dpr: state.dpr },
      pointer: { x: state.pointerX, y: state.pointerY, on: state.pointerOn },
      ext: matExt(),
      ...(rootLod !== undefined ? { lodZoom: rootLod } : {}),
      ...(nav.present ? { present: nav.present } : {}),
      ...(nav.outgoing ? { outgoing: nav.outgoing } : {}),
      sources: sourcesOf(cards, cam),
      frames: framesOf(cards, holes),
      ...(rp.inputs.length ? { portals: rp.inputs } : {}),
      theme: theme(),
    });
  }

  // ---------------------------------------------------------------- the tweak panel
  const num = (label: string, get: () => number, set: (v: number) => void, min: number, max: number, step: number, unit = "px") => ({ kind: "range" as const, label, get, set, min, max, step, unit });
  const range2 = (label: string, get: () => GlyphRange, set: (v: GlyphRange) => void, min: number, max: number, step: number) => [
    num(`${label} min`, () => get()[0], (v) => set([v, get()[1]]), min, max, step), num(`${label} max`, () => get()[1], (v) => set([get()[0], v]), min, max, step)];
  const contentHalf = () => { const c = cards.find((c) => c.motion.selected) ?? cards[0]; return c ? [c.w / 2, c.h / 2] as const : [120, 70] as const; };
  const colorRows = (t: ThemeName) => COLOR_ROLES.map((role) => ({
    // a role lives on the theme's head or in the frame pack's section (design-014); `themeColor` knows which
    kind: "color" as const, label: role, alpha: themeColor(t, role).length === 4,
    get: () => (P.colors[t][role] ?? themeColor(t, role)) as readonly number[],
    set: (v: number[]) => { P.colors[t][role] = v as [number, number, number] | [number, number, number, number]; },
  }));
  const sections: Section[] = [
    { title: "field", open: true, rows: [
      { kind: "select", label: "glyph (this frame)", options: ["dot", "needle", "mat"], get: () => glyphOf(scene), set: (v) => setGlyph(scene, v as GridGlyph) },
      num("reach", () => P.field.reach, (v) => { P.field.reach = v; }, 5, 400, 1),
      num("widget strength", () => P.field.strength, (v) => { P.field.strength = v; for (const c of cards) c.strength = v; }, 0, 3, 0.01, ""),
      num("base half-length", () => P.field.halfLen, (v) => { P.field.halfLen = v; }, 0.5, 16, 0.1),
      num("base half-width", () => P.field.halfWidth, (v) => { P.field.halfWidth = v; }, 0.1, 3, 0.01),
      num("ink alpha", () => P.field.inkAlpha, (v) => { P.field.inkAlpha = v; }, 0, 1, 0.01, ""),
      { kind: "select", label: "polarity", options: ["attract", "repel"], get: () => (P.field.polarity === 1 ? "attract" : "repel"), set: (v) => { P.field.polarity = v === "attract" ? 1 : -1; } },
      { kind: "toggle", label: "needles always align", get: () => P.field.alwaysAlign, set: (v) => { P.field.alwaysAlign = v; } },
      { kind: "select", label: "fine schedule", options: ["auto", "instanced", "fullscreen"], get: () => P.field.fineSchedule, set: (v) => { P.field.fineSchedule = v as FieldConfig["fineSchedule"]; } },
      { kind: "toggle", label: "cursor pole", get: () => state.pointerOn, set: (v) => { state.pointerOn = v; } },
    ] },
    { title: "glyph size presets", open: true, rows: [
      { kind: "select", label: "range", options: ["preset", "open"], get: () => P.field.range, set: (v) => { P.field.range = v as "preset" | "open"; } },
      ...range2("dot radius", () => P.field.dotRadius, (v) => { P.field.dotRadius = v; }, 0, 12, 0.05),
      ...range2("needle half-length", () => P.field.needleHalfLen, (v) => { P.field.needleHalfLen = v; }, 0, 16, 0.05),
      ...range2("needle half-width", () => P.field.needleHalfWidth, (v) => { P.field.needleHalfWidth = v; }, 0, 3, 0.01),
    ] },
    { title: "rung fade-in (one glyph size on every rung)", open: true, rows: [
      num("fade-in from (cell)", () => P.field.fadeIn[0], (v) => { P.field.fadeIn = [v, Math.max(P.field.fadeIn[1], v + 0.5)]; }, 1, 200, 0.5),
      num("fade-in full (cell)", () => P.field.fadeIn[1], (v) => { P.field.fadeIn = [Math.min(P.field.fadeIn[0], v - 0.5), v]; }, 1.5, 400, 0.5),
    ] },
    { title: "navigation · the portal flight (design-006)", rows: [
      // shown only inside a folder or mid-flight — at the root the row is empty and hides itself (the panel harness reads a visible note as a style violation)
      { kind: "note", get: () => (stack.length === 0 && !flight ? "" : `depth ${stack.length}${flight ? ` · ${flight.f.kind} p ${flight.f.p.toFixed(2)}${flight.f.frozen ? " (frozen)" : ""}` : ""} · esc / double-click empty field to fly out`) },
      { kind: "select", label: "a new folder's grid", options: ["cycle", "dot", "needle", "mat"], get: () => P.nav.childGlyph, set: (v) => { P.nav.childGlyph = v as Params["nav"]["childGlyph"]; } },
      num("response", () => P.nav.responseMs, (v) => { P.nav.responseMs = v; }, 100, 1500, 10, "ms"),
      num("exit response ×", () => P.nav.exitResponseFactor, (v) => { P.nav.exitResponseFactor = v; }, 0.3, 1.5, 0.01, ""),
      num("longer per octave ×", () => P.nav.durationPerOctave, (v) => { P.nav.durationPerOctave = v; }, 0, 0.5, 0.01, ""),
      num("free octaves", () => P.nav.baseOctaves, (v) => { P.nav.baseOctaves = v; }, 0, 8, 0.1, ""),
      num("freeze beyond (octaves)", () => P.nav.freezeOctaves, (v) => { P.nav.freezeOctaves = v; }, 1, 10, 0.1, ""),
      num("frozen start ×", () => P.nav.capFactor, (v) => { P.nav.capFactor = v; }, 2, 30, 0.5, ""),
      num("arrival pad", () => P.nav.fitPad, (v) => { P.nav.fitPad = v; }, 0, 300, 1),
      num("arrival zoom min", () => P.nav.fitMin, (v) => { P.nav.fitMin = v; }, 0.05, 1, 0.01, "×"),
      num("arrival zoom max", () => P.nav.fitMax, (v) => { P.nav.fitMax = v; }, 0.5, 4, 0.01, "×"),
      { kind: "actions", items: [
        { label: "enter selected folder", run: () => { const c = cards.find((c) => c.motion.selected); if (c) enter(c); } },
        { label: "exit", run: () => { exit(); } },
        { label: "reset nav", run: () => { P.nav = defaultNavTweaks(); } },
      ] },
    ] },
    { title: "cutting mat · the third grid (research/tree-shadow hero)", rows: [
      num("line half-width thin", () => P.mat.thin, (v) => { P.mat.thin = v; }, 0.1, 3, 0.05, "dpx"),
      num("line half-width thick", () => P.mat.thick, (v) => { P.mat.thick = v; }, 0.1, 4, 0.05, "dpx"),
      num("line alpha thin", () => P.mat.alphaThin, (v) => { P.mat.alphaThin = v; }, 0, 1, 0.01, ""),
      num("line alpha thick", () => P.mat.alphaThick, (v) => { P.mat.alphaThick = v; }, 0, 1, 0.01, ""),
      num("grain (/255)", () => P.mat.grain * 255, (v) => { P.mat.grain = v / 255; }, 0, 40, 0.5, ""),
      { kind: "color", label: "mat ground", alpha: false, get: () => P.mat.ground, set: (v) => { P.mat.ground = v as [number, number, number]; } },
      { kind: "color", label: "mat line", alpha: false, get: () => P.mat.ink, set: (v) => { P.mat.ink = v as [number, number, number]; } },
      num("gobo opacity", () => P.mat.opacity, (v) => { P.mat.opacity = v; }, 0, 1, 0.01, ""),
      { kind: "select", label: "plate", options: ["c", "b"], get: () => P.mat.plate, set: (v) => { P.mat.plate = v as PlateName; } },
      num("wind (gobo s / s)", () => P.mat.wind, (v) => { P.mat.wind = v; }, 0, 20, 0.1, ""),
      num("blur radius (texels)", () => P.mat.blurTexels, (v) => { P.mat.blurTexels = v; }, 0, 8, 0.1, ""),
      num("blur sharp until (m)", () => P.mat.sharp, (v) => { P.mat.sharp = v; }, 0.05, 2, 0.005, ""),
      num("blur soft from (m)", () => P.mat.soft, (v) => { P.mat.soft = v; }, 0.05, 3, 0.005, ""),
      num("shade mix", () => P.mat.shadeMix, (v) => { P.mat.shadeMix = v; }, 0, 1, 0.005, ""),
      num("shade floor", () => P.mat.darkFloor, (v) => { P.mat.darkFloor = v; }, 0, 1, 0.01, ""),
      num("shade saturates", () => P.mat.saturate, (v) => { P.mat.saturate = v; }, 0, 0.5, 0.01, ""),
      num("mouse tilt (rad)", () => P.mat.tilt, (v) => { P.mat.tilt = v; }, 0, 0.02, 0.0005, ""),
      num("metres per world unit ×1e-4", () => P.mat.metresPerUnit * 1e4, (v) => { P.mat.metresPerUnit = v * 1e-4; }, 0.2, 20, 0.05, ""),
      { kind: "actions", items: [{ label: "reset mat", run: () => { P.mat = defaultMatTweaks(); } }] },
    ] },
    { title: "the night · the mat under the Moon (MAT.md; the dark theme)", rows: [
      num("night (0 = the day's chain)", () => P.night.night, (v) => { P.night.night = v; }, 0, 1, 0.01, ""),
      num("the Moon (K)", () => P.night.kelvin, (v) => { P.night.kelvin = v; }, 2000, 10000, 50, ""),
      num("the Moon on the desk (lux)", () => P.night.lux, (v) => { P.night.lux = v; }, 0.01, 2, 0.01, ""),
      num("the sky's share in the shadow", () => P.night.fill, (v) => { P.night.fill = v; }, 0, 1, 0.01, ""),
      num("the rods' hue (nm)", () => P.night.rodNm, (v) => { P.night.rodNm = v; }, 470, 500, 1, ""),
      num("the rods' hue, purity", () => P.night.rodPurity, (v) => { P.night.rodPurity = v; }, 0, 0.5, 0.01, ""),
      num("the lit sage over the day's", () => P.night.litOverDay, (v) => { P.night.litOverDay = v; }, 0.1, 1.5, 0.01, "×"),
      num("snow (/255, peak to peak)", () => P.night.snow * 255, (v) => { P.night.snow = v / 255; }, 0, 16, 0.5, ""),
      { kind: "actions", items: [{ label: "reset night", run: () => { P.night = defaultNightTweaks(); } }] },
    ] },
    { title: "frame style · the shell", rows: [
      { kind: "select", label: "base", options: Object.keys(STYLES), get: () => P.style.base, set: (v) => { P.style = styleTweaksOf(STYLES[v as keyof typeof STYLES], v as keyof typeof STYLES); } },
      num("rim (the plate's band)", () => P.style.band, (v) => { P.style.band = v; }, 1, 40, 0.5),
      num("well (around the content)", () => P.style.well, (v) => { P.style.well = v; }, 0, 80, 0.5),
      num("card radius (resting)", () => P.style.radius, (v) => { P.style.radius = v; }, 0, 60, 0.5),
      num("control (diameter; 0 = no bays)", () => P.style.control, (v) => { P.style.control = v; }, 0, 60, 1),
      num("clearance (to the outer edge)", () => P.style.clearance, (v) => { P.style.clearance = v; }, 0, 30, 0.5),
      num("bay clearance", () => P.style.bayClearance, (v) => { P.style.bayClearance = v; }, 0, 30, 0.5),
      num("fillet", () => P.style.fillet, (v) => { P.style.fillet = v; }, 0, 40, 0.5),
      { kind: "note", get: () => styleViolations(state.style, contentHalf()).map((v) => `⚠ ${v}`).join("\n") },
    ] },
    { title: "motion", rows: [
      num("reveal Hz", () => P.motion.revealHz, (v) => { P.motion.revealHz = v; }, 0.2, 12, 0.1, "Hz"),
      num("reveal damping", () => P.motion.revealDamp, (v) => { P.motion.revealDamp = v; }, 0.1, 2, 0.01, ""),
      num("lock Hz", () => P.motion.lockHz, (v) => { P.motion.lockHz = v; }, 0.2, 12, 0.1, "Hz"),
      num("lock damping", () => P.motion.lockDamp, (v) => { P.motion.lockDamp = v; }, 0.1, 2, 0.01, ""),
      num("lift Hz", () => P.motion.liftHz, (v) => { P.motion.liftHz = v; }, 0.2, 12, 0.1, "Hz"),
      num("lift damping", () => P.motion.liftDamp, (v) => { P.motion.liftDamp = v; }, 0.1, 2, 0.01, ""),
      num("delete seconds", () => P.motion.deleteSeconds, (v) => { P.motion.deleteSeconds = v; }, 0.1, 3, 0.01, "s"),
      num("heat Hz", () => P.motion.hotHz, (v) => { P.motion.hotHz = v; }, 0.2, 12, 0.1, "Hz"),
      num("heat damping", () => P.motion.hotDamp, (v) => { P.motion.hotDamp = v; }, 0.1, 2, 0.01, ""),
    ] },
    { title: "heat (§7 overlap glow · rim)", rows: [
      { kind: "select", label: "drop policy (what a dragged card lights)", options: ["surface", "accept", "reject", "none"], get: () => state.dropPolicy, set: (v) => { state.dropPolicy = v as DropPolicy; } },
      num("light height (the source floats)", () => P.heat.height, (v) => { P.heat.height = v; }, 1, 200, 1),
      num("light reject", () => P.heat.alpha[0], (v) => { P.heat.alpha[0] = v; }, 0, 1.5, 0.01, ""),
      num("light accept", () => P.heat.alpha[1], (v) => { P.heat.alpha[1] = v; }, 0, 1.5, 0.01, ""),
      num("rim width", () => P.heat.rim.width, (v) => { P.heat.rim.width = v; }, 0, 8, 0.1),
      num("rim reject", () => P.heat.rim.alpha[0], (v) => { P.heat.rim.alpha[0] = v; }, 0, 1.5, 0.01, ""),
      num("rim accept", () => P.heat.rim.alpha[1], (v) => { P.heat.rim.alpha[1] = v; }, 0, 1.5, 0.01, ""),
      { kind: "actions", items: [{ label: "reset heat", run: () => { P.heat = defaultHeatTweaks(); } }] },
    ] },
    { title: "portal · a container's face shows its inside (PORTAL.md)", rows: [
      { kind: "toggle", label: "live portals", get: () => P.portal.on, set: (v) => { P.portal.on = v; } },
      num("gate from (face short side)", () => P.portal.gate[0], (v) => { P.portal.gate = [v, Math.max(P.portal.gate[1], v + 1)]; }, 0, 400, 1),
      num("gate full", () => P.portal.gate[1], (v) => { P.portal.gate = [Math.min(P.portal.gate[0], v - 1), v]; }, 1, 600, 1),
      num("portals per frame (cap)", () => P.portal.cap, (v) => { P.portal.cap = v; }, 0, 64, 1, ""),
      { kind: "toggle", label: "dress a portal for its arrival", get: () => P.portal.dress, set: (v) => { P.portal.dress = v; } },
      { kind: "toggle", label: "zoom-through (enter · leave as cuts)", get: () => P.portal.through, set: (v) => { P.portal.through = v; } },
      num("re-dress after a cut", () => P.portal.redressMs, (v) => { P.portal.redressMs = v; }, 0, 2000, 10, "ms"),
      { kind: "actions", items: [{ label: "reset portal", run: () => { P.portal = defaultPortalTweaks(); } }] },
    ] },
    { title: "material (§5 shadow · §7 lift)", rows: [
      num("shadow σ resting", () => P.material.shadow.rest.sigma, (v) => { P.material.shadow.rest.sigma = v; }, 0, 80, 0.5),
      num("shadow offset resting", () => P.material.shadow.rest.offset, (v) => { P.material.shadow.rest.offset = v; }, -40, 80, 0.5),
      num("shadow alpha resting", () => P.material.shadow.rest.alpha, (v) => { P.material.shadow.rest.alpha = v; }, 0, 1, 0.01, ""),
      num("shadow σ lifted", () => P.material.shadow.lifted.sigma, (v) => { P.material.shadow.lifted.sigma = v; }, 0, 120, 0.5),
      num("shadow offset lifted", () => P.material.shadow.lifted.offset, (v) => { P.material.shadow.lifted.offset = v; }, -40, 120, 0.5),
      num("shadow alpha lifted", () => P.material.shadow.lifted.alpha, (v) => { P.material.shadow.lifted.alpha = v; }, 0, 1, 0.01, ""),
      num("lift scale", () => P.material.lift.scale, (v) => { P.material.lift.scale = v; }, 1, 1.3, 0.005, "×"),
      num("lift opacity", () => P.material.lift.opacity, (v) => { P.material.lift.opacity = v; }, 0.1, 1, 0.01, ""),
      num("hairline width", () => P.lines.hairline, (v) => { P.lines.hairline = v; }, 0, 6, 0.1),
      num("selection ring width", () => P.lines.ring, (v) => { P.lines.ring = v; }, 0, 8, 0.1),
    ] },
    { title: "colours · dark (overrides the tokens)", rows: colorRows("dark") },
    { title: "colours · light (overrides the tokens)", rows: colorRows("light") },
    { title: "scene", rows: [
      { kind: "select", label: "theme", options: ["dark", "light"], get: () => state.theme, set: (v) => { state.themePinned = true; setTheme(v as ThemeName); } },
      { kind: "toggle", label: "exact frame field", get: () => state.exactFrames, set: (v) => { state.exactFrames = v; } },
      { kind: "toggle", label: "draw frames", get: () => state.drawFrames, set: (v) => { state.drawFrames = v; } },
      { kind: "actions", items: [
        { label: "scatter 12", run: () => scatter(12) }, { label: "scatter 48", run: () => scatter(48) }, { label: "scatter 256", run: () => scatter(256) }, { label: "add card", run: () => { const w = pointerWorld(); addCard({ x: w.x, y: w.y }); } },
      ] },
      { kind: "select", label: "selected card's content (i cycles)", options: [...CONTENT_CHOICES], get: () => cards.find((c) => c.motion.selected)?.content ?? "plate", set: (v) => { const c = cards.find((c) => c.motion.selected); if (c) setContent(c, v as ContentChoice); } },
      { kind: "actions", items: [
        { label: "texture all (page 0)", run: () => { for (const c of cards) c.content = "page0"; } }, { label: "plain all", run: () => { for (const c of cards) c.content = "plate"; } },
      ] },
      { kind: "actions", items: [
        { label: "copy JSON", run: () => { void navigator.clipboard?.writeText(snapshotParams(P)); } },
        { label: "reset to product", run: () => { P = defaultParams(); for (const c of cards) c.strength = P.field.strength; } },
      ] },
    ] },
  ];
  panel = mountPanel(document.getElementById("panel") as HTMLElement, sections, apply);
  apply();

  bindInput();
  new ResizeObserver(fit).observe(document.documentElement);
  fit();
  for (let i = 0; i < 3; i++) addCard();
  addCard({ surface: "folder", x: centreWorld().x + 260, y: centreWorld().y - 120 });
  for (const ev of ["focus", "pageshow"]) window.addEventListener(ev, markDraw);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) markDraw(); });
  let settle = 8;

  function tick(now: number) {
    requestAnimationFrame(tick);
    const dt = Math.min((now - state.lastTick) / 1000, 0.05); state.lastTick = now;
    if (settle > 0) { settle -= 1; state.needsDraw = true; }
    if (!state.needsDraw) return;
    // Every clock advances every frame (no short-circuit): the springs, a live mat, and the flight each keep the loop awake.
    const live = step(dt);
    const mat = stepMat(dt);
    const nav = stepNav(dt);
    state.needsDraw = live || mat || nav;
    const t0 = performance.now();
    let s: ReturnType<typeof render>;
    try { s = render(); } catch (e) { fail(e); return; }
    state.cpuMs = performance.now() - t0;
    state.frames += 1; state.frameCount += 1;
    if (now - state.fpsStamp >= 500) { state.fps = (state.frames * 1000) / (now - state.fpsStamp); state.frames = 0; state.fpsStamp = now; }
    const z = state.zoom >= 1000 || state.zoom <= 0.001 ? state.zoom.toExponential(2) : state.zoom.toFixed(3);
    const g = glyphOf(scene);
    const night = matLightOf(theme()).night;   // the mat's light rides the theme's `mat` section now (design-014)
    statsEl.textContent =
      `ground · ${state.fps.toFixed(0)} fps · ${state.cpuMs.toFixed(2)} ms cpu · z ${z} · k0 ${s.k0} fade ${s.fade.toFixed(2)} · ` +
      `atlas ${s.atlasW}×${s.atlasH} (${(s.atlasW * s.atlasH).toLocaleString()} texels)${s.baked ? " ← baked" : ""} · ` +
      `${s.instances.toLocaleString()} instances · fine ${s.fine} · ${s.sources}/${cards.length} cards · ${s.frames} frames in ${ground.frames.runCount} run${ground.frames.runCount === 1 ? "" : "s"} · ${s.portals} portal${s.portals === 1 ? "" : "s"} · ${s.bakes} bakes · ${g}${s.surface ? ` (plate ${P.mat.plate} · wind ${P.mat.wind}${s.aux ? " ← blew" : ""} · gobo ${P.mat.opacity} · ${night >= 1 ? "the Moon" : night > 0 ? `night ${night.toFixed(2)}` : "the Sun"}${state.assetsReady ? "" : " · plates loading"})` : ""} · ` +
      `depth ${stack.length}${flight ? ` · ${flight.f.kind} p ${flight.f.p.toFixed(2)} → ${glyphOf(flight.departed)} ${s.outgoing ? `(${s.outgoing.instances.toLocaleString()} instances · ${s.outgoing.frames} frames)` : ""}` : ""} · ` +
      `${state.style.name}${state.exactFrames ? " · exact" : ""} · ${state.theme} · ${rangeLabel()} · fade-in ${fmt(P.field.fadeIn)} px · \` panel`;
  }
  requestAnimationFrame(tick);

  (window as unknown as { __ground: unknown }).__ground = {
    state, ground, addCard, scatter, zoomAt, select, render, hitAt, setTheme,
    /** Resolve the frame's geometry without stepping anything — a harness that wants the numbers before a paint. */
    resolveAll: () => resolveList(cards),
    /** The card program in force, and one card's own springs (design-014): the buttons' hover and press, the lock. */
    pack,
    springs: (index: number) => { const c = cards[index]; return c ? pack.springsOf(c) : null; },
    get cards() { return cards; },
    setContent: (index: number, choice: ContentChoice) => { const c = cards[index]; if (c) setContent(c, choice); },
    /** The §7 heat by hand — a card lit by a source without a drag (a harness's cost row), and the drop policy. */
    heat: {
      set(index: number, src: HotPin) { const c = cards[index]; if (c) pinMotion(c.motion, { hot: src }); markDraw(); },
      clear() { for (const c of cards) c.motion.hotTarget = false; markDraw(); },
      get policy() { return state.dropPolicy; }, set policy(v: DropPolicy) { state.dropPolicy = v; },
    },
    /** The live portal by hand (PORTAL.md): on/off, the gate, the cap; `cameraOf` = the camera a folder's inside renders under now (null under the gate). */
    portal: {
      get on() { return P.portal.on; }, set on(v: boolean) { P.portal.on = v; markDraw(); },
      get gate() { return P.portal.gate; }, set gate(g: [number, number]) { P.portal.gate = g; markDraw(); },
      get cap() { return P.portal.cap; }, set cap(v: number) { P.portal.cap = v; markDraw(); },
      cameraOf: (index: number) => { const c = cards[index]; if (!c || c.surfaceName !== "folder") return null; return portalOf(faceOf(c), faceRadius(c), () => contentOf(insideOf(c, scene)), camera(), viewport(), fitBand(P.nav), P.portal.gate); },
      pool: () => ground.pool.size,
    },
    nav: {
      enter: (index?: number) => { const c = index === undefined ? cards.find((c) => c.motion.selected) ?? cards[0] : cards[index]; return c ? enter(c) : false; },
      exit: () => exit(),
      depth: () => stack.length,
      /** The zoom-through by hand: enter the folder whose face covers the view (its index, or -1), or leave once the container's face has uncovered it. */
      through: () => { const c = enterThrough(); return c ? cards.indexOf(c) === -1 ? stack[stack.length - 1]?.parent.cards.indexOf(c) ?? -1 : cards.indexOf(c) : -1; },
      throughOut: () => exitThrough(),
      /** Does a folder's face cover the view by the enter margin right now — the engine's own answer (nav/portal.ts `faceCovers`). */
      covers: (index: number) => { const c = cards[index]; if (!c || c.surfaceName !== "folder") return false; const live = portalOf(faceOf(c), faceRadius(c), () => contentOf(insideOf(c, scene)), camera(), viewport(), fitBand(P.nav), P.portal.gate); return !!live && faceCovers(live.clip, viewport(), THROUGH_IN); },
      flight: () => (flight ? { kind: flight.f.kind, p: flight.f.p, frozen: flight.f.frozen, active: flight.f.active, c0: flight.f.c0, c1: flight.f.c1 } : null),
      /** Pin the flight at a progress (a still for a shot or a perf batch); `null` unpins. */
      pin(p: number | null) { state.navPinned = p !== null; if (flight && p !== null) { flight.f.p = p; setCamera(flightAt(flight.f, p, viewport())); } markDraw(); },
      glyph: () => glyphOf(scene),
    },
    setScene(s: { cards: Array<{ x: number; y: number; w: number; h: number; r: number; strength: number; surface?: SurfaceName; selected?: boolean; content?: ContentChoice; inside?: { cards: CardSpec[]; glyph: GridGlyph } } & Pins>; portals?: boolean; portalGate?: [number, number]; camX: number; camY: number; zoom: number; mouseX: number; mouseY: number; mouseOn: boolean; reach: number; halfLen: number; inkAlpha?: number; range?: "preset" | "open"; fadeIn?: FadeIn; dotRadius?: GlyphRange; needleHalfLen?: GlyphRange; needleHalfWidth?: GlyphRange; theme: ThemeName; glyph?: GridGlyph; fine?: FieldConfig["fineSchedule"]; style?: keyof typeof STYLES; exact?: boolean; drawFrames?: boolean; mat?: { time?: number; goboTime?: number; noise?: [number, number]; opacity?: number; plate?: PlateName; wind?: number }; nav?: { kind: "enter" | "exit"; container: number; child: { cards: CardSpec[]; glyph: GridGlyph }; p: number; innerCam?: { x: number; y: number; zoom: number } } }) {
      abortFlight(); stack.length = 0; scene = root; cards = root.cards; state.navPinned = false; state.dropPolicy = "surface";
      forgetScene(root);   // the outgoing board's springs leave with it
      cards.length = 0;
      for (const c of s.cards) cards.push({ x: c.x, y: c.y, w: c.w, h: c.h, r: c.r, strength: c.strength, surface: surface(c.surface ?? "card"), surfaceName: c.surface ?? "card", motion: pinMotion(newMotion(c.selected ?? false), c), geometry: null, content: c.content ?? "plate", ...(c.surface === "folder" ? { face: FOLDER_FACE } : {}) });
      state.camX = s.camX; state.camY = s.camY; state.zoom = s.zoom;
      state.pointerX = s.mouseX; state.pointerY = s.mouseY; state.pinned = true; state.pointerOn = s.mouseOn;
      // a scene is a fresh parameter set: the product's, with the scene's own field settings on top
      P = defaultParams();
      P.field.reach = s.reach; P.field.halfLen = s.halfLen; P.field.inkAlpha = s.inkAlpha ?? THEMES[s.theme].fieldInkAlpha;
      state.themePinned = true; setTheme(s.theme);
      P.field.range = s.range ?? "preset";
      P.field.fadeIn = s.fadeIn ?? PRODUCT_GRID.fadeIn;
      P.field.dotRadius = s.dotRadius ?? PRODUCT_GRID.dotRadius; P.field.needleHalfLen = s.needleHalfLen ?? PRODUCT_GRID.needleHalfLen; P.field.needleHalfWidth = s.needleHalfWidth ?? PRODUCT_GRID.needleHalfWidth;
      P.field.glyph = s.glyph ?? "dot"; P.field.fineSchedule = s.fine ?? "auto";
      // a scene's folders show their insides only when it says so (PORTAL.md) — the scenes before it are unchanged
      P.portal.on = s.portals ?? false;
      if (s.portalGate) P.portal.gate = s.portalGate;
      s.cards.forEach((c, i) => { if (c.inside) (cards[i] as Card).child = makeChild(P.field.glyph, c.inside.cards, c.inside.glyph); });   // the root's; makeCard nests the rest
      // a mat scene is a STILL: its clocks are the scene's, the tilt is the baked projector, nothing re-rolls
      P.mat = defaultMatTweaks();
      if (s.mat) { P.mat.opacity = s.mat.opacity ?? P.mat.opacity; P.mat.plate = s.mat.plate ?? P.mat.plate; P.mat.wind = s.mat.wind ?? 0; }
      state.matTime = s.mat?.time ?? 0; state.goboTime = s.mat?.goboTime ?? 0; state.noise = s.mat?.noise ?? [0, 0]; state.goboMatrix = HERO_MATRIX;
      state.matPinned = (s.glyph === "mat" || s.nav !== undefined) && (s.mat?.wind ?? 0) === 0;
      if (s.style) P.style = styleTweaksOf(STYLES[s.style], s.style);
      setStyle(buildStyle(P.style));
      pack.heat = P.heat;
      state.exactFrames = s.exact ?? false;
      state.drawFrames = s.drawFrames ?? true;
      // a flight, pinned at one progress: the same geometry the Node oracle computes (nav/flight.ts)
      if (s.nav) {
        const container = cards[s.nav.container] as Card;
        container.surfaceName = "folder"; container.surface = surface("folder"); container.face = FOLDER_FACE;
        container.child = makeChild(P.field.glyph, s.nav.child.cards, s.nav.child.glyph);
        if (s.nav.kind === "enter") enter(container);
        else {
          enter(container, false);
          setCamera(s.nav.innerCam ?? arrivalCamera(contentOf(scene), viewport(), fitBand(P.nav)));
          exit();
        }
        state.navPinned = true;
        if (flight) { flight.f.p = s.nav.p; setCamera(flightAt(flight.f, s.nav.p, viewport())); }
      }
      panel.refresh();
      markDraw();
    },
    get params() { return P; }, apply, panel,
  };
}

start();
