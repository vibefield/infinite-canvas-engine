// rig:collab — THE M9 LIVE WITNESS (D5a; design-015 §11.6 — nodeboard's "two-machine collab demo over the dumb relay",
// on the desk): the rig starts `pnpm relay`'s own server (scripts/ws-relay.mjs, on a free port it picks), and two tabs of
// one headless Chrome join the same `?room=` THROUGH IT (`?relay=ws://…` — core's `webSocketByteChannel`, the bootstrap's
// hello/snapshot handshake, presence on the same socket), each with a pinned identity (`?name=`/`?color=`). The checks:
// both joined over the relay (the relay saw both sockets in the room; a desk that ignored `?relay=` would still converge
// over the same-origin BroadcastChannel — the socket count is what tells them apart); an ADD in A reaches B;
// a real DRAG in A lands in B where A let go; a DELETE in A leaves B; and each tab SHOWS THE OTHER'S CURSOR — dom's
// remote-cursors reflector (design-015 §1/§3 keep `@ice/dom`'s screen-space half; `<Desk>` mounts it through `createDeskHost` (D5b)
// or not): the peer's world point (its own pointer, read in its own tab) mapped through THIS tab's camera, screen px to 0.5 —
// and again after this tab pans and zooms — with the peer's name on its chip, the chip painted over the desk in the peer's
// colour (the screenshot's pixel). Objects cross by their durable KEY (`__desk.room`).
// PETITION I26 — a host that draws the room's people ITSELF (VibeField, each by face): a THIRD tab, C, joins the same room on a
// page mounted with `deskLayer({ cursors: false })` (`&cursors=false` — the rigs' harness, as `?hold=`/`?trayFoot=` are). A draws
// C's cursor; C's world holds both other people and the hands core derived for them, at their tabs' pointers; and C's page draws
// NOTHING of anyone's — no chip, no `remoteCursors` reflector, and where Alice's chip would be on C's screen (the offset B draws it
// at) C's pixel is the desk's. A and B's rows before it run as they always did.
// PETITION I42 — WHERE A PEER IS: B draws Alice's cursor only while she is HERE — not while her host says she is away
// (`docs.presence().setAway`, her mouse still over her desk), not while her pointer is out of her window (a real pointer leave,
// through Chrome's own input), not while she is in a canvas B is not (she enters a mini mat: B on the root hides her; B entering
// it too shows her again, at her point in its coordinates; she leaves it, and B inside hides her). B's world keeps her each time
// (`room.peers()`: her `away`, her `canvas`, no hand). Exit 0 = passed.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:collab
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";
import { decodePng } from "./png.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
// THE RELAY: `pnpm relay`'s server, verbatim, on a port of its OWN binding (K-H): `PORT=0` — the OS picks a free port as the relay
// binds it, and its "listening" line, said once bound, names it. The rig used to probe 19301 free on 127.0.0.1 and let it go before
// the relay bound the wildcard — a port another session's rig could take between the two — and read a "listening" printed before
// the bind; its log counts the room's sockets
const relayLog = [];
const relay = spawn(process.execPath, [resolve(repo, "scripts/ws-relay.mjs")], { cwd: repo, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
relay.stdout.on("data", (b) => relayLog.push(...String(b).split("\n").filter(Boolean)));
relay.stderr.on("data", (b) => relayLog.push(`stderr ${String(b).trim()}`));
for (let i = 0; i < 600 && !relayLog.some((l) => l.includes("listening")); i++) await sleep(50);
const RELAY_PORT = Number(relayLog.find((l) => l.includes("listening"))?.match(/ws:\/\/localhost:(\d+)/)?.[1] ?? 0);
if (!(RELAY_PORT > 0)) { console.log(`the relay never said it was listening: ${relayLog.join(" | ")}`); relay.kill("SIGKILL"); server.kill("SIGKILL"); process.exit(1); }
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} try { relay.kill("SIGKILL"); } catch {} }
const kick = watchdog(240_000, cleanup);   // no row in 240 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
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
  // two of the presence palette's inks (the product fixture's `PRESENCE_INKS`: violet, red)
  const ALICE = { name: "Alice", color: "#8e4ec6" };
  const BOB = { name: "Bob", color: "#e5484d" };
  const CAROL = { name: "Carol", color: "#e2a336" };   // the palette's amber — I26's third tab
  const urlOf = (who, extra = "") => `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?room=${room}&relay=${encodeURIComponent(`ws://127.0.0.1:${RELAY_PORT}`)}&name=${who.name}&color=${encodeURIComponent(who.color)}${extra}`;
  const logs = [];
  const open = async (name, who, extra = "") => {
    const tab = await openTab(chrome.port, urlOf(who, extra));
    await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
    watchPage(tab, logs, { name });
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
  // conditions, not the moment B's page said ready (K-H): each tab's document and presence, then the relay's own log of the room's two
  // sockets — its lines cross a pipe, and the count was read before B's line had arrived
  const joined = await until(async () => (await roleOf(A)) && (await roleOf(B)), 20000);
  const socketsIn = () => relayLog.filter((l) => l.includes(`room=${JSON.stringify(room)}`) && l.startsWith("+ connect")).length;
  await until(() => socketsIn() >= 2, 10000);
  const sockets = socketsIn();
  check(joined && sockets === 2, `two tabs joined room ${room} THROUGH THE RELAY (ws://127.0.0.1:${RELAY_PORT}: ${sockets} sockets in the room), each with its document and its presence`);
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

  // ---- each tab SHOWS the other's cursor at the peer's world point through THIS tab's camera — before and after a pan
  /** The cursor a tab shows for a peer's name (dom's reflector: a root div translated to the screen point, a name chip in the peer's colour). */
  const cursorOf = (T, name) => T.q(`(() => {
    for (const chip of document.querySelectorAll('div')) {
      if (chip.children.length !== 0 || chip.textContent !== ${JSON.stringify(name)}) continue;
      const m = /translate\\(([-\\d.e]+)px, ([-\\d.e]+)px\\)/.exec(chip.parentElement?.style.transform ?? '');
      if (m === null) continue;
      const r = chip.getBoundingClientRect();
      return { x: Number(m[1]), y: Number(m[2]), shown: getComputedStyle(chip).display !== 'none' && r.width > 0, chip: { x: r.left + 3, y: r.top + r.height / 2 } };
    }
    return null; })()`);
  const pixel = async (T, x, y) => { const png = decodePng(Buffer.from((await T.tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data, "base64")); const o = (Math.floor(y * 2) * png.width + Math.floor(x * 2)) * 4; return [png.rgba[o], png.rgba[o + 1], png.rgba[o + 2]]; };
  /** Tab `T` shows `peer`'s cursor where `peerTab`'s pointer is, through T's own camera (to 0.5 px), its chip in the peer's colour. */
  const shows = async (T, peerTab, peer, label) => {
    await front(T);
    const w = await peerTab.q("window.__desk.pointer()");
    const cam = await T.q("window.__desk.camera()");
    const want = { x: (w.x - cam.x) * cam.zoom, y: (w.y - cam.y) * cam.zoom };
    const c = await until(async () => { const c = await cursorOf(T, peer.name); return c !== null && Math.abs(c.x - want.x) <= 0.5 && Math.abs(c.y - want.y) <= 0.5 ? c : null; }, 8000);
    const seen = c ?? (await cursorOf(T, peer.name));
    const ink = seen === null ? null : await pixel(T, seen.chip.x, seen.chip.y);
    check(c?.shown === true && ink !== null && ink.join() === byteOf(peer.color).join(), `${T.name} SHOWS ${peer.name}'s cursor ${label}: ${peer.name}'s world point (${w.x}, ${w.y}) through ${T.name}'s camera (${cam.x}, ${cam.y}, ×${cam.zoom}) = (${want.x.toFixed(2)}, ${want.y.toFixed(2)}) — shown at (${seen?.x}, ${seen?.y}); the chip painted over the desk in ${peer.name}'s colour (${ink} = ${byteOf(peer.color)})`);
  };
  await front(A);
  await mouse(A, "mouseMoved", 820, 520);
  await front(A);
  await shows(B, A, ALICE, "at rest");
  await B.q("window.__desk.setCamera({ x: 400, y: 300, zoom: 1.25 })");
  await shows(B, A, ALICE, "after B pans and zooms");
  await B.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");   // B's own pointer in B's unpanned world: (260, 620)
  await front(B);
  await mouse(B, "mouseMoved", 260, 620);
  await front(B);
  await shows(A, B, BOB, "at rest");
  await A.q("window.__desk.setCamera({ x: -120, y: 90, zoom: 0.8 })");
  await shows(A, B, BOB, "after A pans and zooms");
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");

  // ---- PETITION I42: where a peer is — B draws Alice only while she is here
  const aliceIn = async (T) => (await T.q("window.__desk.room.peers()")).find((p) => p.name === ALICE.name) ?? null;
  /** B shows no chip for Alice (polled, B in front), and B's world holds her as `want` says — her facet's away/canvas, no hand. */
  const hides = async (want) => until(async () => { await front(B); const p = await aliceIn(B); return (await cursorOf(B, ALICE.name)) === null && p !== null && p.hand === null && p.away === want.away && p.canvas === want.canvas ? p : null; }, 8000);
  await front(A);
  await mouse(A, "mouseMoved", 820, 520);
  await front(A);
  await shows(B, A, ALICE, "— the control before she is away");
  await A.q("window.__desk.engine.docs.presence().setAway('rig'); true");
  const awayHost = await hides({ away: true, canvas: "" });
  check(awayHost !== null, `B HIDES Alice while her HOST says she is away (docs.presence().setAway("rig") — her mouse still over her desk): no chip; B's world holds her, away ${(awayHost ?? (await aliceIn(B)))?.away}, no hand`);
  await A.q("window.__desk.engine.docs.presence().setAway(null); true");
  await shows(B, A, ALICE, "once her host says she is back (setAway(null))");
  // the pointer out of her window: Chrome's own input past the page's right edge — the container's pointerleave, no related target
  await front(A);
  await A.q("window.__i42 = 0; document.addEventListener('pointerleave', (e) => { if (e.relatedTarget === null && e.target === window.__desk.handle.canvas.parentElement) window.__i42 += 1; }, true); true");
  await mouse(A, "mouseMoved", 1260, 520);
  await front(A);
  const leaves = await A.q("window.__i42");
  const awayOut = await hides({ away: true, canvas: "" });
  check(leaves >= 1 && awayOut !== null, `B HIDES Alice while her POINTER is out of her window (a CDP move past her page's edge: ${leaves} pointerleave on her desk's container with no related target): no chip; B's world holds her, away ${(awayOut ?? (await aliceIn(B)))?.away}, no hand`);
  await front(A);
  await mouse(A, "mouseMoved", 820, 520);
  await front(A);
  await shows(B, A, ALICE, "once her pointer is back over her desk");
  // the canvas: a mini mat Alice enters
  await front(A);
  const mm = await A.q("window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 600, y: 360 })");
  const mmKey = await A.q(`window.__desk.room.key(${mm})`);
  await front(A);
  await front(B);
  const mmB = await until(() => B.q(`window.__desk.room.resolve(${K(mmKey)})`), 8000);
  await A.q(`window.__desk.engine.ops.enterContainer(${mm}, { transition: "none" }); true`);
  await front(A);
  await mouse(A, "mouseMoved", 640, 420);
  await front(A);
  const inMat = await hides({ away: false, canvas: mmKey });
  check(mmB !== null && inMat !== null, `B (on the root) HIDES Alice while she is IN the mini mat ${mmKey}: no chip; B's world holds her, canvas ${JSON.stringify((inMat ?? (await aliceIn(B)))?.canvas)}, no hand`);
  await B.q(`window.__desk.engine.ops.enterContainer(${mmB}, { transition: "none" }); true`);
  await front(B);
  await shows(B, A, ALICE, "with B in the same mini mat (her point in its coordinates, through B's camera there)");
  await A.q("window.__desk.engine.ops.exitContainer({ transition: \"none\" }); true");
  await front(A);
  await mouse(A, "mouseMoved", 820, 520);
  await front(A);
  const onRoot = await hides({ away: false, canvas: "" });
  check(onRoot !== null, `B (in the mini mat) HIDES Alice once she is back on the root: no chip; B's world holds her, canvas ${JSON.stringify((onRoot ?? (await aliceIn(B)))?.canvas)}, no hand`);
  await B.q("window.__desk.engine.ops.exitContainer({ transition: \"none\" }); true");
  await front(B);
  await shows(B, A, ALICE, "with both on the root again");
  await A.q(`window.__desk.engine.ops.setSelection([${mm}], "replace")`);
  await front(A);
  await key(A, "Backspace", "Backspace", 8);
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");

  // ---- a DELETE in A leaves B
  await front(A);
  await A.q(`window.__desk.engine.ops.setSelection([${n}], "replace")`);
  await key(A, "Backspace", "Backspace", 8);
  await front(A);
  const goneA = (await A.q(`window.__desk.entity(${n})`)) === null;
  await front(B);
  const goneB = await until(async () => (await B.q(`window.__desk.room.resolve(${K(nKey)})`)) === null && (await B.q(`window.__desk.entity(${bn})`)) === null, 8000);
  check(goneA && goneB, `a DELETE in A leaves B (A: ${goneA ? "gone" : "still there"}, B: ${goneB ? "gone" : "still there"})`);

  // ---- PETITION I26: C joins on a page whose host draws the room's people itself — `deskLayer({ cursors: false })`
  const C = await open("C", CAROL, "&cursors=false");
  const joinedC = await until(() => roleOf(C), 20000);
  await until(() => socketsIn() >= 3, 10000);
  const socketsC = socketsIn();
  await C.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still')");
  check(joinedC && socketsC === 3, `C joined the room on a page mounted with cursors: false (rig.html?…&cursors=false — ${socketsC} sockets in the room), with its document and its presence`);
  // fresh hands for C to hear: each tab's pointer moves once C is in the room
  for (const [T, x, y] of [[A, 700, 380], [B, 300, 560], [C, 520, 460]]) { await front(T); await mouse(T, "mouseMoved", x, y); await front(T); }
  // the first draws the second's — and B, a tab with its cursors on, draws Alice where C's page would (B's camera is C's): the control
  await shows(A, C, CAROL, "while her own page draws none (cursors: false)");
  await shows(B, A, ALICE, "— the control for C: the same room, its cursors on");
  // C's WORLD: both other people, and the hands core derived for them at their tabs' pointers — the presence session untouched
  const wA = await A.q("window.__desk.pointer()");
  const wB = await B.q("window.__desk.pointer()");
  const near = (h, w) => h !== null && w !== null && Math.abs(h.x - w.x) <= 0.5 && Math.abs(h.y - w.y) <= 0.5;
  await front(C);
  const rosterOf = async () => { const ps = await C.q("window.__desk.room.peers()"); const a = ps.find((p) => p.name === ALICE.name); const b = ps.find((p) => p.name === BOB.name); return ps.length === 2 && near(a?.hand ?? null, wA) && near(b?.hand ?? null, wB) ? ps : null; };
  const roster = await until(rosterOf, 8000);
  const rosterSeen = roster ?? (await C.q("window.__desk.room.peers()"));
  check(roster !== null, `C's WORLD holds the room's two other people — ${rosterSeen.map((p) => `${p.name} ${p.color}, hand ${p.hand === null ? "none" : `(${p.hand.x}, ${p.hand.y})`}`).join("; ")} — their hands at A's pointer (${wA.x}, ${wA.y}) and B's (${wB.x}, ${wB.y}): what usePresencePeers lists, and core's derived hands`);
  // C's PAGE: nothing of anyone's cursor — no chip by either name, no remote-cursors reflector; and where Alice's chip WOULD be on C's
  // screen (her hand through C's camera, the chip's offset as B draws it) C's pixel is the desk's, not her ink
  await front(B);
  const onB = await cursorOf(B, ALICE.name);
  await front(C);
  const chipsC = [await cursorOf(C, ALICE.name), await cursorOf(C, BOB.name)];
  const reflectorsC = await C.q("window.__desk.engine.engine.reflectorNames()");
  // Alice's hand through C's camera, plus her chip's offset from the hand as B draws it
  const camC = await C.q("window.__desk.camera()");
  const at = onB === null ? null : { x: (wA.x - camC.x) * camC.zoom + (onB.chip.x - onB.x), y: (wA.y - camC.y) * camC.zoom + (onB.chip.y - onB.y) };
  const inkC = at === null ? null : await pixel(C, at.x, at.y);
  check(chipsC.every((c) => c === null) && !reflectorsC.includes("remoteCursors") && inkC !== null && inkC.join() !== byteOf(ALICE.color).join(), `C's PAGE draws NOTHING of anyone's cursor: no chip for Alice or Bob (${chipsC.map((c) => (c === null ? "none" : `one at (${c.x}, ${c.y})`)).join(", ")}), no remoteCursors reflector (C's reflectors: ${reflectorsC.join(", ")}); where Alice's chip would be, C's screen at (${at?.x.toFixed(1)}, ${at?.y.toFixed(1)}) is the desk's — it reads ${inkC}, her ink ${byteOf(ALICE.color)}`);

  logs.push(...(await faultsOf(A.tab, A.name)), ...(await faultsOf(B.tab, B.name)), ...(await faultsOf(C.tab, C.name)));   // the faults each engine CONTAINED (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors in any of the three tabs");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
