// The desk calendar's COMMITTED PRINT (D3t-c; packages/objects/oracle/prints.mjs) — made from, and held to, the LIVE print. Each print
// fixture the oracle's scenes name (`print: { "YYYY-MM": name }`) is a month of the scenes' one set of entries: the scene is spawned
// into the WORLD through `window.__desk.setScene` with the live print (its events as the pad's data children, today pinned, the note
// stuck), the desk's own raster draws the sheet's tiles, and its level-2 tiles are read back (`__desk.calendar.readSheet` — the same
// `drawRegion` on the same OffscreenCanvas). `--write` commits them (oracle/fixtures/assets/<name>.json + .bin, raw-deflated RGBA);
// without it, every scene that names a print is held to the committed bytes, tile for tile — a note stuck to a day with no lines
// changes no printed byte. Headless Chrome; the moons follow the zone the scene pins beside its today (oracle/prints.mjs `PRINT_ZONE`,
// D7 — before, the machine's own, so a fixture was this machine's). Exit: the number of sheets that differ (1 for a throw, 2 for the watchdog).
//
//   pnpm --filter ./apps/desk build && tsx scripts/print-fixture.mjs [--write]
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { ORACLE_SCENES } from "@ice/objects/oracle/scenes.mjs";
import { launchChrome, openTab } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const assets = resolve(repo, "packages/objects/oracle/fixtures/assets");
const WRITE = process.argv.includes("--write");
/** The level the committed prints hold (band 0.5 texels a unit — four tiles by four for a sheet). */
export const PRINT_LEVEL = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The months a still's pad has in play: its own, and — mid-roll or peeking — the one rolling in (frame.mjs `pinPrints`). */
function monthsInPlay(c) {
  const [y, m] = (c.month ?? "2026-09").split("-").map(Number);
  const key = (d) => { const i = y * 12 + (m - 1) + d; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; };
  const pose = c.pose ?? {};
  if (pose.p !== undefined) return (pose.dir ?? 1) === 1 ? [key(0), key(1)] : [key(0), key(-1)];
  return (pose.peek ?? 0) > 1e-3 ? [key(0), key(1)] : [key(0)];
}

/** Every (scene, pad, month in play) that names a committed print, by the print's name — the first is the one a fixture is made from. */
export function printedSheets(scenes = ORACLE_SCENES) {
  const by = new Map();
  for (const sc of scenes) {
    (sc.scene.calendars ?? []).forEach((c, i) => {
      for (const month of monthsInPlay(c)) {
        const name = c.print?.[month];
        if (name === undefined) continue;
        if (!by.has(name)) by.set(name, []);
        by.get(name).push({ scene: sc, pad: i, month });
      }
    });
  }
  return by;
}

/**
 * Read a live sheet back through `tab` (a desk page): the scene spawned with the LIVE print, the tiles drawn (nothing pending, the
 * hand's face landed), level `PRINT_LEVEL`'s tiles as the raster draws them. Null when the pad never showed that month.
 */
export async function liveSheet(tab, sc, padIndex, month) {
  const scene = { ...sc.scene, calendars: sc.scene.calendars.map((c) => ({ ...c, livePrint: true })) };
  await tab.evaluate(`window.__desk.setScene(${JSON.stringify(scene)})`, { awaitPromise: true, timeoutMs: 60000 });
  // the scene's own pad, asked afresh each time (the desk the scene replaced may still be leaving): the pads the calendar's state
  // knows, as many as the scene lays, in spawn order
  let last = null;
  for (let i = 0; i < 150; i++) {
    await tab.send("Page.bringToFront");
    const r = await tab.evaluate(`(() => {
      const pads = window.__desk.entities().filter((e) => e.type === "desk.calendar" && window.__desk.calendar.roll(e.id) !== null).sort((a, b) => a.id - b.id);
      if (pads.length !== ${scene.calendars.length}) return { pads: pads.map((p) => p.id) };
      const pad = pads[${padIndex}].id;
      const t = window.__desk.calendar.tiles();
      const s = window.__desk.calendar.readSheet(pad, "${month}", ${PRINT_LEVEL});
      return t && t.pending === 0 && s !== null ? { s } : { t, has: s !== null, roll: window.__desk.calendar.roll(pad) };
    })()`, { timeoutMs: 20000 });
    if (r.s !== undefined) return r.s;
    last = r;
    await sleep(100);
  }
  console.log(`  (waited on ${sc.name} ${month}: ${JSON.stringify(last)})`);
  return null;
}

/** A sheet as the bytes a fixture holds: its tiles in row order (ty, then tx), the empty ones. */
function packed(sheet) {
  const order = (k) => { const [tx, ty] = k.split(":").map(Number); return ty * 1000 + tx; };
  const keys = Object.keys(sheet.tiles).sort((a, b) => order(a) - order(b));
  return { keys, empty: [...sheet.empty].sort((a, b) => order(a) - order(b)), bytes: Buffer.concat(keys.map((k) => Buffer.from(sheet.tiles[k], "base64"))) };
}

/** Hold a live sheet to the committed fixture `name`: tile for tile, byte for byte. */
export function compareSheet(name, sheet) {
  const meta = JSON.parse(readFileSync(resolve(assets, `${name}.json`), "utf8"));
  const committed = inflateRawSync(readFileSync(resolve(assets, `${name}.bin`)));
  const live = packed(sheet);
  const size = meta.tex * meta.tex * 4;
  let differ = 0;
  let tilesDiffer = 0;
  const sameSet = JSON.stringify(live.keys) === JSON.stringify(meta.tiles) && JSON.stringify(live.empty) === JSON.stringify(meta.empty);
  if (sameSet) {
    for (let t = 0; t < meta.tiles.length; t++) {
      let d = 0;
      for (let i = t * size; i < (t + 1) * size; i++) if (live.bytes[i] !== committed[i]) d++;
      if (d > 0) tilesDiffer++;
      differ += d;
    }
  }
  return { ok: sameSet && differ === 0, sameSet, tiles: meta.tiles.length, empty: meta.empty.length, tilesDiffer, differ, bytes: committed.length };
}

async function main() {
  if (!existsSync(resolve(app, "dist/rig.html"))) { console.log("PREFLIGHT FAIL: the desk's build is missing — pnpm --filter ./apps/desk build"); process.exit(1); }
  const sheets = printedSheets();
  const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
  const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
  const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
  let failures = 0;
  const cleanup = async () => { try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} };
  const kick = watchdog(300_000, cleanup);   // no row in 300 s: a hang (K-H — a slow host is not one)
  try {
    const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
    await tab.send("Runtime.enable");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
    for (const [name, uses] of sheets) {
      if (WRITE) {
        let sheet = null;
        let from = null;
        for (const u of uses) { sheet = await liveSheet(tab, u.scene, u.pad, u.month); if (sheet !== null) { from = u; break; } }
        if (sheet === null) { console.log(`FAIL  ${name}: no scene showed its month live`); failures++; continue; }
        const p = packed(sheet);
        writeFileSync(resolve(assets, `${name}.json`), `${JSON.stringify({ level: PRINT_LEVEL, tex: 260, tiles: p.keys, empty: p.empty })}\n`);
        const bin = deflateRawSync(p.bytes, { level: 9 });
        writeFileSync(resolve(assets, `${name}.bin`), bin);
        console.log(`WROTE ${name}: ${p.keys.length} tiles (${p.empty.length} empty) at level ${PRINT_LEVEL} from ${from.scene.name} (${from.month}) — ${(bin.length / 1024).toFixed(0)} KiB deflated of ${(p.bytes.length / 1024).toFixed(0)} KiB`);
        continue;
      }
      for (const u of uses) {
        const sheet = await liveSheet(tab, u.scene, u.pad, u.month);
        if (sheet === null) { console.log(`FAIL  ${name} · ${u.scene.name} (${u.month}): the month never showed live`); failures++; continue; }
        const r = compareSheet(name, sheet);
        if (!r.ok) failures++;
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${name} · ${u.scene.name} (${u.month}): the live print = the committed, ${r.sameSet ? `${r.tiles} tiles + ${r.empty} empty, ${r.tilesDiffer} differ (${r.differ} of ${r.bytes} bytes)` : "a different set of tiles"}`);
      }
    }
  } catch (e) { console.log("THREW:", String(e.stack ?? e)); failures = Math.max(failures, 1); }
  finally { await cleanup(); }
  process.exit(Math.min(failures, 250));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(here, "print-fixture.mjs")) await main();
