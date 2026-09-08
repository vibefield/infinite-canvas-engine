// A/B harness: the ground lab against the raw-WebGPU magnet-grid prototype —
// same Chrome, same scene generator, same instrument.
//
//   node test/harness/ab.mjs smoke    boot both, screenshot each
//   node test/harness/ab.mjs oracle   the Node (Dawn) renders of test/oracle/scenes.mjs vs the lab in Chrome
//   node test/harness/ab.mjs perf     saturated-batch throughput + CPU, round-robined
// (The 32-scene pixel A/B against the raw prototype's field was retired with the
// size ladder on 2026-09-04 — the ground no longer draws what raw draws. Its
// maxΔ 0 on all 32 was recorded on 2026-09-01; the Node oracle is the pixel
// witness now.) Headless by default; GROUND_HEADED=1 for a window.
//
// THE EXIT CODE IS THE VERDICT. Oracle mode asserts maxΔ 0 per page scene and
// exits with the number that missed; a boot failure, a throw or a failed
// preflight exits 1. `pnpm run gate:landing` runs it as a gate, so a silent 0
// on an unbuilt dist (what this script did until 2026-09-08) is a green light
// nobody earned.
//
// Serves the ICE REPO ROOT so both pages share one COOP/COEP origin. Lessons
// baked in: bring a tab to front before any frame wait (a hidden tab never
// fires rAF), bound every evaluate, carry a watchdog (macOS has no `timeout`).
//
// ERRATUM (2026-09-08, C4d): the line above said "serves vibe-field/draft",
// which stopped being true at B1 — the server root is this repo. The RAW page
// (`/magnet-grid/claude-agent-experiment/prototype/index.html`) still lives in
// `vibe-field/draft` and is therefore UNREACHABLE from here, so `smoke` and
// `perf` — the two modes that open it — have not worked since the move. Oracle
// mode opens `ground` alone and is unaffected; it is the mode `rig:parity` and
// the landing gate run. Whether the raw prototype comes into the repo, moves to
// a second server root or retires with the A/B it served is a call for the
// ground's owner, not a silent fix here. Until then the exit code says so
// instead of printing THREW and exiting 0.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root: the app's dist and the package's oracle results
const results = resolve(app, "results");
mkdirSync(results, { recursive: true });
const mode = process.argv[2] ?? "smoke";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Preflight, before a browser exists ────────────────────────────────────────
// Both pages this harness compares are FILES ON DISK: the lab is its own built
// `dist`, and oracle mode diffs Chrome against the Dawn renders under
// `packages/ground/oracle/results`. Either one missing used to read as a GREEN
// run — the script printed THREW (or a fetch 404 per scene) and exited 0
// regardless (design-013 Phase C review, 2026-09-07: "witnesses that cannot
// fail"). Now the missing thing is named with the command that produces it, and
// the exit code is 1 before Chrome is ever launched. `ORACLE_SCENES` is imported
// dynamically and only in oracle mode: `scenes.mjs` pulls a `.ts` module, which
// needs `tsx` — smoke and perf still run under plain `node`.
const die = (what, cmd) => {
  console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`);
  process.exit(1);
};
if (!existsSync(resolve(repo, "apps/groundlab/dist/index.html"))) {
  die("the lab's build is missing (apps/groundlab/dist/index.html)", "pnpm --filter ./apps/groundlab build");
}
let ORACLE_SCENES = null;
if (mode === "oracle") {
  ({ ORACLE_SCENES } = await import("@ice/ground/oracle/scenes.mjs"));
  const scored = ORACLE_SCENES.filter((sc) => sc.pages.length > 0);
  const missing = scored.filter((sc) => !existsSync(resolve(repo, `packages/ground/oracle/results/oracle-${sc.name}.rgba`)));
  if (missing.length) {
    die(
      `${missing.length} of ${scored.length} oracle render(s) missing from packages/ground/oracle/results (first: oracle-${missing[0].name}.rgba)`,
      "pnpm --filter ./packages/ground oracle",
    );
  }
}

// Every failure this run saw: a scene off the oracle, a boot that failed, a
// throw. The process exits with the count (a throw exits 1), so a caller —
// `pnpm run gate:landing` — can tell a green run from a run that happened.
let failures = 0;
let threw = false;

const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9461, headless: !process.env.GROUND_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, mode === "perf" ? 900_000 : 200_000).unref();

const PAGES = {
  raw: { url: "/magnet-grid/claude-agent-experiment/prototype/index.html", api: "__proto" },
  ground: { url: "/apps/groundlab/dist/index.html", api: "__ground" },
};

async function open(name) {
  const p = PAGES[name];
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}${p.url}`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`[log] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) {
    if (await tab.evaluate(`typeof window.${p.api} === 'object' || !document.getElementById('fail').hidden`, { timeoutMs: 20000 })) break;
    await sleep(200);
  }
  const fail = await tab.evaluate("document.getElementById('fail').hidden ? null : document.getElementById('fail').textContent", { timeoutMs: 20000 });
  return { name, api: p.api, tab, logs, fail };
}

const front = (tab) => tab.send("Page.bringToFront");
// Both pages render lazily (a dirty flag their rAF loop clears after drawing), and
// a backgrounded tab's rAF does not fire — so bring the tab to front, wait until
// the page reports the scene DRAWN (its dirty flag clear), then two frames for
// the compositor to present it. A capture before that is the previous scene.
async function settle(tab) {
  await front(tab);
  await tab.evaluate(`new Promise((resolve, reject) => {
    const drawn = () => (window.__ground ? !window.__ground.state.needsDraw : !(window.__proto.state.needsDraw || window.__proto.state.needsBake));
    const t0 = performance.now();
    const poll = () => { if (drawn() || performance.now() - t0 > 4000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))); else requestAnimationFrame(poll); };
    poll();
  })`, { awaitPromise: true, timeoutMs: 15000 });
}

// One scene, two APIs. The raw prototype exposes its state directly; the lab has setScene.
const sceneJs = (api, s) => api === "__ground"
  ? `(() => { window.__ground.setScene(${JSON.stringify(s)}); for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden'; })()`
  : `(() => {
  const p = window.__proto; const st = p.state;
  p.cards.length = 0; for (const c of ${JSON.stringify(s.cards)}) p.cards.push({ ...c, selected: false });
  st.camX = ${s.camX}; st.camY = ${s.camY}; st.zoom = ${s.zoom};
  st.mouseX = ${s.mouseX}; st.mouseY = ${s.mouseY}; st.pinned = true; st.mouseOn = ${s.mouseOn};
  st.reach = ${s.reach}; st.halfLen = ${s.halfLen}; st.theme = "${s.theme}"; document.documentElement.dataset.theme = "${s.theme}";
  st.mode = "${s.glyph ?? "dot"}"; st.forceFine = "${s.fine ?? "auto"}";
  if ("drawCards" in st) st.drawCards = false;
  st.needsBake = true; st.needsDraw = true;
  for (const el of document.querySelectorAll('.hud, .topbar, #poleDot, #stats')) el.style.visibility = 'hidden';
})()`;

// Two witnesses: on this always-loaded host the compositor can hand back the
// PREVIOUS frame (a stale capture reads as a real diff — ink share off by half,
// on a different row each run). Capture until two consecutive shots are
// byte-identical; the PNG encoder is deterministic, so identical bytes mean
// identical pixels.
async function capture(tab) {
  let prev = null;
  for (let i = 0; i < 5; i++) {
    await front(tab);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    if (data === prev) return data;
    prev = data;
    await settle(tab);
  }
  return prev;
}
async function pixelsOf(tab, png) {
  return tab.evaluate(`(async () => {
    const img = new Image(); img.src = "data:image/png;base64,${png}"; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
  })()`, { awaitPromise: true, timeoutMs: 60000 });
}
const BG = { dark: 0x17, light: 0xfa };   // --vf-canvas-bg per theme, the ink threshold's reference
function diff(a, b, bg = BG.dark) {
  if (a.w !== b.w || a.h !== b.h) return { error: `size ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  let maxD = 0;
  let over4 = 0;
  const n = a.w * a.h;
  let inkA = 0;
  let inkB = 0;
  const ink = (d, o) => Math.abs(d[o] - bg) + Math.abs(d[o + 1] - bg) + Math.abs(d[o + 2] - bg) > 12;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    if (d > maxD) maxD = d; if (d > 4) over4++; if (ink(a.data, o)) inkA++; if (ink(b.data, o)) inkB++;
  }
  return { maxD, over4Pct: (100 * over4) / n, inkA: (100 * inkA) / n, inkB: (100 * inkB) / n };
}
// `inkAlpha: 0.85` is the raw prototype's fixed value; the ground's default is the product's dotAlpha (1),
// so an A/B against raw states it. The rest are the study's field settings, not the product's.
// … `range: "open"`: the raw prototype has no size clamp. (Raw still draws its size ladder; the perf rows compare the same lattice, not the same pixels.)
const scene = (n, z, extra = {}) => ({ cards: makeCards(n), camX: 13.7, camY: -21.3, zoom: z, mouseX: 640, mouseY: 400, mouseOn: true, reach: 140, halfLen: 5.5, inkAlpha: 0.85, range: "open", theme: "dark", ...extra });

try {
  const pages = mode === "oracle" ? { ground: await open("ground") } : { raw: await open("raw"), ground: await open("ground") };
  for (const p of Object.values(pages)) console.log(`${p.name.padEnd(6)} boot: ${p.fail ? `FAIL ${p.fail}` : "ok"}${p.logs.length ? `\n  ${p.logs.slice(0, 5).join("\n  ")}` : ""}`);
  if (pages.raw?.fail || pages.ground.fail) throw new Error("boot failed");

  if (mode === "smoke") {
    for (const p of Object.values(pages)) {
      const sm = scene(24, 1.6); sm.cards = sm.cards.map((c, i) => (i === 3 ? { ...c, selected: true } : c));
      await p.tab.evaluate(sceneJs(p.api, sm)); await settle(p.tab); await new Promise((r) => setTimeout(r, 700)); await settle(p.tab);
      writeFileSync(resolve(results, `ab-smoke-${p.name}.png`), Buffer.from(await capture(p.tab), "base64"));
      await p.tab.evaluate("for (const el of document.querySelectorAll('#stats')) el.style.visibility = ''");
      console.log(`${p.name.padEnd(6)} stats: ${await p.tab.evaluate("document.getElementById('stats').textContent")}`);
    }
  }

  if (mode === "oracle") {
    let scenes = 0;
    for (const sc of ORACLE_SCENES) for (const name of sc.pages) {
      const p = pages[name];
      await p.tab.evaluate(sceneJs(p.api, sc.scene)); await settle(p.tab); await new Promise((r) => setTimeout(r, 400)); await settle(p.tab);
      const png = await capture(p.tab);
      const r = await p.tab.evaluate(`(async () => {
        const img = new Image(); img.src = "data:image/png;base64,${png}"; await img.decode();
        const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const a = g.getImageData(0, 0, img.width, img.height).data;
        const res = await fetch("/packages/ground/oracle/results/oracle-${sc.name}.rgba", { cache: "no-store" }); if (!res.ok) return { error: "fetch " + res.status };
        const b = new Uint8Array(await res.arrayBuffer()); if (b.length !== a.length) return { error: "size " + a.length + " vs " + b.length };
        let maxD = 0, over4 = 0, n = img.width * img.height;
        for (let i = 0; i < n; i++) { const o = i * 4; const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2])); if (d > maxD) maxD = d; if (d > 4) over4++; }
        return { maxD, over4Pct: +(100 * over4 / n).toFixed(4) };
      })()`, { awaitPromise: true, timeoutMs: 60000 });
      // THE ASSERTION. maxΔ 0 is the standing claim for every page scene (Chrome
      // = Dawn to the byte); `over4Pct` is redundant under it and printed
      // because a regression's SHAPE — one hot pixel or a whole surface — is the
      // first thing the next reader wants.
      scenes += 1;
      const ok = r.error === undefined && r.maxD === 0 && r.over4Pct === 0;
      if (!ok) failures += 1;
      const detail = r.error === undefined ? `maxΔ ${r.maxD} · over4 ${r.over4Pct}%` : `ERROR ${r.error}`;
      console.log(`${ok ? "PASS" : "FAIL"}  node oracle ${sc.name.padEnd(22)} vs ${name.padEnd(6)}: ${detail}`);
    }
    console.log(`\n${scenes} scene${scenes === 1 ? "" : "s"} checked · ${failures} FAILED`);
  }

  if (mode === "perf") {
    const ARM = (api, forceBake, n) => api === "__ground"
      ? `(async () => { const g = window.__ground; const q = g.ground.device.queue; await q.onSubmittedWorkDone();
          const t0 = performance.now(); let cpu = 0;
          for (let i = 0; i < ${n}; i++) { ${forceBake ? "g.ground.field.invalidate();" : ""} const c0 = performance.now(); g.render(); cpu += performance.now() - c0; }
          await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`
      : `(async () => { const p = window.__proto; const r = p.renderer; const q = r.device.queue; await q.onSubmittedWorkDone();
          const t0 = performance.now(); let cpu = 0;
          for (let i = 0; i < ${n}; i++) { p.state.needsBake = ${forceBake}; const c0 = performance.now(); r.draw(); cpu += performance.now() - c0; }
          await q.onSubmittedWorkDone(); return { ms: (performance.now() - t0) / ${n}, cpu: cpu / ${n} }; })()`;
    console.log(`crossOriginIsolated: ${await pages.raw.tab.evaluate("crossOriginIsolated")} / ${await pages.ground.tab.evaluate("crossOriginIsolated")}`);
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    for (const drawFrames of [false, true]) {
    console.log(`\n=== ${drawFrames ? "field + frames (ground) vs field only (raw)" : "field only, both"} ===`);
    console.log("  zoom  fade  cards  bake   batch    raw ms  ground ms   ratio    raw cpu  ground cpu");
    for (const forceBake of [true, false]) for (const n of [0, 48, 256]) for (const z of [1.0, 1.259, 2.512, 6.31]) {
      const s = scene(n, z, { drawFrames });
      for (const p of Object.values(pages)) { await p.tab.evaluate(sceneJs(p.api, s)); await settle(p.tab); }
      await front(pages.raw.tab);
      const probe = await pages.raw.tab.evaluate(ARM("__proto", forceBake, 4), { awaitPromise: true, timeoutMs: 60000 });
      const B = Math.max(3, Math.min(300, Math.round(25 / Math.max(probe.ms, 0.05))));
      const R = { raw: [], ground: [] };
      const C = { raw: [], ground: [] };
      for (let round = 0; round < 5; round++) for (const name of round % 2 ? ["ground", "raw"] : ["raw", "ground"]) {
        await front(pages[name].tab);
        const r = await pages[name].tab.evaluate(ARM(pages[name].api, forceBake, B), { awaitPromise: true, timeoutMs: 60000 });
        R[name].push(r.ms); C[name].push(r.cpu);
      }
      const st = await pages.ground.tab.evaluate("window.__ground.render().fade");
      console.log(`${z.toFixed(3).padStart(6)}  ${st.toFixed(2)}  ${String(n).padStart(5)}  ${forceBake ? "every" : "none "}  ${String(B).padStart(4)}  ${med(R.raw).toFixed(3).padStart(8)}  ${med(R.ground).toFixed(3).padStart(9)}  ${(med(R.ground) / med(R.raw)).toFixed(3).padStart(6)}   ${(med(C.raw) * 1000).toFixed(0).padStart(5)} µs  ${(med(C.ground) * 1000).toFixed(0).padStart(6)} µs`);
    }
    }
  }
  for (const p of Object.values(pages)) if (p.logs.length) console.log(`\n${p.name} logs:\n  ${p.logs.slice(0, 8).join("\n  ")}`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  threw = true;
} finally {
  await cleanup();
}
// A throw (a failed boot included) is 1; otherwise the number of scenes that
// missed the oracle, clamped because an exit code is one byte.
process.exit(threw ? 1 : Math.min(failures, 250));
