// rig:capture — THE CAPTURE DOOR (petition I23; design-015 §2.4 idle-zero; DK-D25 "a frozen desk should be still and consume no render
// time at all"): `window.__desk.handle.capture({ rect?, scale? })` — the desk as the LAST PRESENTED frame showed it, as an ImageBitmap,
// drawn once more into a readable still and read back; never a copy kept of every frame, never a frame. On the showcase (a row of
// notes, a mini mat, a whiteboard, a notebook), the loop PARKED by the frame gate (`engine.frame.freeze("cover")`):
//
//   the still         capture() → view × dpr, a picture (many colours, alpha 255 throughout), its time the headline measurement;
//                     across it the engine took 0 steps, the desk drew 0 frames and 0 flushes drew; the queue saw ONE submit; the
//                     memory ledger made two resources (the still, its readback) and destroyed both — no `capture` row left, the live
//                     total unmoved (the ledger counts the capture, not a frame)
//   the thumbnail     capture({ scale: 0.25 }) → view × dpr / 4, timed; a rect → the rect × dpr
//   the share         two asked at once with equal options are one promise and one bitmap; a different one is its own
//   the oracle        the still `capture-desk-z1` staged FROM THE WORLD, frozen, captured: the bitmap's pixels are the Node (Dawn)
//                     render's — oracle/results/oracle-capture-desk-z1.rgba — at maxΔ 0 on every channel (the petition's acceptance 1),
//                     0 steps and 0 redraws across it
//   without the marks (petition I40) the same staged still, parked: `capture({ marks: false })` — its note SELECTED — is the same desk
//                     with its selection cleared and settled, parked and captured as presented, byte for byte (maxΔ 0); across the
//                     marks-off capture the selection stands and the engine took 0 steps and the desk drew 0 frames; the capture as
//                     presented, beside it, differs where the brackets are
//   the six at a quarter   (petition I29) `capture-six-z0.5` — one of each reference kind on a desk calendar — staged FROM THE WORLD
//                     and captured at 1× and 0.25×, then each kind staged away in turn and captured again: the quarter within the
//                     oracle's tolerance of the 1× still downsampled 4 × 4, and EACH KIND COUNTED in it — a kind's pixels being where
//                     the still differs from the same still without it, ≥ 90 % of those of the 1× still downsampled are its pixels in
//                     the quarter too (scenes.mjs QUARTER_TOL: the oracle's `captureCheck` holds the Node render to the same)
//   live              the gate open, a capture answers and the next frame still presents
//   the lost device   `device.destroy()` → status `failed` → capture() → undefined, no throw, the status unmoved (last: the desk ends)
//
//   pnpm --filter ./packages/objects oracle && pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:capture   (DESK_HEADED=1 to watch)
// Exit 0 = every check passed; 1 = a check failed or a throw; 2 = the watchdog.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CAPTURE_KINDS, ORACLE_SCENES, QUARTER_TOL } from "@ice/objects/oracle/scenes.mjs";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCENE = "capture-desk-z1";
const die = (what, cmd) => { console.log(`PREFLIGHT FAIL: ${what}\n  produce it with:  ${cmd}`); process.exit(1); };
if (!existsSync(resolve(app, "dist/rig.html"))) die("the desk's build is missing (apps/desk/dist/rig.html)", "pnpm --filter ./apps/desk build");
if (!existsSync(resolve(repo, `packages/objects/oracle/results/oracle-${SCENE}.rgba`))) die(`the oracle render oracle-${SCENE}.rgba is missing`, "pnpm --filter ./packages/objects oracle");
const scene = ORACLE_SCENES.find((sc) => sc.name === SCENE);
if (scene === undefined) die(`no oracle scene ${SCENE}`, "packages/objects/oracle/scenes.mjs CAPTURE_SCENES");
const SIX = "capture-six-z0.5";
const six = ORACLE_SCENES.find((sc) => sc.name === SIX);
if (six === undefined) die(`no oracle scene ${SIX}`, "packages/objects/oracle/scenes.mjs QUARTER_SCENES");

const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(300_000, cleanup);   // no row in 300 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const ms = (v) => (typeof v === "number" ? v.toFixed(1) : String(v));

/** The bitmap's pixels through a 2D canvas (an ImageBitmap is not readable itself): RGBA, straight alpha — lossless at alpha 255. */
const PIXELS = "((bmp) => { const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height).data; })";
/** A still shrunk by `f` in the page — each pixel the mean of its f × f block of bytes (the oracle's `downsample`) — and the larger of two pixels' channel differences. */
const DOWN = "((P, w, h, f) => { const W = Math.floor(w / f); const H = Math.floor(h / f); const o = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += P[((y * f + j) * w + x * f + i) * 4 + c]; o[(y * W + x) * 4 + c] = Math.round(s / (f * f)); } return o; })";
const DELTA = "((A, B, o) => Math.max(Math.abs(A[o] - B[o]), Math.abs(A[o + 1] - B[o + 1]), Math.abs(A[o + 2] - B[o + 2])))";
/** The loop parked by the gate under a named freeze: the thaw kept on the window; true once parked (the settle walk takes a few frames). */
const PARK = (name) => `(async () => { const F = window.__desk.engine.engine.frame; window.__thaw = F.freeze(${JSON.stringify(name)}); for (let i = 0; i < 400 && !F.isParked(); i++) await new Promise((r) => requestAnimationFrame(r)); return { parked: F.isParked(), holds: F.holds() }; })()`;

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  await front();
  const q = (js, timeoutMs = 20000) => tab.evaluate(js, { timeoutMs });
  const qa = (js, timeoutMs = 60000) => tab.evaluate(js, { awaitPromise: true, timeoutMs });
  const settle = async (ms = 8000) => { await front(); return qa(`window.__desk.settle(${ms})`); };
  // the bar is DOM over the canvas (design-018 §5): the still is the renderer's frame alone, as the oracle's is
  await q("window.__desk.bar(false)");

  // ── the showcase: a row of notes, a mini mat, a whiteboard, a notebook — at rest
  await q("(() => { const d = window.__desk; for (let i = 0; i < 6; i++) d.spawn('desk.note', { seed: i + 1 }, { x: 160 + i * 150, y: 160 }); d.spawn('desk.minimat', { name: 'Inbox' }, { x: 300, y: 540 }); d.spawn('desk.board', {}, { x: 780, y: 560 }); d.spawn('desk.notebook', { seed: 3, angle: 0.05 }, { x: 1050, y: 330 }); return 0; })()");
  await q("window.__desk.ambient('still')");
  const settled = await settle();
  const vp = await q("window.__desk.viewport()");
  check(settled.settled === true && vp.w === 1200 && vp.h === 800 && vp.dpr === 2, `the showcase drawn and quiet (${settled.redraws} redraws; the view ${vp.w}×${vp.h} @ ${vp.dpr})`);
  check((await q("window.__desk.handle.gpuMemory() !== undefined")) === true, "the memory ledger is kept from the boot (the app asks for it, D-K2.2) — the capture's own line is readable");

  // ── the loop parked under freeze("cover") — the covers' case (DK-D25)
  const parked = await qa(PARK("cover"));
  check(parked.parked === true && parked.holds.includes("cover"), `the frame gate parks the loop under freeze("cover") (holds: ${parked.holds.join(", ")})`);

  // ── the still: capture() on the parked desk — the counters around it
  const still = await qa(`(async () => {
    const d = window.__desk; const F = d.engine.engine.frame; const L = d.handle.gpuMemory();
    const read = () => { const m = L.read(); return { steps: F.sleepStats().steps, redraws: d.handle.redraws(), frames: d.handle.perf().frames, submits: d.submits().total, made: m.made, destroyed: m.destroyed, total: m.total, row: m.byLabel.capture ?? null }; };
    const before = read();
    const t0 = performance.now();
    const bmp = await d.handle.capture();
    const took = performance.now() - t0;
    const after = read();
    if (!bmp) return { bmp: null, took, before, after };
    const size = { width: bmp.width, height: bmp.height };   // read before close(): a closed ImageBitmap is 0×0
    const a = ${PIXELS}(bmp);
    const colours = new Set(); for (let i = 0; i < a.length; i += 4 * 97) colours.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    let alpha = true; for (let i = 3; i < a.length; i += 4 * 331) if (a[i] !== 255) alpha = false;
    // the same still twice more, warm: the time a cover pays once the first has paid the warm-up
    const again = []; for (let k = 0; k < 2; k++) { const t = performance.now(); const b = await d.handle.capture(); again.push(performance.now() - t); b.close(); }
    bmp.close();
    return { bmp: size, took, again, colours: colours.size, alpha, before, after };
  })()`);
  check(still.bmp !== null && still.bmp.width === Math.round(vp.w * vp.dpr) && still.bmp.height === Math.round(vp.h * vp.dpr), `capture() → an ImageBitmap of the view × dpr: ${still.bmp?.width}×${still.bmp?.height}`);
  check(still.colours > 1 && still.alpha === true, `a picture: ${still.colours} colours among the sampled pixels, alpha 255 throughout`);
  const d = (k) => still.after[k] - still.before[k];
  check(d("steps") === 0 && d("redraws") === 0 && d("frames") === 0, `no frame: ${d("steps")} engine steps, ${d("redraws")} redraws, ${d("frames")} flushes that drew across the capture`);
  check(d("submits") === 1 && d("made") === 2 && d("destroyed") === 2 && still.after.row === null && d("total") === 0, `the ledger counts the capture and no frame: ${d("submits")} submit; the still and its readback made (+${d("made")}) and destroyed (+${d("destroyed")}); no \`capture\` row left; the live total moved by ${d("total")} bytes`);
  console.log(`  capture at 1× (${still.bmp?.width}×${still.bmp?.height}): ${ms(still.took)} ms first, then ${still.again.map(ms).join(" / ")} ms`);

  // ── the thumbnail and the rect
  const THUMB = 0.25;   // the thumbnails' scale (VibeField DK-4 asks a quarter)
  const small = await qa(`(async () => {
    const d = window.__desk;
    const t0 = performance.now(); const b = await d.handle.capture({ scale: ${THUMB} }); const took = performance.now() - t0;
    const again = []; for (let k = 0; k < 2; k++) { const t = performance.now(); const x = await d.handle.capture({ scale: ${THUMB} }); again.push(performance.now() - t); x.close(); }
    const r = await d.handle.capture({ rect: { x: 100, y: 80, width: 320, height: 200 } });
    const out = { thumb: b ? { width: b.width, height: b.height } : null, took, again, rect: r ? { width: r.width, height: r.height } : null };
    b?.close(); r?.close();
    return out;
  })()`);
  check(small.thumb !== null && small.thumb.width === Math.round((vp.w * vp.dpr) / 4) && small.thumb.height === Math.round((vp.h * vp.dpr) / 4), `capture({ scale: 0.25 }) → the view at a quarter of the dpr: ${small.thumb?.width}×${small.thumb?.height}`);
  check(small.rect !== null && small.rect.width === 320 * vp.dpr && small.rect.height === 200 * vp.dpr, `capture({ rect: 320×200 css at (100, 80) }) → the rect × dpr: ${small.rect?.width}×${small.rect?.height}`);
  console.log(`  capture at 0.25× (${small.thumb?.width}×${small.thumb?.height}): ${ms(small.took)} ms first, then ${small.again.map(ms).join(" / ")} ms`);

  // ── the share: equal options in flight together are one answer; a different one its own
  const share = await qa("(async () => { const d = window.__desk; const a = d.handle.capture(); const b = d.handle.capture(); const c = d.handle.capture({ scale: 0.5 }); const [ra, rb, rc] = await Promise.all([a, b, c]); const out = { same: a === b && ra === rb, other: c !== a && rc !== ra, sizes: [ra?.width, rc?.width] }; ra?.close(); rc?.close(); return out; })()");
  check(share.same === true && share.other === true && share.sizes[0] === 2400 && share.sizes[1] === 1200, `two captures asked at once with equal options share one promise and one bitmap; a third with another scale is its own (${share.sizes.join(" / ")} px wide)`);
  await q("window.__thaw()");

  // ── THE ORACLE (acceptance 1): the still staged from the world, the loop parked, captured — the bytes are Dawn's
  await qa(`window.__desk.setScene(${JSON.stringify(scene.scene)})`);
  await settle();
  await sleep(150);
  await settle();
  const cmp = await qa(`(async () => {
    const d = window.__desk; const F = d.engine.engine.frame;
    const p = await ${PARK("oracle")};
    const steps0 = F.sleepStats().steps; const redraws0 = d.handle.redraws();
    const bmp = await d.handle.capture();
    const r = { parked: p.parked, steps: F.sleepStats().steps - steps0, redraws: d.handle.redraws() - redraws0 };
    window.__thaw();
    if (!bmp) return { ...r, error: "no bitmap" };
    const w = bmp.width; const h = bmp.height;   // before close()
    const a = ${PIXELS}(bmp);
    bmp.close();
    let res = null;
    for (let i = 0; i < 6; i++) {
      try { res = await fetch("/packages/objects/oracle/results/oracle-${SCENE}.rgba", { cache: "no-store" }); if (res.ok || res.status === 404) break; } catch (e) { if (i === 5) return { ...r, error: "fetch " + e }; }
      await new Promise((w) => setTimeout(w, 100 * 2 ** i));
    }
    if (!res.ok) return { ...r, error: "fetch " + res.status };
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.length !== a.length) return { ...r, error: "size " + w + "x" + h + " (" + a.length + " bytes) vs " + b.length };
    let maxD = 0; let differ = 0; const n = w * h;
    for (let i = 0; i < n; i++) { const o = i * 4; const dd = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2])); if (dd > maxD) maxD = dd; if (dd > 0) differ++; }
    return { ...r, w, h, maxD, differ, n };
  })()`);
  check(cmp.error === undefined && cmp.maxD === 0 && cmp.n === 2400 * 1600, `${SCENE} staged from the world, frozen, captured: ${cmp.error ?? `${cmp.w}×${cmp.h} — maxΔ ${cmp.maxD} on ${cmp.differ?.toLocaleString()} of ${cmp.n?.toLocaleString()} px against the Node render`}`);
  check(cmp.parked === true && cmp.steps === 0 && cmp.redraws === 0, `…with the loop parked (${cmp.parked}): ${cmp.steps} engine steps and ${cmp.redraws} redraws across the capture`);

  // ── WITHOUT THE SELECTION'S MARKS (petition I40): the staged still parked again — `capture({ marks: false })` and, beside it, the
  //    capture as presented; then the selection CLEARED, the desk settled, parked and captured as presented: the marks-off bitmap is
  //    that one byte for byte, and the selection and the frame stood across it
  const off = await qa(`(async () => {
    const d = window.__desk; const F = d.engine.engine.frame;
    const p = await ${PARK("unmarked")};
    const sel0 = d.selection(); const steps0 = F.sleepStats().steps; const redraws0 = d.handle.redraws();
    const bare = await d.handle.capture({ marks: false });
    const r = { parked: p.parked, selected: sel0.length, same: JSON.stringify(d.selection()) === JSON.stringify(sel0), steps: F.sleepStats().steps - steps0, redraws: d.handle.redraws() - redraws0 };
    const shown = await d.handle.capture();
    window.__thaw();
    if (!bare || !shown) return { ...r, error: "no bitmap" };
    const w = bare.width; const h = bare.height;
    const a = ${PIXELS}(bare); const m = ${PIXELS}(shown);
    bare.close(); shown.close();
    let drew = 0; for (let o = 0; o < a.length; o += 4) if (${DELTA}(a, m, o) > 0) drew++;
    window.__i40 = a;
    return { ...r, w, h, drew };
  })()`);
  await q("window.__desk.engine.ops.clearSelection()");
  await settle();
  await sleep(150);
  await settle();
  const plain = await qa(`(async () => {
    const d = window.__desk;
    const p = await ${PARK("unselected")};
    const bmp = await d.handle.capture();
    const selected = d.selection().length;
    window.__thaw();
    if (!bmp) return { parked: p.parked, selected, error: "no bitmap" };
    const b = ${PIXELS}(bmp); bmp.close();
    const a = window.__i40; window.__i40 = undefined;
    if (!a || a.length !== b.length) return { parked: p.parked, selected, error: "size " + (a?.length ?? 0) + " vs " + b.length };
    let maxD = 0; let differ = 0;
    for (let o = 0; o < a.length; o += 4) { const dd = Math.max(${DELTA}(a, b, o), Math.abs(a[o + 3] - b[o + 3])); if (dd > maxD) maxD = dd; if (dd > 0) differ++; }
    return { parked: p.parked, selected, maxD, differ, n: a.length / 4 };
  })()`);
  check(off.error === undefined && plain.error === undefined && off.selected > 0 && plain.selected === 0 && plain.maxD === 0 && off.drew > 0, `capture({ marks: false }) of ${SCENE} with ${off.selected} object selected IS the same desk unselected, settled and captured: ${off.error ?? plain.error ?? `${off.w}×${off.h} — maxΔ ${plain.maxD} on ${plain.differ?.toLocaleString()} of ${plain.n?.toLocaleString()} px; the capture as presented differs on ${off.drew.toLocaleString()} px (the selection's marks)`}`);
  check(off.parked === true && off.same === true && off.steps === 0 && off.redraws === 0, `…and across it the selection stood (${off.same ? "the same" : "CHANGED"}) and no frame was drawn: ${off.steps} engine steps, ${off.redraws} redraws (the loop parked: ${off.parked})`);

  // ── THE SIX AT A QUARTER (petition I29): one of each reference kind, staged from the world; then each staged away in turn — a kind's
  //    pixels counted in the 0.25 still against the 1× still downsampled, to the oracle's tolerance (scenes.mjs QUARTER_TOL)
  const stage = async (s) => { await qa(`window.__desk.setScene(${JSON.stringify(s)})`); await settle(); await sleep(150); await settle(); };
  /** The staged still, the loop parked: at 1× downsampled 4 × 4 in the page, and at 0.25×. */
  const STILLS = `(async () => { const d = window.__desk; const p = await ${PARK("quarter")}; const a = await d.handle.capture(); const q = await d.handle.capture({ scale: 0.25 }); window.__thaw(); if (!a || !q) { a?.close(); q?.close(); return null; } const out = { parked: p.parked, down: ${DOWN}(${PIXELS}(a), a.width, a.height, 4), q: ${PIXELS}(q), qw: q.width, qh: q.height }; a.close(); q.close(); return out; })()`;
  await stage(six.scene);
  const whole = await qa(`(async () => {
    const s = await ${STILLS};
    if (s === null) return { error: "no bitmap" };
    window.__six = s;
    const delta = ${DELTA}; const n = s.qw * s.qh; const D = new Uint8Array(n); let sum = 0;
    for (let i = 0; i < n; i++) { D[i] = delta(s.q, s.down, i * 4); sum += D[i]; }
    D.sort();
    return { parked: s.parked, qw: s.qw, qh: s.qh, mean: sum / n, p99: D[Math.floor(n * 0.99)], worst: D[n - 1] };
  })()`);
  check(whole.error === undefined && whole.parked === true && whole.qw === 600 && whole.qh === 400 && whole.mean <= QUARTER_TOL.mean && whole.p99 <= QUARTER_TOL.p99, `${SIX} staged from the world, the loop parked, captured at 0.25× (${whole.qw}×${whole.qh}) against its 1× still downsampled 4×4: ${whole.error ?? `mean |Δ| ${whole.mean.toFixed(2)} (≤ ${QUARTER_TOL.mean}), 99 % within ${whole.p99} (≤ ${QUARTER_TOL.p99}), maxΔ ${whole.worst}`}`);
  const counted = [];
  for (const [field, label] of CAPTURE_KINDS) {
    if (!((six.scene[field]?.length ?? 0) > 0)) continue;
    await stage({ ...six.scene, [field]: [] });
    const k = await qa(`(async () => {
      const s = await ${STILLS}; const S = window.__six;
      if (s === null) return { error: "no bitmap" };
      const delta = ${DELTA}; let n1 = 0; let both = 0;
      for (let i = 0; i < S.qw * S.qh; i++) { const o = i * 4; if (delta(S.down, s.down, o) <= ${QUARTER_TOL.kind}) continue; n1++; if (delta(S.q, s.q, o) > ${QUARTER_TOL.kind}) both++; }
      return { n1, both };
    })()`);
    counted.push({ label, error: k.error, n1: k.n1 ?? 0, drawn: k.n1 > 0 ? k.both / k.n1 : 0 });
    kick();
  }
  check(counted.length === CAPTURE_KINDS.length && counted.every((k) => k.error === undefined && k.n1 > 0 && k.drawn >= QUARTER_TOL.drawn), `…its ${counted.length} kinds counted in the quarter, each staged away in turn (≥ ${QUARTER_TOL.drawn * 100} % of a kind's pixels in the 1× still downsampled are its pixels there too): ${counted.map((k) => `${k.label} ${k.error ?? `${(k.drawn * 100).toFixed(1)} % of ${k.n1.toLocaleString()} px`}`).join(", ")}`);

  // ── live: the gate open, a capture answers and the next frame still presents
  const live = await qa("(async () => { const d = window.__desk; const F = d.engine.engine.frame; const frozen = F.isFrozen(); const r0 = d.handle.redraws(); const b = await d.handle.capture({ scale: 0.5 }); const cam = d.camera(); d.setCamera({ x: cam.x + 1, y: cam.y, zoom: cam.zoom }); await d.settle(4000); const out = { frozen, bmp: b ? { width: b.width, height: b.height } : null, redrew: d.handle.redraws() > r0 }; b?.close(); return out; })()");
  check(live.frozen === false && live.bmp !== null && live.redrew === true, `live (the gate open): a capture answers ${live.bmp?.width}×${live.bmp?.height} and the next frame still presents (the camera moved, the desk redrew)`);

  // ── the lost device — LAST: the desk ends (its own console.error is the desk's word on the loss, K9 — expected below)
  const seen = logs.length;
  const lost = await qa(`(async () => {
    const h = window.__desk.handle; const heard = []; h.onStatus((s) => heard.push(s.state));
    h.device().destroy();
    for (let i = 0; i < 300 && h.status().state !== "failed"; i++) await new Promise((r) => setTimeout(r, 10));
    const before = h.status();
    let threw = null; let bmp = "unset";
    try { bmp = await h.capture(); } catch (e) { threw = String(e); }
    return { state: before.state, after: h.status().state, same: h.status() === before, bmp: bmp === undefined ? "undefined" : typeof bmp, threw, heard };
  })()`, 30000);
  check(lost.state === "failed" && lost.bmp === "undefined" && lost.threw === null && lost.same === true, `after a forced device loss (status ${lost.state}): capture() → ${lost.bmp}, ${lost.threw === null ? "no throw" : `THREW ${lost.threw}`}, the status unmoved (heard: ${lost.heard.join(", ")})`);

  const before = [...logs.slice(0, seen), ...(await faultsOf(tab))];
  const after = logs.slice(seen).filter((l) => !/the device was lost|device was destroyed|Device was destroyed|uncaptured GPU error/.test(l));
  if (before.length || after.length) console.log(`page errors:\n  ${[...before, ...after].slice(0, 6).join("\n  ")}`);
  check(before.length === 0 && after.length === 0, `no page errors (the loss's own ${logs.length - seen} line${logs.length - seen === 1 ? "" : "s"} are the desk's word on it)`);
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
