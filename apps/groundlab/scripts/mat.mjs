// The cutting mat through a real Chrome — screenshots and a throughput row.
//   node test/harness/mat.mjs          → results/mat-<what>.png, and the mat vs dot ms/frame
//   node test/harness/mat.mjs perf     → the throughput table only, more rounds
// Shots, by DAY (the light theme — the reference's chain): the lines alone at
// zoom 1 · the gobo at the reference's time · zoomed out past the projector's
// cone · zoomed in with the fine rung fading in · the canopy plate · the mat
// under the product's cards, one selected. And by NIGHT (the dark theme, MAT.md:
// the Moon, the mesopic eye, Eigengrau): zoom 1 · zoom 3 · the canopy · the cards.
// Perf: saturated batches of render() (drained before and after), median of
// five rounds, dot vs the day's mat vs the night's at the same view — the mat is
// one fullscreen pass, so its cost is the number that has to stay near the dot's.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const mode = process.argv[2] ?? "shots";
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9483, headless: !process.env.GROUND_HEADED });
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
  const shot = async (name) => { await tab.send("Page.bringToFront"); await settle(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `mat-${name}.png`), Buffer.from(data, "base64")); return data.length; };
  const base = { camX: 13.7, camY: -21.3, mouseX: 640, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: "light", style: "product", glyph: "mat" };
  const surfaces = (n) => makeCards(n).map((c, i) => ({ ...c, surface: ["card", "note", "deep", "folder"][i % 4], selected: i === 5 }));
  const still = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };
  const hide = "for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'";

  if (mode === "shots") {
    const shots = [
      ["lines-z1", { ...base, cards: makeCards(6), zoom: 1, mat: { opacity: 0 } }],
      ["gobo-z1", { ...base, cards: makeCards(6), zoom: 1, mat: still }],
      ["gobo-z0.2", { ...base, cards: makeCards(6), camX: -2400, camY: -1500, zoom: 0.2, mat: still }],
      ["gobo-z3", { ...base, cards: makeCards(6), zoom: 3, mat: still }],
      ["gobo-z6.3", { ...base, cards: makeCards(6), zoom: 6.31, mat: still }],
      ["canopy-z1", { ...base, cards: makeCards(6), zoom: 1, mat: { ...still, plate: "b" } }],
      ["light-cards", { ...base, cards: surfaces(12), zoom: 1.6, mat: still }],
      // …and the NIGHT (MAT.md): the same mat in the dark theme — the Moon, the mesopic eye, Eigengrau
      ["night-z1", { ...base, theme: "dark", cards: makeCards(6), zoom: 1, mat: still }],
      ["night-z3", { ...base, theme: "dark", cards: makeCards(6), zoom: 3, mat: still }],
      ["night-canopy-z1", { ...base, theme: "dark", cards: makeCards(6), zoom: 1, mat: { ...still, plate: "b" } }],
      ["night-cards", { ...base, theme: "dark", cards: surfaces(12), zoom: 1.6, mat: still }],
    ];
    for (const [name, s] of shots) {
      await q(`window.__ground.setScene(${JSON.stringify(s)}); ${hide}`);
      const bytes = await shot(name);
      const st = await q("window.__ground.render()");
      check(st.surface === "mat" && bytes > 60_000, `${name.padEnd(12)} mat drawn${st.aux ? " (wind pass ran)" : ""} · ${(bytes / 1024).toFixed(0)} KB png · k0 ${st.k0}`);
    }
    // a live mat: wind on → the loop stays awake and the gobo time advances
    await q(`window.__ground.setScene(${JSON.stringify({ ...base, cards: makeCards(6), zoom: 1, mat: { ...still, wind: 5 } })}); ${hide}`);
    await sleep(400);
    const t0 = await q("window.__ground.state.goboTime"); await sleep(500); const t1 = await q("window.__ground.state.goboTime");
    check(t1 > t0 + 1.5, `wind 5: gobo time advanced ${(t1 - t0).toFixed(2)} s in 0.5 s (the loop stays awake)`);
    const c0 = await q("window.__ground.state.frameCount"); await sleep(300); const c1 = await q("window.__ground.state.frameCount");
    check(c1 - c0 >= 8, `frames keep coming while the wind blows (${c1 - c0} in 0.3 s)`);
    // wind 0 → a still: the loop goes quiet
    await q("window.__ground.params.mat.wind = 0; window.__ground.apply()"); await sleep(600);
    const f0 = await q("window.__ground.state.frameCount"); await sleep(600); const f1 = await q("window.__ground.state.frameCount");
    check(f1 - f0 <= 2, `wind 0: ${f1 - f0} frames in 0.6 s — a still renders on demand`);
    // switching back to dots re-bakes the atlas
    const bakes0 = await q("window.__ground.render().bakes");
    await q("window.__ground.params.field.glyph = 'dot'; window.__ground.apply()"); await sleep(200);
    const st = await q("window.__ground.render()");
    check(!st.surface && st.bakes > bakes0 && st.instances > 0, `back to dots: ${st.bakes - bakes0} bake(s) on the switch, ${st.instances} instances`);
  }

  // ---- throughput: dot vs the day's mat vs the night's, same view, saturated batches
  const ARM = (n) => `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
    const t0 = performance.now(); let cpu = 0;
    for (let i = 0; i < ${n}; i++) { const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
    await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`;
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`\ncrossOriginIsolated: ${await q("crossOriginIsolated")}`);
  console.log("  scene                 zoom   cards   dot ms    day ms  night ms   day/dot  night/dot   dot cpu   day cpu  night cpu");
  const rounds = mode === "perf" ? 7 : 5;
  for (const [label, z, n, gobo] of [["lines only", 1, 0, 0], ["gobo, still", 1, 0, 1], ["gobo, still", 1, 48, 1], ["gobo, still", 6.31, 48, 1], ["gobo, blowing", 1, 48, 1]]) {
    const blowing = label === "gobo, blowing";
    const matScene = { ...base, glyph: "mat", cards: makeCards(n), zoom: z, mouseOn: true, drawFrames: true, mat: { ...still, opacity: gobo, ...(blowing ? { wind: 5 } : {}) } };
    const scenes = {
      dot: { ...base, glyph: "dot", cards: makeCards(n), zoom: z, mouseOn: true, drawFrames: true },
      mat: matScene,
      night: { ...matScene, theme: "dark" },
    };
    const names = ["dot", "mat", "night"];
    const R = { dot: [], mat: [], night: [] };
    const C = { dot: [], mat: [], night: [] };
    for (let round = 0; round < rounds; round++) for (const name of round % 2 ? [...names].reverse() : names) {
      await q(`window.__ground.setScene(${JSON.stringify(scenes[name])}); ${hide}`); await settle();
      // a blowing mat: advance the clocks by hand so every render pays the wind pass, as a live frame would
      if (blowing && name !== "dot") await q("window.__ground.state.matPinned = true");
      const probe = await tab.evaluate(ARM(4), { awaitPromise: true, timeoutMs: 60000 });
      const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
      const arm = blowing && name !== "dot"
        ? ARM(B).replace("g.render();", "g.state.goboTime += 0.08; g.state.noise = [Math.random(), Math.random()]; g.render();")
        : ARM(B);
      const r = await tab.evaluate(arm, { awaitPromise: true, timeoutMs: 60000 });
      R[name].push(r.ms); C[name].push(r.cpu);
    }
    const us = (name) => `${(med(C[name]) * 1000).toFixed(0).padStart(4)} µs`;
    console.log(`  ${label.padEnd(20)} ${z.toFixed(2).padStart(5)}   ${String(n).padStart(4)}   ${med(R.dot).toFixed(3).padStart(6)}    ${med(R.mat).toFixed(3).padStart(6)}    ${med(R.night).toFixed(3).padStart(6)}    ${(med(R.mat) / med(R.dot)).toFixed(2).padStart(5)}    ${(med(R.night) / med(R.dot)).toFixed(2).padStart(5)}    ${us("dot")}   ${us("mat")}   ${us("night")}`);
  }
  if (logs.length) console.log("logs:", logs.slice(0, 6).join(" | "));
  console.log(`\n${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
