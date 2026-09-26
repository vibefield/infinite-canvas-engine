// rig:world — Chrome = Node FROM THE WORLD (design-015 §11 witness 2; D2a-world). Every mat, ruler
// and paper oracle scene is spawned into the desk's WORLD through `window.__desk.setScene` — the
// scene's objects as entities in one transaction, the camera written, the mat's clocks and plate
// pinned on the layer's handle, the rulers as the app's mat config, the committed raster pinned on
// its note — and the desk's reflector draws it from the builder's records; the page's pixels are
// held to the Node (Dawn) render of the same scene byte for byte: maxΔ 0 on every channel of every
// pixel. What this compares is the WORLD PATH — entities → kinds → records — against the oracle's
// direct scene builder (frame.mjs); the hosts were already equal (rig:parity).
//
//   pnpm --filter ./packages/desk oracle && pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:world [scene-regex]
//
// The minimat, chain and nav scenes need insides and flights (D2b) and are not drawn here; a scene
// off the oracle is drawn and captured ONCE more (the second witness the landing discipline asks of
// a rig on a loaded host) and reported as a flap if that witness is clean. THE EXIT CODE IS THE
// VERDICT: the number of scenes red on both witnesses; 1 for a failed preflight, boot or throw; 2
// for the watchdog. `pnpm run gate:landing` runs it after rig:parity.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { ORACLE_SCENES } from "@ice/desk/oracle/scenes.mjs";
import { launchChrome, openTab } from "./cdp.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const results = resolve(app, "results");
mkdirSync(results, { recursive: true });
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The scenes the world draws in this slice: the mat, the rulers, the notes — flat desks, no insides, no flight. */
const WORLD_SCENES = /^(mat|ruler|paper)-/;

const die = (what, cmd) => { console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`); process.exit(1); };
if (!existsSync(resolve(app, "dist/index.html"))) die("the desk's build is missing (apps/desk/dist/index.html)", "pnpm --filter ./apps/desk build");
const scenes = ORACLE_SCENES.filter((sc) => WORLD_SCENES.test(sc.name) && (only === null || only.test(sc.name)));
if (scenes.length === 0) die(`no mat/ruler/paper oracle scene matches ${only}`, "pnpm --filter ./apps/desk rig:world [scene-regex]");
const missing = scenes.filter((sc) => !existsSync(resolve(repo, `packages/desk/oracle/results/oracle-${sc.name}.rgba`)));
if (missing.length) die(`${missing.length} of ${scenes.length} oracle render(s) missing (first: oracle-${missing[0].name}.rgba)`, "pnpm --filter ./packages/desk oracle");

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
const chrome = await launchChrome({ port: await freePort(9491), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 900_000).unref();

const front = (tab) => tab.send("Page.bringToFront");
async function settle(tab) {
  await front(tab);
  return tab.evaluate("window.__desk.settle(8000)", { awaitPromise: true, timeoutMs: 20000 });
}
async function capture(tab) {
  let prev = null;
  for (let i = 0; i < 5; i++) {
    await front(tab);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    if (data === prev) return data;
    prev = data;
    await tab.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))))", { awaitPromise: true, timeoutMs: 15000 });
  }
  return prev;
}
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

/** One witness: spawn the scene into the world, let the desk settle, capture, compare. */
async function witness(tab, sc) {
  await front(tab);
  const spawned = await tab.evaluate(`window.__desk.setScene(${JSON.stringify(sc.scene)})`, { awaitPromise: true, timeoutMs: 60000 });
  const s = await settle(tab);
  await sleep(150);
  await settle(tab);
  const png = await capture(tab);
  const r = await tab.evaluate(diffJs(png, sc.name), { awaitPromise: true, timeoutMs: 60000 });
  const stats = await tab.evaluate("(() => { const s = window.__desk.stats(); return { objects: s.objects, redraws: s.redraws, live: s.live, kinds: s.frame && s.frame.kinds }; })()", { timeoutMs: 20000 });
  return { ...r, png, settled: s.settled, objects: stats.objects, kinds: stats.kinds, spawned: spawned.notes.length + spawned.minimats.length };
}

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error" || e.entry.level === "warning") logs.push(`[${e.entry.level}] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) {
    await front(tab);
    if (await tab.evaluate("(typeof window.__desk === 'object' && window.__desk.state.ready) || !document.getElementById('fail').hidden", { timeoutMs: 20000 })) break;
    await sleep(200);
  }
  const fail = await tab.evaluate("document.getElementById('fail').hidden ? (typeof window.__desk === 'object' && window.__desk.state.ready ? null : 'the desk never came up') : document.getElementById('fail').textContent", { timeoutMs: 20000 });
  const boot = await tab.evaluate("window.__desk ? { available: window.__desk.handle.available(), status: window.__desk.handle.status().state, vp: window.__desk.viewport(), iso: crossOriginIsolated } : null", { timeoutMs: 20000 });
  console.log(`chrome ${chrome.version.Browser} · desk boot: ${fail ? `FAIL ${fail}` : "ok"} · ${JSON.stringify(boot)}${logs.length ? `\n  ${logs.slice(0, 5).join("\n  ")}` : ""}`);
  if (fail) throw new Error("boot failed");

  let flaps = 0;
  console.log("\nscene                        Chrome (from the world) vs Node                objects");
  for (const sc of scenes) {
    let r = await witness(tab, sc);
    let note = "";
    const clean = (x) => x.error === undefined && x.maxD === 0;
    if (!clean(r)) {
      const first = r;
      writeFileSync(resolve(results, `world-${sc.name}-1.png`), Buffer.from(first.png, "base64"));
      r = await witness(tab, sc);
      note = clean(r) ? ` · FLAP: the first capture read ${first.error ?? `maxΔ ${first.maxD} on ${first.differ} px`}` : ` · red on both witnesses (the first: ${first.error ?? `maxΔ ${first.maxD}`})`;
      if (clean(r)) flaps += 1;
      else writeFileSync(resolve(results, `world-${sc.name}-2.png`), Buffer.from(r.png, "base64"));
    }
    if (!clean(r)) failures += 1;
    const detail = r.error === undefined ? `maxΔ ${r.maxD} · ${r.differ} px differ · over4 ${r.over4Pct}% · ${r.w}×${r.h}` : `ERROR ${r.error}`;
    console.log(`${clean(r) ? "PASS" : "FAIL"}  ${sc.name.padEnd(24)} ${detail.padEnd(52)} ${r.objects}/${r.spawned} ${JSON.stringify(r.kinds)}${r.settled ? "" : " · UNSETTLED"}${note}`);
  }
  console.log(`\n${scenes.length} scene${scenes.length === 1 ? "" : "s"} drawn from the world · ${failures} FAILED · ${flaps} flap${flaps === 1 ? "" : "s"} (clean on the second witness)`);
  if (logs.length) console.log(`\npage logs:\n  ${logs.slice(0, 8).join("\n  ")}`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  threw = true;
} finally {
  await cleanup();
}
process.exit(threw ? 1 : Math.min(failures, 250));
