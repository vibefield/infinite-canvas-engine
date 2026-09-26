// rig:two-tab — a note typed in one tab arrives in the other when the typing SESSION commits (D2c; design-015
// §11.6's port of graybox's M5 two-tab test, desk objects instead of boxes). Two tabs of one headless Chrome join
// the same `?room=` document over a BroadcastChannel (core's bootstrap — `docs.join`). Tab A stays in front (a
// tab that loses focus blurs its editor, which would end the session); tab B is read through its DOCUMENT, which
// the channel's messages reach without a frame, then brought to the front to draw. The checks: a spawn in A
// reaches B; A's keystrokes are LIVE in A and cross NOTHING while the session is open; Escape commits the session
// and B's document holds the text with A's seeds — the same hand — and B draws it; 1 s without input commits the
// next session with A's editor still on the note; an undo in A takes the session back in B too. Exit 0 = passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9611), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 300_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };

/** Poll `fn` until it answers truthy or `ms` pass; the last answer. */
async function until(fn, ms) {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < ms) { await sleep(80); v = await fn(); }
  return v;
}

try {
  const room = `d2c-${process.pid}-${Date.now()}`;
  const url = `http://127.0.0.1:${PORT}/apps/desk/dist/index.html?room=${room}`;
  const logs = [];
  const open = async (name) => {
    const tab = await openTab(chrome.port, url);
    await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
    tab.on("Runtime.exceptionThrown", (e) => logs.push(`${name} EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
    tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`${name} [${e.entry.level}] ${e.entry.text}`); });
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
    for (let i = 0; i < 300; i++) { await tab.send("Page.bringToFront"); if (await q("typeof window.__desk === 'object' && window.__desk.state.ready")) break; await sleep(200); }
    return { tab, q, name };
  };
  const A = await open("A");
  const B = await open("B");
  check((await A.q("window.__desk.state.ready")) && (await B.q("window.__desk.state.ready")), `two tabs joined room ${room} (A ${await A.q("window.__desk.engine.docs.current() !== undefined")}, B ${await B.q("window.__desk.engine.docs.current() !== undefined")})`);
  const front = (T) => T.tab.send("Page.bringToFront");
  const key = async (k, modifiers = 0) => {
    const VK = { Escape: 27, End: 35, z: 90 };
    const code = k.length === 1 ? (k === " " ? "Space" : `Key${k.toUpperCase()}`) : k;
    const vk = VK[k] ?? (k === " " ? 32 : k.toUpperCase().charCodeAt(0));
    const text = k.length === 1 && modifiers === 0 ? { text: k, unmodifiedText: k } : {};
    await A.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...text });
    await A.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const typeKeys = async (s) => { for (const ch of s) { await key(ch); await sleep(20); } };
  const click = async (x, y) => {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await A.tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); if (type === "mousePressed") await sleep(30); }
    await sleep(80);
  };

  // a note spawned in A (a committed transaction) reaches B's document
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still')");
  await front(A);
  const a = await A.q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 400, y: 300 })");
  // B's DOCUMENT has it at once; its world projects on B's next frame — and a background tab gets none: B forward, once
  await front(B);
  const b = await until(() => B.q("(window.__desk.entities().find((e) => e.type === 'desk.note') ?? {}).id"), 8000);
  check(typeof b === "number", `the note spawned in A reaches B (A's #${a}, B's #${b})`);
  await front(A);
  await A.q("window.__desk.settle(4000)");

  // A writes: LIVE in A, nothing crosses while the session is open
  await click(400, 300);
  check((await A.q("window.__desk.note.editing()")) === a, "a tap in A puts A's editor on the note");
  await typeKeys("hello");
  const liveA = await A.q(`window.__desk.note.ink(${a})`);
  await sleep(300);
  const midB = await B.q(`window.__desk.note.docInk(${b})`);
  check(liveA?.text === "hello" && (await A.q("window.__desk.note.sessionOpen()")) && midB?.text === "", `A's keystrokes are live in A ("${liveA?.text}") and cross nothing while the session is open (B's document: "${midB?.text}")`);

  // Escape commits the session: B's document holds the text with A's seeds — the same hand
  await key("Escape");
  const docA = await A.q(`window.__desk.note.docInk(${a})`);
  const gotB = await until(async () => { const d = await B.q(`window.__desk.note.docInk(${b})`); return d?.text === "hello" ? d : null; }, 5000);
  check(docA?.text === "hello" && gotB !== null, `Escape commits the session and it arrives in B ("${gotB?.text ?? (await B.q(`window.__desk.note.docInk(${b})`))?.text}")`);
  check(gotB !== null && gotB.seeds === docA.seeds && gotB.seeds.length > 0, `with A's seeds — the same hand, glyph for glyph (${gotB?.seeds})`);
  await front(B);
  await B.q("window.__desk.settle(4000)");
  const rasterB = await B.q(`window.__desk.note.raster(${b})`);
  const layoutB = await B.q(`window.__desk.note.layout(${b})`);
  check(rasterB !== null && layoutB?.glyphs === 5, `B draws it: ${layoutB?.glyphs} glyphs in the hand, a ${rasterB?.w}² raster at band ${rasterB?.band}`);

  // 1 s without input commits the next session — A's editor still on the note
  await front(A);
  await A.q("window.__desk.settle(4000)");
  await click(400, 300);
  await key("End");
  await typeKeys(" world");
  await sleep(300);
  const midB2 = await B.q(`window.__desk.note.docInk(${b})`);
  const gotB2 = await until(async () => { const d = await B.q(`window.__desk.note.docInk(${b})`); return d?.text === "hello world" ? d : null; }, 5000);
  check(midB2?.text === "hello" && gotB2 !== null && (await A.q("window.__desk.note.editing()")) === a && (await A.q("window.__desk.note.editorFocused()")), `after 1 s without input the session commits and reaches B ("${midB2?.text}" → "${gotB2?.text}") while A still writes`);

  // an undo in A takes that session back — in B too
  await key("Escape");
  await key("z", 4);
  const undoneB = await until(async () => { const d = await B.q(`window.__desk.note.docInk(${b})`); return d?.text === "hello" ? d : null; }, 5000);
  check((await A.q(`window.__desk.note.docInk(${a})`))?.text === "hello" && undoneB !== null, `⌘Z in A takes the last session back in ONE step, and B follows ("${(await B.q(`window.__desk.note.docInk(${b})`))?.text}")`);

  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors in either tab");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
