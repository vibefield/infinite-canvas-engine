// VibeField's projection into the ground — the PRODUCT's half of the theme, as a
// FIXTURE: the desk oracle's palette and apps/desk's parity page's (design-015 D1,
// the D-B1.6 precedent). This is the prototype's lab/theme.ts, moved verbatim;
// nothing in @ice/desk's src/ imports it.
//
// Every colour here is a token from `vibe-field/DESIGN.md` (§2 Color), or a
// desk material transcribed WITH ITS NAME from the tree-shadow design system
// (research/tree-shadow/prototype/design/mat.css), the same discipline as
// `packages/design-kit/src/tokens.css`: the doc moves first, then this file.
// `test/vf-theme.test.ts` cross-checks the tokens against the real tokens.css
// and DESIGN.md when the repo is beside us. At the fold this file does not
// move: it is the shape field-app's `canvas-appearance.ts` takes, reading
// `--vf-*` off the stamped root instead of transcribing. The engine's half —
// the types, the parser, `themeFrom`, the mat and the desk's materials — is
// `src/theme.ts`. Transcribed 2026-09-01; split out 2026-09-07. The card
// chrome's roles, the cards' committed surfaces and the product's magnet grid
// retired with the cards and the dot and needle grids on 2026-09-25.

import { cssColor, type GroundTheme, type Palette, type RGB, type RGBA, rgb, themeFrom, type ThemeName } from "../../src/theme";

export const PALETTE: Record<ThemeName, Palette> = {
  light: {
    canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" },
    select: { token: "--vf-select", css: "#4a90d9" },
  },
  dark: {
    canvasBg: { token: "--vf-canvas-bg", css: "#171717" },
    select: { token: "--vf-select", css: "#4a90d9" },
  },
};

/**
 * §2.2 committed content surfaces the desk's paper takes — a note's colour, carried across BOTH
 * themes like an iOS widget on any wallpaper (the LIGHT is the desk's).
 */
export const SURFACES = {
  note: { token: "--vf-note-surface", css: "#f6e7a9" },
} as const;
export type SurfaceName = keyof typeof SURFACES;
export const surface = (name: SurfaceName): RGB => rgb(SURFACES[name].css);

/**
 * The NOTEBOOK's materials (BOOK.md) — the tree-shadow design system's paper layer
 * (research/tree-shadow/prototype/design/mat.css, the cutting mat's own UI system),
 * transcribed by token: `--cream` is a page ("text on the mat, primary paper"), `--paper` an
 * endpaper ("index card, secondary paper"), the covers wear `--kraft` · `--ink` · `--cork` ·
 * `--paper` and, the product's own black, `--vf-card` (DESIGN.md §2.2). Rules on paper are
 * ink at 28 % (mat.css `--hair-paper`). Like a card's committed surface, a notebook keeps
 * its colours in both themes; the LIGHT is the desk's.
 */
export const BOOK_PAPER = {
  page: { token: "tree-shadow mat.css --cream", css: "#ffedd7" },
  end: { token: "tree-shadow mat.css --paper", css: "#f6e0c6" },
  rule: { token: "tree-shadow mat.css --hair-paper (--ink at 28 %)", css: "rgb(16 9 4 / 28%)" },
} as const;
export const COVERS = {
  ink: { cover: { token: "tree-shadow mat.css --ink", css: "#100904" }, spine: { token: "tree-shadow mat.css --brass", css: "#c4a574" } },
  kraft: { cover: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" }, spine: { token: "tree-shadow mat.css --ink-2", css: "#382416" } },
  cork: { cover: { token: "tree-shadow mat.css --cork", css: "#c48a52" }, spine: { token: "tree-shadow mat.css --cream", css: "#ffedd7" } },
  paper: { cover: { token: "tree-shadow mat.css --paper", css: "#f6e0c6" }, spine: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" } },
  card: { cover: { token: "--vf-card", css: "#1c1c1e" }, spine: { token: "tree-shadow mat.css --brass-mute", css: "#9a7f55" } },
} as const;
export type CoverName = keyof typeof COVERS;
export const COVER_NAMES = Object.keys(COVERS) as CoverName[];
/** A notebook's look, parsed: its cover and spine, the endpaper and the page every notebook shares, the rule ink. */
export const bookLook = (name: CoverName): { cover: RGB; spine: RGB; end: RGB; paper: RGB; rule: RGBA } =>
  ({ cover: rgb(COVERS[name].cover.css), spine: rgb(COVERS[name].spine.css), end: rgb(BOOK_PAPER.end.css), paper: rgb(BOOK_PAPER.page.css), rule: cssColor(BOOK_PAPER.rule.css) });

/**
 * The PENS a sticky note is written with (STICKY.md §3) — the host's colours, like a
 * card's committed surface: a felt tip's near-black, a ballpoint's blue-black, a
 * fountain pen's blue, a red marker. None is a DESIGN.md token yet; adding the pens
 * to the doc's material book is the step before any of this leaves draft/ (STICKY.md §8).
 */
export const PENS = {
  felt: { token: "STICKY.md §3 felt tip", css: "#2b2a33" },
  ball: { token: "STICKY.md §3 ballpoint", css: "#1f2f5c" },
  fountain: { token: "STICKY.md §3 fountain pen", css: "#264a9a" },
  red: { token: "STICKY.md §3 red marker", css: "#c0392b" },
} as const;
export type PenName = keyof typeof PENS;
export const PEN_NAMES: readonly PenName[] = ["felt", "ball", "fountain", "red"];
export const pen = (name: PenName): RGB => rgb(PENS[name].css);

/**
 * The WHITEBOARD's materials (BOARD.md) — the board's own colours, kept in both themes like a
 * card's committed surface; the LIGHT is the desk's. The melamine is the research board's
 * albedo as it displays (research/whiteboard board.wgsl); the frame is anodised aluminium in
 * the tree-shadow design's warm greys ("no neutral grey — greys are grey-brown"); the eraser
 * wears the design's `--kraft` back and `--ink-2` felt. None is a DESIGN.md token yet; the doc's
 * material book moves first before any of this leaves draft/ (BOARD.md §8).
 */
export const BOARD_LOOK = {
  surface: { token: "research/whiteboard melamine (board.wgsl albedo, displayed)", css: "#f3f2ed" },
  frame: { token: "anodised aluminium, warm (tree-shadow: greys are grey-brown)", css: "#cdc7ba" },
  barrel: { token: "a marker's barrel, warm white plastic", css: "#ece8e0" },
  felt: { token: "tree-shadow mat.css --ink-2 (the eraser's felt)", css: "#382416" },
  wood: { token: "tree-shadow mat.css --kraft (the eraser's back)", css: "#d9b57c" },
} as const;
/** The board's colours, parsed. */
export const boardLook = (): { surface: RGB; frame: RGB; barrel: RGB; felt: RGB; wood: RGB } =>
  ({ surface: rgb(BOARD_LOOK.surface.css), frame: rgb(BOARD_LOOK.frame.css), barrel: rgb(BOARD_LOOK.barrel.css), felt: rgb(BOARD_LOOK.felt.css), wood: rgb(BOARD_LOOK.wood.css) });

/**
 * The dry-erase MARKERS — the research whiteboard's inks (research/whiteboard tools.ts `MARKERS`)
 * and the coverage one pass of each lays. Its orange is dropped: orange is the desk's `--hot`,
 * reserved for state (the tree-shadow design). Content colours, like the note's pens.
 */
export const MARKERS = {
  black: { token: "research/whiteboard black marker", css: "#1b1c20", opacity: 0.985 },
  blue: { token: "research/whiteboard blue marker", css: "#2350b5", opacity: 0.97 },
  red: { token: "research/whiteboard red marker", css: "#c92a2e", opacity: 0.96 },
  green: { token: "research/whiteboard green marker", css: "#1e8f4e", opacity: 0.95 },
} as const;
export type MarkerName = keyof typeof MARKERS;
export const MARKER_NAMES: readonly MarkerName[] = ["black", "blue", "red", "green"];
export const marker = (name: MarkerName): RGB => rgb(MARKERS[name].css);

/**
 * The marker TRAY — the board's tools while it is open: the tree-shadow design's INK layer
 * (mat.css: 94 % ink, cream on it, brass for mono labels, `--hot` for the active tool only, the
 * shadows cast lower-left in the world's darkest value). The tray's stylesheet names these as
 * custom properties; the values are set from here, so no colour lives in its CSS.
 */
export const TRAY = {
  ink: { token: "tree-shadow mat.css --ink", css: "#100904" },
  cream: { token: "tree-shadow mat.css --cream", css: "#ffedd7" },
  brass: { token: "tree-shadow mat.css --brass", css: "#c4a574" },
  brassMute: { token: "tree-shadow mat.css --brass-mute", css: "#9a7f55" },
  hot: { token: "tree-shadow mat.css --hot", css: "#dc5000" },
  cast: { token: "tree-shadow mat.css --cast-rgb", css: "rgb(14 26 10)" },
} as const;

/**
 * The MINI MATS' vinyls (MINIMAT.md §2) — the colours a self-healing mat is sold in, and the desk a
 * mini mat opens onto: enter a slate mini mat and the whole desk is slate. `sage` is the desk's own
 * (MAT.ground, whatever the panel has made it). Each is the colour the mat's chain STARTS from (the
 * reference's double gamma darkens it, as it darkens the sage to #3d5a30): slate shows as #34505a,
 * charcoal as #1e221e. None is a DESIGN.md token yet; the doc's material book moves first (§8).
 */
export const VINYLS = {
  slate: { token: "a blue self-healing mat (shows #34505a through the mat's chain)", css: "#7d98a0" },
  charcoal: { token: "a black self-healing mat, green-black (shows #1e221e — no pure black on the desk)", css: "#616661" },
} as const;
export type VinylName = "sage" | keyof typeof VINYLS;
export const VINYL_NAMES: readonly VinylName[] = ["sage", "slate", "charcoal"];
/** A vinyl's colour: the desk's own sage (`sage`, the host's), or one of the others. */
export const vinyl = (name: VinylName, sage: RGB): RGB => (name === "sage" ? sage : rgb(VINYLS[name].css));

/** VibeField's two themes, as the passes read them. */
export const THEMES: Record<ThemeName, GroundTheme> = {
  light: themeFrom("light", PALETTE.light),
  dark: themeFrom("dark", PALETTE.dark),
};

/**
 * The 3D NOTEBOOK's materials (NOTEBOOK.md §4) — five covers after the Paper app's shelf (a
 * cloth or paper case, a band of cloth down the spine, a printed design) in the tree-shadow
 * design system's paper layer (research/tree-shadow/prototype/design/mat.css), plus the page's
 * own ivory. Every colour by token; the two that are not a mat.css token say what they are.
 * Like a card's committed surface, a notebook keeps its colours in both themes; the LIGHT is
 * the desk's. `--hot` is left out on purpose: the mat's orange is for state, never a cover.
 */
export const NOTEBOOK_LOOK = {
  /** The page: an ivory a shade cooler than `--cream`, so the ink's dots and the dapple read on it. */
  paper: { token: "notebook ivory (a writing paper's white: warmer than --vf-canvas-bg, cooler than --cream)", css: "#f3ebdc" },
  /** The ruling's dots and the label's rules. */
  ink: { token: "tree-shadow mat.css --ink-3", css: "#6c5f51" },
  covers: {
    ink: {
      cloth: { token: "bookcloth black (tree-shadow --ink, lifted to a cloth's black so the weave reads)", css: "#221b16" },
      band: { token: "tree-shadow mat.css --brass", css: "#c4a574" },
      a: { token: "tree-shadow mat.css --brass", css: "#c4a574" }, b: { token: "tree-shadow mat.css --cream", css: "#ffedd7" }, c: { token: "tree-shadow mat.css --cork", css: "#c48a52" },
      endpaper: { token: "tree-shadow mat.css --paper", css: "#f6e0c6" },
      design: "plain", paperCover: false,
    },
    orbit: {
      cloth: { token: "tree-shadow mat.css --ink-2", css: "#382416" },
      band: { token: "tree-shadow mat.css --cork", css: "#c48a52" },
      a: { token: "tree-shadow mat.css --brass", css: "#c4a574" }, b: { token: "tree-shadow mat.css --cream", css: "#ffedd7" }, c: { token: "tree-shadow mat.css --cork", css: "#c48a52" },
      endpaper: { token: "tree-shadow mat.css --cream", css: "#ffedd7" },
      design: "orbit", paperCover: false,
    },
    tiles: {
      cloth: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" },
      band: { token: "tree-shadow mat.css --ink-2", css: "#382416" },
      a: { token: "tree-shadow mat.css --ink-2", css: "#382416" }, b: { token: "tree-shadow mat.css --cream", css: "#ffedd7" }, c: { token: "tree-shadow mat.css --cork", css: "#c48a52" },
      endpaper: { token: "tree-shadow mat.css --ink-2", css: "#382416" },
      design: "tiles", paperCover: false,
    },
    label: {
      cloth: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" },
      band: { token: "tree-shadow mat.css --ink-2", css: "#382416" },
      a: { token: "tree-shadow mat.css --ink-2", css: "#382416" }, b: { token: "tree-shadow mat.css --cream", css: "#ffedd7" }, c: { token: "tree-shadow mat.css --brass", css: "#c4a574" },
      endpaper: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" },
      design: "label", paperCover: true,
    },
    linen: {
      cloth: { token: "tree-shadow mat.css --paper", css: "#f6e0c6" },
      band: { token: "tree-shadow mat.css --brass-mute", css: "#9a7f55" },
      a: { token: "tree-shadow mat.css --brass", css: "#c4a574" }, b: { token: "tree-shadow mat.css --cream", css: "#ffedd7" }, c: { token: "tree-shadow mat.css --cork", css: "#c48a52" },
      endpaper: { token: "tree-shadow mat.css --cream", css: "#ffedd7" },
      design: "bordered", paperCover: false,
    },
  },
} as const;
export type NotebookCover = keyof typeof NOTEBOOK_LOOK.covers;
export const NOTEBOOK_COVERS = Object.keys(NOTEBOOK_LOOK.covers) as NotebookCover[];
/** A cover's look, parsed: what the notebook pass's record takes. */
export const notebookLook = (name: NotebookCover): { cloth: RGB; band: RGB; accents: [RGB, RGB, RGB]; endpaper: RGB; paper: RGB; ink: RGB; design: "plain" | "orbit" | "tiles" | "label" | "bordered"; paperCover: boolean } => {
  const c = NOTEBOOK_LOOK.covers[name];
  return { cloth: rgb(c.cloth.css), band: rgb(c.band.css), accents: [rgb(c.a.css), rgb(c.b.css), rgb(c.c.css)], endpaper: rgb(c.endpaper.css), paper: rgb(NOTEBOOK_LOOK.paper.css), ink: rgb(NOTEBOOK_LOOK.ink.css), design: c.design, paperCover: c.paperCover };
};
/** The ruling's ink with its presence on the page. */
export const notebookRuleInk = (): RGBA => [...rgb(NOTEBOOK_LOOK.ink.css), 0.55] as unknown as RGBA;

/**
 * The DESK CALENDAR's materials (CALENDAR.md §4) — a pad of the notebook's own ivory under a cloth
 * tape, printed in the tree-shadow design's inks: the dates and the month in `--ink-2`, the year,
 * the eyebrows and the weekend in `--ink-3`, the weekend's columns washed with `--kraft`; today is
 * `--hot` (a state — "what is happening"), ringed by a marker. The pens are the sticky note's; the
 * highlighters are new: the fluorescents a desk has, muted to sit on the ivory under the mat's
 * light (the shader lays them in by MULTIPLY, as a highlighter's dye does). The chipboard back is
 * kraft gone grey. None is a DESIGN.md token yet — the doc's material book moves first (§12).
 */
export const CALENDAR_LOOK = {
  paper: { token: "notebook ivory (NOTEBOOK_LOOK.paper — the desk's one writing paper)", css: "#f3ebdc" },
  ink: { token: "tree-shadow mat.css --ink-2", css: "#382416" },
  muted: { token: "tree-shadow mat.css --ink-3", css: "#6c5f51" },
  weekend: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" },
  hot: { token: "tree-shadow mat.css --hot (a state: today)", css: "#dc5000" },
  pencil: { token: "graphite — a warm grey-brown (the design has no neutral grey)", css: "#5f574f" },
  chipboard: { token: "chipboard — kraft gone grey (the pad's back)", css: "#9c8b76" },
  /** The presences: the rules, the heading rule, the weekend's wash, a neighbour month's wash and its dates, a highlighter. */
  alpha: { rule: 0.3, head: 0.62, weekend: 0.1, outside: 0.06, faint: 0.26, highlight: 0.62 },
  tapes: {
    ink: { cloth: { token: "bookcloth black (NOTEBOOK_LOOK.covers.ink)", css: "#221b16" }, foil: { token: "tree-shadow mat.css --brass", css: "#c4a574" } },
    tobacco: { cloth: { token: "tree-shadow mat.css --ink-2", css: "#382416" }, foil: { token: "tree-shadow mat.css --cork", css: "#c48a52" } },
    kraft: { cloth: { token: "tree-shadow mat.css --kraft", css: "#d9b57c" }, foil: { token: "tree-shadow mat.css --ink-2", css: "#382416" } },
  },
  highlighters: {
    yellow: { token: "highlighter yellow", css: "#f2d64f" },
    green: { token: "highlighter green", css: "#b4d98a" },
    pink: { token: "highlighter pink", css: "#f0a9bf" },
    blue: { token: "highlighter blue", css: "#a3cde8" },
    orange: { token: "highlighter orange", css: "#f4b673" },
  },
} as const;
export type CalendarTape = keyof typeof CALENDAR_LOOK.tapes;
export const CALENDAR_TAPES = Object.keys(CALENDAR_LOOK.tapes) as CalendarTape[];
export type HighlighterName = keyof typeof CALENDAR_LOOK.highlighters;
export const HIGHLIGHTER_NAMES = Object.keys(CALENDAR_LOOK.highlighters) as HighlighterName[];
/** A colour as the Canvas 2D takes it, with a presence. */
const cssOf = (c: RGB, a = 1): string => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
/** The print's colours, for the raster (lab/calendar-print.ts `PrintLook`). */
export const calendarPrint = () => {
  const L = CALENDAR_LOOK;
  const pens: Record<string, string> = {};
  for (const name of PEN_NAMES) pens[name] = cssOf(pen(name));
  const highlighters: Record<string, string> = {};
  for (const name of HIGHLIGHTER_NAMES) highlighters[name] = cssOf(rgb(L.highlighters[name].css));
  return { ink: cssOf(rgb(L.ink.css)), muted: cssOf(rgb(L.muted.css)), faint: L.alpha.faint, hot: cssOf(rgb(L.hot.css)), pencil: cssOf(rgb(L.pencil.css), 0.55), pens, highlighters, highlight: L.alpha.highlight };
};
/** The pad's materials, for the pass: the paper, the print's rules and wash, the chipboard, the tape's cloth and foil. */
export const calendarLook = (tape: CalendarTape): { paper: RGB; ink: RGB; muted: RGB; weekend: RGB; hot: RGB; chipboard: RGB; cloth: RGB; foil: RGB; alpha: typeof CALENDAR_LOOK.alpha } => {
  const L = CALENDAR_LOOK;
  const t = L.tapes[tape];
  return { paper: rgb(L.paper.css), ink: rgb(L.ink.css), muted: rgb(L.muted.css), weekend: rgb(L.weekend.css), hot: rgb(L.hot.css), chipboard: rgb(L.chipboard.css), cloth: rgb(t.cloth.css), foil: rgb(t.foil.css), alpha: L.alpha };
};

/**
 * The inks a PERSON takes in apps/desk's rooms (D5a) — the colour `@ice/dom`'s remote-cursors reflector paints a peer's cursor and
 * name chip in (core's `PresenceInfo.color`): violet and the warm hues, which read over the green mat by day and under the Moon;
 * none a green of the mat's, none the pencil's blue (YOUR hand's). A demo's choice, not yet a DESIGN.md token.
 */
export const PRESENCE_INKS = ["#8e4ec6", "#e2a336", "#e5484d", "#d6409f", "#f76b15"] as const;
