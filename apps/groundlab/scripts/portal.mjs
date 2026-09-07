// The live portal through a real Chrome (PORTAL.md) — stills, the cut, the gate, the pool, and the cost.
//   node test/harness/portal.mjs          → results/portal-<what>.png, the checks, and the cost table
//   node test/harness/portal.mjs perf     → the cost table only, more rounds
// Stills: three folders with three grids inside at 1:1, the gate mid-fade, light, a folder inside a folder.
// Live: the frame BEFORE a double-click and the flight's FIRST frame are the same PNG (the cut is the
// portal's own camera); the flight lands and the inside's own folder shows ITS inside; the exit lands on
// the saved camera with the portal back; zooming out under the gate leaves no slot and the loop is quiet
// with a still mat inside; the toggle. Cost: a 48-card board with 0 / 1 / 4 / 12 folders showing their
// insides at zoom 1, the same 12 gated out at zoom 0.2 and with portals off, three grids inside —
// saturated batches, medians of alternating rounds.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
import { PORTAL_SCENES } from "@ice/ground/oracle/scenes.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const mode = process.argv[2] ?? "shots";
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9493, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 420_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object' && window.__ground.state.assetsReady && window.__ground.state.contentReady", { timeoutMs: 20000 })) break; await sleep(200); }
  check(await tab.evaluate("window.__ground.state.assetsReady && window.__ground.state.contentReady"), "the plates, the blue noise and the test residency are ready");
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("new Promise((resolve) => { const t0 = performance.now(); const poll = () => { if (!window.__ground.state.needsDraw || performance.now() - t0 > 4000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))); else requestAnimationFrame(poll); }; poll(); })", { awaitPromise: true, timeoutMs: 15000 });
  const png = async () => { await tab.send("Page.bringToFront"); await settle(); return (await tab.send("Page.captureScreenshot", { format: "png" })).data; };
  const shot = async (name) => { const data = await png(); writeFileSync(resolve(app, "results", `portal-${name}.png`), Buffer.from(data, "base64")); return data.length; };
  const hide = "for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'";
  const inside = (glyph, n = 4, seed = 7) => ({ cards: makeCards(n, seed).map((c) => ({ ...c, x: c.x - 600, y: c.y - 400 })), glyph });
  const base = { camX: 13.7, camY: -21.3, mouseX: 640, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: "dark", style: "product", portals: true, mat: { wind: 0 } };
  const FOLDER = 2;
  const live = { ...base, zoom: 1, cards: [{ x: 200, y: 150, w: 150, h: 90, r: 14, strength: 1 }, { x: 1000, y: 700, w: 155, h: 155, r: 22, strength: 1, surface: "note" }, { x: 600, y: 400, w: 329, h: 345, r: 22, strength: 1, surface: "folder", inside: inside("mat") }] };
  const pinMat = "window.__ground.state.matPinned = true";

  if (mode === "shots") {
    const want = { "portal-three-z1": 3, "portal-gate-mid-z0.3": 1, "portal-light-z1.6": 3, "portal-nested-z2.5": 2 };
    for (const sc of PORTAL_SCENES.filter((s) => s.name in want)) {
      await q(`window.__ground.setScene(${JSON.stringify(sc.scene)}); ${hide}`);
      const bytes = await shot(sc.name.replace(/^portal-/, ""));
      const st = await q("window.__ground.render()");
      check(st.portals === want[sc.name] && bytes > 60_000, `${sc.name.padEnd(22)} ${st.portals} portal${st.portals === 1 ? "" : "s"} (expected ${want[sc.name]}) · ${st.frames} frames · ${(bytes / 1024).toFixed(0)} KB png`);
    }

    // ---- the cut: the frame before the double-click IS the flight's first frame
    await q(`window.__ground.setScene(${JSON.stringify(live)}); ${pinMat}; ${hide}`); await settle();
    const before = await png();
    const stRest = await q("window.__ground.render()");
    const camPortal = await q(`JSON.stringify(window.__ground.portal.cameraOf(${FOLDER}).cam)`);
    check(stRest.portals === 1 && stRest.frames === 3, `at rest the folder shows its inside: ${stRest.portals} portal, ${stRest.frames} frames, pool ${await q("window.__ground.portal.pool()")}`);
    await q(`window.__ground.nav.enter(${FOLDER}); window.__ground.nav.pin(0)`);
    const f0 = await q("window.__ground.nav.flight()");
    check(f0 && f0.kind === "enter" && JSON.stringify(f0.c0) === camPortal, `the flight starts from the portal's own camera, the same numbers (zoom ${f0?.c0.zoom.toFixed(4)})`);
    const first = await png();
    check(first === before, `the flight's FIRST frame is the portal's last frame — the same PNG, ${(first.length / 1024).toFixed(0)} KB (${first === before ? "identical" : `differs: ${before.length} vs ${first.length} bytes`})`);
    await q("window.__ground.nav.pin(null)");
    let landed = false;
    let waited = 0;
    while (waited < 3000) { await sleep(50); waited += 50; if (!(await q("window.__ground.nav.flight()"))) { landed = true; break; } }
    const stIn = await q("window.__ground.render()");
    check(landed && (await q("window.__ground.nav.depth()")) === 1 && stIn.portals === 0, `landed inside (depth 1): four plain cards, ${stIn.portals} portals`);
    // ---- exit lands with the portal back
    const land = async () => { let w = 0; while (w < 3000) { await sleep(50); w += 50; if (!(await q("window.__ground.nav.flight()"))) return true; } return false; };
    await q("window.__ground.nav.exit()"); await land();
    const after = await png();
    const stBack = await q("window.__ground.render()");
    const cam = await q("({ x: window.__ground.state.camX, y: window.__ground.state.camY, zoom: window.__ground.state.zoom })");
    check(Math.abs(cam.x - live.camX) < 1e-9 && Math.abs(cam.zoom - 1) < 1e-9 && stBack.portals === 1 && after === before, `exit lands on the saved camera with the live portal back — the frame equals the one before the enter (${after === before ? "identical PNG" : "PNG differs"})`);
    // ---- a folder added INSIDE gets an inside of its own on first use and shows it — the rule is the same at every depth
    await q(`window.__ground.nav.enter(${FOLDER})`); await land();
    await q("window.__ground.addCard({ surface: 'folder', x: 0, y: -420, w: 329, h: 345 })"); await settle();
    const stNest = await q("window.__ground.render()");
    check(stNest.portals === 1 && stNest.frames === 5, `a folder added inside shows ITS inside — ${stNest.portals} portal among ${stNest.frames} frames, pool ${await q("window.__ground.portal.pool()")}`);
    await q("window.__ground.nav.exit()"); await land();
    // ---- the gate, the toggle, the quiet loop
    await q("window.__ground.zoomAt(600, 400, 0.2)"); await settle();
    const g0 = await q("window.__ground.render()");
    await q("window.__ground.zoomAt(600, 400, 0.36)"); await settle();
    const g1 = await q(`window.__ground.portal.cameraOf(${FOLDER})?.presence ?? 0`);
    await q("window.__ground.zoomAt(600, 400, 1)"); await settle();
    const g2 = await q("window.__ground.render()");
    const short = 345 - 10 - 36;   // the face's short side in world units: the content rect inset like the product folder's (nav/portal.ts FOLDER_FACE)
    check(g0.portals === 0 && g1 > 0 && g1 < 1 && g2.portals === 1, `the gate: zoom 0.2 (face ${(short * 0.2).toFixed(0)} px) → ${g0.portals} portals · zoom 0.36 (${(short * 0.36).toFixed(0)} px) → presence ${g1.toFixed(2)} · zoom 1 → ${g2.portals}`);
    // ---- the zoom-through (PORTAL.md §8): zoom until the face covers the view, cut in by hand at the same camera — the same PNG; zoom out, cut out
    await q(`window.__ground.setScene(${JSON.stringify(live)}); ${pinMat}; ${hide}`); await settle();
    let covered = false;
    for (let i = 0; i < 40 && !covered; i++) { await q("window.__ground.zoomAt(600, 400, window.__ground.state.zoom * 1.12)"); covered = await q(`window.__ground.nav.covers(${FOLDER})`); }
    await settle();
    const zCover = await q("window.__ground.state.zoom");
    const preThrough = await png();
    // hold the dressing where the cut leaves it, so the frame after the cut can be compared with the one before
    await q("window.__ground.state.redressPinned = true");
    const idx = await q("window.__ground.nav.through()");
    const postThrough = await png();
    const d1 = await q("window.__ground.nav.depth()");
    const fl = await q("window.__ground.nav.flight()");
    check(covered && idx === FOLDER && d1 === 1 && !fl && postThrough === preThrough, `zoom-through: the face covers the view at zoom ${zCover.toFixed(2)}, the cut enters (depth ${d1}, no flight, the camera now ${(await q("window.__ground.state.zoom")).toFixed(2)}) and the frame is the SAME PNG (${postThrough === preThrough ? "identical" : "differs"})`);
    await q("window.__ground.state.redressPinned = false"); await sleep(400);   // the inside re-dresses from the portal's look to its own
    let left = false;
    for (let i = 0; i < 40 && !left; i++) { await q("window.__ground.zoomAt(600, 400, window.__ground.state.zoom / 1.12)"); left = await q("window.__ground.nav.throughOut()"); }
    await settle();
    check(left && (await q("window.__ground.nav.depth()")) === 0 && (await q("window.__ground.render()")).portals === 1, `zooming out past the face leaves as a cut (depth ${await q("window.__ground.nav.depth()")}) with the live portal back at zoom ${(await q("window.__ground.state.zoom")).toFixed(2)}`);
    await q(`window.__ground.setScene(${JSON.stringify(live)}); ${pinMat}; ${hide}`); await settle();
    await q("window.__ground.portal.on = false"); await settle();
    const off = await q("window.__ground.render()");
    await q("window.__ground.portal.on = true"); await settle();
    check(off.portals === 0 && (await q("window.__ground.render()")).portals === 1, `portals off → ${off.portals}; on → 1`);
    await q("window.__ground.params.mat.wind = 3; window.__ground.apply()"); await settle();
    const c0 = await q("window.__ground.state.frameCount"); await sleep(500); const c1 = await q("window.__ground.state.frameCount");
    check(c1 - c0 <= 2, `a mat inside a portal is a STILL: with the wind at 3 the loop stays quiet (${c1 - c0} frames in 0.5 s)`);
  }

  // ---- the cost: a 48-card board, k of them folders showing their insides
  const ARM = (n) => `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
    const t0 = performance.now(); let cpu = 0;
    for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
    await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n}, portals: g.render().portals }; })()`;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const board = (k, zoom, grids = ["dot"]) => ({ ...base, camX: 13.7, camY: -21.3, zoom, cards: makeCards(48).map((c, i) => (i < k ? { ...c, w: 329, h: 345, r: 22, surface: "folder", inside: inside(grids[i % grids.length], 4, 7 + i) } : c)) });
  console.log(`\ncrossOriginIsolated: ${await q("crossOriginIsolated")}`);
  console.log("  board                        zoom  portals   ms/frame   vs none   cpu");
  const rounds = mode === "perf" ? 7 : 5;
  const rows = [
    ["no folders", board(0, 1)], ["1 folder", board(1, 1)], ["4 folders", board(4, 1)], ["12 folders", board(12, 1)],
    ["12 folders, portals off", { ...board(12, 1), portals: false }], ["12 folders, gated out", board(12, 0.2)], ["3 folders · mat needle dot", board(3, 1, ["mat", "needle", "dot"])],
  ];
  const R = {};
  const C = {};
  const N = {};
  for (let round = 0; round < rounds; round++) for (const [label, s] of round % 2 ? [...rows].reverse() : rows) {
    await q(`window.__ground.setScene(${JSON.stringify(s)}); ${pinMat}; ${hide}`); await settle();
    const probe = await tab.evaluate(ARM(4), { awaitPromise: true, timeoutMs: 60000 });
    const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
    const r = await tab.evaluate(ARM(B), { awaitPromise: true, timeoutMs: 60000 });
    R[label] ??= []; R[label].push(r.ms);
    C[label] ??= []; C[label].push(r.cpu);
    N[label] = r.portals;
  }
  const none = med(R["no folders"]);
  for (const [label, s] of rows) console.log(`  ${label.padEnd(28)} ${s.zoom.toFixed(1).padStart(4)}  ${String(N[label]).padStart(7)}   ${med(R[label]).toFixed(3).padStart(8)}   ${(med(R[label]) - none >= 0 ? "+" : "") + (med(R[label]) - none).toFixed(3).padStart(6)}   ${(med(C[label]) * 1000).toFixed(0).padStart(4)} µs`);
  if (logs.length) console.log("logs:", logs.slice(0, 6).join(" | "));
  console.log(`\n${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
