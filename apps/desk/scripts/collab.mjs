// rig:collab — THE M9 LIVE WITNESS (D5a; design-015 §11.6 — nodeboard's "two-machine collab demo over the dumb relay",
// on the desk): the rig starts `pnpm relay`'s own server (scripts/ws-relay.mjs, on a free port it picks), and two tabs of
// one headless Chrome join the same `?room=` THROUGH IT (`?relay=ws://…` — core's `webSocketByteChannel`, the bootstrap's
// hello/snapshot handshake, presence on the same socket), each with a pinned identity (`?name=`/`?color=`). The checks:
// both joined over the relay (the relay saw both sockets in the room; a desk that ignored `?relay=` would still converge
// over the same-origin BroadcastChannel — the socket count is what tells them apart); an ADD in A reaches B;
// a real DRAG in A lands in B where A let go; a DELETE in A leaves B; and each tab DRAWS THE OTHER'S HAND (D-D5a.1) — A's
// pointer on A's desk is Alice's violet arrow on B's, at the same point with her name, and B's pointer Bob's on A's —
// read from the marks the frame drew and from the frame itself: the pixel under the arrow's body is the peer's ink, byte
// for byte; and what A holds selected wears A's brackets on B's desk at 50 %. Objects cross by their durable KEY
// (`__desk.room`). Exit 0 = passed.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:collab
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { MARKS } from "../../../packages/desk/src/theme.ts";
import { launchChrome, openTab } from "./cdp.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free port in ${from}…${from + 39}`);
}
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
// THE RELAY: `pnpm relay`'s server, verbatim, on a port of the rig's own — its log counts the room's sockets
const RELAY_PORT = await freePort(19301);
const relayLog = [];
const relay = spawn(process.execPath, [resolve(repo, "scripts/ws-relay.mjs")], { cwd: repo, env: { ...process.env, PORT: String(RELAY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
relay.stdout.on("data", (b) => relayLog.push(...String(b).split("\n").filter(Boolean)));
relay.stderr.on("data", (b) => relayLog.push(`stderr ${String(b).trim()}`));
for (let i = 0; i < 100 && !relayLog.some((l) => l.includes("listening")); i++) await sleep(50);
const chrome = await launchChrome({ port: await freePort(9651), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} try { relay.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 240_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
/** Poll `fn` until it answers truthy or `ms` pass; the last answer. */
async function until(fn, ms) {
  const start = Date.now();
  let v = await fn();
  while (!v && Date.now() - start < ms) { await sleep(80); v = await fn(); }
  return v;
}
const byteOf = (css) => { const v = Number.parseInt(css.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

try {
  const room = `d5a-${process.pid}-${Date.now()}`;
  const ALICE = { name: "Alice", color: MARKS.hand.inks[0] };
  const BOB = { name: "Bob", color: MARKS.hand.inks[2] };
  const urlOf = (who) => `http://127.0.0.1:${PORT}/apps/desk/dist/index.html?room=${room}&relay=${encodeURIComponent(`ws://127.0.0.1:${RELAY_PORT}`)}&name=${who.name}&color=${encodeURIComponent(who.color)}`;
  const logs = [];
  const open = async (name, who) => {
    const tab = await openTab(chrome.port, urlOf(who));
    await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
    tab.on("Runtime.exceptionThrown", (e) => logs.push(`${name} EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
    tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`${name} [${e.entry.level}] ${e.entry.text}`); });
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
    for (let i = 0; i < 300; i++) { await tab.send("Page.bringToFront"); if (await q("typeof window.__desk === 'object' && window.__desk.state.ready")) break; await sleep(200); }
    return { tab, q, name };
  };
  const A = await open("A", ALICE);
  const B = await open("B", BOB);
  const front = async (T) => { await T.tab.send("Page.bringToFront"); await T.q("window.__desk.settle(4000)"); };
  const mouse = (T, type, x, y) => T.tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const key = async (T, k, code, vk, modifiers = 0) => { await T.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await T.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  const K = (k) => JSON.stringify(k);
  const roleOf = (T) => T.q("(() => { const d = window.__desk.engine.docs; return d.current() !== undefined && d.presence() !== undefined; })()");
  const sockets = relayLog.filter((l) => l.includes(`room=${JSON.stringify(room)}`) && l.startsWith("+ connect")).length;
  check((await roleOf(A)) && (await roleOf(B)) && sockets === 2, `two tabs joined room ${room} THROUGH THE RELAY (ws://127.0.0.1:${RELAY_PORT}: ${sockets} sockets in the room), each with its document and its presence`);
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still')");

  // ---- an ADD in A reaches B
  await front(A);
  const n = await A.q("window.__desk.spawn('desk.note', { seed: 17 }, { x: 400, y: 300 })");
  const nKey = await A.q(`window.__desk.room.key(${n})`);
  await front(A);
  const n0 = await A.q(`window.__desk.entity(${n})`);
  await front(B);
  const bn = await until(() => B.q(`window.__desk.room.resolve(${K(nKey)})`), 8000);
  const bn0 = bn === null ? null : await B.q(`window.__desk.entity(${bn})`);
  check(bn0 !== null && bn0.x === n0.x && bn0.y === n0.y && bn0.props.seed === 17, `an ADD in A reaches B over the relay (key ${nKey}: A's at (${n0.x}, ${n0.y}), B's at (${bn0?.x}, ${bn0?.y}))`);

  // ---- a MOVE in A (a real drag) lands in B where A let go
  await front(A);
  await mouse(A, "mouseMoved", 400, 300); await mouse(A, "mousePressed", 400, 300);
  for (let i = 1; i <= 8; i++) { await mouse(A, "mouseMoved", 400 + 20 * i, 300 + 5 * i); await sleep(16); }
  await sleep(120);
  await mouse(A, "mouseReleased", 560, 340);
  await front(A);
  const moved = await A.q(`window.__desk.entity(${n})`);
  await front(B);
  const movedB = await until(async () => { const e = await B.q(`window.__desk.entity(${bn})`); return e !== null && e.x === moved.x && e.y === moved.y ? e : null; }, 8000);
  check(moved.x > n0.x && movedB !== null, `a MOVE in A — a real drag — lands in B where A let go: (${moved.x}, ${moved.y}) in A, (${movedB?.x}, ${movedB?.y}) in B`);

  // ---- each tab DRAWS the other's hand: A's pointer on A's desk is Alice's arrow on B's, with her name; A's selection on B at 50 %
  await front(A);
  await mouse(A, "mouseMoved", 820, 520);
  await A.q(`window.__desk.engine.ops.setSelection([${n}], "replace")`);
  await front(A);
  await sleep(300);
  await front(B);
  const handsOf = async (T) => (await T.q("window.__desk.marks()?.peers ?? null")) ?? { hands: [], selections: [] };
  const seenB = await until(async () => { const p = await handsOf(B); return p.hands.find((h) => h.x === 820 && h.y === 520) ? p : null; }, 8000);
  const handB = seenB?.hands.find((h) => h.x === 820 && h.y === 520);
  const inkA = byteOf(ALICE.color);
  const inkB = byteOf(BOB.color);
  const pixel = async (T, x, y) => { await front(T); const png = decodePng(Buffer.from((await T.tab.send("Page.captureScreenshot", { format: "png" })).data, "base64")); const o = (Math.floor(y * 2) * png.width + Math.floor(x * 2)) * 4; return [png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]]; };
  // the arrow's body: 2.5 in from its tip's corner along the path (theme MARKS.hand.path: (4, 9) of the 16 × 20 box, the tip at (1.5, 1.5))
  const body = (h) => [h.x - MARKS.hand.path[0][0] + 4, h.y - MARKS.hand.path[0][1] + 9];
  const onB = handB === undefined ? null : await pixel(B, ...body(handB));
  const theirSel = seenB?.selections ?? [];
  check(handB !== undefined && handB.name === "Alice" && onB !== null && onB.join() === inkA.join(), `B DRAWS A's hand: Alice's arrow where A's pointer is (${handB?.x}, ${handB?.y}), her name in the flag — the pixel under its body is her ink (${onB} = ${inkA})`);
  check(theirSel.length === 1 && Math.abs(theirSel[0].frame.cx - (moved.x + moved.w / 2)) < 1e-6, `what A holds selected wears A's brackets on B's desk (${theirSel.length} selection at centre x ${theirSel[0]?.frame.cx}) — at ${MARKS.hand.selection * 100} %`);
  // and the other way: B's pointer on B's desk is Bob's arrow on A's
  await front(B);
  await mouse(B, "mouseMoved", 260, 620);
  await front(B);
  await sleep(300);
  await front(A);
  const seenA = await until(async () => { const p = await handsOf(A); return p.hands.find((h) => h.x === 260 && h.y === 620) ? p : null; }, 8000);
  const handA = seenA?.hands.find((h) => h.x === 260 && h.y === 620);
  const onA = handA === undefined ? null : await pixel(A, ...body(handA));
  check(handA !== undefined && handA.name === "Bob" && onA !== null && onA.join() === inkB.join(), `A DRAWS B's hand: Bob's arrow where B's pointer is (${handA?.x}, ${handA?.y}) — the pixel under its body is his ink (${onA} = ${inkB})`);

  // ---- a DELETE in A leaves B
  await front(A);
  await A.q(`window.__desk.engine.ops.setSelection([${n}], "replace")`);
  await key(A, "Backspace", "Backspace", 8);
  await front(A);
  const goneA = (await A.q(`window.__desk.entity(${n})`)) === null;
  await front(B);
  const goneB = await until(async () => (await B.q(`window.__desk.room.resolve(${K(nKey)})`)) === null && (await B.q(`window.__desk.entity(${bn})`)) === null, 8000);
  check(goneA && goneB, `a DELETE in A leaves B (A: ${goneA ? "gone" : "still there"}, B: ${goneB ? "gone" : "still there"})`);

  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors in either tab");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
