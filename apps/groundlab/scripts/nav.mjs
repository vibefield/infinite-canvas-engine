// The portal flight through a real Chrome — stills, a live flight, an
// interrupted one, and the cost of a flight frame.
//   node test/harness/nav.mjs          → results/nav-<what>.png, the liveness checks, and the cost table
//   node test/harness/nav.mjs perf     → the cost table only, more rounds
// Stills: dot → mat at the cut, midway and near landing; the way back out;
// mat → dot; needle → mat; a tiny folder's frozen crossfade. Live: enter a
// folder — the camera flies, the departed slot draws, the flight lands on the
// arrival within its response and the loop goes quiet; exit lands back on the
// saved camera; a wheel mid-flight yields (touch wins). Cost: a flight frame
// pinned at p 0.5 (both slots) against the same frame at rest, saturated
// batches, medians of alternating rounds.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
import { flightOpacity } from "@ice/ground/compose";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const mode = process.argv[2] ?? "shots";
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9487, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 300_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object' && window.__ground.state.assetsReady", { timeoutMs: 20000 })) break; await sleep(200); }
  check(await tab.evaluate("window.__ground.state.assetsReady"), "the plates and the blue noise are uploaded");
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("new Promise((resolve) => { const t0 = performance.now(); const poll = () => { if (!window.__ground.state.needsDraw || performance.now() - t0 > 4000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))); else requestAnimationFrame(poll); }; poll(); })", { awaitPromise: true, timeoutMs: 15000 });
  const shot = async (name) => { await tab.send("Page.bringToFront"); await settle(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `nav-${name}.png`), Buffer.from(data, "base64")); return data.length; };
  const hide = "for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'";
  const FOLDER = 2;
  const childOf = (glyph) => ({ cards: makeCards(4, 7).map((c) => ({ ...c, x: c.x - 600, y: c.y - 400 })), glyph });
  const base = { camX: 13.7, camY: -21.3, mouseX: 640, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: "dark", style: "product", cards: makeCards(6) };
  const still = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };

  if (mode === "shots") {
    const shots = [
      ["enter-dot-mat-p0", { ...base, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0 } }],
      ["enter-dot-mat-p0.5", { ...base, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
      ["enter-dot-mat-p0.9", { ...base, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.9 } }],
      ["exit-mat-dot-p0", { ...base, zoom: 1, nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0 } }],
      ["exit-mat-dot-p0.5", { ...base, zoom: 1, nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
      ["enter-mat-dot-p0.5", { ...base, zoom: 0.8, glyph: "mat", mat: still, nav: { kind: "enter", container: FOLDER, child: childOf("dot"), p: 0.5 } }],
      ["enter-needle-mat-p0.35", { ...base, zoom: 1.585, glyph: "needle", nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.35 } }],
      ["enter-frozen-p0.5", { ...base, cards: makeCards(6).map((c, i) => (i === FOLDER ? { ...c, w: 22, h: 14, r: 4 } : c)), zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
    ];
    for (const [name, s] of shots) {
      await q(`window.__ground.setScene(${JSON.stringify(s)}); ${hide}`);
      const bytes = await shot(name);
      const st = await q("window.__ground.render()");
      const fl = await q("window.__ground.nav.flight()");
      // a departed slot at opacity 0 (past p 0.75 on enter, past 0.45 frozen) is skipped outright — its stats are null by design
      const outOn = fl ? flightOpacity(fl.kind, fl.p, fl.frozen).outgoing > 0 : false;
      check(fl && fl.p === s.nav.p && (st.outgoing !== null) === outOn && bytes > 60_000, `${name.padEnd(22)} ${outOn ? "both slots drew" : "departed at opacity 0, skipped"} · ${fl?.kind} p ${fl?.p}${fl?.frozen ? " frozen" : ""}${st.outgoing ? ` · departed ${st.outgoing.instances.toLocaleString()} instances ${st.outgoing.frames} frames` : ""} · ${(bytes / 1024).toFixed(0)} KB png`);
    }

    // ---- a live flight: enter a folder
    // a still mat inside (wind 0), so the loop can go quiet after landing; the folder gets the mat by the panel's pick
    await q(`window.__ground.setScene(${JSON.stringify({ ...base, zoom: 1 })}); window.__ground.cards[${FOLDER}].surfaceName = "folder"; window.__ground.params.mat.wind = 0; window.__ground.params.nav.childGlyph = "mat"; window.__ground.apply(); ${hide}`);
    await settle();
    const cam0 = await q("({ x: window.__ground.state.camX, y: window.__ground.state.camY, zoom: window.__ground.state.zoom })");
    const t0 = performance.now();
    await q(`window.__ground.nav.enter(${FOLDER})`);
    const f0 = await q("window.__ground.nav.flight()");
    check(f0?.active && f0.kind === "enter" && (await q("window.__ground.nav.depth()")) === 1, `enter: the frame cut at once (depth 1) and a flight is on — c0 zoom ${f0?.c0.zoom.toFixed(3)} → c1 zoom ${f0?.c1.zoom.toFixed(3)}`);
    const z0 = await q("window.__ground.state.zoom"); await sleep(120); const z1 = await q("window.__ground.state.zoom");
    check(z1 > z0, `the camera is flying in (zoom ${z0.toFixed(3)} → ${z1.toFixed(3)} in 120 ms)`);
    const mid = await q("window.__ground.render()");
    check(mid.outgoing !== null, `mid-flight the departed frame draws beside the arriving one (${mid.outgoing?.instances?.toLocaleString()} instances, ${mid.outgoing?.frames} frames)`);
    let landed = false;
    let waited = 0;
    while (waited < 3000) { await sleep(50); waited += 50; if (!(await q("window.__ground.nav.flight()"))) { landed = true; break; } }
    const cam1 = await q("({ x: window.__ground.state.camX, y: window.__ground.state.camY, zoom: window.__ground.state.zoom })");
    check(landed && Math.abs(cam1.zoom - f0.c1.zoom) < 1e-9 && Math.abs(cam1.x - f0.c1.x) < 1e-9, `the flight landed EXACTLY on the arrival in ${(performance.now() - t0).toFixed(0)} ms (zoom ${cam1.zoom.toFixed(3)})`);
    check((await q("window.__ground.render()")).outgoing === null && (await q("window.__ground.nav.glyph()")) === "mat", "at rest: one slot, the folder's own grid (mat)");
    const c0 = await q("window.__ground.state.frameCount"); await sleep(500); const c1 = await q("window.__ground.state.frameCount");
    check(c1 - c0 <= 2, `and the loop is quiet again (${c1 - c0} frames in 0.5 s)`);
    // ---- exit lands back where we came from
    await q("window.__ground.nav.exit()");
    const e0 = await q("window.__ground.nav.flight()");
    check(e0 && e0.kind === "exit" && (await q("window.__ground.nav.depth()")) === 0, `exit: depth 0 at once, the inside flies back into the card (c0 zoom ${e0?.c0.zoom.toFixed(3)})`);
    waited = 0; while (waited < 3000) { await sleep(50); waited += 50; if (!(await q("window.__ground.nav.flight()"))) break; }
    const cam2 = await q("({ x: window.__ground.state.camX, y: window.__ground.state.camY, zoom: window.__ground.state.zoom })");
    check(Math.abs(cam2.x - cam0.x) < 1e-9 && Math.abs(cam2.y - cam0.y) < 1e-9 && Math.abs(cam2.zoom - cam0.zoom) < 1e-9, `landed on the saved camera (${cam2.x.toFixed(2)}, ${cam2.y.toFixed(2)} @ ${cam2.zoom})`);
    // ---- touch wins: a wheel mid-flight yields the camera
    await q(`window.__ground.nav.enter(${FOLDER})`); await sleep(80);
    await q("window.__ground.zoomAt(600, 400, window.__ground.state.zoom * 1.1); window.__ground.state.needsDraw = true");
    await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: -40 });
    await sleep(60);
    check(!(await q("window.__ground.nav.flight()")) && (await q("window.__ground.nav.depth()")) === 1, "a wheel mid-flight aborts the flight and keeps the frame (touch wins)");
    await q("window.__ground.nav.exit()"); await sleep(600);
  }

  // ---- the cost of a flight frame: both slots at p 0.5 vs the same frame at rest
  const ARM = (n) => `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
    const t0 = performance.now(); let cpu = 0;
    for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
    await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`\ncrossOriginIsolated: ${await q("crossOriginIsolated")}`);
  console.log("  flight                  rest ms   flight ms   ratio    rest cpu   flight cpu");
  const rounds = mode === "perf" ? 7 : 5;
  const rows = [
    ["dot → mat, enter", { ...base, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
    ["mat → dot, exit", { ...base, zoom: 1, nav: { kind: "exit", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
    ["dot → dot, enter", { ...base, zoom: 1, nav: { kind: "enter", container: FOLDER, child: childOf("dot"), p: 0.5 } }],
    ["needle → mat, enter", { ...base, zoom: 1.585, glyph: "needle", nav: { kind: "enter", container: FOLDER, child: childOf("mat"), p: 0.5 } }],
    ["mat → dot, enter", { ...base, zoom: 0.8, glyph: "mat", mat: still, nav: { kind: "enter", container: FOLDER, child: childOf("dot"), p: 0.5 } }],
  ];
  for (const [label, s] of rows) {
    // rest = the same root scene at the same camera, no flight
    const rest = { ...s, nav: undefined };
    const R = { rest: [], flight: [] };
    const C = { rest: [], flight: [] };
    for (let round = 0; round < rounds; round++) for (const name of round % 2 ? ["flight", "rest"] : ["rest", "flight"]) {
      await q(`window.__ground.setScene(${JSON.stringify(name === "rest" ? rest : s)}); ${hide}`); await settle();
      const probe = await tab.evaluate(ARM(4), { awaitPromise: true, timeoutMs: 60000 });
      const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
      const r = await tab.evaluate(ARM(B), { awaitPromise: true, timeoutMs: 60000 });
      R[name].push(r.ms); C[name].push(r.cpu);
    }
    console.log(`  ${label.padEnd(22)} ${med(R.rest).toFixed(3).padStart(8)}   ${med(R.flight).toFixed(3).padStart(9)}   ${(med(R.flight) / med(R.rest)).toFixed(2).padStart(5)}    ${(med(C.rest) * 1000).toFixed(0).padStart(5)} µs   ${(med(C.flight) * 1000).toFixed(0).padStart(6)} µs`);
  }
  if (logs.length) console.log("logs:", logs.slice(0, 6).join(" | "));
  console.log(`\n${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
