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
// both witnesses counts. THE EXIT CODE IS THE VERDICT: the number of such scenes; 1 for a failed
// preflight, a failed boot or a throw; 2 for the watchdog. `pnpm run gate:landing` runs it.
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
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 900_000).unref();

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
  const drawn = await tab.evaluate(`window.__parity.render(${JSON.stringify(name)})`, { awaitPromise: true, timeoutMs: 60000 });
  await settle(tab); await sleep(200); await settle(tab);
  const png = await capture(tab);
  const r = await tab.evaluate(diffJs(png, name), { awaitPromise: true, timeoutMs: 60000 });
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
    if (!clean(r)) failures += 1;
    const detail = r.error === undefined ? `maxΔ ${r.maxD} · ${r.differ} px differ · over4 ${r.over4Pct}% · ${r.w}×${r.h}` : `ERROR ${r.error}`;
    console.log(`${clean(r) ? "PASS" : "FAIL"}  ${sc.name.padEnd(24)} ${detail.padEnd(46)} ${r.portals}${note}`);
  }
  const errs = await tab.evaluate("window.__parity.state.errors", { timeoutMs: 20000 });
  console.log(`\n${scenes.length} scene${scenes.length === 1 ? "" : "s"} checked · ${failures} FAILED · ${flaps} flap${flaps === 1 ? "" : "s"} (clean on the second witness) · ${errs.length} uncaptured GPU error${errs.length === 1 ? "" : "s"}`);
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
