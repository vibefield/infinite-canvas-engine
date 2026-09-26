// rig:ruler — the RULERS on the desk through a real Chrome (RULER.md; the prototype's test/harness/ruler.mjs, its check rows,
// ported at D5a against `window.__desk`). The stills themselves are oracle scenes already (`ruler-*`, held to Dawn from the world
// by rig:world); these are the rows the harness asked of a LIVE frame: the atlas is up; every ruler still — and a zoom ladder
// through one decade — has ink in both bands over the field; a 7 px pan moves the ticks 14 device px; the label MIRROR agrees
// with the shader's UNIFORMS (the root mat's `rulerSites`/`rulerOrigin` as the frame uploaded them, against lattice/ruler.ts
// for the same view — and at zoom 1 it lays 11 labels 100 px apart along x); rulers off, no print. Exit 0 = every check passed.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:ruler
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { RULER_SCENES } from "@ice/desk/oracle/scenes.mjs";
import { lod } from "../../../packages/desk/src/lattice/lod.ts";
import { finestLabelled, labelReach, labelsAlong, rulerLevels } from "../../../packages/desk/src/lattice/ruler.ts";
import { DEFAULT_MAT_CONFIG } from "../../../packages/desk/src/mat/layout.ts";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9671), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 240_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
const lumAt = (P, x, y) => { const o = (y * P.width + x) * 4; return 0.2126 * P.rgba[o] + 0.7152 * P.rgba[o + 1] + 0.0722 * P.rgba[o + 2]; };
/** The harness's `inkOf`: the brightest pixel in each band (CSS 28–50 in from the top and the left) against the field's mean (CSS 150–450 × 150–250). */
function inkOf(P, r = 2) {
  let top = 0;
  let left = 0;
  let mid = 0;
  let n = 0;
  for (let y = 28 * r; y < 50 * r; y++) for (let x = 55 * r; x < P.width - 30 * r; x++) top = Math.max(top, lumAt(P, x, y));
  for (let x = 28 * r; x < 50 * r; x++) for (let y = 55 * r; y < P.height - 30 * r; y++) left = Math.max(left, lumAt(P, x, y));
  for (let y = 150 * r; y < 250 * r; y += 7) for (let x = 150 * r; x < 450 * r; x += 7) { mid += lumAt(P, x, y); n++; }
  return { top, left, mid: mid / n };
}
/** The harness's pan witness: the brightest column of the top band's row 100 (device px), x 300–500. */
function brightestColumn(P) {
  let best = -1;
  let bx = 0;
  for (let x = 300; x < 500; x++) { const l = lumAt(P, x, 100); if (l > best) { best = l; bx = x; } }
  return bx;
}

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const scene = (s) => tab.evaluate(`window.__desk.setScene(${JSON.stringify(s)}).then(() => window.__desk.settle(6000))`, { awaitPromise: true, timeoutMs: 60000 });
  const shot = async () => decodePng(Buffer.from((await tab.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  /** What the root mat's last frame uploaded: the camera, the view, the rulers' on/margin/band, the origin row and the five levels' sites. */
  const uniforms = () => q(`(() => { const m = window.__desk.handle.ground().mat; const U = m.uniforms; const f = new Float32Array(U.bytes); const S = U.def.slots;
    const at = (k) => { const a = /^array<vec4f, (\\d+)>$/.exec(S[k].type); return Array.from(f.subarray(S[k].byte / 4, S[k].byte / 4 + (a ? Number(a[1]) * 4 : S[k].n))); };
    return { cam: at("cam"), view: at("view"), ruler: at("ruler"), origin: at("rulerOrigin"), sites: at("rulerSites"), glyphs: m.glyphs, loaded: m.loaded }; })()`);
  const base = RULER_SCENES[0].scene;   // the product's zoom: the still mat, the rulers on, nothing near the bands

  // ---- the atlas is up: the app's runtime glyph atlas uploaded to the root mat at the view's ratio, the rulers' twelve and more
  await scene(base);
  const u0 = await uniforms();
  check(u0.loaded.glyphs && u0.glyphs.count >= 12 && u0.glyphs.scale === 2, `the atlas is up: ${u0.glyphs.count} glyphs at ${u0.glyphs.scale} texels per CSS px (${u0.glyphs.width}×${u0.glyphs.height})`);

  // ---- every ruler still has ink in both bands over the field (the print's contrast: the cream by day, the moonlit grey by night)
  // — and, the harness's rows made honest, over the SAME frame with the rulers off (the control): the bare mat's own lattice lines
  // clear the field bar at some zooms (at zoom 1 they read ~45 over it — D5a's red proof found it), so a band only counts as printed
  // where it also outshines itself bare: by 20 by day, by 6 under the Moon (measured: the print adds 45–66 by day, 14 by night)
  const INK = (s) => (s.theme === "dark" ? 6 : 25);
  const OVER_BARE = (s) => (s.theme === "dark" ? 6 : 20);
  const bareOf = (s) => { const { ruler: _r, ...rest } = s; return rest; };
  /** Ink in both bands: over the field, and over the same frame bare. */
  const printed = async (s) => {
    await scene(bareOf(s));
    const bare = inkOf(await shot());
    await scene(s);
    const ink = inkOf(await shot());
    const ok = ink.top > ink.mid + INK(s) && ink.left > ink.mid + INK(s) && ink.top > bare.top + OVER_BARE(s) && ink.left > bare.left + OVER_BARE(s);
    return { ok, ink, bare };
  };
  for (const sc of RULER_SCENES) {
    const { ok, ink, bare } = await printed(sc.scene);
    check(ok, `${sc.name.padEnd(18)} ink in the top band (${ink.top.toFixed(0)}) and the left (${ink.left.toFixed(0)}) over the field (${ink.mid.toFixed(0)}) and over the same frame bare (${bare.top.toFixed(0)} · ${bare.left.toFixed(0)})`);
  }

  // ---- the zoom ladder through one decade — the fine ticks arriving, the labels arriving, the wrap: ink, and a labelled level, at every rung
  for (const z of [1, 1.6, 2.5, 3.2, 4, 5, 6.3, 8, 9.9, 10.1, 12]) {
    const { ok: inked, ink, bare } = await printed({ ...base, zoom: z });
    const u = await uniforms();
    const lf = u.origin[2];
    check(inked && lf >= 0, `ladder z ${String(z).padEnd(5)} ink in the bands (${ink.top.toFixed(0)} over the field's ${ink.mid.toFixed(0)}, over ${bare.top.toFixed(0)} bare) · labels on level ${lf} at ${lf >= 0 ? (u.sites[lf * 4] * z).toFixed(0) : "—"} px (presence ${lf >= 0 ? u.sites[lf * 4 + 3].toFixed(2) : "—"}) · fine ticks ${u.sites[2].toFixed(2)}`);
  }

  // ---- a pan moves the ticks: the same scene 7 px along has its brightest top-band column 14 device px further
  // (the column must be the PRINT's: brighter than anything in that row of the same frame bare — the lattice's lines pan too)
  await scene(bareOf({ ...base, zoom: 1, camX: 0, camY: 0 }));
  const bareShot = await shot();
  const bareRow = lumAt(bareShot, brightestColumn(bareShot), 100);
  await scene({ ...base, zoom: 1, camX: 0, camY: 0 });
  const pa = await shot();
  const ca = brightestColumn(pa);
  await scene({ ...base, zoom: 1, camX: -7, camY: 0 });
  const cb = brightestColumn(await shot());
  check(Math.abs(cb - ca - 14) <= 1 && lumAt(pa, ca, 100) > bareRow + 20, `a 7 px pan moves the ticks 14 device px (±1: a tick centred on a pixel edge lights two columns alike): brightest column ${ca} → ${cb} — a tick of the print (${lumAt(pa, ca, 100).toFixed(0)} over the bare row's ${bareRow.toFixed(0)})`);

  // ---- the label mirror agrees with the shader's uniforms: lattice/ruler.ts for this frame's own view is what the frame uploaded
  await scene(base);
  const u = await uniforms();
  const view = { camX: u.cam[0], camY: u.cam[1], zoom: u.cam[2], width: u.view[0], height: u.view[1], dpr: u.cam[3] };
  const law = { ...DEFAULT_MAT_CONFIG.ruler, ...(base.ruler ?? {}), on: true };
  const levels = rulerLevels(lod(view), view.zoom, law, Math.max(labelReach(view.camX, view.zoom, view.width), labelReach(view.camY, view.zoom, view.height)));
  const f32 = Math.fround;
  const sitesOk = levels.every((L, i) => [L.spacing, L.tickLen, L.tickAlpha, L.labelAlpha].every((v, k) => f32(v) === u.sites[i * 4 + k]));
  const lf = finestLabelled(levels);
  check(u.ruler[0] === 1 && u.ruler[1] === law.margin && u.ruler[2] === law.band && sitesOk && lf === u.origin[2], `the mirror's five levels are the uniforms' own (spacing, tick, presences — f32 for f32), its finest labelled level ${lf} = the uniforms' ${u.origin[2]}; the rulers on at margin ${u.ruler[1]}, band ${u.ruler[2]}`);
  const labels = labelsAlong(view.camX, view.zoom, view.width, levels, law);
  check(labels.length === 11 && labels.every((l, i) => i === 0 || Math.abs(l.at - labels[i - 1].at - 100) < 1e-6), `at zoom 1 the mirror lays 11 labels 100 px apart along x: ${labels.map((l) => l.text).join(" ")}`);

  // ---- rulers off: the print goes
  const { ruler: _ruler, ...bare } = base;
  await scene(bare);
  const off = inkOf(await shot());
  const uOff = await uniforms();
  check(uOff.ruler[0] === 0 && off.top < off.mid + 60, `rulers off: the uniforms say so (${uOff.ruler[0]}) and there is no print in the band (${off.top.toFixed(0)} vs the field ${off.mid.toFixed(0)})`);

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
