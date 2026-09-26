// rig:proto-parity — the desk = the PROTOTYPE, in Chrome (design-015 D3r-a, D3r-b). The prototype's prints, whiteboards,
// notebooks and desk calendars had no Node oracle: its PHOTO LAB (lab/photo.html + photo.ts), its BOARD BENCH (lab/board.html +
// board-lab.ts) and its MAIN LAB (lab/index.html + main.ts: the books and the pads) were their only witnesses, and the desk's
// `photo-*` / `board-*` / `book-*` / `pad-*` oracle scenes are new. So this rig holds those scenes to the strongest thing there
// is: the prototype's own pages, built from the frozen snapshot (D-D0.1), each scene staged through the page's own window hooks
// exactly as the prototype's harnesses stage a still (test/harness/{photo,board,notebook,calendar}.mjs), beside apps/desk's
// PARITY page (parity.html, `window.__parity`) drawing the same scene through frame.mjs. Both captured at 1200 × 800 @2 until two
// shots agree; the table is maxΔ and the pixels that differ, per scene. (`rig:parity` then holds apps/desk's page to the Node
// oracle: Chrome = Node = the prototype.)
//
//   DESK_PROTO=<the snapshot's ground/, extracted, with draft/ground's node_modules linked in> \
//   [DESK_PROTO_OUT=<a directory for the prototype's build>] pnpm --filter ./apps/desk rig:proto-parity [scene-regex]
//
// Staging, per page:
// - the photo lab runs on its own clock (a rAF loop stepping every print's physics): the rig takes the loop's rAF over, stops
//   it, stages the still — the mat's clocks and noise pinned, the camera, the theme, each print through `__photo.addRGBA` (the
//   committed picture) with its pose pinned on its body — and runs ONE tick at dt = 0 (no physics moves, the frame renders);
// - the board bench draws on demand: `__board.scene` (its clocks pinned: the mat's time and noise 0, the palm at `goboTime`,
//   the rulers off) + `__board.sketch` per board, then waits for the bench's own `idle`;
// - the main lab draws on demand too: `__ground.setScene` (the camera, the theme, the mat's still clocks, the notes, the books —
//   the lab's own `makeBook` pins them), then for a pad the calendar's own harness door as calendar.mjs uses it (`reset` to the
//   scene's place, month and week, `today`, `pose`, a note `pin`ned to a day) — and the pad's PRINT held back: every page table
//   the lab writes reaches its pass all MISSING (its pass's `writeTable`, wrapped; every table it holds marked dirty once), as
//   the oracle draws a pad whose host has printed no tile — then waits until the lab has nothing left to draw.
// A scene the prototype cannot stage (a print between two notes — the photo lab has no notes; a print inside a mini mat) is
// reported as such, never compared. (D3r-b: the desk's side is `parity.html` — D2a-world made `index.html` the REAL desk, whose
// `window.__desk` draws no oracle scene; this rig, written before that and rebased over it, still drove `index.html` and threw.)
// THE EXIT CODE: the number of stageable scenes whose captures differ and whose difference is not a named, measured exception
// (EXCEPTIONS, below — none today); 1 for a failed preflight or a throw; 2 for the watchdog.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ORACLE_SCENES } from "@ice/desk/oracle/scenes.mjs";
import { launchChrome, openTab } from "./cdp.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const results = resolve(app, "results");
mkdirSync(results, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A difference that is understood, measured and kept on purpose: scene name → the reason. The prototype drew its prints in a
 * render pass of their own after the ground's (loadOp "load"), the desk draws them as runs in its one pass — the same premultiplied
 * blend onto the same 8-bit bytes, so no exception is expected there; nor for its books (a command buffer of their own after the
 * ground's: shadow maps, the 4× layer, a composite pass with "load") and its pads (a layer submitted before the ground's, laid as
 * an `underlays` entry), which the desk records into its one frame and lays as each kind's composite run (D3r-b: none was needed).
 * This table stays empty unless a run proves one.
 */
const EXCEPTIONS = {};

/**
 * The prototype's pages draw a selection as the kinds' own ring and no marks; the desk retired that ring for the marks pass (D4a).
 * A scene with a selection is drawn on the desk's side as the prototype drew it — frame.mjs's `prototypeRing`, the oracle's own
 * BASELINE rule — so this rig holds the objects to the prototype, and `rig:parity` holds the marks to the Node oracle.
 */
const selects = (s) => [...(s.notes ?? []), ...(s.minimats ?? []), ...(s.boards ?? []), ...(s.prints ?? []), ...(s.books ?? []), ...(s.calendars ?? []), ...(s.things ?? [])].some((o) => o.selected);

// ── Preflight: the prototype, its build tool, the page's build ──────────────────────────────────────────────────────────────
const die = (what, how) => { console.log(`PREFLIGHT FAIL: ${what}\n  ${how}`); process.exit(1); };
const proto = process.env.DESK_PROTO ? resolve(process.env.DESK_PROTO) : null;
if (!proto) die("DESK_PROTO is not set", "extract vibe-field/draft/ground/results/backup/ground-at-desk-port-2026-09-25.tgz into a scratch directory, link draft/ground's node_modules into its ground/, and point DESK_PROTO at that ground/");
for (const f of ["lab/photo.html", "lab/photo.ts", "lab/board.html", "lab/board-lab.ts", "lab/index.html", "lab/main.ts", "node_modules/.bin/vite"]) if (!existsSync(join(proto, f))) die(`${join(proto, f)} is missing`, "DESK_PROTO must be the snapshot's ground/ with its node_modules");
if (!existsSync(resolve(app, "dist/parity.html"))) die("the parity page's build is missing (apps/desk/dist/parity.html)", "pnpm --filter ./apps/desk build");
const picturePath = resolve(repo, "packages/desk/oracle/fixtures/assets/photo-1.rgba");
const pictureMeta = JSON.parse(readFileSync(resolve(repo, "packages/desk/oracle/fixtures/assets/photo-1.json"), "utf8"));
const out = process.env.DESK_PROTO_OUT ? resolve(process.env.DESK_PROTO_OUT) : mkdtempSync(join(tmpdir(), "desk-proto-"));
mkdirSync(out, { recursive: true });

// ── Which scenes, and how each page stages them ────────────────────────────────────────────────────────────────────────────
const matOf = (s) => ({ time: s.mat?.time ?? 0, goboTime: s.mat?.goboTime ?? 0, noise: s.mat?.noise ?? [0, 0] });
const PRINT_KEYS = new Set(["x", "y", "angle", "height", "sx", "sy", "bend", "ax", "ay", "hold"]);
const NOTE_KEYS = new Set(["x", "y", "seed", "text"]);
const BOARD_KEYS = new Set(["x", "y", "selected", "strokes"]);
const BOOK_KEYS = new Set(["kind", "x", "y", "angle", "cover", "ruling", "sheets", "seed", "open", "left", "turn", "peek", "held", "tilt", "selected"]);
const PAD_KEYS = new Set(["x", "y", "month", "weekStart", "pose"]);
const MAIN_NOTE_KEYS = new Set(["kind", "x", "y", "seed", "text", "pin"]);
/** The prototype page that can stage a scene exactly, or why none can. */
function stagingOf(s) {
  const has = (k) => s[k] !== undefined && !(Array.isArray(s[k]) && s[k].length === 0);
  // the MAIN LAB (D3r-b): its books over everything — as the desk's composite run draws them, whatever the desk's order — and its
  // pads beneath; its notes blank (their hand is a Canvas 2D raster the oracle has only as a committed fixture)
  const things = s.things ?? [];
  if (has("books") || has("calendars") || things.some((t) => t.kind === "book")) {
    if (has("minimats") || has("nav") || has("prints") || has("boards") || s.ruler !== undefined || s.lodZoom !== undefined || s.mat?.opacity !== undefined || s.mat?.plate !== undefined) return { why: "the main lab stages books and pads on a bare desk (no mini mat, flight, print, board, rulers or tuned gobo)" };
    if (things.some((t) => t.kind !== "note" && t.kind !== "book")) return { why: "the main lab's things here are notes and books" };
    const books = [...(s.books ?? []), ...things.filter((t) => t.kind === "book")].map(({ kind: _k, ...b }) => b);
    const notes = [...(s.notes ?? []), ...things.filter((t) => t.kind === "note")].map(({ kind: _k, ...n }) => n);
    if (books.some((b) => Object.keys(b).some((k) => !BOOK_KEYS.has(k)))) return { why: "a book the lab's makeBook cannot make" };
    if ((s.calendars ?? []).some((c) => Object.keys(c).some((k) => !PAD_KEYS.has(k)))) return { why: "a pad the lab's calendar door cannot pose" };
    if (notes.some((n) => Object.keys(n).some((k) => !MAIN_NOTE_KEYS.has(k)) || (n.text ?? "") !== "")) return { why: "a note the rig cannot write (it stages blank notes)" };
    return { page: "main", books, notes };
  }
  if (has("minimats") || has("things") || has("nav") || s.ruler !== undefined || s.lodZoom !== undefined || s.mat?.opacity !== undefined || s.mat?.plate !== undefined) return { why: "no prototype page holds it (a mini mat, a flight, the rulers, a desk's own order, the gobo tuned)" };
  if (has("prints")) {
    if (has("notes") || has("boards")) return { why: "the photo lab has prints and nothing else" };
    if (s.prints.some((p) => Object.keys(p).some((k) => !PRINT_KEYS.has(k)) || p.picture !== undefined)) return { why: "a print the lab's addRGBA cannot make" };
    return { page: "photo" };
  }
  if (has("boards")) {
    const m = matOf(s);
    if (m.time !== 0 || m.noise[0] !== 0 || m.noise[1] !== 0) return { why: "the bench pins the mat's time and noise at 0" };
    if (s.boards.some((b) => Object.keys(b).some((k) => !BOARD_KEYS.has(k)))) return { why: "a board the bench's scene cannot make" };
    if ((s.notes ?? []).some((n) => Object.keys(n).some((k) => !NOTE_KEYS.has(k)) || (n.text ?? "") !== "")) return { why: "a note the bench cannot make (it draws blank felt notes)" };
    return { page: "board" };
  }
  return { why: "neither a print nor a board" };
}
const scenes = ORACLE_SCENES.filter((sc) => /^(photo|board|book|pad)-/.test(sc.name) && (!only || only.test(sc.name)));
if (scenes.length === 0) die(`no photo-/board-/book-/pad- oracle scene matches ${only}`, "pnpm --filter ./apps/desk rig:proto-parity [scene-regex]");

// ── The prototype's two pages, built by its own vite from the snapshot (a plain config object: nothing to resolve) ──────────
const pages = join(out, "pages");
const config = join(out, "vite.proto.config.mjs");
writeFileSync(config, `export default ${JSON.stringify({
  root: join(proto, "lab"), base: "./", logLevel: "warn",
  build: { outDir: pages, emptyOutDir: true, target: "esnext", rollupOptions: { input: { photo: join(proto, "lab/photo.html"), board: join(proto, "lab/board.html"), index: join(proto, "lab/index.html") } } },
}, null, 2)};\n`);
const t0 = performance.now();
execFileSync(join(proto, "node_modules/.bin/vite"), ["build", "--config", config], { cwd: proto, stdio: "inherit" });
console.log(`the prototype's photo lab, board bench and main lab built from ${proto} into ${pages} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

/** A CDP port nothing listens on — never drive another session's Chrome by accident. */
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const serve = async (root) => {
  const child = spawn(process.execPath, [resolve(here, "server.mjs"), root, "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((r) => child.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
  return { child, port };
};

let threw = false;
let failures = 0;
const deskServer = await serve(repo);
const protoServer = await serve(pages);
const chrome = await launchChrome({ port: await freePort(9511), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} for (const s of [deskServer, protoServer]) try { s.child.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 1_500_000).unref();

const front = (tab) => tab.send("Page.bringToFront");
/** Two frames and a beat — on the page's ORIGINAL rAF (the photo lab's is taken over, see below). */
const SETTLE = "new Promise((resolve) => { const raf = window.__freeze?.raf ?? requestAnimationFrame; raf(() => raf(() => setTimeout(resolve, 60))); })";
async function settle(tab) { await front(tab); await tab.evaluate(SETTLE, { awaitPromise: true, timeoutMs: 30000 }); }
/** Capture until two consecutive shots are byte-identical (on this loaded host the compositor can hand back the previous frame). */
async function capture(tab) {
  let prev = null;
  for (let i = 0; i < 6; i++) {
    await front(tab);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    if (data === prev) return data;
    prev = data;
    await settle(tab);
  }
  return prev;
}
async function openPage(url, ready) {
  const tab = await openTab(chrome.port, url);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`[error] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) {
    await front(tab);
    if (await tab.evaluate(`(${ready}) || !document.getElementById('fail').hidden`, { timeoutMs: 20000 })) break;
    await sleep(200);
  }
  const fail = await tab.evaluate("document.getElementById('fail').hidden ? null : document.getElementById('fail').textContent", { timeoutMs: 20000 });
  if (fail || !(await tab.evaluate(ready, { timeoutMs: 20000 }))) throw new Error(`${url} did not come up: ${fail ?? "never ready"} ${logs.join(" | ")}`);
  return { tab, logs };
}

// The photo lab's loop, taken over: every rAF the page asks for goes through this wrapper, which records the frame's time; frozen,
// the next request is KEPT instead — so the lab's tick can be run once by hand at the very time it last ran (dt = 0: no print moves).
const FREEZE = `(() => {
  const F = window.__freeze = { raf: window.requestAnimationFrame.bind(window), frozen: false, tick: null, t: 0 };
  window.requestAnimationFrame = (cb) => { if (F.frozen) { F.tick = cb; return 0; } return F.raf((t) => { F.t = t; cb(t); }); };
})()`;
/** The photo lab staged for one scene and drawn once. */
const stagePhoto = (s) => `(() => {
  const P = window.__photo;
  const F = window.__freeze;
  if (!F.tick) throw new Error("the photo lab's loop is not frozen");
  P.pin(${JSON.stringify(matOf(s).noise)});
  P.state.matTime = ${matOf(s).time}; P.state.goboTime = ${matOf(s).goboTime}; P.state.noise = ${JSON.stringify(matOf(s).noise)};
  P.setTheme(${JSON.stringify(s.theme)});
  P.setCamera(${s.camX}, ${s.camY}, ${s.zoom});
  P.prints.length = 0;
  for (const p of ${JSON.stringify(s.prints)}) {
    const i = P.addRGBA(window.__picture, ${pictureMeta.w}, ${pictureMeta.h}, [p.x, p.y], p.height ?? 0);
    const b = P.prints[i].body;
    for (const k of ["angle", "sx", "sy", "bend", "ax", "ay"]) if (p[k] !== undefined) b[k] = p[k];
    if (p.hold) b.hold = { gx: p.hold.gx, gy: p.hold.gy, px: p.hold.px, py: p.hold.py, vx: 0, vy: 0, ax: 0, ay: 0, trail: [[0, p.hold.px, p.hold.py]] };
  }
  const tick = F.tick;
  F.tick = null;
  tick(F.t);   // dt = 0: the physics stands still; the frame renders exactly the pose staged
  return P.prints.length;
})()`;
/** The board bench staged for one scene (its own `scene` and `sketch`). */
const stageBoard = (s) => {
  const spec = {
    camX: s.camX, camY: s.camY, zoom: s.zoom, theme: s.theme, goboTime: matOf(s).goboTime, wind: 0, ruler: false, bare: true,
    boards: s.boards.map((b) => ({ x: b.x, y: b.y, selected: !!b.selected })), notes: (s.notes ?? []).map((n) => ({ cx: n.x, cy: n.y, seed: n.seed })),
  };
  return `(() => {
    window.__board.scene(${JSON.stringify(spec)});
    ${s.boards.map((b, i) => (b.strokes?.length ? `window.__board.sketch(${i}, ${JSON.stringify(b.strokes)});` : "")).join("\n")}
    return window.__board.desk.boards.length;
  })()`;
};
async function boardIdle(tab) {
  for (let i = 0; i < 400; i++) { await front(tab); if (await tab.evaluate("window.__board.idle", { timeoutMs: 20000 })) return; await sleep(50); }
  throw new Error("the board bench never went idle");
}
/**
 * The main lab staged for one scene (D3r-b): its own `setScene` — the camera, the theme, the mat's still clocks, the notes, the books
 * (the lab's `makeBook` pins them as the spec says) and the pads it names — then each pad through the calendar's harness door as
 * calendar.mjs uses it (`reset` to the scene's place, month and week, `today`, `pose`) and each stuck note `pin`ned to its day; the
 * pad's print held back (every page table MISSING — see the header). Returns what the lab holds: books, pads, notes.
 */
const stageMain = (s, staging) => {
  const spec = { camX: s.camX, camY: s.camY, zoom: s.zoom, theme: s.theme, mat: matOf(s), notes: staging.notes.map(({ pin: _p, ...n }) => n), books: staging.books, ...(s.calendars ? { calendars: s.calendars.map((c) => ({ x: c.x, y: c.y })) } : {}) };
  const pads = s.calendars ?? [];
  const pins = staging.notes.map((n, i) => (n.pin ? [i, n.pin.pad ?? 0, n.pin.day] : null)).filter((p) => p !== null);
  return `(() => {
    const G = window.__ground;
    G.setScene(${JSON.stringify(spec)});
    for (const el of document.querySelectorAll('#legend, #stats, #panel, .panel')) el.style.visibility = 'hidden';
    const C = G.calendar;
    if (C) {
      // the print held back: every table the lab writes reaches its pass MISSING, and every table it holds is written once more
      const pass = C.desk.pass;
      if (!pass.__missing) { const write = pass.writeTable.bind(pass); pass.writeTable = (slot, grid, table) => write(slot, grid, new Int32Array(table.length).fill(-1)); pass.__missing = true; }
      for (const t of C.desk.tables.values()) t.dirty = true;
      ${JSON.stringify(pads)}.forEach((c, i) => { C.reset(i, { x: c.x, y: c.y }, c.month ?? "2026-09", c.weekStart ?? 1); C.pose(i, c.pose ?? {}); });
      C.today("2026-09-24");
      for (const [note, pad, day] of ${JSON.stringify(pins)}) C.pin(note, pad, day);
    }
    return { books: ${staging.books.length}, pads: C ? C.desk.calendars.length : 0, notes: ${staging.notes.length} };
  })()`;
};
/**
 * The main lab has nothing left to draw — or, as calendar.mjs's own `settle` allows (it waits 8 s, then shoots), a still that keeps
 * the lab drawing the same frame: a pad's roll pinned part-way is a turn in progress, so the lab's clock never stops (lab/calendar.ts
 * `step`: `if (c.turn) live = true`). Then the capture's two identical shots are the witness that the frame stands. Returns whether
 * the lab went idle.
 */
async function mainIdle(tab) {
  for (let i = 0; i < 80; i++) { await front(tab); if (await tab.evaluate("!window.__ground.state.needsDraw", { timeoutMs: 20000 })) return true; await sleep(50); }
  return false;
}

/** The two captures as pixels: maxΔ over RGB, and how many pixels differ at all. */
function compare(a, b) {
  const A = decodePng(Buffer.from(a, "base64"));
  const B = decodePng(Buffer.from(b, "base64"));
  if (A.width !== B.width || A.height !== B.height) return { error: `${A.width}×${A.height} vs ${B.width}×${B.height}` };
  let maxD = 0;
  let differ = 0;
  for (let o = 0; o < A.rgba.length; o += 4) {
    const d = Math.max(Math.abs(A.rgba[o] - B.rgba[o]), Math.abs(A.rgba[o + 1] - B.rgba[o + 1]), Math.abs(A.rgba[o + 2] - B.rgba[o + 2]));
    if (d > maxD) maxD = d;
    if (d > 0) differ++;
  }
  return { w: A.width, h: A.height, maxD, differ, same: a === b };
}

try {
  const desk = await openPage(`http://127.0.0.1:${deskServer.port}/apps/desk/dist/parity.html`, "typeof window.__parity === 'object'");
  const lab = await openPage(`http://127.0.0.1:${protoServer.port}/photo.html`, "typeof window.__photo === 'object' && window.__photo.state.ready && window.__photo.state.frames > 2");
  const bench = await openPage(`http://127.0.0.1:${protoServer.port}/board.html`, "!!window.__board && window.__board.ready");
  const main = await openPage(`http://127.0.0.1:${protoServer.port}/index.html`, "typeof window.__ground === 'object' && window.__ground.state.assetsReady && window.__ground.books.pass().ready && window.__ground.calendar !== null");
  console.log(`chrome ${chrome.version.Browser} · apps/desk's parity page ${await desk.tab.evaluate("window.__parity.format", { timeoutMs: 20000 })} · the photo lab, the board bench and the main lab up`);
  // the photo lab: its overlays hidden (the harness's `hide`), its picture handed in once, its loop taken over and stopped
  await lab.tab.evaluate("for (const el of document.querySelectorAll('#legend, #stats, #hint')) el.style.visibility = 'hidden'", { timeoutMs: 20000 });
  await lab.tab.evaluate(`window.__picture = Uint8Array.from(atob(${JSON.stringify(readFileSync(picturePath).toString("base64"))}), (c) => c.charCodeAt(0))`, { timeoutMs: 60000 });
  await lab.tab.evaluate(FREEZE, { timeoutMs: 20000 });
  for (let i = 0; i < 200; i++) { await settle(lab.tab); if (await lab.tab.evaluate("window.__freeze.t > 0", { timeoutMs: 20000 })) break; }
  await lab.tab.evaluate("window.__freeze.frozen = true", { timeoutMs: 20000 });
  for (let i = 0; i < 200; i++) { await settle(lab.tab); if (await lab.tab.evaluate("!!window.__freeze.tick", { timeoutMs: 20000 })) break; }
  if (!(await lab.tab.evaluate("!!window.__freeze.tick", { timeoutMs: 20000 }))) throw new Error("the photo lab's loop would not stop");

  console.log("\nscene                     prototype page      desk vs prototype                          ");
  let compared = 0;
  let skipped = 0;
  for (const sc of scenes) {
    const s = sc.scene;
    const staging = stagingOf(s);
    if (!staging.page) { skipped++; console.log(`SKIP  ${sc.name.padEnd(24)} —                   ${staging.why}`); continue; }
    // the prototype's page
    const page = staging.page === "photo" ? lab : staging.page === "board" ? bench : main;
    await front(page.tab);
    const staged = await page.tab.evaluate(staging.page === "photo" ? stagePhoto(s) : staging.page === "board" ? stageBoard(s) : stageMain(s, staging), { timeoutMs: 60000 });
    if (staging.page === "board") await boardIdle(page.tab);
    const idle = staging.page === "main" ? await mainIdle(page.tab) : true;
    await settle(page.tab); await sleep(200); await settle(page.tab);
    const protoPng = await capture(page.tab);
    // the desk's page, the same scene through frame.mjs
    await front(desk.tab);
    await desk.tab.evaluate(`window.__parity.render(${JSON.stringify(sc.name)}${selects(s) ? ", { prototypeRing: true }" : ""})`, { awaitPromise: true, timeoutMs: 60000 });
    await settle(desk.tab); await sleep(200); await settle(desk.tab);
    const deskPng = await capture(desk.tab);
    const r = compare(protoPng, deskPng);
    compared++;
    const clean = r.error === undefined && r.maxD === 0;
    const excused = !clean && EXCEPTIONS[sc.name];
    if (!clean) {
      writeFileSync(resolve(results, `proto-${sc.name}-prototype.png`), Buffer.from(protoPng, "base64"));
      writeFileSync(resolve(results, `proto-${sc.name}-desk.png`), Buffer.from(deskPng, "base64"));
      if (!excused) failures++;
    }
    const detail = r.error === undefined ? `maxΔ ${r.maxD} · ${r.differ} px differ · ${r.w}×${r.h}${r.same ? " · the PNGs byte-identical" : ""}` : `ERROR ${r.error}`;
    const held = typeof staged === "object" ? `${staged.books}b ${staged.pads}p ${staged.notes}n${idle ? "" : " live"}` : staged;
    console.log(`${clean ? "PASS" : excused ? "KEPT" : "FAIL"}  ${sc.name.padEnd(24)} ${`${staging.page === "photo" ? "photo lab" : staging.page === "board" ? "board bench" : "main lab"} (${held})`.padEnd(19)} ${detail}${excused ? ` — ${excused}` : ""}`);
  }
  console.log(`\n${compared} scene${compared === 1 ? "" : "s"} held to the prototype · ${failures} FAILED · ${skipped} not stageable there`);
  const logs = [...lab.logs, ...bench.logs, ...main.logs, ...desk.logs];
  if (logs.length) console.log(`\npage logs:\n  ${logs.slice(0, 8).join("\n  ")}`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  threw = true;
} finally {
  await cleanup();
}
process.exit(threw ? 1 : Math.min(failures, 250));
