// Oracle scenes: rendered headless by render.mjs, diffed against the lab in Chrome by `ab.mjs oracle`.
// Every scene is a STILL: its clocks pinned, the baked projector, the blue noise at a fixed offset.
// The desk is the cutting mat (the dot and the needle, and the cards, retired on 2026-09-25 —
// MINIMAT.md §1); on it lie notes and MINI MATS, each mini mat holding a desk of its own.

const base = { camX: 13.7, camY: -21.3, theme: "dark" };
const matStill = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };

export const ORACLE_SCENES = [
  // The cutting mat alone: the lines; the gobo at the reference's time and a mid-blur plate; zoomed out past the cone; the canopy plate close up.
  { name: "mat-lines-z1", baseline: true, scene: { ...base, theme: "light", zoom: 1, mat: { opacity: 0 } } },
  { name: "mat-gobo-z1", baseline: true, scene: { ...base, theme: "light", zoom: 1, mat: matStill } },
  { name: "mat-gobo-z0.2", baseline: true, scene: { ...base, theme: "light", camX: -2400, camY: -1500, zoom: 0.2, mat: matStill } },
  { name: "mat-gobo-b-z6.3", baseline: true, scene: { ...base, theme: "light", zoom: 6.31, mat: { time: 1.2, goboTime: 12.5, noise: [0.8, 0.15], plate: "b" } } },
  // …and the same mat by NIGHT (MAT.md) — the dark theme: the Moon, the mesopic eye, Eigengrau. `night` runs the check.
  { name: "mat-night-lines-z1", baseline: true, scene: { ...base, zoom: 1, mat: { opacity: 0 } } },
  { name: "mat-night-z1", baseline: true, night: true, scene: { ...base, zoom: 1, mat: matStill } },
  { name: "mat-night-z0.2", baseline: true, scene: { ...base, camX: -2400, camY: -1500, zoom: 0.2, mat: matStill } },
  { name: "mat-night-b-z6.3", baseline: true, scene: { ...base, zoom: 6.31, mat: { time: 1.2, goboTime: 12.5, noise: [0.8, 0.15], plate: "b" } } },
];

// The RULERS printed on the mat (RULER.md) — the product's zoom; the mockup's state (zoom 7); the coarse decade; a negative
// camera; by night; a level mid-fade (parity only — `ruler` runs where every presence is 0 or 1).
const rulerBase = { ...base, theme: "light", mat: matStill, ruler: {} };
export const RULER_SCENES = [
  { name: "ruler-z1", ruler: true, scene: { ...rulerBase, zoom: 1 } },
  { name: "ruler-z7-mockup", ruler: true, scene: { ...rulerBase, camX: -52 / 7, camY: -52 / 7, zoom: 7 } },
  { name: "ruler-z0.13-far", ruler: true, scene: { ...rulerBase, camX: -3000, camY: -2200, zoom: 0.13 } },
  { name: "ruler-neg-z2.5", ruler: true, scene: { ...rulerBase, camX: -800, camY: -600, zoom: 2.5 } },
  { name: "ruler-night-z1", ruler: true, scene: { ...rulerBase, theme: "dark", zoom: 1 } },
  { name: "ruler-z55-midfade", scene: { ...rulerBase, camX: -1, camY: -1, zoom: 55 } },
];
ORACLE_SCENES.push(...RULER_SCENES.map((s) => ({ ...s, baseline: true })));

// The STICKY NOTES (STICKY.md) — three sheets: one carrying the committed ink raster (tools/make-ink-raster.mjs; both hosts
// sample the same bytes at the same texels), a blank one, a selected blank one. By day and by night; zoomed in (parity only);
// one held; with no light on the desk (the token's byte is the drawn byte); through the mat's own chain (the golden note).
const INK = { asset: "note-1", text: "buy milk\ncall mum back\nfix the desk lamp", seed: 7, w: 200, h: 200 };
const paperBase = { ...base, theme: "light", mat: matStill };
const NOTES = [{ x: 300, y: 250, ...INK }, { x: 560, y: 330, seed: 11, text: "" }, { x: 830, y: 240, seed: 5, text: "", selected: true }];
export const PAPER_SCENES = [
  { name: "paper-z1", paper: true, scene: { ...paperBase, zoom: 1, notes: NOTES } },
  { name: "paper-night-z1", paper: true, scene: { ...paperBase, theme: "dark", zoom: 1, notes: NOTES } },
  { name: "paper-z2.5", scene: { ...paperBase, zoom: 2.5, camX: 200, camY: 170, notes: NOTES } },
  { name: "paper-held-z1.6", paper: true, scene: { ...paperBase, zoom: 1.6, camX: 150, camY: 120, notes: NOTES.map((n, i) => (i === 1 ? { ...n, held: true } : n)) } },
  { name: "paper-nolight-z1", paper: true, token: true, scene: { ...paperBase, zoom: 1, mat: { ...matStill, opacity: 0 }, notes: NOTES } },
  { name: "paper-golden-z1", paper: true, scene: { ...paperBase, zoom: 1, notes: NOTES, paper: { chain: true } } },
];
ORACLE_SCENES.push(...PAPER_SCENES.map((s) => ({ ...s, baseline: true })));

export const VIEW = { cssW: 1200, cssH: 800, dpr: 2 };

// ---------------------------------------------------------------- the MINI MATS (MINIMAT.md)
//
// A desk of four mini mats at 1:1 — A holding a desk of notes and a mini mat of its own, its face past the gate (the live
// inside); C mid-gate (the inside's objects half in, the chips half out); D under it (the far LOD: the lattice and the chips,
// the writing greeked); E empty. A note of the desk lies over A's border. The GREEK lines a scene states are each note's
// lines of writing (baseline, width, note units) — what the lab takes from the hand's layout, stated so the two hosts agree.
const greek3 = [[36, 96], [64, 150], [92, 168]];
const greek2 = [[36, 132], [64, 88]];
const note = (x, y, seed, extra = {}) => ({ x, y, seed, text: "", greek: seed % 2 ? greek3 : greek2, ...extra });
const insideA = {
  notes: [note(-420, -250, 3, { ...INK, greek: greek3 }), note(-160, -260, 8), note(120, -240, 13), note(-300, 20, 21, { pen: "ball" }), note(-40, 60, 34)],
  minimats: [{ x: 340, y: 120, w: 420, h: 320, name: "Sketches", inside: { notes: [note(-120, -60, 5), note(110, -40, 9), note(-10, 120, 12)], minimats: [] } }],
};
const insideC = { notes: [note(-200, -80, 4), note(40, -100, 6), note(-60, 140, 10)], minimats: [] };
const insideD = { notes: [note(-260, -120, 7), note(0, -130, 11), note(240, -110, 15), note(-130, 110, 17), note(120, 120, 19)], minimats: [{ x: 460, y: 20, w: 300, h: 220, inside: { notes: [note(0, 0, 2)], minimats: [] } }] };
export const DESK = [
  { x: 380, y: 330, w: 640, h: 480, name: "Studio notes", inside: insideA },
  { x: 915, y: 175, w: 300, h: 240, name: "Errands", inside: insideC },
  { x: 985, y: 555, w: 250, h: 190, name: "Reading list", inside: insideD },
  { x: 1120, y: 745, w: 170, h: 140, name: "Empty", inside: { notes: [], minimats: [] } },
];
// (the desk's own notes carry no text: the oracle renders none, so a written one would read blank here and in the hand in Chrome.
// The first stands for a WRITTEN note — its greek stated — whose ink is never laid: at far it greeks (K7b's zoom and nav
// goldens), and since K9 R6 at ANY size while it holds no raster, so the desk-z1, near-z2.2, far-z0.35, selected-held, chain and
// nav-enter-p0 stills show its greek at full where they showed a blank sheet; the second carries no greek — a blank sheet at every size)
export const deskNotes = [note(700, 610, 23), note(640, 80, 27, { greek: undefined })];
// K9 R6 — THE PENDING RASTER: a written note (its greek stated, as the desk states it from the layout) whose ink is not laid —
// on the frame queue's way, or let go at far and not yet back — draws its greek at FULL at any size, never a blank sheet; the
// blank note beside it (no greek) is the contrast. Before K9 R6 the first sheet read blank at zoom 1 (far = 0 above 64 CSS px).
ORACLE_SCENES.push({ name: "paper-greek-pending-z1", scene: { ...paperBase, zoom: 1, notes: [{ x: 300, y: 250, seed: 7, text: "", greek: greek3 }, { x: 560, y: 330, seed: 11, text: "" }] } });
const mmBase = { ...base, theme: "light", mat: matStill, camX: 0, camY: 0 };
export const MINIMAT_SCENES = [
  { name: "minimat-desk-z1", sealed: true, lod: true, scene: { ...mmBase, zoom: 1, minimats: DESK, notes: deskNotes } },
  { name: "minimat-desk-night-z1", scene: { ...mmBase, theme: "dark", zoom: 1, minimats: DESK, notes: deskNotes } },
  { name: "minimat-far-z0.35", scene: { ...mmBase, camX: -500, camY: -380, zoom: 0.35, minimats: DESK, notes: deskNotes } },
  { name: "minimat-near-z2.2", scene: { ...mmBase, camX: 30, camY: 60, zoom: 2.2, minimats: DESK, notes: deskNotes } },
  { name: "minimat-selected-held-z1", scene: { ...mmBase, zoom: 1, minimats: DESK.map((m, i) => (i === 1 ? { ...m, selected: true } : i === 2 ? { ...m, held: true, selected: true } : m)), notes: deskNotes } },
  // the light: the desk's dapple across a mini mat — the same mini mat lit by its inside's own lamp is the control (MINIMAT.md §4)
  { name: "minimat-light-z1", light: true, scene: { ...mmBase, zoom: 1, minimats: [{ x: 600, y: 400, w: 800, h: 560, inside: { notes: [], minimats: [] } }], notes: [] } },
  // the far LOD alone: live insides off — the lab's and the oracle's `portals: false`
  { name: "minimat-farlod-z1", scene: { ...mmBase, zoom: 1, portals: false, minimats: DESK, notes: deskNotes } },
];
ORACLE_SCENES.push(...MINIMAT_SCENES);

// THE CHAIN (PORTAL.md §10): a mini mat nearly filling the view holds a desk three viewports wide, so its arrival is clamped
// at zoom 0.5 and a mini mat at its far right lands half outside the parent's face — the half outside must show nothing.
// (the content spans x −2750 … 3150, so the face shows the inside from x −1088 to 1488: the mini mat at 1400 straddles its right edge)
const wideInside = { notes: [note(0, 0, 3), note(3050, -200, 6)], minimats: [{ x: 1400, y: 100, w: 640, h: 480, inside: { notes: [note(-100, 0, 5), note(120, 20, 9)], minimats: [] } }, { x: -2600, y: 300, w: 300, h: 220, inside: { notes: [], minimats: [] } }] };
ORACLE_SCENES.push({ name: "minimat-chain-z1", chain: true, scene: { ...mmBase, camX: -600, camY: -400, zoom: 1, minimats: [{ x: 0, y: 0, w: 1120, h: 720, inside: wideInside }], notes: [] } });

// THE FLIGHT (design-006, PORTAL.md §2.4) — a still at one progress, both desks drawn: into A (its face past the gate) at the
// cut, midway and near landing; the way back out; into D from its far LOD (the inside grows through the gate on the way in);
// a tiny mini mat, whose flight is depth-capped and therefore a frozen crossfade. `continuity` and `cut` name the checks.
const navBase = { ...mmBase, minimats: DESK, notes: deskNotes };
export const NAV_SCENES = [
  { name: "nav-enter-p0", continuity: "enter", cut: "enter", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 0, p: 0 } } },
  { name: "nav-enter-p0.5", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 0, p: 0.5 } } },
  { name: "nav-enter-p0.9", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 0, p: 0.9 } } },
  { name: "nav-exit-p0", continuity: "exit", scene: { ...navBase, zoom: 1, nav: { kind: "exit", container: 0, p: 0 } } },
  { name: "nav-exit-p0.5", cut: "exit", scene: { ...navBase, zoom: 1, nav: { kind: "exit", container: 0, p: 0.5 } } },
  { name: "nav-enter-far-p0", cut: "enter-far", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 2, p: 0 } } },
  { name: "nav-enter-far-p0.3", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 2, p: 0.3 } } },
  { name: "nav-enter-far-p0.6", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: 2, p: 0.6 } } },
  { name: "nav-enter-night-p0.5", scene: { ...navBase, theme: "dark", zoom: 1, nav: { kind: "enter", container: 0, p: 0.5 } } },
  { name: "nav-enter-frozen-p0.5", scene: { ...navBase, zoom: 0.25, camX: -600, camY: -400, nav: { kind: "enter", container: 3, p: 0.5 } } },
];
ORACLE_SCENES.push(...NAV_SCENES);

// ---------------------------------------------------------------- the PRINTS (PHOTO.md) and the WHITEBOARDS (BOARD.md)
//
// design-015 D3r-a: the prototype's oracle had no scene of either — its prints lived only in the photo lab, its boards on the
// board bench, both seen through Chrome screenshots. Every scene below is staged exactly as those two pages stage a still
// (apps/desk `rig:proto-parity` draws the same scene in the prototype's own page and holds the two to each other): a print is
// the lab's `addRGBA` body with its pose pinned; a board is the bench's `scene` + `sketch` — its clocks the bench's (the mat's
// time and its noise at 0, the palm at `goboTime`), its rulers off (the bench's atlas is rendered by the page, not committed).
//
// THE PRINTS — the committed picture (tools/make-photo-fixture.mjs), a 6×4 at the note's scale: at rest; HELD (lifted to the
// hand's height by a grab near its right edge, tipped toward the fingers, drooping away from them — the pose the law settles
// to, `stepPhoto` for 3 s, rounded); by night; three overlapping (the top one hovered); far off (the picture's mips); and laid
// BETWEEN two notes, so the desk's things are three runs of two kinds (`things` gives the order; `order` runs the check).
const photoBase = { ...base, theme: "light", mat: matStill };
const PRINT = { x: 520, y: 330, angle: -0.07 };
const HELD = { ...PRINT, height: 24, sx: 0.037, sy: 0.0061, bend: 5, ax: 167.2, ay: 39.9, hold: { gx: 167.2, gy: 39.9, px: 689.58, py: 358.11 } };
const STACK = [{ x: 390, y: 290, angle: 0.09 }, { x: 610, y: 400, angle: -0.06 }, { x: 790, y: 270, angle: 0.03, height: 2.2 }];
export const PHOTO_SCENES = [
  { name: "photo-rest-z1", photo: true, scene: { ...photoBase, zoom: 1, prints: [PRINT] } },
  { name: "photo-held-z1", photo: true, scene: { ...photoBase, zoom: 1, prints: [HELD] } },
  { name: "photo-night-z1", photo: true, scene: { ...photoBase, theme: "dark", zoom: 1, prints: [PRINT] } },
  { name: "photo-stack-z1", photo: true, scene: { ...photoBase, zoom: 1, prints: STACK } },
  { name: "photo-far-z0.15", scene: { ...photoBase, camX: 590 - 600 / 0.15, camY: 335 - 400 / 0.15, zoom: 0.15, prints: STACK } },
  {
    name: "photo-over-note-z1", order: true,
    scene: { ...photoBase, zoom: 1, things: [{ kind: "note", x: 330, y: 300, seed: 5, text: "" }, { kind: "print", x: 520, y: 330, angle: 0.05 }, { kind: "note", x: 700, y: 420, seed: 11, text: "" }] },
  },
  // a print INSIDE a mini mat (design-015 D-D18: prints nest): its face past the gate, the print lit by the lamp of the desk the
  // mini mat lies on (MINIMAT.md §4) — the photo pass's LIT_ELSEWHERE pipeline, as the note's. `lit` runs the check.
  { name: "photo-inside-z1", lit: true, scene: { ...photoBase, camX: 0, camY: 0, zoom: 1, notes: [], minimats: [{ x: 600, y: 400, w: 800, h: 560, inside: { notes: [], minimats: [], prints: [{ x: 0, y: 0, angle: 0.04 }] } }] } },
];
ORACLE_SCENES.push(...PHOTO_SCENES);

// THE WHITEBOARDS — the bench's desk (lab/board-lab.ts: a board and a note beside it; test/harness/board.mjs's camera, the board's
// centre at CSS (540, 420)): at rest, the capped marker lying on it; its ink REPLAYED from a stroke list (a blue bullet line, a
// green fine one, a red chisel one, and the eraser across the blue — the raster is a cache of that history); selected (its
// marks since D4a: the brackets and the knobs — a whiteboard resizes); by night; the ink up close (parity only). `board`, `ink`
// and `marks` name the checks.
const boardBase = { ...base, theme: "light", camX: -120, camY: -540, mat: { time: 0, goboTime: 3.2, noise: [0, 0] } };
const BOARD_NOTE = { x: 830, y: -180, seed: 7, text: "" };
export const BOARD_STROKES = [
  { ink: "blue", tip: "bullet", points: [[40, 60], [90, 48], [150, 52], [200, 70], [230, 100]] },
  { ink: "green", tip: "fine", points: [[60, 200], [120, 185], [180, 205], [240, 190], [300, 210], [360, 195]] },
  { ink: "red", tip: "chisel", points: [[250, 120], [300, 96], [350, 110], [390, 140]] },
  { erase: true, points: [[128, 30], [146, 84]] },
];
const inked = (extra = {}) => ({ x: 420, y: -120, strokes: BOARD_STROKES, ...extra });
export const BOARD_SCENES = [
  { name: "board-rest-z1", board: true, scene: { ...boardBase, zoom: 1, boards: [{ x: 420, y: -120 }], notes: [BOARD_NOTE] } },
  { name: "board-ink-z1", board: true, ink: true, scene: { ...boardBase, zoom: 1, boards: [inked()], notes: [BOARD_NOTE] } },
  { name: "board-selected-z1", marks: true, scene: { ...boardBase, zoom: 1, boards: [inked({ selected: true })], notes: [BOARD_NOTE] } },
  { name: "board-night-z1", board: true, scene: { ...boardBase, theme: "dark", zoom: 1, boards: [inked()], notes: [BOARD_NOTE] } },
  { name: "board-ink-z2.5", scene: { ...boardBase, camX: 200, camY: -260, zoom: 2.5, boards: [inked()], notes: [BOARD_NOTE] } },
];
ORACLE_SCENES.push(...BOARD_SCENES);

// ---------------------------------------------------------------- the NOTEBOOKS (NOTEBOOK.md) and the DESK CALENDARS (CALENDAR.md)
//
// design-015 D3r-b: the prototype's oracle had no scene of either — its books and its pads lived in its main lab, seen through
// Chrome stills (test/harness/{notebook,calendar}.mjs). Each scene below is one of those stills, or staged as they stage one (apps/desk
// `rig:proto-parity` holds every one to the prototype's own main lab): a camera centred on a world point (`at`), the mat's still
// clocks; a book is the lab's `makeBook` from its spec (`nb()`, the harness's: cover orbit, seed 7, square), a pad the lab's `reset`
// + `pose` at the origin — September 2026, the week from Monday. The books carry no ink and the pads no print: a pad's tiles are the
// host's Canvas 2D raster (CALENDAR.md §6), and a page table that names none shows the paper and its ruled grid (MISSING).
//
// THE NOTEBOOKS — closed; open across its spread; held (lifted, tilted toward the hand); laid over a note — the note first in the
// desk's order AND the book first give the same frame: the book's composite is the things' last run (`bookOrder`); by night. `book`
// runs the check where it applies.
const at = (cx, cy, z) => ({ camX: cx - 600 / z, camY: cy - 400 / z, zoom: z });
const deskBase = { theme: "light", mat: matStill };
const nb = (extra = {}) => ({ x: 0, y: 0, angle: 0, cover: "orbit", seed: 7, ...extra });
/** The open spread's centre: the back board's centre less half a spread (W + the spine) — the harness's. */
const spreadX = -(180 + 17) / 2;
export const NOTEBOOK_SCENES = [
  { name: "book-closed-z2.2", book: true, scene: { ...deskBase, ...at(0, 0, 2.2), books: [nb()] } },
  { name: "book-open-z2.2", book: true, scene: { ...deskBase, ...at(spreadX, 0, 2.2), books: [nb({ open: true, left: 30 })] } },
  { name: "book-held-z1.8", book: true, scene: { ...deskBase, ...at(0, 0, 1.8), books: [nb({ cover: "label", held: true, tilt: [0.05, 0.08], selected: true })] } },
  { name: "book-over-note-z1.6", bookOrder: true, scene: { ...deskBase, ...at(-40, 0, 1.6), things: [{ kind: "note", x: -150, y: 30, seed: 5, text: "" }, { kind: "book", ...nb({ angle: 0.04 }) }] } },
  { name: "book-night-z2.2", book: true, scene: { ...deskBase, ...at(spreadX, 0, 2.2), theme: "dark", books: [nb({ open: true, left: 10, cover: "ink" })] } },
];
ORACLE_SCENES.push(...NOTEBOOK_SCENES);

// THE DESK CALENDARS — the whole pad at rest (the harness's `whole`); a month rolling up, pinned at p 0.55 (`rolling`), a note lying
// on the mat beside the pad (drawn after the pad's layer: the slot's scissor must be given back); two notes stuck to days (`notes`:
// each where the lab's calendar snaps it, its day's slot); by night. `pad` runs the check; `padNote` holds the notes lying on the pad
// to themselves alone.
/** The pad's sheet, world units (calendar/law.ts `sheetSize`): a sheet point x from its left, y from its head is at (x − W/2, y − H/2). */
const SHEET = { W: 1760, H: 1852 };
const wpt = (sx, sy) => [sx - SHEET.W / 2, sy - SHEET.H / 2];
const pad = (extra = {}) => ({ x: 0, y: 0, month: "2026-09", weekStart: 1, ...extra });
export const CALENDAR_SCENES = [
  { name: "pad-rest-z0.42", pad: true, scene: { ...deskBase, ...at(0, 0, 0.42), calendars: [pad()] } },
  { name: "pad-roll-z0.42", pad: true, scene: { ...deskBase, ...at(0, 0, 0.42), calendars: [pad({ pose: { dir: 1, p: 0.55 } })], notes: [{ x: 1150, y: 200, seed: 13, text: "" }] } },
  { name: "pad-notes-z0.85", padNote: true, scene: { ...deskBase, ...at(...wpt(1150, 1150), 0.85), calendars: [pad()], notes: [{ x: 0, y: 0, seed: 11, text: "", pin: { day: "2026-09-26" } }, { x: 0, y: 0, seed: 23, text: "", pin: { day: "2026-09-15" } }] } },
  { name: "pad-night-z0.42", pad: true, scene: { ...deskBase, ...at(0, 0, 0.42), theme: "dark", calendars: [pad()] } },
];
ORACLE_SCENES.push(...CALENDAR_SCENES);

// THE DESK CALENDAR AT WORK (D3t-c) — its PRINT from its entries: a month with its lines (the untimed first, a time set apart), a
// highlighter's band across a run, today ringed and the past ticked (today pinned: the 24th); mid-roll, with entries on both sheets;
// a note stuck to a day of it (its day has no lines: its cell's print is the same bytes). The world lays `events` as the pad's data
// children and pins `today`; the print is the COMMITTED one both hosts pin (`print`: month → oracle/fixtures/assets/<name>.*, the
// live print's level-2 tiles read back from the world by apps/desk scripts/print-fixture.mjs; rig:world holds the live print to them).
export const PAD_EVENTS = [
  { start: "2026-09-02", text: "call mum back" },
  { start: "2026-09-02", text: "11am haircut" },
  { start: "2026-09-11", end: "2026-09-15", text: "holiday in Lisbon", ink: "yellow" },
  { start: "2026-09-17", text: "dentist 3pm" },
  { start: "2026-09-29", text: "tax return", ink: "red" },
  { start: "2026-10-06", text: "9:30 flight to Porto" },
  { start: "2026-10-19", end: "2026-10-21", text: "conference", ink: "green" },
];
const printed = (extra = {}) => pad({ events: PAD_EVENTS, today: "2026-09-24", print: { "2026-09": "print-2026-09", "2026-10": "print-2026-10" }, ...extra });
export const PRINT_SCENES = [
  { name: "pad-print-z0.42", pad: true, printed: true, scene: { ...deskBase, ...at(0, 0, 0.42), calendars: [printed()] } },
  { name: "pad-print-roll-z0.42", pad: true, printed: true, bothSheets: true, scene: { ...deskBase, ...at(0, 0, 0.42), calendars: [printed({ pose: { dir: 1, p: 0.55 } })] } },
  { name: "pad-print-note-z0.85", padNote: true, printed: true, scene: { ...deskBase, ...at(...wpt(880, 1330), 0.85), calendars: [printed()], notes: [{ x: 0, y: 0, seed: 11, text: "", pin: { day: "2026-09-24" } }] } },
];
ORACLE_SCENES.push(...PRINT_SCENES);

// THE MARKS (design-015 §7, *Marks on the Mat* v2; D4a) — the desk's chrome over the objects, as stills: the brackets on each
// kind at rest (the knobs only where it resizes: the whiteboard, the print); the lock-on pinned at t = 0.3 (the frame still
// arriving from further out); several: the members' ticks and one union; the vellum mid-drag (two notes touched and ticked, a
// taped one passed over, the count by the cursor); the vellum folding onto the union; the laser (three notes on a row, the middle
// one carried: its top, bottom and centre aligned with its neighbours', the gaps equal — a real snap through the kernel's law);
// the tape; far out, where the brackets collapse to one ring; by night (the pencil and the laser unlit, the tape moonlit); your
// extent on the rulers. `marks` runs the check (outside the marks' band nothing moved; the pencil's byte where a stroke is solid;
// a knob's face, a pill's fill); `unlit` runs the night's. And (D3w) a notebook lying closed and a desk calendar, each selected:
// the brackets go around their footprints on the mat (kinds `bookFrame`, `calendarFrame` — what the world's builder draws).
const marksBase = { ...base, theme: "light", mat: matStill };
const ROW = [{ x: 250, y: 300, seed: 5, text: "" }, { x: 550, y: 300, seed: 11, text: "", selected: true, held: true }, { x: 850, y: 300, seed: 7, text: "" }];
export const MARKS_SCENES = [
  { name: "marks-note-z1", marks: true, scene: { ...marksBase, zoom: 1, notes: [{ x: 400, y: 330, seed: 5, text: "", selected: true }, { x: 760, y: 360, seed: 11, text: "" }] } },
  { name: "marks-lockon-t0.3-z1", marks: true, scene: { ...marksBase, zoom: 1, notes: [{ x: 400, y: 330, seed: 5, text: "", selected: true }], marks: { t: 0.3 } } },
  { name: "marks-minimat-z1", marks: true, scene: { ...marksBase, zoom: 1, minimats: [{ x: 520, y: 400, name: "INBOX", selected: true }], notes: [{ x: 960, y: 250, seed: 7, text: "" }] } },
  { name: "marks-board-z1", marks: true, scene: { ...boardBase, zoom: 1, boards: [{ x: 420, y: -120, selected: true }], notes: [BOARD_NOTE] } },   // no ink: the stamps' 1-LSB Dawn split (D-D3r-a.5) is board-selected-z1's
  { name: "marks-print-z1", marks: true, scene: { ...photoBase, zoom: 1, prints: [{ ...PRINT, selected: true }] } },
  { name: "marks-several-z1", marks: true, scene: { ...marksBase, zoom: 1, notes: [{ x: 300, y: 280, seed: 5, text: "", selected: true }, { x: 620, y: 420, seed: 11, text: "", selected: true }, { x: 900, y: 260, seed: 7, text: "", selected: true }] } },
  {
    name: "marks-vellum-z1", marks: true,
    scene: { ...marksBase, zoom: 1, notes: [{ x: 300, y: 300, seed: 5, text: "" }, { x: 560, y: 380, seed: 11, text: "" }, { x: 860, y: 300, seed: 7, text: "", locked: true }], marks: { marquee: { x0: 150, y0: 180, x1: 1000, y1: 560 } } },
  },
  {
    name: "marks-fold-t0.5-z1", marks: true,
    scene: { ...marksBase, zoom: 1, notes: [{ x: 300, y: 300, seed: 5, text: "", selected: true }, { x: 560, y: 380, seed: 11, text: "", selected: true }], marks: { fold: { rect: { x0: 120, y0: 150, x1: 900, y1: 640 }, t: 0.5 } } },
  },
  { name: "marks-laser-z1", marks: true, scene: { ...marksBase, zoom: 1, notes: ROW, marks: { snap: true, strike: 0.5 } } },
  { name: "marks-tape-z1", marks: true, scene: { ...marksBase, zoom: 1, minimats: [{ x: 360, y: 400, name: "PINNED", locked: true }], notes: [{ x: 880, y: 330, seed: 5, text: "", selected: true, locked: true }] } },
  { name: "marks-far-z0.1", marks: true, scene: { ...marksBase, camX: 400 - 600 / 0.1, camY: 330 - 400 / 0.1, zoom: 0.1, notes: [{ x: 400, y: 330, seed: 5, text: "", selected: true }, { x: 900, y: 330, seed: 11, text: "" }] } },
  { name: "marks-night-z1", marks: true, unlit: true, scene: { ...marksBase, theme: "dark", zoom: 1, notes: [{ x: 400, y: 330, seed: 5, text: "", selected: true }, { x: 760, y: 360, seed: 11, text: "", locked: true }] } },
  { name: "marks-ruler-z1", marks: true, scene: { ...marksBase, zoom: 1, ruler: {}, notes: [{ x: 400, y: 330, seed: 5, text: "", selected: true }] } },
  { name: "marks-book-z2.2", marks: true, scene: { ...deskBase, ...at(0, 0, 2.2), books: [nb({ angle: 0.04, selected: true })] } },
  { name: "marks-pad-z0.42", marks: true, scene: { ...deskBase, ...at(0, 0, 0.42), calendars: [pad({ selected: true })] } },
];
ORACLE_SCENES.push(...MARKS_SCENES);

// The LATTICE through a zoom sweep (the prototype's test/harness/zoom.mjs — screenshots there, stills here, drawn FROM THE WORLD by
// rig:world — D5a): the desk of mini mats and notes by night at the harness's camera, the product's fade-in window (the mid cell
// 10 → 20 px) across the sweep with the DECADE WRAP between 0.99 and 1.01 among it; and the sparse window (20 → 40 px — the classic
// grid's "nothing under 20 px") at three of those zooms, over the notes alone (an inside keeps the product's window).
const zoomBase = { ...base, theme: "dark", mat: matStill, camX: 13.7, camY: -21.3 };
export const ZOOM_SCENES = [
  ...[0.11, 0.15, 0.2, 0.3, 0.6, 0.99, 1.01, 1.5].map((zoom) => ({ name: `zoom-z${zoom}`, scene: { ...zoomBase, zoom, minimats: DESK, notes: deskNotes } })),
  ...[0.2, 0.99, 1.01].map((zoom) => ({ name: `zoom-sparse-z${zoom}`, scene: { ...zoomBase, zoom, notes: deskNotes, fadeIn: [20, 40] } })),
];
ORACLE_SCENES.push(...ZOOM_SCENES);

// THE OPENING (design-015 §8, *Marks on the Mat* v2's Opening; D4b) — stills of an object IN HAND: a notebook picked up from a
// turned rest, at 42 % of the carry (straightening, growing in log scale, the cover still shut, the desk half out of focus) and at
// the top (the spread at its reading size under the desk eye, the cover open, the desk blurred 14 px and dimmed 8 %); the same by
// night (the reading light: the book keeps its day light while the mat stays moonlit); a whiteboard at 42 % and at the top (a
// flat kind: the pose is a camera); on a portrait phone (one page of the spread — the right — centred, the blur 10 px). And the
// carry at 0: the rest frame byte for byte. `held` runs the check: at e = 0 the frame is the rest frame; else the frame outside the
// held object's box (grown by its reach) equals the blurred desk alone (the hand drawn empty), inside it differs, and two renders
// of the same still are identical.
// THE WHITEBOARD IN HAND AT WORK (D3t-a, BOARD.md §4–5): the marker taken up into the hand — hovering over the melamine (its
// shadow off the nib), pressed (they meet); the ink of a hand at work — a stroke just lifted, WET (laid live, committed wet), and
// another MID-DRAW (its first samples in the stroke layer, the pen pressed at its head) — and the same strokes DRIED (every one
// replayed from its data, the pen lifted over the last one's end). The strokes are TIMED as a hand lays them (one sample a frame,
// the red one resting — its bleed), in melamine units; the board lies at (420, −120): its melamine's top-left is (189, −271).
const MEL = [189, -271];
const onBoard = ([x, y]) => ({ x: MEL[0] + x, y: MEL[1] + y });
export const BOARD_WET = { ink: "red", tip: "bullet", points: [[260, 150], [290, 140], [320, 135], [350, 140], [350, 140], [380, 150]], times: [0, 16, 33, 50, 250, 266] };
export const BOARD_LIVE = { ink: "black", tip: "chisel", points: [[60, 260], [90, 250], [120, 245], [150, 248], [180, 255], [210, 262]], times: [0, 16, 32, 48, 64, 80] };
const penBoard = (extra = {}) => ({ x: 420, y: -120, cap: "blue", strokes: BOARD_STROKES.slice(0, 2), ...extra });
const BOARD_PEN_SCENES = [
  { name: "hold-board-pen-e1-z1", held: true, scene: { ...boardBase, zoom: 1, boards: [penBoard()], notes: [BOARD_NOTE], hold: { board: 0, e: 1, pen: onBoard([191, 121]) } } },
  { name: "hold-board-wet-e1-z1", held: true, scene: { ...boardBase, zoom: 1, boards: [penBoard({ wet: BOARD_WET, live: { ...BOARD_LIVE, upto: 4 } })], notes: [BOARD_NOTE], hold: { board: 0, e: 1, pen: { ...onBoard([150, 248]), press: true, ink: "black" } } } },
  { name: "hold-board-dry-e1-z1", held: true, scene: { ...boardBase, zoom: 1, boards: [penBoard({ strokes: [...BOARD_STROKES.slice(0, 2), BOARD_WET, BOARD_LIVE] })], notes: [BOARD_NOTE], hold: { board: 0, e: 1, pen: { ...onBoard([210, 262]), ink: "black" } } } },
];
const holdBase = { ...deskBase, ...at(0, 0, 1) };
const HOLD_NOTE = { x: 380, y: -160, seed: 5, text: "" };
const HOLD_BOOK = nb({ angle: 0.08 });
export const HOLD_SCENES = [
  { name: "hold-book-e0-z1", held: true, scene: { ...holdBase, books: [HOLD_BOOK], notes: [HOLD_NOTE], hold: { book: 0, e: 0 } } },
  { name: "hold-book-e0.42-z1", held: true, scene: { ...holdBase, books: [HOLD_BOOK], notes: [HOLD_NOTE], hold: { book: 0, e: 0.42 } } },
  { name: "hold-book-e1-z1", held: true, scene: { ...holdBase, books: [HOLD_BOOK], notes: [HOLD_NOTE], hold: { book: 0, e: 1 } } },
  { name: "hold-book-night-e1-z1", held: true, scene: { ...holdBase, theme: "dark", books: [nb({ angle: 0.08, cover: "ink" })], notes: [HOLD_NOTE], hold: { book: 0, e: 1 } } },
  { name: "hold-book-phone-e1", held: true, scene: { ...deskBase, view: { cssW: 390, cssH: 844, dpr: 2 }, camX: -195, camY: -422, zoom: 1, books: [HOLD_BOOK], hold: { book: 0, e: 1 } } },
  { name: "hold-board-e0.42-z1", held: true, scene: { ...boardBase, zoom: 1, boards: [{ x: 420, y: -120 }], notes: [BOARD_NOTE], hold: { board: 0, e: 0.42 } } },
  { name: "hold-board-e1-z1", held: true, scene: { ...boardBase, zoom: 1, boards: [{ x: 420, y: -120 }], notes: [BOARD_NOTE], hold: { board: 0, e: 1 } } },
  ...BOARD_PEN_SCENES,
];
ORACLE_SCENES.push(...HOLD_SCENES);

// THE NOTEBOOK IN HAND AT WORK (D3t-b, NOTEBOOK.md §6–8): pages written in the four pens — the strokes are the book's DATA
// (`ink`: each on its `page` — sheet i's recto 2i + 1, its verso 2i + 2 — in page units, `s` from the gutter and `y` from the
// head, a sample a frame), their pages' rasters the notebook kind's cache on both sides. An open spread written on BOTH faces
// (sheet 0's verso on the left, sheet 1's recto on the right — a red ring on it); a sheet MID-TURN with ink riding it (its recto
// going over, its verso coming into view, the page it uncovers written too); the same spread by night — the ink laid into the
// paper before the light, so it takes the moon as the paper does. The writing is loops of a cursive hand made with arithmetic
// alone (every host computes the same points); on a left page the hand runs toward the gutter's other side (s falls as it writes).
const LOOP = [[0, 0], [1.5, -2.5], [2.5, -6], [2, -8.5], [0.75, -9], [0, -7.5], [0.5, -3.5], [2, 0]];
/** A line of writing: `loops` loops of the hand from (s0, y0), 4.5 units apart; `dir` −1 on a left page. */
const scrawl = (s0, y0, loops, dir = 1) => {
  const points = [];
  for (let k = 0; k < loops; k++) for (const [lx, ly] of LOOP) points.push([s0 + dir * (k * 4.5 + lx), y0 + ly]);
  return { points, times: points.map((_, i) => i * 16) };
};
/** A ring drawn round a word: eight samples on an octagon, closed. */
const ring = (s, y, r) => {
  const k = r * 0.75;
  const points = [[s + r, y], [s + k, y + k], [s, y + r], [s - k, y + k], [s - r, y], [s - k, y - k], [s, y - r], [s + k, y - k], [s + r, y]];
  return { points, times: points.map((_, i) => i * 24) };
};
export const BOOK_INK = [
  { page: 2, pen: "fountain", ...scrawl(150, 48, 22, -1) },
  { page: 2, pen: "fountain", ...scrawl(150, 66, 18, -1) },
  { page: 2, pen: "felt", points: [[150, 76], [120, 77], [84, 76.5], [60, 77]], times: [0, 30, 60, 90] },
  { page: 3, pen: "felt", ...scrawl(26, 52, 24) },
  { page: 3, pen: "felt", ...scrawl(26, 72, 20) },
  { page: 3, pen: "red", ...ring(70, 66, 14) },
  { page: 4, pen: "ball", ...scrawl(150, 110, 20, -1) },
  { page: 5, pen: "fountain", ...scrawl(26, 130, 22) },
];
const inkBook = (extra = {}) => nb({ angle: 0.08, left: 1, ink: BOOK_INK, ...extra });
export const HOLD_INK_SCENES = [
  { name: "hold-book-ink-e1-z1", held: true, scene: { ...holdBase, books: [inkBook()], notes: [HOLD_NOTE], hold: { book: 0, e: 1 } } },
  { name: "hold-book-turn-ink-e1-z1", held: true, scene: { ...holdBase, books: [inkBook({ turn: { dir: 1, phi: 0.8, psi: 1.35, twist: 0.12 } })], notes: [HOLD_NOTE], hold: { book: 0, e: 1 } } },
  { name: "hold-book-ink-night-e1-z1", held: true, scene: { ...holdBase, theme: "dark", books: [inkBook({ cover: "ink" })], notes: [HOLD_NOTE], hold: { book: 0, e: 1 } } },
];
ORACLE_SCENES.push(...HOLD_INK_SCENES);

// THE PEGBOARD TRAY (design-017, K3): the drawer open over a desk of notes by day and by night, scrolled by a fractional row (13.4 of
// a 40 px pitch — the carry's fraction on the GPU), and half-way through its slide (the dim at half). `trayed` runs the tray check.
const trayBase = { ...base, theme: "light", zoom: 1, mat: matStill, notes: [{ x: 300, y: 250, seed: 7, text: "" }, { x: 640, y: 560, seed: 11, text: "" }] };
export const TRAY_SCENES = [
  { name: "tray-day", trayed: true, scene: { ...trayBase, tray: { p: 1, scroll: 0 } } },
  { name: "tray-night", trayed: true, scene: { ...trayBase, theme: "dark", tray: { p: 1, scroll: 0 } } },
  { name: "tray-scroll-frac", trayed: true, scene: { ...trayBase, tray: { p: 1, scroll: 13.4 } } },
  { name: "tray-half-open", trayed: true, scene: { ...trayBase, tray: { p: 0.5, scroll: 0 } } },
  // K5a: scrolled a fractional row past the first line — the mini mat on its shelf and the whiteboard under its rail, the notebook under the rim
  { name: "tray-scrolled", trayed: true, scene: { ...trayBase, tray: { p: 1, scroll: 240.4 } } },
];
ORACLE_SCENES.push(...TRAY_SCENES);

// THE CAPTURE DOOR (petition I23 — `handle.capture`, ground.ts `captureFrame`): one still carrying what the door must carry — two mini
// mats (the first with a live inside, a mini mat of its own in it), a SELECTED note (the marks) and a blank one, a bare whiteboard, a
// print, a closed notebook — on the reference desk at 1:1. `capture` runs the check: the still captured at 1× is the golden frame byte
// for byte; at 0.25× it is the frame drawn at a quarter of the dpr; a rect is the frame's crop. rig:capture stages the same still FROM
// THE WORLD and holds the door's bitmap to this render.
export const CAPTURE_SCENES = [
  { name: "capture-desk-z1", capture: true, scene: { ...mmBase, zoom: 1, minimats: [DESK[0], DESK[1]], notes: [note(700, 610, 23, { selected: true }), note(640, 80, 27, { greek: undefined })], boards: [{ x: 1000, y: 650 }], prints: [{ x: 980, y: 430, angle: 0.06 }], books: [nb({ x: 850, y: 480, angle: 0.05 })] } },
];
ORACLE_SCENES.push(...CAPTURE_SCENES);

// THE OPEN KIND LIST (design-016 K8b): a PLUGIN's stills join the golden — the desk clock's, from its own package
// (examples/desk-clock, built on the published entries alone), drawn through its kind's own contract; its object types are handed to
// the desk by each host (render.mjs here, the parity page in Chrome) from the same package. New rows only: every scene above draws
// as it did.
import { CLOCK_SCENES } from "../../../examples/desk-clock/oracle/scenes.mjs";
ORACLE_SCENES.push(...CLOCK_SCENES);

// THE HOST'S FOOT (petition I21 — `deskLayer({ tray: { foot } })`): tray-scrolled's still with a host's foot inset of 88 (VibeField's
// line floats over the board's foot, y 712 of 800): the second line hangs across the foot's line — feathered over the ramp above it,
// gone in the foot, no hole there — and above the ramp it is tray-scrolled byte for byte (`footed` names the still the check holds it
// to). Last, so every scene above draws in the order it always did. rig:world draws it on a page mounted with the foot (`?trayFoot=88`).
export const FOOT_SCENES = [
  { name: "tray-foot", trayed: true, footed: "tray-scrolled", scene: { ...trayBase, tray: { p: 1, scroll: 240.4, foot: 88 } } },
];
ORACLE_SCENES.push(...FOOT_SCENES);
