// The §7 overlap heat through a real Chrome — stills, a live drag, and the cost.
//   node test/harness/glow.mjs          → results/glow-<what>.png, the checks, the cost table
//   node test/harness/glow.mjs perf     → the cost table only, more rounds
// Stills: the oracle's six heat scenes (the picked card's edge at a folder's lower right,
// the same on a deep card, a corner-only contact, a selected target on light, the two
// exact-check scenes). Live: a plain card dragged over a folder — the signal arrives, the
// presence springs up, the SOURCE is the dragged card's silhouette and moves with it —
// then over a deep card (the folder fades, the deep card lights at the reject tier), then
// let go: everything falls and the loop goes quiet. Cost: 48 cards + frames — cold, one
// lit, all lit — saturated batches, medians of alternating rounds; a cold card pays one
// compare, so the number is the delta.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
import { HEAT_SCENES } from "@ice/ground/oracle/scenes.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const mode = process.argv[2] ?? "shots";
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9492, headless: !process.env.GROUND_HEADED });
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
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object' && window.__ground.state.contentReady", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("new Promise((resolve) => { const t0 = performance.now(); const poll = () => { if (!window.__ground.state.needsDraw || performance.now() - t0 > 4000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))); else requestAnimationFrame(poll); }; poll(); })", { awaitPromise: true, timeoutMs: 15000 });
  const shot = async (name) => { await tab.send("Page.bringToFront"); await settle(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `glow-${name}.png`), Buffer.from(data, "base64")); return data.length; };
  const hide = "for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'";
  const mouse = async (type, x, y) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const base = { camX: 0, camY: 0, mouseX: 640, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: "dark", style: "product" };
  const board = { ...base, camX: 13.7, camY: -21.3, zoom: 1, cards: makeCards(48) };
  const motion = (i) => q(`(() => { const m = window.__ground.cards[${i}].motion; return { target: m.hotTarget, tier: m.hotTier, hot: m.hot, at: m.hotAt, half: m.hotHalf, r: m.hotR }; })()`);

  if (mode === "shots") {
    for (const sc of HEAT_SCENES) {
      await q(`window.__ground.setScene(${JSON.stringify(sc.scene)}); ${hide}`);
      const bytes = await shot(sc.name.replace(/^heat-/, ""));
      const st = await q("window.__ground.render()");
      const hot = await q("window.__ground.cards.filter((c) => c.motion.hot > 0.99 && c.motion.hotTarget).length");
      check(st.frames === sc.scene.cards.length && hot === 1 && bytes > 40_000, `${sc.name.padEnd(30)} ${st.frames} frames, ${hot} hot at presence 1 · ${(bytes / 1024).toFixed(0)} KB png`);
    }
    // live: a folder (accepts), a deep card (rejects), a plain card to drag — the camera at the origin, zoom 1: CSS px = world
    const live = { ...base, zoom: 1, cards: [{ x: 400, y: 400, w: 320, h: 200, r: 22, strength: 1, surface: "folder" }, { x: 850, y: 400, w: 220, h: 160, r: 22, strength: 1, surface: "deep" }, { x: 620, y: 650, w: 150, h: 90, r: 14, strength: 1 }] };
    await q(`window.__ground.setScene(${JSON.stringify(live)}); ${hide}`); await settle();
    await mouse("mouseMoved", 620, 650); await mouse("mousePressed", 620, 650); await sleep(30);
    await mouse("mouseMoved", 560, 520);   // the plain card now 485..635 × 475..565 — over the folder's lower right (240..560 × 300..500)
    const trace = [];
    for (let t = 0; t <= 360; t += 60) { trace.push((await motion(0)).hot.toFixed(2)); await sleep(60); }
    console.log(`-- drag over the folder --\n  presence 0..360ms: ${trace.join("  ")}`);
    const f1 = await motion(0);
    check(f1.target && f1.tier === 1, "the folder is the target at the ACCEPT tier");
    const D = await q("(() => { const c = window.__ground.cards[window.__ground.cards.length - 1]; return { half: c.geometry.half, r: c.geometry.outerR }; })()");
    check(Math.abs(f1.at[0] - 560) < 1e-6 && Math.abs(f1.at[1] - 520) < 1e-6 && Math.abs(f1.half[0] - D.half[0]) < 0.1 && Math.abs(f1.half[1] - D.half[1]) < 0.1 && Math.abs(f1.r - D.r) < 0.1 && D.half[0] > 75 * 1.04, `the source is the dragged card's silhouette AS DRAWN — centre (${f1.at.map((v) => v.toFixed(1)).join(", ")}), half ${f1.half.map((v) => v.toFixed(2)).join("×")} (content 75×45, lifted and revealed), r ${f1.r.toFixed(2)}`);
    check(f1.hot > 0.95 && Number(trace[1]) > 0.05 && Number(trace[1]) < 0.95, `presence sprang to ${f1.hot.toFixed(3)} through intermediate frames`);
    await mouse("mouseMoved", 540, 500); await sleep(40);
    const f2 = await motion(0);
    check(Math.abs(f2.at[0] - 540) < 1e-6 && Math.abs(f2.at[1] - 500) < 1e-6 && f2.hot > 0.95, `the source moves with the drag (${f2.at.map((v) => v.toFixed(1)).join(", ")}), presence stays`);
    await mouse("mouseMoved", 790, 430);   // 715..865 × 385..475 — off the folder, over the deep card (740..960 × 320..480)
    await sleep(120);
    const f3 = await motion(0);
    const d3 = await motion(1);
    check(!f3.target && f3.hot < 0.95 && f3.hot > 0 && f3.at[0] === f2.at[0], `moved off: the folder fades (${f3.hot.toFixed(2)}) with its source held`);
    check(d3.target && d3.tier === 0 && d3.hot > 0.3, `the deep card is the target at the REJECT tier, lighting (${d3.hot.toFixed(2)})`);
    await mouse("mouseReleased", 790, 430); await sleep(700);
    const f4 = await motion(0);
    const d4 = await motion(1);
    const quiet = !(await q("window.__ground.state.needsDraw"));
    check(!f4.target && f4.hot === 0 && !d4.target && d4.hot === 0, `let go: both cold (${f4.hot}, ${d4.hot})`);
    check(quiet, "the loop went quiet");
    check(await q("window.__ground.cards.every((c) => !c.motion.held)"), "the lift ended with the hold");
  }

  // ---- the cost: 48 cards + frames, cold · one hot · all hot
  const ARM = (n) => `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
    const t0 = performance.now(); let cpu = 0;
    for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
    await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const src = (c, tier) => `{ x: ${c}.x + ${c}.w * 0.3, y: ${c}.y + ${c}.h * 0.4, hx: 78.75, hy: 47.25, r: 14.7, tier: ${tier} }`;
  const heatOf = { cold: "", one: `(() => { const c = window.__ground.cards[20]; window.__ground.heat.set(20, ${src("c", 1)}); })()`, all: `window.__ground.cards.forEach((c, i) => window.__ground.heat.set(i, ${src("c", "i % 2")}))` };
  console.log(`\ncrossOriginIsolated: ${await q("crossOriginIsolated")}`);
  console.log("  heat     zoom   ms/frame   vs cold   cpu");
  const rounds = mode === "perf" ? 7 : 5;
  for (const z of [1, 2.512]) {
    const R = { cold: [], one: [], all: [] };
    const C = { cold: [], one: [], all: [] };
    const names = Object.keys(R);
    for (let round = 0; round < rounds; round++) for (const name of round % 2 ? [...names].reverse() : names) {
      await q(`window.__ground.setScene(${JSON.stringify({ ...board, zoom: z })}); ${hide}; ${heatOf[name]}`); await settle();
      const probe = await tab.evaluate(ARM(4), { awaitPromise: true, timeoutMs: 60000 });
      const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
      const r = await tab.evaluate(ARM(B), { awaitPromise: true, timeoutMs: 60000 });
      R[name].push(r.ms); C[name].push(r.cpu);
    }
    for (const name of names) console.log(`  ${name.padEnd(7)} ${z.toFixed(2).padStart(5)}   ${med(R[name]).toFixed(3).padStart(8)}   ${(med(R[name]) - med(R.cold) >= 0 ? "+" : "") + (med(R[name]) - med(R.cold)).toFixed(3).padStart(6)}   ${(med(C[name]) * 1000).toFixed(0).padStart(4)} µs`);
  }
  if (logs.length) console.log("logs:", logs.slice(0, 6).join(" | "));
  console.log(`\n${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
