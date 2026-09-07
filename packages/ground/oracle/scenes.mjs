// Oracle scenes: rendered headless by render.mjs, diffed against the browser
// pages by `ab.mjs oracle`. `pages` names which browser pages must match —
// the raw prototype has no frame pass, so it only takes field-only scenes.
import { makeCards } from "./scene.mjs";
import { LIFT } from "../src/theme.ts";

// The study's field settings (reach 140, needle 5.5) — the raw prototype's, which the two field scenes are pinned to.
const base = { camX: 13.7, camY: -21.3, mouseX: 640, mouseY: 400, mouseOn: true, reach: 140, halfLen: 5.5, theme: "dark" };
// The raw prototype's fixed ink alpha and its unclamped glyph sizes; the ground's defaults are the
// product's dotAlpha (1) and the theme.ts size presets.

export const ORACLE_SCENES = [
  { name: "field-z1.585-dot", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 1.585, drawFrames: false } },
  { name: "field-z2.512-needle", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 2.512, glyph: "needle", drawFrames: false } },
  // needle on the instanced fine rung, zoomed OUT a decade (k0 1), with cards — the A/B row that first went red
  { name: "field-z0.316-needle", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 0.316, glyph: "needle", drawFrames: false } },
  { name: "frames-z2.5-selected", pages: ["ground"], scene: { ...base, cards: makeCards(6).map((c, i) => (i === 3 ? { ...c, selected: true } : c)), camX: 204.97, camY: 670.16, zoom: 2.5, mouseOn: false, style: "product" } },
  { name: "frames-z1-idle-24", pages: ["ground"], scene: { ...base, cards: makeCards(24), zoom: 1, mouseOn: false, style: "product" } },
  // The size PRESETS, at a dense zoom (fine cells ~8 px: the floor bites) and a sparse one (the coarse rung: the ceiling bites).
  { name: "field-preset-dot-z0.4", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 0.398, drawFrames: false } },
  { name: "field-preset-needle-z4", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 3.981, glyph: "needle", drawFrames: false } },
  // UNIFORM rungs mid-fade: zoom 0.7 puts the fine rung's cell at 14 px — halfway through the [10, 20] window
  { name: "field-uniform-fadein-z0.7", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 0.7, drawFrames: false } },
  // … and the sparse window, mid rung at 30 px: halfway through [20, 40], the fine rung off
  { name: "field-uniform-sparse-z0.15", pages: ["ground"], scene: { ...base, cards: makeCards(48), zoom: 0.15, fadeIn: [20, 40], drawFrames: false } },
  { name: "frames-light-surfaces", pages: ["ground"], scene: { ...base, theme: "light", cards: makeCards(12).map((c, i) => ({ ...c, surface: ["card", "note", "deep", "folder"][i % 4], selected: i === 5 })), zoom: 1.6, mouseOn: false, style: "product" } },
  // The cutting mat — a STILL (its clocks pinned, the baked projector, blue noise at a fixed offset):
  // the lines alone; the gobo at the reference's time and a mid-blur plate; zoomed out past the cone; the fine rung fading in.
  { name: "mat-lines-z1", pages: ["ground"], scene: { ...base, theme: "light", cards: makeCards(6), zoom: 1, glyph: "mat", mouseOn: false, style: "product", mat: { opacity: 0 } } },
  { name: "mat-gobo-z1", pages: ["ground"], scene: { ...base, theme: "light", cards: makeCards(6), zoom: 1, glyph: "mat", mouseOn: false, style: "product", mat: { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] } } },
  { name: "mat-gobo-z0.2", pages: ["ground"], scene: { ...base, theme: "light", cards: makeCards(6), camX: -2400, camY: -1500, zoom: 0.2, glyph: "mat", mouseOn: false, style: "product", mat: { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] } } },
  { name: "mat-gobo-b-z6.3", pages: ["ground"], scene: { ...base, theme: "light", cards: makeCards(6), zoom: 6.31, glyph: "mat", mouseOn: false, style: "product", mat: { time: 1.2, goboTime: 12.5, noise: [0.8, 0.15], plate: "b" } } },
  // …and the same mat by NIGHT (MAT.md) — the dark theme: the Moon, the mesopic eye, Eigengrau. `night` runs the check.
  { name: "mat-night-lines-z1", pages: ["ground"], scene: { ...base, cards: makeCards(6), zoom: 1, glyph: "mat", mouseOn: false, style: "product", mat: { opacity: 0 } } },
  { name: "mat-night-z1", pages: ["ground"], night: true, scene: { ...base, cards: makeCards(6), zoom: 1, glyph: "mat", mouseOn: false, style: "product", mat: { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] } } },
  { name: "mat-night-z0.2", pages: ["ground"], scene: { ...base, cards: makeCards(6), camX: -2400, camY: -1500, zoom: 0.2, glyph: "mat", mouseOn: false, style: "product", mat: { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] } } },
  { name: "mat-night-b-z6.3", pages: ["ground"], scene: { ...base, cards: makeCards(6), zoom: 6.31, glyph: "mat", mouseOn: false, style: "product", mat: { time: 1.2, goboTime: 12.5, noise: [0.8, 0.15], plate: "b" } } },
];

export const VIEW = { cssW: 1200, cssH: 800, dpr: 2 };

// The portal flight — a STILL at one progress, both frames drawn (nav/flight.ts is the
// geometry, the same in the lab and here): a dot root flying into a mat folder at the
// cut, midway and near landing; the way back out; a mat root into a dot folder; a
// needle root into a mat one; and a tiny folder, whose flight is depth-capped and
// therefore a frozen crossfade. `continuity` names the check render.mjs runs on it.
const FOLDER = 2;   // makeCards(6)[2]: 224×106, r 14, centred at (951, 216) — the right third of the view at zoom 1
const childOf = (glyph, n = 4, seed = 7) => ({ cards: makeCards(n, seed).map((c) => ({ ...c, x: c.x - 600, y: c.y - 400 })), glyph });
const navBase = { ...base, cards: makeCards(6), mouseOn: false, style: "product" };
export const NAV_SCENES = [
  { name: "nav-enter-dot-mat-p0", continuity: "enter", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0 } } },
  { name: "nav-enter-dot-mat-p0.5", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } } },
  { name: "nav-enter-dot-mat-p0.9", scene: { ...navBase, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.9 } } },
  { name: "nav-exit-mat-dot-p0", continuity: "exit", scene: { ...navBase, zoom: 1, nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0 } } },
  { name: "nav-exit-mat-dot-p0.5", scene: { ...navBase, zoom: 1, nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0.5 } } },
  // zoomed OUT inside before leaving: the portal is smaller than the view at the cut, so the parent shows around it
  { name: "nav-exit-dot-dot-p0", continuity: "exit", scene: { ...navBase, zoom: 1.2, nav: { kind: "exit", container: FOLDER, child: childOf("dot"), p: 0, innerCam: { x: -1400, y: -900, zoom: 0.45 } } } },
  { name: "nav-enter-mat-dot-p0.5", scene: { ...navBase, zoom: 0.8, glyph: "mat", mat: { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] }, nav: { kind: "enter", container: FOLDER, child: childOf("dot"), p: 0.5 } } },
  { name: "nav-enter-needle-mat-p0.35", scene: { ...navBase, zoom: 1.585, glyph: "needle", nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.35 } } },
  { name: "nav-enter-frozen-p0.5", scene: { ...navBase, cards: makeCards(6).map((c, i) => (i === FOLDER ? { ...c, w: 22, h: 14, r: 4 } : c)), zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } } },
];
ORACLE_SCENES.push(...NAV_SCENES.map((s) => ({ ...s, pages: ["ground"] })));

// The content term (COMPOSE.md, design-013 §10). 1:1 cards: content 64×64 world at zoom 1, dpr 2 = the
// 128² test plate texel for texel (the camera at the origin so pixel centres land on texel centres) — one
// per content mode, plus a magnified one; the same board at zoom 2.5 (bilinear, parity only); and the
// z-runs: five 1:1 cards overlapping in paint order page · own · page · own-srgb · own, then a plate.
const one = (x, y, content, extra = {}) => ({ x, y, w: 64, h: 64, r: 8, strength: 1, content, ...extra });
const contentBase = { ...base, camX: 0, camY: 0, mouseOn: false, style: "product", exact: true };
const modes = [one(200, 200, "page0"), one(400, 200, "page1"), one(600, 200, "own"), one(800, 200, "own-srgb"), { x: 500, y: 540, w: 260, h: 150, r: 14, strength: 1, content: "page0", surface: "note" }];
export const CONTENT_SCENES = [
  // runs: the two page cards and the own card make one run (page cards ride), own-srgb starts the second and the big page card rides it
  { name: "content-modes-z1", content: true, runs: 2, scene: { ...contentBase, zoom: 1, cards: modes } },
  { name: "content-modes-z2.5", scene: { ...contentBase, zoom: 2.5, camX: 150, camY: 130, cards: modes } },
  // checked with the §5 shadow off: an upper card's shadow rightly darkens the card under it, and this check is about paint order
  { name: "content-zruns-z1", content: true, runs: 3, noShadow: true, scene: { ...contentBase, zoom: 1, cards: [one(300, 300, "page0"), one(340, 330, "own"), one(380, 300, "page1"), one(420, 330, "own-srgb"), one(460, 300, "own"), one(340, 380, "plate", { surface: "deep" })] } },
];
ORACLE_SCENES.push(...CONTENT_SCENES.map((s) => ({ ...s, pages: ["ground"] })));

// The §7 overlap HEAT (GLOW.md): the LIGHT a lifted card casts on a drop target, a STILL —
// `hot` on the target pins the SOURCE (the lifted card's silhouette as drawn: its centre, its
// lifted half extents and radius — the same numbers both hosts get), the presence at 1 and the
// tier; `held` lifts the picked card (0.75, the lifted shadow) over it. Pictures for the eye:
// the picked card's edge at the target's lower right (accept on a folder, reject on a deep
// card), a corner-only contact, a selected target on light with the source at its top-left.
// Two `heat` scenes the exact check runs: the target alone, lit by a source that is NOT drawn.
const srcOf = (lifted, tier) => ({ x: lifted.x, y: lifted.y, hx: (lifted.w / 2) * LIFT.scale, hy: (lifted.h / 2) * LIFT.scale, r: lifted.r * LIFT.scale, tier });
const heatBase = { ...base, mouseOn: false, style: "product" };
const TARGET = { x: 600, y: 400, w: 320, h: 200, r: 22, strength: 1, surface: "folder" };   // 440..760 × 300..500
const LIFTED = { x: 740, y: 470, w: 150, h: 90, r: 14, strength: 1, held: true };        // its left and top edges inside the target's lower right
const LIFTED_BR = { x: 800, y: 540, w: 150, h: 90, r: 14, strength: 1, held: true };     // a corner-only contact
const LIFTED_TL = { x: 460, y: 320, w: 150, h: 90, r: 14, strength: 1, held: true };     // over the top-left corner
const FAR = [{ x: 180, y: 160, w: 150, h: 90, r: 14, strength: 1 }, { x: 1020, y: 640, w: 155, h: 155, r: 22, strength: 1, surface: "note" }];
/**
 * The SHELL (design-014): the engine's own card program — a rounded plate at the card's radius, the §5 shadow,
 * a hairline, the ring on selection, and the drop cue on the accept tier. Rendered with NO pack registered.
 * No browser page draws the shell yet (`pages: []`): these are the shell's baseline, not a parity scene.
 */
export const SHELL_SCENES = [
  { name: "shell-z1-idle-24", pages: [], scene: { ...base, program: "shell", cards: makeCards(24), zoom: 1, mouseOn: false } },
  { name: "shell-z2.5-selected", pages: [], scene: { ...base, program: "shell", cards: makeCards(6).map((c, i) => (i === 3 ? { ...c, selected: true } : c)), camX: 204.97, camY: 670.16, zoom: 2.5, mouseOn: false } },
  { name: "shell-light-heat-z1", pages: [], scene: { ...base, program: "shell", theme: "light", zoom: 1, mouseOn: false, cards: [FAR[0], { ...TARGET, hot: srcOf(LIFTED, 1) }, LIFTED, { ...FAR[1], hot: srcOf(LIFTED_BR, 0) }] } },
];
ORACLE_SCENES.push(...SHELL_SCENES);

export const HEAT_SCENES = [
  { name: "heat-accept-z1", scene: { ...heatBase, zoom: 1, cards: [...FAR, { ...TARGET, hot: srcOf(LIFTED, 1) }, LIFTED] } },
  { name: "heat-reject-z1", scene: { ...heatBase, zoom: 1, cards: [...FAR, { ...TARGET, surface: "deep", hot: srcOf(LIFTED, 0) }, LIFTED] } },
  { name: "heat-corner-z1", scene: { ...heatBase, zoom: 1, cards: [...FAR, { ...TARGET, hot: srcOf(LIFTED_BR, 1) }, LIFTED_BR] } },
  { name: "heat-light-selected-z2", scene: { ...heatBase, theme: "light", zoom: 2, camX: 320, camY: 220, cards: [{ ...TARGET, selected: true, hot: srcOf(LIFTED_TL, 1) }, LIFTED_TL] } },
  { name: "heat-exact-accept-z1", heat: true, scene: { ...heatBase, zoom: 1, cards: [FAR[0], { ...TARGET, hot: srcOf(LIFTED, 1) }] } },
  { name: "heat-exact-reject-light-z1.6", heat: true, scene: { ...heatBase, theme: "light", zoom: 1.6, camX: 250, camY: 150, cards: [FAR[1], { ...TARGET, hot: srcOf({ x: 430, y: 380, w: 150, h: 90, r: 14 }, 0) }] } },
];
ORACLE_SCENES.push(...HEAT_SCENES.map((s) => ({ ...s, pages: ["ground"] })));

// The LIVE PORTAL (PORTAL.md): a folder whose face passes the gate shows its inside through it —
// the inside's grid and cards under the camera the fly-in starts from. Stills: three folders with
// three grids inside at 1:1; the gate mid-fade (zoom 0.3 puts the big face's short side at 90 px —
// a face is the content rect inset like the product folder's, FOLDER_FACE — a quarter into [80, 120],
// the two small ones under it); light; a folder inside a folder, zoomed
// in so the nested face passes the gate too. The two `cut` scenes are §2.4's proof: an enter's
// first frame = the rest frame before it; an exit at p 0.5 = the rest frame under its camera.
const insideOf = (glyph, n = 4, seed = 7) => ({ cards: makeCards(n, seed).map((c) => ({ ...c, x: c.x - 600, y: c.y - 400 })), glyph });
const folder = (x, y, w, h, inside) => ({ x, y, w, h, r: 22, strength: 1, surface: "folder", inside });
const portalBase = { ...base, mouseOn: false, style: "product", portals: true };
const THREE = [
  { x: 200, y: 150, w: 150, h: 90, r: 14, strength: 1 }, { x: 1000, y: 700, w: 155, h: 155, r: 22, strength: 1, surface: "note" },
  folder(330, 400, 329, 345, insideOf("mat")), folder(780, 250, 329, 155, insideOf("needle", 3, 3)), folder(760, 560, 155, 155, insideOf("dot", 5, 11)),
];
const NESTED = [folder(600, 400, 329, 345, { cards: [{ x: 0, y: 0, w: 329, h: 155, r: 22, strength: 1 }, folder(120, 380, 329, 345, insideOf("needle", 3, 5)), { x: 440, y: 40, w: 155, h: 155, r: 22, strength: 1, surface: "deep" }], glyph: "dot" })];
export const PORTAL_SCENES = [
  { name: "portal-three-z1", scene: { ...portalBase, zoom: 1, cards: THREE } },
  { name: "portal-gate-mid-z0.3", scene: { ...portalBase, zoom: 0.3, camX: -1400, camY: -900, cards: THREE } },
  { name: "portal-light-z1.6", scene: { ...portalBase, theme: "light", zoom: 1.6, camX: 120, camY: 200, cards: THREE } },
  { name: "portal-nested-z2.5", scene: { ...portalBase, zoom: 2.5, camX: 380, camY: 300, cards: NESTED } },
  // the folder's face is 204×60 at 1:1 (its 224×106 content rect inset) — a gate open by 40 px puts it at full presence, the case the proof is about (mid-gate the portal is still fading in)
  { name: "portal-cut-enter-p0", cut: "enter", scene: { ...portalBase, portalGate: [20, 40], zoom: 1, cards: makeCards(6), nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0 } } },
  { name: "portal-cut-exit-p0.5", cut: "exit", scene: { ...portalBase, portalGate: [20, 40], zoom: 1, cards: makeCards(6), nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0.5 } } },
  // §10's two witnesses. THE CHAIN: a folder whose face nearly fills the view holds an inside three viewports wide, so its
  // arrival is clamped at zoom 0.5 and a folder at the far right lands half outside the parent's face — the half outside
  // must show nothing (the review's leak: 9,884 device px drawn over the root's grid). THE FACE: a product folder at 1:1 —
  // the 10 px band and the 36 px bar round the face are the plate, and nothing under the container shows at the edge.
  { name: "portal-chain-z1", chain: true, scene: { ...portalBase, zoom: 1, camX: -600, camY: -400, cards: [folder(0, 0, 1100, 700, { cards: [{ x: 0, y: 0, w: 329, h: 155, r: 22, strength: 1 }, folder(2800, 100, 329, 345, insideOf("needle", 3, 5)), { x: 3050, y: 300, w: 155, h: 155, r: 22, strength: 1, surface: "note" }], glyph: "dot" })] } },
  { name: "portal-face-z1", sealed: true, scene: { ...portalBase, zoom: 1, cards: [{ x: 200, y: 150, w: 150, h: 90, r: 14, strength: 1 }, folder(600, 400, 329, 345, insideOf("dot")), { x: 1000, y: 700, w: 155, h: 155, r: 22, strength: 1, surface: "note" }] } },
];
ORACLE_SCENES.push(...PORTAL_SCENES.map((s) => ({ ...s, pages: ["ground"] })));
