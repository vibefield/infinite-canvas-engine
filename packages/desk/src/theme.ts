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

/** The night's model, for a host that rebuilds the Moon from its own numbers (the desk's dev panel — D5a; the prototype's lab/params.ts). */
export { dayLuminance, type MatLight, nightLight } from "./mat/night";

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
 * The PORTAL's law (PORTAL.md §2.5, MINIMAT.md §5) — the live inside's GATE: a container's face shows its live inside
 * only when its short side on screen is at least `lo` CSS px, fading in fully by `hi` (the rung law applied to portals).
 * Under it the face is drawn by the container itself (the mini mat's lattice and chips); across it the nested desk fades
 * in over them; past it the face is the nested desk, the flight's first frame. The engine's (nav/portal.ts
 * `PORTAL_GATE`) since K4a — the mini mat's law (minimat/theme.ts) takes it by name, and the kinds' specs moved to their
 * own folders (paper/, notebook/, board/, minimat/ `theme.ts`; the hand's law to kit/text.ts; what they share to
 * kit/physics.ts).
 */
export const PORTAL = { gate: [140, 220] as const } as const;

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

/**
 * THE PEGBOARD TRAY (design-017 §6.5–§6.6; K3) — the research board (research/sdf-pegboard, shader.js) under the desk's light. The
 * face is its own render's (preview.jpg): lit flat, a flat face is drawn at this byte (the paper's law — a configured byte is the
 * drawn byte). The punched edge keeps the research's edge/face albedo ratio; the plaster is its WALL_ALB. The cavity is the share of
 * the room's light on the wall in a hole — at the hole's edge, at its heart, over what width (pitches) — fitted to the render's
 * shadowed wall (#45443f); the lamp's angular radius is the research's HOME lamp (D-K3.5: the desk's object-shadow law, σ ≈ 0.9 px
 * per px of height, would wash the slots out at this scale).
 */
export const TRAY = {
  face: { token: "research/sdf-pegboard preview.jpg — the face, lit flat", css: "#cdb491" },
  /** shader.js FACE_ALB · EDGE_ALB · WALL_ALB, linear. */
  research: { face: [0.42, 0.26, 0.135], edge: [0.56, 0.41, 0.25], wall: [0.74, 0.72, 0.68] },
  cavity: { edge: 0.1, heart: 0.22, width: 0.13 },
  lampSize: 0.06,
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
