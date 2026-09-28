// rig:sticky — the sticky note's TEXT through a real headless Chrome, FROM THE WORLD (D2c; the prototype's
// test/harness/sticky.mjs ported onto `window.__desk`, and design-015 §6.1's witnesses). Page-level CDP input
// only (nothing reaches the OS). The checks:
//   · the text raster seam IS the prototype's ink: the committed ink-note-1.r8, byte for byte;
//   · a note written LIVE draws the frame its committed still draws, maxΔ 0;
//   · stills — four written notes by day, by night, at 2.5 and 0.4, one held — every note with its raster at its band;
//   · a TAP puts the editor on the note: the one screen-space textarea, its rect the sheet's screen rect;
//   · keys through the platform land in the note LIVE (the document untouched until the session ends), the pen's
//     wipe runs 110 ms and ends, the caret stands after the glyph and blinks — and nothing else draws;
//   · a tap between two glyphs puts the caret between them; the editor follows a pan and a wheel zoom;
//   · the hand-off: the sheet before the focus and after the blur (its text put back) differs on 0 px;
//   · typing is a GESTURE: 1 s without input commits the session (the focus stays), Escape commits it,
//     ⌘Z takes a session back in ONE step, ⇧⌘Z redoes it;
//   · the band ladder re-rasters at a rung crossing only (never on a pan or a wobble);
//   · delete while editing ends the session and the claim; the ghost gone, the note's page rect is back
//     (no leak over delete/undo cycles); the undo brings it back as last committed, re-rastered;
//   · IME text enters as handwriting while it composes (the prototype's behaviour, kept);
//   · the editor owns the keys: `w` types, it does not stick a note; ⌫ erases a glyph, not the note.
// DESK_SHOTS=<dir> writes the stills and the typing frames for the eye. Exit 0 = every check passed.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, until, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const shots = process.env.DESK_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(420_000, cleanup);   // no row in 420 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const INK_TEXT = "buy milk\ncall mum back\nfix the desk lamp";

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.evaluate("window.__desk.bar(false)", { timeoutMs: 20000 });   // design-018 §5 (R2): its pixels are the renderer's alone — the tray's bar hidden
  const front = () => tab.send("Page.bringToFront");
  await front();
  // the witness is the RENDERER's frame (rig:world's rule): the screen-space selection menu (DOM over the canvas — D4a) steps aside
  // while a note is written and comes back 200 ms after on its own clock, so a capture would catch it at any point of its fade
  await tab.evaluate("document.head.insertAdjacentHTML('beforeend', '<style>[data-ice-selection-menu]{display:none!important}</style>')", { timeoutMs: 20000 });
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 15000 });
  const mouse = (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await sleep(30); await mouse("mouseReleased", x, y); await sleep(60); };
  const VK = { Backspace: 8, Escape: 27, End: 35, z: 90 };
  const key = async (k, modifiers = 0) => {
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    const vk = VK[k] ?? k.toUpperCase().charCodeAt(0);
    const text = k.length === 1 && modifiers === 0 ? { text: k, unmodifiedText: k } : {};
    await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...text });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const typeKeys = async (s) => { for (const ch of s) { await key(ch); await sleep(20); } };
  const META = 4;
  const SHIFT = 8;
  const note = (id) => q(`window.__desk.note.ink(${id})`);
  const docNote = (id) => q(`window.__desk.note.docInk(${id})`);
  const submitsIn = (ms) => tab.evaluate(`(async () => { const s = window.__desk.submits(); const n0 = s.total; await new Promise((r) => setTimeout(r, ${ms})); return window.__desk.submits().total - n0; })()`, { awaitPromise: true, timeoutMs: ms + 10000 });
  /** A note's sheet on screen (CSS px): its four corners' bounding box, from the geometry the builder drew. */
  const sheetBox = async (id) => q(`(() => { const e = window.__desk.entity(${id}); const G = e.geometry; const c = window.__desk.camera();
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const qx = sx * G.half[0], qy = sy * G.half[1]; return [(G.centre[0] + G.cos * qx - G.sin * qy - c.x) * c.zoom, (G.centre[1] + G.sin * qx + G.cos * qy - c.y) * c.zoom]; });
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), cx: (G.centre[0] - c.x) * c.zoom, cy: (G.centre[1] - c.y) * c.zoom }; })()`);
  const sameBox = (a, b, eps = 0.75) => a !== null && b !== null && near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.width, b.width, eps) && near(a.height, b.height, eps);
  const fmt = (r) => (r === null ? "null" : `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`);
  // pixels: captured, decoded in the page, kept by key; a diff counts differing pixels and their box
  const shot = async (name) => {
    await front(); await settle();
    const { data } = await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true });
    if (shots) writeFileSync(resolve(shots, `sticky-${name}.png`), Buffer.from(data, "base64"));
    return q(`(async () => { const img = new Image(); img.src = "data:image/png;base64,${data}"; await img.decode();
      const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      window.__px = window.__px || {}; const key = "k" + Object.keys(window.__px).length; window.__px[key] = g.getImageData(0, 0, img.width, img.height).data; return { key, w: img.width, h: img.height }; })()`);
  };
  const diff = (a, b) => q(`(() => { const A = window.__px["${a.key}"], B = window.__px["${b.key}"]; let n = 0, max = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const w = ${a.w};
    for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d > 0) { n++; if (d > max) max = d; const p = i >> 2, x = p % w, y = (p / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
    return { n, max, box: n ? [x0, y0, x1, y1] : null }; })()`);
  const still = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };
  const base = { camX: 0, camY: 0, theme: "light", mat: still };

  await q("window.__desk.ambient('still')");

  // --- 1. the text raster seam IS the prototype's ink: its committed raster, byte for byte
  await q(`window.__desk.spawn('desk.note', { seed: 7, text: 'warm' }, { x: 300, y: 250 })`);   // a note asks for the face
  for (let i = 0; i < 50 && !(await q("window.__desk.note.fontReady()")); i++) await sleep(100);
  check(await q("window.__desk.note.fontReady()"), "the hand's face (Caveat 500, the app's OFL file) is loaded");
  const b64 = await q(`window.__desk.note.rasterBytes(${JSON.stringify(INK_TEXT)}, 200, 200, 2, "caveat", 7)`);
  const mine = Buffer.from(b64 ?? "", "base64");
  const ref = readFileSync(resolve(repo, "packages/objects/oracle/fixtures/assets/ink-note-1.r8"));
  let inkDiff = 0;
  for (let i = 0; i < ref.length; i++) if (ref[i] !== mine[i]) inkDiff++;
  check(mine.length === ref.length && inkDiff === 0, `the OffscreenCanvas text raster draws the prototype's committed ink-note-1.r8 byte for byte (${mine.length} of ${ref.length} bytes, ${inkDiff} differ)`);

  // --- 2. written LIVE, the note draws the frame its committed still draws (the paper-z1 scene: the pages carved afresh, the same texels)
  const NOTES3 = [{ x: 300, y: 250, text: INK_TEXT, seed: 7, w: 200, h: 200 }, { x: 560, y: 330, seed: 11, text: "" }, { x: 830, y: 240, seed: 5, text: "", selected: true }];
  const paper = { ...base, camX: 13.7, camY: -21.3, zoom: 1, notes: NOTES3 };
  // (the ids are setScene's own: until the next sync the previous scene's notes are still alive, despawning)
  const P = await q(`window.__desk.setScene(${JSON.stringify({ ...paper, notes: NOTES3.map((n, i) => (i === 0 ? { ...n, asset: "note-1" } : n)) })})`);
  const pinned = await shot("pinned");
  const pinnedAt = await q(`window.__desk.note.raster(${P.notes[0]})`);
  const Lv = await q(`window.__desk.setScene(${JSON.stringify(paper)})`);
  const liveShot = await shot("live");
  const liveAt = await q(`window.__desk.note.raster(${Lv.notes[0]})`);
  const dPL = await diff(pinned, liveShot);
  check(pinnedAt?.pinned === true && liveAt?.pinned === false && liveAt.band === 2 && liveAt.x === pinnedAt.x && liveAt.y === pinnedAt.y && liveAt.layer === pinnedAt.layer, `the live raster lands where the committed one did: band ${liveAt?.band}, ${liveAt?.w}² at layer ${liveAt?.layer} (${liveAt?.x},${liveAt?.y})`);
  check(dPL.n === 0, `the note written live draws its committed still's frame: ${dPL.n} px differ (maxΔ ${dPL.max})`);

  // --- 3. stills: four written notes (three pens), one selected — each drawn with its raster at its band
  const NOTES4 = [
    { x: 300, y: 250, seed: 3, text: INK_TEXT },
    { x: 560, y: 330, seed: 11, pen: "ball", text: "the desk is where thinking gets arranged" },
    { x: 830, y: 240, seed: 5, text: "hello!", selected: true },
    { x: 780, y: 560, seed: 8, pen: "red", text: "DON'T FORGET\nthursday 3pm" },
  ];
  const stills = [
    ["day-z1", { ...base, zoom: 1, notes: NOTES4 }, 2],
    ["night-z1", { ...base, theme: "dark", zoom: 1, notes: NOTES4 }, 2],
    ["day-z2.5", { ...base, zoom: 2.5, camX: 200, camY: 170, notes: NOTES4 }, 5.656854249492381],
    ["day-z0.4", { ...base, zoom: 0.4, camX: -900, camY: -700, notes: NOTES4 }, 1],
    ["held-z1.6", { ...base, zoom: 1.6, camX: 150, camY: 120, notes: NOTES4.map((n, i) => (i === 1 ? { ...n, held: true } : n)) }, 4],
  ];
  for (const [name, s, band] of stills) {
    const S = await q(`window.__desk.setScene(${JSON.stringify(s)})`);
    await shot(name);
    const rs = await q(`${JSON.stringify(S.notes)}.map((id) => window.__desk.note.raster(id))`);
    const visible = rs.filter((r) => r !== null);
    check(visible.length >= 3 && visible.every((r) => r.band === band), `${name.padEnd(10)} ${visible.length} written notes drawn with rasters · ${visible.map((r) => `${r.w}²@${r.band.toFixed(2)}`).join(" ")}`);
  }

  // --- 4. the editor: a TAP puts the one screen-space textarea on the note, its rect the sheet's
  const one = { ...base, zoom: 1.6, camX: 150, camY: 120, notes: [{ x: 560, y: 330, seed: 21, text: "" }] };
  const id = (await q(`window.__desk.setScene(${JSON.stringify(one)})`)).notes[0];
  await q(`window.__desk.engine.ops.setSelection([${id}], "replace")`);
  const A = await shot("type-0");
  const box0 = await sheetBox(id);
  await click(box0.cx, box0.cy);
  check((await q("window.__desk.note.editing()")) === id && (await q("window.__desk.note.editorFocused()")) && JSON.stringify(await q("window.__desk.note.claimed()")) === JSON.stringify([id]), "a tap puts the editor on the note: focused, and the world's `Editing` claim on it alone");
  const r0 = await q("window.__desk.note.editorRect()");
  check(sameBox(r0, box0), `the editor's rect IS the sheet's screen rect: ${fmt(r0)} vs ${fmt(box0)} (turned ${((await q(`window.__desk.entity(${id}).geometry.angle`)) * 180 / Math.PI).toFixed(2)}°)`);
  const nodes = await q("document.querySelectorAll('[data-desk-editor]').length + ':' + getComputedStyle(document.querySelector('[data-desk-editor]')).color + ':' + getComputedStyle(document.querySelector('[data-desk-editor]')).pointerEvents + ':' + document.querySelector('[data-desk-editor]').style.transform");
  check(/^1:rgba\(0, 0, 0, 0\):none:translate\(.*\) rotate\(.*\) translate\(.*\)$/.test(nodes) && !/scale\(|matrix/.test(nodes), `ONE editor element, invisible and never under the pointer, one plain transform (${nodes.split(":").slice(0, 3).join(" · ")})`);

  // keys through the platform: LIVE in the note, the document untouched while the session is open; the pen still writing
  const f0 = await q("window.__desk.submits().total");
  await key("h"); await key("i");
  const live1 = await note(id);
  const wipe1 = await q(`window.__desk.note.wipe(${id})`);
  const doc1 = await docNote(id);
  check(live1?.text === "hi" && doc1?.text === "" && (await q("window.__desk.note.sessionOpen()")), `two keys land in the note LIVE ("${live1?.text}") while the document still holds "${doc1?.text}" — a session is open`);
  check(wipe1 !== null && wipe1.index === 1, `the pen is still writing the last glyph (the wipe at index ${wipe1?.index})`);
  // conditions, not sleeps (D7): the wipe draws frames while it runs, then ends; the idle commit lands when it lands
  const fMid = await until(async () => { const n = await q("window.__desk.submits().total"); return n > f0 ? n : 0; }, 2000);
  const wipeOver = await until(async () => (await q(`window.__desk.note.wipe(${id})`)) === null, 2000);
  check(fMid > f0 && wipeOver, `the wipe drew frames while it ran (${fMid - f0} submits) and is over`);
  const doc2 = await until(async () => { const d = await docNote(id); return d?.text === "hi" ? d : null; }, 5000) ?? (await docNote(id));   // past the 1 s idle: the session commits, the focus stays
  check(doc2?.text === "hi" && !(await q("window.__desk.note.sessionOpen()")) && (await q("window.__desk.note.editing()")) === id && (await q("window.__desk.note.editorFocused()")), `1 s without input commits the session ("${doc2?.text}" in the document) and the editor stays on the note`);
  const blinks = await submitsIn(1100);
  check(blinks >= 1 && blinks <= 4, `at rest with the caret blinking the desk submits ${blinks} frames in 1.1 s — the blink and nothing else`);
  const caret2 = await q("window.__desk.note.caret()");
  const lay2 = await q(`window.__desk.note.layout(${id})`);
  check(caret2?.index === 2 && caret2.entity === id && lay2?.glyphs === 2 && (await q(`window.__desk.note.raster(${id})`)) !== null, `the caret stands after the second glyph (index ${caret2?.index}) and the raster holds ${lay2?.glyphs} glyphs`);
  await shot("type-hi");

  // a tap BETWEEN the glyphs puts the caret there (the layout's own positions → the screen)
  const cam = await q("window.__desk.camera()");
  const G = await q(`window.__desk.entity(${id}).geometry`);
  const [px, py] = [lay2.positions[2], lay2.positions[3] - lay2.ascent * 0.4];   // before glyph 1, a little above the baseline
  const qx = px - 100;
  const qy = py - 100;
  const tap = { x: (G.centre[0] + G.cos * qx - G.sin * qy - cam.x) * cam.zoom, y: (G.centre[1] + G.sin * qx + G.cos * qy - cam.y) * cam.zoom };
  await click(tap.x, tap.y);
  const caret3 = await q("window.__desk.note.caret()");
  check(caret3?.index === 1 && (await q("window.__desk.note.editing()")) === id, `a tap between "h" and "i" puts the pen there: caret index ${caret3?.index}`);

  // the editor follows the camera: a pan, then a wheel zoom about the pointer — its rect stays the sheet's
  await q(`window.__desk.setCamera({ x: ${cam.x + 25}, y: ${cam.y}, zoom: ${cam.zoom} })`);
  await sleep(120);
  const r1 = await q("window.__desk.note.editorRect()");
  const box1 = await sheetBox(id);
  check(near(r1.x - r0.x, -25 * cam.zoom, 0.75) && sameBox(r1, box1), `a 25-unit pan at zoom ${cam.zoom} moves the editor ${(r1.x - r0.x).toFixed(1)} px (${(-25 * cam.zoom).toFixed(1)} expected) — still the sheet's rect`);
  await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box1.cx, y: box1.cy, deltaX: 0, deltaY: -240 });
  await sleep(250);
  const cam2 = await q("window.__desk.camera()");
  const r2 = await q("window.__desk.note.editorRect()");
  const box2 = await sheetBox(id);
  check(cam2.zoom > cam.zoom * 1.1 && sameBox(r2, box2) && (await q("window.__desk.note.editorFocused()")), `a wheel zoom (×${(cam2.zoom / cam.zoom).toFixed(3)}) keeps the editor on the sheet: ${fmt(r2)} vs ${fmt(box2)}, still focused`);

  // the hand-off: erase back to nothing (the pen to the end of the line first), Escape — the sheet is the still it was
  await key("End");
  await key("Backspace"); await key("Backspace");
  const erased = await note(id);
  await key("Escape");
  await sleep(100);
  check(erased?.text === "" && (await q("window.__desk.note.editing()")) === -1 && !(await q("window.__desk.note.editorFocused()")) && (await q("window.__desk.note.claimed()")).length === 0, `⌫⌫ erases the writing live ("${erased?.text}"), Escape ends it: no editor, no claim`);
  await q(`window.__desk.setCamera(${JSON.stringify(cam)})`);
  const C = await shot("type-blurred");
  const dAC = await diff(A, C);
  check(dAC.n === 0, `the hand-off leaves no seam: the sheet before the focus and after the blur (its text put back) differ on ${dAC.n} px (maxΔ ${dAC.max})`);
  check((await docNote(id))?.text === "", `Escape committed the erasing session: the document holds "${(await docNote(id))?.text}"`);

  // write again and keep it: only the sheet's own box changed
  await click(box0.cx, box0.cy);
  await typeKeys("hi");
  await key("Escape");
  const K = await shot("type-kept");
  const dAK = await diff(A, K);
  const dpr = 2;
  const inside = dAK.box !== null && dAK.box[0] >= box0.x * dpr - 4 && dAK.box[2] <= (box0.x + box0.width) * dpr + 4 && dAK.box[1] >= box0.y * dpr - 4 && dAK.box[3] <= (box0.y + box0.height) * dpr + 4;
  check(dAK.n > 200 && inside, `the ink itself changed ${dAK.n} px, all inside the sheet's box ${JSON.stringify(dAK.box)}`);

  // ⌘Z takes a typing SESSION back in one step (never a keystroke); ⇧⌘Z redoes it
  await key("z", META);
  await sleep(150);
  const undone = await docNote(id);
  await key("z", META | SHIFT);
  await sleep(150);
  const redone = await docNote(id);
  check(undone?.text === "" && redone?.text === "hi", `⌘Z after a session restores the text in ONE step ("hi" → "${undone?.text}"), ⇧⌘Z brings the whole session back ("${redone?.text}")`);

  // the editor owns the keys: `w` types (no note stuck), ⌫ erases a glyph (the note stays)
  const count0 = (await q("window.__desk.entities()")).length;
  await click(box0.cx, box0.cy);
  await key("w");
  await key("Backspace");
  const afterKeys = await note(id);
  check((await q("window.__desk.entities()")).length === count0 && afterKeys?.text === "hi" && (await q("window.__desk.note.editing()")) === id, `while writing, \`w\` types instead of sticking a note and ⌫ erases it again ("${afterKeys?.text}", ${count0} object)`);
  await key("Escape");

  // --- 5. the band ladder re-rasters at a rung crossing only — never on a pan or a wobble
  const bandAt = async (camera) => { await q(`window.__desk.setCamera(${JSON.stringify(camera)})`); await settle(); return { r: await q(`window.__desk.note.raster(${id})`), n: (await q("window.__desk.note.writing()")).rasters }; };
  const L0 = await bandAt({ x: 150, y: 120, zoom: 1.6 });
  const Lpan = await bandAt({ x: 190, y: 90, zoom: 1.6 });
  const L1 = await bandAt({ x: 150, y: 120, zoom: 1 });
  const Lwob = await bandAt({ x: 150, y: 120, zoom: 1.9 });
  const L4 = await bandAt({ x: 400, y: 280, zoom: 4 });
  const L05 = await bandAt({ x: -200, y: -200, zoom: 0.5 });
  check(L0.r.band === 4 && Lpan.n === L0.n && L1.r.band === 4 && L1.n === L0.n && Lwob.n === L0.n, `a pan, a zoom out to 1 (kept by the hysteresis) and a wobble to 1.9 re-raster nothing (band ${L0.r.band}, ${L0.n} rasters throughout)`);
  check(L4.r.band === 8 && L4.r.w === 1600 && L4.n === L0.n + 1 && L05.r.band === 1 && L05.r.w === 200 && L05.n === L0.n + 2, `the raster follows the zoom one rung crossing at a time: band 4 → ${L4.r.band} (${L4.r.w}²) → ${L05.r.band} (${L05.r.w}²), ${L05.n - L0.n} re-rasters`);

  // --- 6. delete while editing ends the session and the claim; the note's page rect goes back; undo brings it back as committed
  await q(`window.__desk.setCamera(${JSON.stringify(cam)})`);
  await settle();
  const used0 = (await q("window.__desk.note.pages()")).used;
  await click(box0.cx, box0.cy);
  await key("End");
  await typeKeys(" and more");
  const mid = await note(id);
  await q("window.__desk.engine.ops.deleteSelection()");
  await sleep(500);
  check(mid?.text === "hi and more" && (await q("window.__desk.note.editing()")) === -1 && !(await q("window.__desk.note.editorFocused()")) && (await q("window.__desk.note.claimed()")).length === 0 && (await q(`window.__desk.entity(${id})`)) === null, "a delete while writing ends the session: the note gone, no editor, no claim");
  await settle();
  const usedGone = (await q("window.__desk.note.pages()")).used;
  check(used0 > 0 && usedGone === 0, `the ghost faded, the note's page rect is given back: ${used0} texels in use → ${usedGone}`);
  await key("z", META);
  await settle();
  const back = await q("window.__desk.entities()");
  const backId = back[0]?.id;
  check(back.length === 1 && (await note(backId))?.text === "hi" && (await q(`window.__desk.note.raster(${backId})`)) !== null && (await q("window.__desk.note.pages()")).used === used0, `⌘Z brings the note back as last committed ("${(await note(backId))?.text}" — the interrupted run is gone) and it re-rasters (${(await q("window.__desk.note.pages()")).used} texels)`);
  const cycles = [];
  for (let i = 0; i < 4; i++) {
    const cur = (await q("window.__desk.entities()"))[0].id;
    await q(`window.__desk.engine.ops.setSelection([${cur}], "replace"); window.__desk.engine.ops.deleteSelection()`);
    await settle();
    await key("z", META);
    await settle();
    cycles.push((await q("window.__desk.note.pages()")).used);
  }
  check(cycles.every((u) => u === used0), `four more delete → undo cycles leak no page slot (${cycles.join(", ")} texels in use)`);

  // --- 7. IME text enters as handwriting while it composes (the prototype's behaviour, kept)
  const imeId = await q("window.__desk.spawn('desk.note', { seed: 9 }, { x: 350, y: 300 })");
  await settle();
  const imeBox = await sheetBox(imeId);
  await click(imeBox.cx, imeBox.cy);
  await tab.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await sleep(100);
  const composing = await note(imeId);
  await tab.send("Input.insertText", { text: "日本" });
  await sleep(150);
  const composed = await note(imeId);
  await settle();
  const imeLayout = await q(`window.__desk.note.layout(${imeId})`);
  await key("Escape");
  await sleep(100);
  check(composing?.text === "に" && composed?.text === "日本" && imeLayout?.glyphs === 2 && (await q(`window.__desk.note.raster(${imeId})`)) !== null && (await docNote(imeId))?.text === "日本", `IME text is written as it composes ("${composing?.text}") and as it commits ("${composed?.text}", ${imeLayout?.glyphs} glyphs in the hand), and Escape commits it`);

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
