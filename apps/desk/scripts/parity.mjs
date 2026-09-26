// rig:parity — Chrome = Node. Every oracle scene drawn by apps/desk's parity page (parity.html — D1's page, kept beside the real desk since D2a-world) in headless
// Chrome, held to the Node (Dawn) render of the same scene (packages/desk/oracle/results) byte for
// byte: maxΔ 0 on every channel of every pixel (design-015 §11 witness 1; plan D1 witness 5).
//
//   pnpm --filter ./packages/desk oracle && pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:parity [scene-regex]
//
// The page draws each scene through the oracle's own desk (frame.mjs), so what this compares is
// the two HOSTS — Dawn in Node and Chrome's WebGPU — not two scene builders. Ported from
// apps/groundlab/scripts/ab.mjs's oracle mode with its lessons: serve the REPO root (one COOP/COEP
// origin for the app's dist and the package's renders); bring the tab to front before any frame
// wait (a hidden tab never fires rAF); bound every evaluate; carry a watchdog (macOS has no
// `timeout`); capture until two consecutive shots are byte-identical (on this loaded host the
// compositor can hand back the previous frame). Headless by default; DESK_HEADED=1 for a window.
//
// Scenes are drawn in the oracle's order, the order its saved renders were made in. A scene off
// the oracle is drawn and captured ONCE more — the second witness the landing discipline asks of
// a rig on a loaded host — and reported as a flap if that witness is clean; only a scene red on
// both witnesses counts — unless it is a NAMED, MEASURED exception (EXCEPTIONS: its cause, and a
// bound pinned at what was measured — worse than the bound is red; better is a pass). THE EXIT
// CODE IS THE VERDICT: the number of red scenes; 1 for a failed preflight, a failed boot or a
// throw; 2 for the watchdog. `pnpm run gate:landing` runs it.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { ORACLE_SCENES } from "@ice/desk/oracle/scenes.mjs";
import { launchChrome, openTab } from "./cdp.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root: the app's dist and the package's oracle results
const results = resolve(app, "results");
mkdirSync(results, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * design-015 D3r-a (D-D3r-a.5): the whiteboard's INK is not bit-stable across the two hosts' Dawns. The stamp pass (board/
 * stamp.wgsl + felt.wgsl) — the same WGSL, the same stamps (bit-identical Float32 from both V8s, measured) — compiled by
 * Chrome's Dawn and by node-webgpu 0.4.0's quantises a handful of the raster's r8 coverages one LSB apart where a float lands
 * within an ulp of a rounding boundary: replayed alone, the bullet stroke and the eraser agree to the texel, the fine stroke and
 * the chisel stroke differ on 3 texels each (6 of the 1848 × 1208 raster, max 1). The melamine samples that raster, so a frame
 * shows it at those texels' footprint. Bounded at what was measured; the scenes stay, the cause is the board pass's to fix.
 */
const STAMP_LSB = "the ink raster's stamps quantise 6 of 2,232,384 texels 1 LSB apart between the two hosts' Dawns (D-D3r-a.5)";
const EXCEPTIONS = {
  "board-ink-z1": { maxD: 1, differ: 1, why: STAMP_LSB },
  "board-selected-z1": { maxD: 1, differ: 1, why: STAMP_LSB },
  "board-ink-z2.5": { maxD: 1, differ: 16, why: STAMP_LSB },  // D3t-a: the whiteboard IN HAND at work — the same class on the same kind of strokes (the green fine one, the red timed one), seen at
  // the reading scale (2.1×: a texel's footprint two device px); the pen itself is exact. Measured on both witnesses, and the two
  // Chrome paths (the oracle's desk here, the world in rig:world) agree with each other to the pixel.
  "hold-board-pen-e1-z1": { maxD: 1, differ: 5, why: STAMP_LSB },
  "hold-board-wet-e1-z1": { maxD: 1, differ: 11, why: STAMP_LSB },
  "hold-board-dry-e1-z1": { maxD: 1, differ: 10, why: STAMP_LSB },
};

// ── Preflight, before a browser exists: both things compared are FILES ON DISK ─────────────────
const die = (what, cmd) => {
  console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`);
  process.exit(1);
};
if (!existsSync(resolve(app, "dist/parity.html"))) die("the page's build is missing (apps/desk/dist/parity.html)", "pnpm --filter ./apps/desk build");
const scenes = only ? ORACLE_SCENES.filter((sc) => only.test(sc.name)) : ORACLE_SCENES;
if (scenes.length === 0) die(`no oracle scene matches ${only}`, "pnpm --filter ./apps/desk rig:parity [scene-regex]");
const missing = scenes.filter((sc) => !existsSync(resolve(repo, `packages/desk/oracle/results/oracle-${sc.name}.rgba`)));
if (missing.length) die(`${missing.length} of ${scenes.length} oracle render(s) missing from packages/desk/oracle/results (first: oracle-${missing[0].name}.rgba)`, "pnpm --filter ./packages/desk oracle");

/** A CDP port nothing listens on — never drive another session's Chrome by accident. */
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}

let threw = false;
let failures = 0;
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9471), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 1_800_000).unref();   // 49+ scenes took 14 min at load 400–700

const front = (tab) => tab.send("Page.bringToFront");
/** The frame the page drew is presented: to the front, two frames, a beat for the compositor. */
async function settle(tab) {
  await front(tab);
  await tab.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))))", { awaitPromise: true, timeoutMs: 15000 });
}
/** Capture until two consecutive shots are byte-identical (the PNG encoder is deterministic: same bytes, same pixels). */
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
/** Chrome's pixels (the PNG, decoded in the page) against the Node render, served from the repo root. */
const diffJs = (png, name) => `(async () => {
  const img = new Image(); img.src = "data:image/png;base64,${png}"; await img.decode();
  const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const a = g.getImageData(0, 0, img.width, img.height).data;
  const res = await fetch("/packages/desk/oracle/results/oracle-${name}.rgba", { cache: "no-store" }); if (!res.ok) return { error: "fetch " + res.status };
  const b = new Uint8Array(await res.arrayBuffer()); if (b.length !== a.length) return { error: "size " + img.width + "x" + img.height + " (" + a.length + " bytes) vs " + b.length };
  let maxD = 0; let over4 = 0; let differ = 0; const n = img.width * img.height;
  for (let i = 0; i < n; i++) { const o = i * 4; const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2])); if (d > maxD) maxD = d; if (d > 4) over4++; if (d > 0) differ++; }
  return { w: img.width, h: img.height, maxD, differ, over4Pct: +(100 * over4 / n).toFixed(4) };
})()`;

/** One witness: draw the scene, let it present, capture, compare. */
async function witness(tab, name) {
  await front(tab);
  // a scene with a view of its own (a phone's portrait still, D4b): the page's metrics follow it for this witness, the page's canvas too
  const v = ORACLE_SCENES.find((s) => s.name === name)?.scene?.view;
  if (v) { await tab.send("Emulation.setDeviceMetricsOverride", { width: v.cssW, height: v.cssH, deviceScaleFactor: v.dpr, mobile: false }); await sleep(200); }
  const drawn = await tab.evaluate(`window.__parity.render(${JSON.stringify(name)})`, { awaitPromise: true, timeoutMs: 60000 });
  await settle(tab); await sleep(200); await settle(tab);
  const png = await capture(tab);
  const r = await tab.evaluate(diffJs(png, name), { awaitPromise: true, timeoutMs: 60000 });
  if (v) { await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false }); await sleep(200); }
  return { ...r, portals: drawn.portals, png };
}

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/parity.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error" || e.entry.level === "warning") logs.push(`[${e.entry.level}] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 150; i++) {
    await front(tab);
    if (await tab.evaluate("typeof window.__parity === 'object' || !document.getElementById('fail').hidden", { timeoutMs: 20000 })) break;
    await sleep(200);
  }
  const fail = await tab.evaluate("document.getElementById('fail').hidden ? (typeof window.__parity === 'object' ? null : 'the page never came up') : document.getElementById('fail').textContent", { timeoutMs: 20000 });
  console.log(`chrome ${chrome.version.Browser} · page boot: ${fail ? `FAIL ${fail}` : "ok"} · ${await tab.evaluate("window.__parity ? window.__parity.format + ' · crossOriginIsolated ' + crossOriginIsolated : ''", { timeoutMs: 20000 })}${logs.length ? `\n  ${logs.slice(0, 5).join("\n  ")}` : ""}`);
  if (fail) throw new Error("boot failed");

  let flaps = 0;
  let kept = 0;
  console.log("\nscene                        Chrome vs Node                                live insides");
  for (const sc of scenes) {
    let r = await witness(tab, sc.name);
    let note = "";
    const clean = (x) => x.error === undefined && x.maxD === 0;
    if (!clean(r)) {
      const first = r;
      writeFileSync(resolve(results, `parity-${sc.name}-1.png`), Buffer.from(first.png, "base64"));
      r = await witness(tab, sc.name);   // the second witness
      note = clean(r) ? ` · FLAP: the first capture read ${first.error ?? `maxΔ ${first.maxD} on ${first.differ} px`}` : ` · red on both witnesses (the first: ${first.error ?? `maxΔ ${first.maxD}`})`;
      if (clean(r)) flaps += 1;
      else writeFileSync(resolve(results, `parity-${sc.name}-2.png`), Buffer.from(r.png, "base64"));
    }
    const bound = EXCEPTIONS[sc.name];
    const excused = !clean(r) && r.error === undefined && bound !== undefined && r.maxD <= bound.maxD && r.differ <= bound.differ;
    if (excused) { kept += 1; note += ` · KEPT within its measured bound (maxΔ ≤ ${bound.maxD}, ≤ ${bound.differ} px): ${bound.why}`; }
    else if (!clean(r)) failures += 1;
    const detail = r.error === undefined ? `maxΔ ${r.maxD} · ${r.differ} px differ · over4 ${r.over4Pct}% · ${r.w}×${r.h}` : `ERROR ${r.error}`;
    console.log(`${clean(r) ? "PASS" : excused ? "KEPT" : "FAIL"}  ${sc.name.padEnd(24)} ${detail.padEnd(46)} ${r.portals}${note}`);
  }
  const errs = await tab.evaluate("window.__parity.state.errors", { timeoutMs: 20000 });
  const scoped = await tab.evaluate("window.__parity.state.scoped", { timeoutMs: 20000 });
  console.log(`\n${scenes.length} scene${scenes.length === 1 ? "" : "s"} checked · ${failures} FAILED · ${kept} kept within a named, measured bound · ${flaps} flap${flaps === 1 ? "" : "s"} (clean on the second witness) · ${errs.length} GPU error${errs.length === 1 ? "" : "s"} (uncaptured, or in the probe's scopes over the creation and ${Math.max(0, scoped - 1)} frames)`);
  if (errs.length) { failures += 1; console.log(`  ${errs.slice(0, 5).join("\n  ")}`); }
  if (logs.length) console.log(`\npage logs:\n  ${logs.slice(0, 8).join("\n  ")}`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  threw = true;
} finally {
  await cleanup();
}
// A throw (a failed boot included) is 1; otherwise the number of scenes off the oracle on both witnesses, clamped to a byte.
process.exit(threw ? 1 : Math.min(failures, 250));
