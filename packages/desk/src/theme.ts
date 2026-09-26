// The ground's colours and material numbers — the ENGINE's half of the theme.
//
// Two homes, one law: a colour literal lives here or in the host's projection
// (`lab/theme.ts` — VibeField's `--vf-*` tokens transcribed by name; at the fold,
// field-app's `canvas-appearance.ts` reading them off the stamped root), and
// nowhere else in src/, shaders/ or lab/ — `test/theme.test.ts` enforces it.
// This file holds what the engine SHIPS: the types and the CSS-colour parser;
// `themeFrom` (a palette → the numbers the passes read); the grid's fade-in
// law; and the desk's materials, each with its lineage named — the cutting mat
// with its two lights (the tree-shadow reference; MAT.md), the paper, the hand,
// the notebook, the whiteboard and the mini mat. A product's palette is the
// product's: it reaches the passes through `GroundTheme`, never from here.
// Split from the one-file projection on 2026-09-07, before B1 (the move). The
// card chrome's numbers (the §2.3 lines, the §5 shadow, the §7 lift and heat)
// and the magnet field's (ICE's grid defaults) retired with the card frame and
// the dot and needle grids on 2026-09-25 (MINIMAT.md §1).

import { DAY_LIGHT, dayLuminance, type MatLight, nightLight } from "./mat/night";

export type RGB = readonly [number, number, number];
export type RGBA = readonly [number, number, number, number];
export type ThemeName = "light" | "dark";

/**
 * Parse the CSS colour syntaxes tokens.css uses — `#rrggbb`, `rgb(r g b / p%)`,
 * `rgba(r, g, b, a)` — into sRGB 0..1 + alpha. The swap chain is a plain
 * 8-bit format, so what CSS shows is what the shader writes.
 */
export function cssColor(css: string): RGBA {
  const s = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const v = Number.parseInt(m[1] as string, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+)(%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] === "%" ? Number(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a];
  }
  throw new Error(`theme: unparsed colour "${css}"`);
}
export const rgb = (css: string): RGB => cssColor(css).slice(0, 3) as unknown as RGB;

/** A colour as the design kit names it, with its CSS value verbatim. */
export interface TokenRef {
  /** `--vf-*` = a tokens.css token (checked by name); anything else names its DESIGN.md source. */
  readonly token: string;
  readonly css: string;
}

/** The roles the ground paints from a product's palette, one token each, per theme. */
export interface Palette {
  readonly canvasBg: TokenRef;     // §2.1 the ground — the clear colour under the mat
  readonly select: TokenRef;       // §2.5 selection ring only
}

/**
 * The GRID's fade-in window — the lattice's one law for every rung (lod.ts `FadeIn`,
 * line.ts): a rung fades in as its OWN cell grows from 10 to 20 CSS px, one octave
 * under the decade's 20 px bottom, so zoom 1 lands on a full lattice. The mat's
 * lines, the rulers' ticks and a mini mat's face all read it. (It was the magnet
 * field's `fadeIn` — ICE's `worldGrid.fadeIn` — and is the one number of that set
 * the mat kept.) And the DRESSING's floor (PORTAL.md §9, MINIMAT.md §5): a mini mat's inside is dressed
 * for its arrival — its lattice as it will look when entered, scaled — but the window is never scaled
 * below this share of itself, so a miniature's grid is never finer than half the desk's: a tiny mini
 * mat shows its inside's major lines, not a haze of its minor ones. The live inside, the face's far
 * LOD and a flight's two desks all take the same floor, so none of them can disagree.
 */
export const GRID = { fadeIn: [10, 20] as const, dressFloor: 0.5 } as const;

/**
 * The CUTTING MAT — the ground's one grid: a hairline lattice on a green mat, ported
 * from research/tree-shadow/prototype (the oryzo "hero desk"). Its colours are
 * a material's, carried across both themes like an object's own colours;
 * the numbers are the reference's, transcribed with their names. DESIGN.md has
 * no cutting-mat row yet (it is a research port) — the token names below say
 * where each value came from, and adding the material to the doc is the step
 * before any of this leaves draft/.
 *
 * The reference draws its albedo through `srgbToLinear` and then `pow(2.2)`
 * again, grades in HSB, and writes `pow(1/2.2)` straight to the swap chain: the
 * mat on screen is the LINEARISED sage, a dark green. That chain is the look
 * and is kept verbatim (mat.wgsl), so `ground` and `line` below are the values
 * the chain STARTS from, not what a pixel measures.
 */
export const MAT = {
  ground: { token: "hero cuttingMatAlbedo `sage`", css: "#86a078" },   // 134 160 120
  line: { token: "hero cuttingMatAlbedo `cream`", css: "#e8dcbe" },    // 232 220 190
  /** The colour a desk object's shadow casts ON the mat — the tree-shadow design system's `--cast-rgb` (mat.css: "the world's darkest value"). */
  cast: { token: "tree-shadow design mat.css `--cast-rgb`", css: "#0e1a0a" },   // 14 26 10
} as const;
/** The same, parsed — what a pass reads (nothing outside this file parses a colour). */
export const MAT_COLORS: { readonly ground: RGB; readonly line: RGB; readonly cast: RGB } = { ground: rgb(MAT.ground.css), line: rgb(MAT.line.css), cast: rgb(MAT.cast.css) };

/**
 * The mat's line law and the gobo's numbers (research/tree-shadow/prototype:
 * shaders.js `cuttingMatAlbedo` · `sampleGobo` · `heroFrag`, scenes.js `hero`).
 * Line widths are DEVICE px — the reference's hairlines are 0.5 / 0.75 of a
 * framebuffer pixel; the alphas ride the engine's `fadeIn` window (line.ts).
 */
export const MAT_GRID = {
  line: { thin: 0.5, thick: 0.75, alphaThin: 0.14, alphaThick: 0.28 },
  /** ±8/255 on the green channel (0.4× red, 0.35× blue): static hash + drifting value noise + blue noise. */
  grain: 8 / 255,
  gobo: {
    opacity: 1,
    /** `getGoboBlurRatio(z, params) * 2.0` — the blur radius in plate texels at full softness. */
    blurTexels: 2,
    /** heroFrag: `shade = mix(1, coaster·(0.5 + 0.5·gobo), 0.975)`; then HSB s += (1−shade)·0.1, v *= shade. */
    shadeMix: 0.975, darkFloor: 0.5, saturate: 0.1,
    /** scenes.js `hero.params` — the blur ramp's two linear depths (metres from the projector). */
    sharp: 0.372991, soft: 0.79059,
    /** The plates: R silhouette, G wind amp 1, B phase, A amps 2+3; each with its wind strength. */
    plates: { c: { strength: 0.38847005 }, b: { strength: 0.4630597 } },
    plate: "c" as "c" | "b",
    /** gobo.js: `time += dt·(speed + 1 + r)` at speed 4; the lab's 0 = frozen. */
    wind: 5,
    /** hero `mouseStrength` — radians of projector tilt per unit of smoothed pointer NDC. */
    tilt: 0.003,
  },
  /**
   * The RULERS printed along the mat's top and left edges (RULER.md — James's mockup of
   * 2026-09-23, measured at its 1.6×: a 41 px band under a 41 px margin, 12 px numerals,
   * ticks 9 · 15 · 24, 1–2 px lines): one MODULE for the unprinted margin and one for the
   * band; 1 px lines; the text 10 px mono (DESIGN.md §3's caption size, the product's
   * `--vf-font-mono`) 5 px in from the outer line and 3 px after its tick; the ink the
   * mat's own cream at these presences. The fine rung's ticks arrive over a 6 → 9 px pitch
   * (a ruler's mm under its cm; at 5 the comb read busy) and a level's labels over 50 → 70 px,
   * so labels sit 50–250 px apart at every zoom (lattice/ruler.ts).
   */
  ruler: {
    band: 26, margin: 26, tick: [6, 9, 15], line: 1,
    alpha: { frame: 0.55, tick: 0.85, label: 0.85 },
    ticksFrom: [6, 9], labelsFrom: [50, 70],
    text: { size: 10, top: 5, gap: 3 },
    maxChars: 9,
  },
  /**
   * World → desk: the hero's view at its default height is 0.2227 m over the
   * window's height (900 px in the reference shots), so one world unit (a CSS
   * px at zoom 1) is 0.2227 / 900 m and the dapple spans the same screen at
   * zoom 1. The mat's centre (the reference's coaster) is world (0, 0); the
   * desk plane is `y = 0.7471` in the projector's frame.
   */
  plane: { metresPerUnit: 0.2227 / 900, originX: -0.0105761, originZ: -0.0485146, deskY: 0.7471 },
} as const;

/**
 * The NIGHT — the cutting mat in the dark theme (MAT.md). The mat is a material and
 * keeps its sage and cream in both themes; what the theme changes is the LIGHT: the
 * Sun by day (the reference's chain, verbatim), the Moon by night — and the eye that
 * sees by it. Every number here is a choice with its source; `mat/night.ts` turns
 * them into the shader's numbers.
 */
export const NIGHT = {
  /** Full moonlight is REDDER than sunlight — ≈ 4100 K against the Sun's ≈ 5500 (Ciocca & Wang 2013); the blue of a moonlit scene is the eye's, not the light's. */
  kelvin: 4100,
  /** A full Moon high in a clear sky: 0.1–0.3 lux on the ground, a million times under the Sun's. Where on the mesopic ramp the eye sits. */
  lux: 0.2,
  /** The sky's share in the shadow — the same air scatters the same fraction of the Moon as of the Sun, ≈ 0.15–0.2 of the direct light at 45°. */
  fill: 0.18,
  /** The rods' signal drawn as a colour: white pulled 18 % toward 485 nm — the low-purity blue the night-rendering literature gives scotopic vision (Jensen et al. 2000; Khan & Pattanaik 2004). */
  rodHue: { nm: 485, purity: 0.18 },
  /** Eigengrau — the "intrinsic grey" the eye reports with no light at all (the rods' own dark noise); the value the term is given. */
  eigengrau: { token: "Eigengrau (the dark's own grey)", css: "#16161d" },
  /** The appearance's one scale: the moonlit sage is drawn at HALF the sunlit one's displayed luminance — the million can't be shown; the adapted eye's report is. */
  litOverDay: 0.5,
  /** The rods' own noise on the display: ±2/255, blue noise, achromatic. */
  snow: 4 / 255,
  /** CIECAM02's surround factor for the eye's adaptation to the Moon's colour: 0.8, a dark surround. */
  surround: 0.8,
} as const;

/** Eigengrau, parsed — what a host hands `nightLight` (lab/params.ts rebuilds the night from its panel). */
export const EIGENGRAU: RGB = rgb(NIGHT.eigengrau.css);

/** The light the mat pass reads, per theme: the Sun (the reference's chain, bit for bit) by day, the Moon by night. */
export const MAT_LIGHT: Record<ThemeName, MatLight> = {
  light: DAY_LIGHT,
  dark: nightLight({
    kelvin: NIGHT.kelvin, lux: NIGHT.lux, fill: NIGHT.fill, rodHue: NIGHT.rodHue, eigengrau: EIGENGRAU,
    litLuminance: NIGHT.litOverDay * dayLuminance(MAT_COLORS.ground), snow: NIGHT.snow, surround: NIGHT.surround,
  }, MAT_COLORS.ground),
};

/**
 * PAPER — the desk's first object (STICKY.md): a sticky note as a MATERIAL under the
 * mat's one light. A square of thin paper pressed flat under its adhesive strip and
 * free below it, where it rises a little off the mat and its corners rise most; stuck
 * a degree or two off square, as a hand leaves it; lit by the lamp that casts the
 * palm's shadow (the gobo projector — `paper.ts` `lampOf`), so the dapple crosses it
 * and its shadow falls away from that lamp; by night, under the Moon like the mat.
 * Lengths are world units (CSS px at zoom 1). The paper's colour is the product's
 * (`--vf-note-surface`, lab/theme.ts); the pen's ink is the host's too.
 */
export const PAPER = {
  /** The note's side — a 3″ square read at about the card grid's scale (DESIGN.md §4: small 155). */
  size: 200,
  /** The die-cut corner. */
  radius: 1.5,
  /** Never stuck square: each note takes its own tilt within ± this, degrees. */
  tilt: 2.5,
  /** The fraction of the height pressed flat under the adhesive strip. */
  glue: 0.3,
  /** How far the free edge rises off the mat, and how much more its corners rise than its middle. */
  curl: 3, cornerCurl: 0.6,
  /** How far a HELD note rises (§7's lift, as a height), and the scale it reads at (§7's 1.05, kept). */
  lift: { height: 12, scale: 1.03 },
  /**
   * The contact shadow on the mat: Gaussian-blurred coverage of the sheet cast along the lamp's
   * ground direction by its height — σ and alpha at contact, σ growing per unit of height, the
   * alpha a held note casts, and the slope's cap (a note far from the lamp keeps a finite shadow).
   */
  shadow: { sigma: 2.2, alpha: 0.36, sigmaPerUnit: 0.9, alphaHeld: 0.4, slopeMax: 2.2 },
  /** How much the sheet's slope is exaggerated for the lamp's shading: a curl of a few px over a hundred is invisible at 1; at this it reads as paper. */
  relief: 3.5,
  /** The paper's fibre: ±/255 on the albedo. */
  grain: 2.5 / 255,
  /** The sole-selection ring (DESIGN.md §7), CSS px, in `--vf-select`. */
  ring: 1.5,
  /** The caret: CSS px wide, the platform's blink. */
  caret: { width: 1.5, blinkMs: 530 },
} as const;

/**
 * The HAND — how the pen writes on the paper (STICKY.md §3; `paper/text.ts`). The face is
 * the host's (the lab's Caveat, an OFL hand); its size is in world units; the jitter is
 * each glyph's own — a tilt, a rise, a size, a pressure — and the line wanders slowly.
 * The wipe is how a typed glyph arrives: revealed left to right in `wipeMs`, the pen's stroke.
 */
export const HAND = {
  size: 24, lineHeight: 1.16, pad: 16,
  jitter: { rot: 0.028, rise: 0.03, scale: 0.05, press: [0.8, 0.97] as readonly [number, number] },
  wander: { amp: 0.022, period: 9 },
  wipeMs: 110,
} as const;

/**
 * The NOTEBOOK (BOOK.md) — a desk object under the mat's lamp, ONE PHYSICS with the sticky
 * note: it lifts as the note lifts and casts as the note casts (`PAPER`'s numbers, by name),
 * plus what a slab has and a sheet has not — a CONTACT shadow at its base (the tree-shadow
 * design system's paper elevation, mat.css `--lift-1`: a tight `-1px 2px 0 cast/.22` under the
 * soft `-3px 5px 10px`), the lamp's fill on a face turned from it (the cover mid-swing), and
 * the materials: the page's fibre is the note's grain; the board wears a cloth, a rolled edge
 * and the spine's roll; a bound page dips into the gutter; a stack shows its sheets' edges.
 * Lengths are world units (CSS px at zoom 1); the colours are the product's (lab/theme.ts).
 */
export const BOOK = {
  lift: PAPER.lift,
  shadow: {
    penumbra: { sigma0: PAPER.shadow.sigma, sigmaPerHeight: PAPER.shadow.sigmaPerUnit, alpha: PAPER.shadow.alpha },
    /** The contact term: σ, alpha, and the gap (world units) it has faded over once the object floats. */
    contact: { sigma: 1.1, alpha: 0.3, reach: 2.5 },
    slopeMax: PAPER.shadow.slopeMax,
  },
  /** The lamp's fill on a face turned away from it; how far past a flat face one turned toward it may brighten. */
  light: { ambient: 0.5, cap: 1.35 },
  /**
   * The leaves' dapple on the object, as a share of the mat's own (1 = the reference's shade, floor 0.5):
   * a PAGE takes it gently so writing under the palm stays legible (thinking-the-desk §6 guardrail 3),
   * a board takes it whole. BOOK.md Q-b — James's to rule.
   */
  dapple: { page: 0.55, board: 1 },
  /** The fibre (the note's grain, a touch more — a notebook's sheet is heavier than a Post-it's), the gutter's depth and width, the sheets' edge pitch (device px). */
  paper: { fibre: 3.5 / 255, gutterDepth: 0.35, gutterWidth: 14, edgeStep: 1.3 },
  /** The board: its cloth (±/255), the rolled edge's width and tilt (rad), the spine's roll. */
  cover: { cloth: 6 / 255, bevel: 2.2, bevelTilt: 0.96, roll: 5 },
  /** The ruling: the pitch (the fine lattice at zoom 1), a dot's radius, a rule's width. */
  rule: { pitch: 20, dot: 0.7, width: 0.6 },
  ring: PAPER.ring,
  /** A notebook as a host spawns one: A6 at the card grid's scale — 176 × 248, a 16 px tape, 9 px fore-edge corners, 1.8 px boards, 80 sheets of 0.12, 2.5 px squares. */
  spec: { width: 176, height: 248, spine: 16, radius: 9, board: 1.8, sheet: 0.12, sheets: 80, inset: 2.5 },
} as const;

/**
 * The WHITEBOARD (BOARD.md) — a desk dry-erase board under the mat's one lamp, ONE PHYSICS with
 * the note and the notebook: it lifts as they lift (`PAPER.lift`), its slab casts the note's
 * penumbra swept down its height with the notebook's contact term at its base (`BOOK.shadow`),
 * and a face reads by the notebook's light (`BOOK.light`). What a board has of its own is the
 * research whiteboard (research/whiteboard): melamine with an orange-peel grain and a sheen that
 * slides with the eye, felt-tip ink laid by max-blended stamps — streaky when fast, bleeding when
 * held, glossy while wet — and an eraser that leaves a ghost. The board is 3:2 like every
 * whiteboard, on the tree-shadow design's 80-unit module, at the notebook's scale: 480 × 320
 * beside the A6 notebook's 176 × 248 is a ~29 × 19 cm desk board. World units throughout; the
 * research's tip and stroke numbers were CSS px on a full-screen board and are scaled into them.
 * The colours are the product's (lab/theme.ts `BOARD_LOOK`, `MARKERS`).
 */
export const BOARD = {
  /** A board as a host spawns one: its outer size, the aluminium frame's width, the frame's outer radius, the slab's height, the melamine's recess below the frame's top. */
  spec: { width: 480, height: 320, frame: 9, radius: 7, thick: 8, recess: 1.2 },
  lift: PAPER.lift,
  shadow: BOOK.shadow,
  light: BOOK.light,
  /**
   * The melamine: its tone's drift (±), its orange-peel grain (±/255), the ghost old erasures
   * leave; the SHEEN — the window's reflection — its strength, its spread, the eye's height over
   * the board (× the board's height) and how far it slides with the pointer; the frame's lip on
   * the surface: its shadow's alpha and σ.
   */
  surface: { tone: 0.012, grain: 1.5 / 255, ghost: 0.012, sheen: 0.16, spread: 0.35, eye: 1.6, parallax: 0.12, lip: { alpha: 0.2, sigma: 0.9 } },
  /** The frame: brushed along its length (±/255), its profile's roll at the rims (rad), the metal's glint. */
  frame: { brushed: 9 / 255, roll: 0.85, glint: 0.35 },
  /** The ink raster (texels per world unit — the open board fills the view at ~1.8× on a 2× display), how long fresh ink stays wet (s) and how dark it lays wet, the film's edge relief. */
  ink: { density: 4, wetSeconds: 1.2, wetDarken: 0.8, film: 0.04 },
  /** The tips, world units: half extents (along, across the tip), corner radius, edge softness, the angle it is held at (deg). The research's, scaled to the desk board. */
  tips: {
    fine: { half: [0.75, 0.75], radius: 0.75, softness: 0.3, angle: 0 },
    bullet: { half: [1.35, 1.35], radius: 1.35, softness: 0.35, angle: 0 },
    chisel: { half: [2.4, 0.9], radius: 0.5, softness: 0.35, angle: -50 },
  },
  eraser: { half: [16, 7], radius: 2.5, softness: 1.6, angle: 8 },
  /**
   * The felt: its streaks (strength, lanes per world unit across, drift along ×2), how fast a
   * stroke runs dry (world units/s: from, full) and how much flow it loses, a held pen's bleed
   * (after ms, growth, its time constant ms), and the stamps' pitch (× the tip's narrow half, clamped).
   */
  felt: { streak: 0.45, lanes: 0.75, along: [0.058, 0.145], dry: [200, 1450], dryLoss: 0.16, bleed: { after: 150, grow: 0.35, tau: 700 }, pitch: { k: 0.3, min: 0.12, max: 0.5 } },
  /** The pen in the hand and on the board: its length, barrel radius, the cap's length, how steeply it rises from the tip (height per unit of length), how high it hovers unpressed, its lean with speed (rad). */
  pen: { length: 150, radius: 6.5, cap: 42, rise: 0.18, hover: 6, lean: 0.16 },
  /** The eraser in the hand: the felt block's half extents, the felt's and the wooden back's heights. */
  block: { half: [18, 8], felt: 4, wood: 10 },
  ring: PAPER.ring,
  /** The open board: CSS px kept clear round it and for the tray under it, the zoom band, and the pinch-out that closes it (× the framing's zoom). */
  focus: { pad: 48, tray: 92, minZoom: 0.5, maxZoom: 3, close: 0.72 },
} as const;

/**
 * The MINI MAT (MINIMAT.md) — the desk's CONTAINER: a smaller self-healing cutting mat lying on
 * the big one, and inside it another desk (a nested canvas: double-click it, or zoom into it, and
 * it becomes the desk). Its sheet is the mat's own vinyl — the sage and the cream print (`MAT`),
 * the mat's chain by day and the Moon by night — so it is told from the desk by what a real small
 * mat has: its cut edge and its shadow, the printed BORDER round its cutting area (a frame line,
 * a ruler along the top and left edges — its ticks on the very lattice the face shows, numbered
 * in the inside's own units — and its NAME in the foot, as a mat's maker prints its own), and the
 * finer grid of the miniature desk inside. It is thin, so it lies flat and lifts as little as a
 * sheet does, casting the desk's one shadow (`BOOK.shadow`: the note's penumbra with a contact
 * term at the base). World units (CSS px at zoom 1).
 */
export const MINIMAT = {
  /** A new mini mat: 8 × 6 of the tree-shadow design's 80-unit modules (mat.css `--module`). */
  size: { w: 640, h: 480 },
  /** The die-cut corner; the printed border's width (the FACE is the sheet inset by it); the vinyl's thickness. */
  radius: 10, margin: 32, thick: 3,
  /** Held it rises and reads a touch larger — a thin sheet lifts less than a note (PAPER.lift 12 · 1.03); hovered it rises a fifth of that (Marks on the Mat: hover is a rise, never an outline). */
  lift: { height: 10, scale: 1.02 }, hover: 0.2,
  /** The shadow: the desk's one law. */
  shadow: BOOK.shadow,
  /** The cut edge: a bevel this wide, catching the lamp on its near side (× 1 + light) and falling away on the far (× 1 − dark). */
  edge: { width: 1.5, light: 0.1, dark: 0.18 },
  /**
   * The print, in the mat's cream at the tree-shadow design's print-strong (55 %): the frame round the
   * face, the ruler's ticks, its numerals and the name. Its lines this wide (world units: a print
   * scales with the sheet — but never under a device px, the ink thinning instead); the ticks' lengths
   * — minor, medium, major, for the lattice's fine, mid and coarse rungs. The NUMERALS: the rulers' own
   * mono digits (RULER.md), this tall (cap, world units), after their tick by `gap`, their cap's top
   * `top` in from the sheet's edge; a rung is numbered once its sites are `labelsFrom` CSS px apart on
   * screen (its every tenth site, the next rung's, stays numbered). The NAME: the design's print label
   * (mono capitals, tracked 0.16 em) this tall, in the foot of the border from the face's left edge.
   * Text fades in as its cap grows from 4 to 6 CSS px (smaller is a smudge, never a word).
   */
  print: {
    frame: 0.55, tick: 0.55, width: 1, ticks: [5, 9, 14] as const,
    digits: { cap: 6, gap: 2.5, top: 4 }, labelsFrom: [48, 64] as const,
    name: { cap: 8, tracking: 0.16 }, legible: [4, 6] as const,
  },
  /** The sole-selection ring (DESIGN.md §7), CSS px, in `--vf-select`. */
  ring: PAPER.ring,
  /**
   * The face's far LOD (MINIMAT.md §5): its children drawn as CHIPS — at most this many (ICE's preview
   * record keeps 128), none smaller than this many CSS px; a note's writing GREEKED as lines of ink once
   * its chip is this tall (CSS px), at this presence, its lines this thick (× the line pitch).
   */
  chips: { max: 64, minPx: 1, greekPx: 18, greekAlpha: 0.42, greekWeight: 0.3 },
  /**
   * The live inside's GATE: the face's short side on screen, CSS px. Under it the face is drawn by the
   * mini mat itself (the lattice and the chips); across it the nested desk fades in over them; past it
   * the face is the nested desk, the flight's first frame.
   */
  gate: [140, 220] as const,
} as const;

/**
 * The MARKS — the desk's chrome as the renderer draws it over every object (stratum 5; design-015 §7,
 * D4a): *Marks on the Mat* v2 (claude.ai artifact W9xB23bF9JkSoZhxqKpjaQ, sources
 * `vibe-field/draft/desk-chrome/`; Q-a…Q-k agreed 2026-09-25), its proposed DESIGN.md §14 "the
 * desk's hands". Every mark has one hand and every hand one ink: YOU draw in the PENCIL — the
 * selection's focus brackets, a several's union and its members' ticks, the knobs, the vellum
 * marquee, your extent on the rulers (`--vf-select`'s hue, OKLCH 252°, lifted to L .76: 3.62:1 on
 * the lit mat) — with a dark KEYLINE under every stroke so it holds on paper and on the whiteboard;
 * the DESK states facts about space in the LASER — the snap guides, the equal gaps and their numbers
 * — which is light, so it is ADDED; and the TAPE is masking tape across a taped object's top corners,
 * an attachment of the OBJECT (it zooms with it) and so moonlit by night, where the pencil and the
 * laser are light and the Moon does not dim them (Q-k). Lengths are SCREEN px (the chrome keeps its
 * size at every zoom) unless named; the numbers are chrome.js's `CHROME`/`INK` and its `drawSelection`
 * · `drawMember` · `drawUnion` · `drawMarquee` · `drawGuides` · `flare` · `pill` · `drawRulerBand`,
 * number for number, and desk.css's tape; the clocks are the page's §14 motion table (ms).
 */
export const MARKS = {
  /** The inks, each with its token (the page's §14; desk.css; chrome.js `INK`). */
  inks: {
    pencil: { token: "--desk-pencil (Marks on the Mat §14, proposed)", css: "#79b5f8" },
    /** The keyline under a pencil stroke: the mat's cast at 34 % (`--desk-keyline`). */
    keyline: { token: "--desk-keyline — the tree-shadow design's `--cast-rgb`", css: "rgb(14 26 10 / .34)" },
    /** A resize knob's face: chrome.js `INK.paper`. */
    paper: { token: "chrome.js INK.paper", css: "#fffdf8" },
    laser: { token: "--desk-laser (the bloom, added)", css: "#ff2e93" },
    laserLine: { token: "--desk-laser-line", css: "#ff4fa3" },
    laserCore: { token: "--desk-laser-core (5.94:1 on the lit mat)", css: "#ffd6ea" },
    /** The pencil pill's numerals: the tray's ink (`--desk-ink`, solid); the laser pill's: white. */
    tray: { token: "--desk-ink, solid (the tree-shadow design's `--ink`)", css: "#100904" },
    white: { token: "chrome.js `pill` — the laser pill's numerals", css: "#ffffff" },
    tape: { token: "--desk-tape", css: "rgb(238 228 204 / .88)" },
    /** The vellum's veil: cream by day, a cool milk by night (chrome.js `drawMarquee`). */
    vellumDay: { token: "chrome.js vellum, day", css: "rgb(255 250 238 / .11)" },
    vellumNight: { token: "chrome.js vellum, night", css: "rgb(214 226 255 / .07)" },
  },
  /** The keyline is this much wider than the stroke it lies under. */
  keyline: { grow: 2 },
  /** One object selected: the frame 6 out, brackets reaching 16 (≤ 30 % of a side, never under r + 2), 1.5 thick, the hairline between them one DEVICE px at 42 %, the corner r + 6 ≤ 10; the lock-on arrives from 8 further out, its presence full by 1/2.2 of the way; knobs (radius 3.5, a cast ring 1 wider at 28 %) where the object resizes; under 24 px on screen, one ring. */
  select: { gap: 6, reach: 16, share: 0.3, minOverR: 2, stroke: 1.5, hair: 0.42, radiusMax: 10, arrive: 8, rise: 2.2, knob: 3.5, knobShadow: 0.28, knobStroke: 1.5, collapse: 24 },
  /** A member of several: quiet ticks — 4 out, reaching 8, 1.25 thick, at 62 %; the union carries the weight. */
  member: { gap: 4, reach: 8, radiusMax: 8, stroke: 1.25, alpha: 0.62 },
  /** Several: one union, 10 out, square to the mat, its corner 4. */
  union: { gap: 10, radius: 4 },
  /** The vellum: its pencil edge at 80 % (one device px), brackets reaching 12 at its corners once both sides pass 14, the count riding the cursor at +14, +18. */
  marquee: { edge: 0.8, reach: 12, minSide: 14, count: [14, 18] as const },
  /** A number the desk states: 10 px mono, 8 wider than its text, 15 tall, corner 3.5. */
  pill: { size: 10, pad: 8, height: 15, radius: 3.5 },
  /**
   * The laser: a faint line wall to wall (3 px at 12 %, then 1 device px + 0.5 at 34 %, both added), and between the
   * objects it aligns, 14 past them, the bloom (9 · 5 · 2.6 px at 7 · 16 · 32 %, added) under a 1.25 px line at 95 %
   * with a 0.6 px core at 95 %; a centre is dotted (a dot every 4.51 px: the bloom 0.7 as wide, the line 2, the core 1);
   * a new alignment strikes at 1.8×; a flare (radius 7) at every aligned corner; a gap, a 4 px bloom at 18 % under a
   * 1.1 px line with 4 px ticks at its ends, its number in a laser pill on it (off it, under 26 px).
   */
  laser: {
    wall: [[3, 0.12], [0.5, 0.34]] as const, bloom: [[9, 0.07], [5, 0.16], [2.6, 0.32]] as const,
    line: 1.25, core: 0.6, alpha: 0.95, dotted: { period: 4.51, bloom: 0.7, line: 2, core: 1 }, past: 14, strike: 0.8,
    flare: { radius: 7, stop: 0.25, core: 0.9, mid: 0.55 },
    bar: { bloom: [4, 0.18] as const, line: 1.1, tick: 4, pillFrom: 26, off: [16, 14] as const },
  },
  /** Your extent on the rulers (the mat's RULER band): a pencil wash at 16 %, its edges at 95 %, the edge coordinates 4 off them, 7 up from the band's inner line, over a 3 px cast halo at 55 %; a guide ticks the band in laser (1.5 px at 90 %, added). */
  ruler: { wash: 0.16, edge: 0.95, label: { gap: 4, lift: 7, halo: 1.5, haloAlpha: 0.55 }, tick: { width: 1.5, alpha: 0.9, inset: 3 } },
  /** Masking tape (desk.css `.obj-tape`): two strips 60 × 17 (object units) crossing the top corners, 5 over the top edge and 20 past each side, turned 37°; fibres 1 in 3 at 10 % white, a light from above (18 % white → 4 % black); moonlit by night. */
  tape: { w: 60, h: 17, over: 5, past: 20, turn: 37, fibre: { every: 3, alpha: 0.1 }, sheen: [0.18, 0.04] as const, night: { saturate: 0.3, brightness: 0.46 }, press: 1.22 },
  /** The clocks, ms: the lock-on (on `--vf-ease-lift`) and the leave; several's union and its fade; the vellum's fold (`--vf-ease-island`); the strike; the tape pressed (the second strip 60 later) and lifted; the tape's GIVE — a drag that meets it shivers 2.2 px and settles. */
  clocks: { lockOn: 180, leave: 120, union: 220, unionFade: 120, fold: 240, strike: 160, tapePress: 240, tapeStagger: 60, tapeLift: 160, give: 360 },
  give: { px: 2.2, rate: 44 },
} as const;

/** Everything the passes read, as numbers. */
export interface GroundTheme {
  readonly name: ThemeName;
  /** The clear colour — what shows where nothing is drawn (the mat covers it at rest). */
  readonly canvasBg: RGB;
  /** §2.5 the selection ring. */
  readonly select: RGB;
  /** The cutting mat's light (mat/night.ts): the Sun by day, the Moon by night. */
  readonly matLight: MatLight;
}

/** A theme from a palette — the host's projection (lab/theme.ts builds VibeField's two). */
export function themeFrom(name: ThemeName, p: Palette): GroundTheme {
  return { name, canvasBg: rgb(p.canvasBg.css), select: rgb(p.select.css), matLight: MAT_LIGHT[name] };
}
