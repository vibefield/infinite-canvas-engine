// rig:cost — the notebook's and the desk calendar's COST re-measured on this host THROUGH THE REGISTRY (design-015 D3r-b), and
// since D5a the MAT's and the RULERS' (MAT.md §5 — the day's and the night's; RULER.md — the mat with the rulers, same view): the
// prototype's own tables (NOTEBOOK.md §9, CALENDAR.md §9, MAT.md §5, RULER.md — its harnesses' `perf` scenes,
// test/harness/{notebook,calendar,mat,ruler}.mjs; the mat's "blowing" row is not carried — the parity page's bench draws a still)
// drawn by apps/desk's parity page through the oracle's desk (frame.mjs → prepareFrame → drawFrame, the two layered kinds among
// the note and the mini mat), and — when DESK_PROTO names the frozen snapshot — by the prototype's own main lab beside it, round
// for round under the same load (its books a command buffer of their own after the ground's, its pads' layer one before).
//
//   [DESK_PROTO=<the snapshot's ground/ with draft/ground's node_modules linked in>] [DESK_PROTO_OUT=<dir>] \
//   pnpm --filter ./apps/desk rig:cost [label-regex]
//
// The method is the harnesses' own: a saturated batch of frames drawn back to back into the canvas's current texture, the GPU
// drained before and after, ms per frame and the CPU µs of recording one; a 4-frame probe sizes the batch to ~25 ms; median and
// min over ROUNDS rounds, the two pages alternating which goes first; the host's 1-minute load recorded at every scene. The pads
// draw with NO print on either side (the desk's oracle draws a pad whose host printed no tile; the lab's page tables are held
// MISSING as rig:proto-parity holds them) — the prototype's §9 rows sampled its tiles. The lab's own clock is stopped during a
// batch (a pad's pinned roll keeps it drawing). Nothing else should run beside it (the landing discipline). THE EXIT CODE: 0 once
// the table is printed; 1 for a failed preflight or a throw; 2 for the watchdog.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const ROUNDS = Number(process.env.DESK_COST_ROUNDS ?? 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The scenes: the harnesses' `perf` scenes, as the prototype's current snapshot states them ──────────────────────────────────
const still = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };
const base = { theme: "light", mat: still };
const at = (cx, cy, z) => ({ camX: cx - 600 / z, camY: cy - 400 / z, zoom: z });
/** test/harness/{mat,ruler}.mjs's view: the camera's corner at (13.7, −21.3), at zoom `z`. */
const cam = (z) => ({ camX: 13.7, camY: -21.3, zoom: z });
/** test/harness/scene.mjs `makeDesk(n)`: notes and MINI MATS on a golden spiral, every third a mini mat holding two notes. */
function makeDesk(n, seed = 1) {
  const notes = [];
  const minimats = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963 + seed;
    const rad = 560 * Math.sqrt((i + 1) / Math.max(n, 1));
    const x = 600 + Math.cos(a) * rad;
    const y = 400 + Math.sin(a) * rad;
    if (i % 3 === 2) {
      const w = 240 + ((i * 37) % 160);
      const h = 180 + ((i * 53) % 120);
      minimats.push({ x, y, w, h, name: `Desk ${i}`, inside: { notes: [{ x: -110, y: -40, seed: 100 + i }, { x: 90, y: 30, seed: 200 + i }], minimats: [] } });
    } else notes.push({ x, y, seed: 1 + i, text: "" });
  }
  return { notes, minimats };
}
const nb = (extra = {}) => ({ x: 0, y: 0, angle: 0, cover: "orbit", seed: 7, ...extra });
const spreadX = -(180 + 17) / 2;
const shelf = (n, open) => Array.from({ length: n }, (_, i) => nb({ x: (i % 4) * 420 - 600, y: Math.floor(i / 4) * 320 - 300, cover: ["ink", "orbit", "tiles", "label"][i % 4], ...(open ? { open: true, left: 5 + i } : {}) }));
const SHEET = { W: 1760, H: 1852 };
const wpt = (sx, sy) => [sx - SHEET.W / 2, sy - SHEET.H / 2];
const pad = (x, y, pose) => ({ x, y, month: "2026-09", weekStart: 1, ...(pose ? { pose } : {}) });
/** Each row: its label, the scene, and the prototype's own figure (median · min, ms/frame) from its record. */
const SCENES = [
  ["NOTEBOOK.md §9", "12 objects, no notebook", { ...base, ...at(0, 0, 1), ...makeDesk(12), books: [] }, "0.91 · 0.78 (12 cards)"],
  ["NOTEBOOK.md §9", "12 objects + 1 closed", { ...base, ...at(0, 0, 1), ...makeDesk(12), books: [nb()] }, "1.59 · 1.55"],
  ["NOTEBOOK.md §9", "12 objects + 1 open", { ...base, ...at(0, 0, 1), ...makeDesk(12), books: [nb({ open: true, left: 5 })] }, "1.88 · 1.85"],
  ["NOTEBOOK.md §9", "12 objects + 1 turning", { ...base, ...at(0, 0, 1), ...makeDesk(12), books: [nb({ open: true, left: 5, turn: { dir: 1, phi: 1.1, psi: 1.6 } })] }, "3.27 · 3.18"],
  ["NOTEBOOK.md §9", "1 open, focused (zoom 2.2)", { ...base, ...at(spreadX, 0, 2.2), books: [nb({ open: true, left: 20 })] }, "3.04 · 2.96"],
  ["NOTEBOOK.md §9", "12 objects + 12 closed", { ...base, ...at(0, 0, 0.7), ...makeDesk(12), books: shelf(12, false) }, "3.14 · 3.10"],
  ["NOTEBOOK.md §9", "12 objects + 12 open", { ...base, ...at(0, 0, 0.7), ...makeDesk(12), books: shelf(12, true) }, "4.97 · 4.77"],
  ["CALENDAR.md §9", "12 objects, the pad off screen", { ...base, ...at(0, 0, 1), ...makeDesk(12), calendars: [pad(9000, 0)] }, "0.58 · 0.56 (12 cards)"],
  ["CALENDAR.md §9", "12 objects + the pad under them", { ...base, ...at(0, 0, 1), ...makeDesk(12), calendars: [pad(0, 0)] }, "4.06 · 4.04 (12 cards)"],
  ["CALENDAR.md §9", "the whole pad (zoom 0.42)", { ...base, ...at(0, 0, 0.42), calendars: [pad(0, 0)] }, "2.42 · 2.36"],
  ["CALENDAR.md §9", "a week up close (zoom 1.3)", { ...base, ...at(...wpt(1000, 1300), 1.3), calendars: [pad(0, 0)] }, "3.45 · 3.43"],
  ["CALENDAR.md §9", "the whole pad, rolling", { ...base, ...at(0, 0, 0.42), calendars: [pad(0, 0, { dir: 1, p: 0.5 })] }, "4.33 · 3.82"],
  // the mat (MAT.md §5: the day's and the night's, medians of seven) and the rulers (RULER.md: the mat alone vs with them, medians of
  // five) — test/harness/{mat,ruler}.mjs's own views (the camera at (13.7, −21.3)), their `makeDesk(48)` for "48 cards + frames"
  ["MAT.md §5", "mat, lines only · day", { ...base, ...cam(1), mat: { ...still, opacity: 0 } }, "0.670 (day)"],
  ["MAT.md §5", "mat, lines only · night", { ...base, theme: "dark", ...cam(1), mat: { ...still, opacity: 0 } }, "0.804 (night)"],
  ["MAT.md §5", "mat, gobo still · day", { ...base, ...cam(1) }, "0.929 (day)"],
  ["MAT.md §5", "mat, gobo still · night", { ...base, theme: "dark", ...cam(1) }, "0.966 (night)"],
  ["MAT.md §5", "mat, 48 objects · day", { ...base, ...cam(1), ...makeDesk(48) }, "1.615 (day)"],
  ["MAT.md §5", "mat, 48 objects · night", { ...base, theme: "dark", ...cam(1), ...makeDesk(48) }, "1.627 (night)"],
  ["MAT.md §5", "mat, 48 objects, zoom 6.31 · day", { ...base, ...cam(6.31), ...makeDesk(48) }, "1.117 (day)"],
  ["RULER.md", "rulers, gobo still · zoom 1", { ...base, ...cam(1), ruler: {} }, "0.907 (mat 0.919)"],
  ["RULER.md", "rulers, gobo still · zoom 7", { ...base, ...cam(7), ruler: {} }, "1.216 (mat 1.256)"],
  ["RULER.md", "rulers, 48 objects · zoom 1", { ...base, ...cam(1), ...makeDesk(48), ruler: {} }, "1.781 (mat 1.732)"],
].filter(([, label]) => !only || only.test(label));

// ── Preflight ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const die = (what, how) => { console.log(`PREFLIGHT FAIL: ${what}\n  ${how}`); process.exit(1); };
if (SCENES.length === 0) die(`no scene matches ${only}`, "pnpm --filter ./apps/desk rig:cost [label-regex]");
if (!existsSync(resolve(app, "dist/parity.html"))) die("the parity page's build is missing (apps/desk/dist/parity.html)", "pnpm --filter ./apps/desk build");
const proto = process.env.DESK_PROTO ? resolve(process.env.DESK_PROTO) : null;
if (proto) for (const f of ["lab/index.html", "lab/main.ts", "node_modules/.bin/vite"]) if (!existsSync(join(proto, f))) die(`${join(proto, f)} is missing`, "DESK_PROTO must be the snapshot's ground/ with its node_modules");
let pages = null;
if (proto) {
  const out = process.env.DESK_PROTO_OUT ? resolve(process.env.DESK_PROTO_OUT) : mkdtempSync(join(tmpdir(), "desk-cost-"));
  mkdirSync(out, { recursive: true });
  pages = join(out, "pages");
  const config = join(out, "vite.proto.config.mjs");
  writeFileSync(config, `export default ${JSON.stringify({ root: join(proto, "lab"), base: "./", logLevel: "warn", build: { outDir: pages, emptyOutDir: true, target: "esnext", rollupOptions: { input: { index: join(proto, "lab/index.html") } } } }, null, 2)};\n`);
  execFileSync(join(proto, "node_modules/.bin/vite"), ["build", "--config", config], { cwd: proto, stdio: "inherit" });
}

const serve = async (root) => {
  const child = spawn(process.execPath, [resolve(here, "server.mjs"), root, "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((r) => child.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
  return { child, port };
};

let threw = false;
const deskServer = await serve(repo);
const protoServer = pages ? await serve(pages) : null;
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} for (const s of [deskServer, protoServer]) try { s?.child.kill("SIGKILL"); } catch {} }
const kick = watchdog(2_400_000, cleanup);   // no row in 2400 s: a hang (K-H — a slow host is not one)

const front = (tab) => tab.send("Page.bringToFront");
async function openPage(url, ready) {
  const tab = await openTab(chrome.port, url);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await front(tab); if (await tab.evaluate(`(${ready}) || !document.getElementById('fail').hidden`, { timeoutMs: 20000 })) break; await sleep(200); }
  const fail = await tab.evaluate("document.getElementById('fail').hidden ? null : document.getElementById('fail').textContent", { timeoutMs: 20000 });
  if (fail || !(await tab.evaluate(ready, { timeoutMs: 20000 }))) throw new Error(`${url} did not come up: ${fail ?? "never ready"}`);
  return tab;
}

/** The lab staged for one scene: its own setScene, each pad through the calendar's harness door, the print held back (rig:proto-parity's staging, with the mini mats the perf desks carry). */
const stageLab = (s) => `(() => {
  const G = window.__ground;
  G.setScene(${JSON.stringify({ camX: s.camX, camY: s.camY, zoom: s.zoom, theme: s.theme, mat: s.mat, notes: s.notes ?? [], minimats: s.minimats ?? [], books: s.books ?? [], ...(s.calendars ? { calendars: s.calendars.map((c) => ({ x: c.x, y: c.y })) } : {}) })});
  for (const el of document.querySelectorAll('#legend, #stats, #panel, .panel')) el.style.visibility = 'hidden';
  const C = G.calendar;
  const pass = C.desk.pass;
  if (!pass.__missing) { const write = pass.writeTable.bind(pass); pass.writeTable = (slot, grid, table) => write(slot, grid, new Int32Array(table.length).fill(-1)); pass.__missing = true; }
  for (const t of C.desk.tables.values()) t.dirty = true;
  ${JSON.stringify(s.calendars ?? [])}.forEach((c, i) => { C.reset(i, { x: c.x, y: c.y }, c.month, c.weekStart); C.pose(i, c.pose ?? {}); });
  return true;
})()`;
/** The lab's rAF loop taken over (the photo lab's FREEZE): frozen, its next request is kept, not run — no frame of its own lands in a batch. */
const FREEZE = `(() => {
  const F = window.__freeze = { raf: window.requestAnimationFrame.bind(window), frozen: false, tick: null };
  window.requestAnimationFrame = (cb) => { if (F.frozen) { F.tick = cb; return 0; } return F.raf(cb); };
})()`;
const THAW = "(() => { const F = window.__freeze; F.frozen = false; const t = F.tick; F.tick = null; if (t) F.raf(t); })()";
/** One batch: `n` frames back to back, the GPU drained before and after (the harnesses' ARM, on each page's own door). */
const labBatch = (n) => `(async () => { const g = window.__ground; const qq = g.ground.device.queue; window.__freeze.frozen = true; await qq.onSubmittedWorkDone();
  const t0 = performance.now(); let cpu = 0;
  for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
  await qq.onSubmittedWorkDone(); const r = { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; ${THAW}; return r; })()`;
const deskBatch = (spec, n) => `window.__parity.bench(${JSON.stringify(spec)}, ${n})`;
async function measure(tab, batch) {
  await front(tab);
  const probe = await tab.evaluate(batch(4), { awaitPromise: true, timeoutMs: 120000 });
  const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
  return tab.evaluate(batch(B), { awaitPromise: true, timeoutMs: 120000 });
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const fmt = (R) => `${med(R).toFixed(3).padStart(6)} · ${Math.min(...R).toFixed(3).padStart(6)}`;

try {
  const desk = await openPage(`http://127.0.0.1:${deskServer.port}/apps/desk/dist/parity.html`, "typeof window.__parity === 'object'");
  const lab = protoServer ? await openPage(`http://127.0.0.1:${protoServer.port}/index.html`, "typeof window.__ground === 'object' && window.__ground.state.assetsReady && window.__ground.books.pass().ready && window.__ground.calendar !== null") : null;
  if (lab) await lab.evaluate(FREEZE, { timeoutMs: 20000 });
  console.log(`chrome ${chrome.version.Browser} · ${ROUNDS} rounds · 1200 × 800 @2 · apps/desk's parity page (the registry)${lab ? " and the prototype's main lab" : " (DESK_PROTO unset: the desk alone)"}`);
  console.log(`\n${"scene".padEnd(34)} ${"the registry ms/frame".padEnd(22)} cpu µs   ${lab ? `${"the prototype, now".padEnd(19)} cpu µs   ` : ""}its record (§9)            load`);
  for (const [, label, s, record] of SCENES) {
    const load0 = loadavg()[0];
    const spec = JSON.stringify(s);
    if (lab) {
      await front(lab);
      await lab.evaluate(stageLab(s), { timeoutMs: 60000 });
      // settle as the harness does: the lab draws until it has nothing left (its tiles, the notes' springs) — bounded (a pinned roll never stops)
      for (let i = 0; i < 80; i++) { if (await lab.evaluate("!window.__ground.state.needsDraw", { timeoutMs: 20000 })) break; await sleep(50); }
      await sleep(300);
    }
    await measure(desk, (n) => deskBatch(spec, n));   // the desk's first frames: the books' meshes made and uploaded — a warm-up, not a round
    const D = [];
    const DC = [];
    const P = [];
    const PC = [];
    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 === 0 ? ["desk", "lab"] : ["lab", "desk"];
      for (const who of order) {
        if (who === "desk") { const r = await measure(desk, (n) => deskBatch(spec, n)); D.push(r.ms); DC.push(r.cpu); }
        else if (lab) { const r = await measure(lab, labBatch); P.push(r.ms); PC.push(r.cpu); }
      }
    }
    const load1 = loadavg()[0];
    console.log(`${label.padEnd(34)} ${fmt(D).padEnd(22)} ${(med(DC) * 1000).toFixed(0).padStart(6)}   ${lab ? `${fmt(P).padEnd(19)} ${(med(PC) * 1000).toFixed(0).padStart(6)}   ` : ""}${record.padEnd(25)} ${load0.toFixed(1)}–${load1.toFixed(1)}`);
  }
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  threw = true;
} finally {
  await cleanup();
}
process.exit(threw ? 1 : 0);
