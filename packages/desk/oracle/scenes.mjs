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
// (the desk's own notes carry no text: the oracle renders none, so a written one would read blank here and in the hand in Chrome)
export const deskNotes = [note(700, 610, 23), note(640, 80, 27, { greek: undefined })];
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
