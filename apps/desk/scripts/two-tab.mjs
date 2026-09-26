// rig:two-tab — a note typed in one tab arrives in the other when the typing SESSION commits (D2c; design-015
// §11.6's port of graybox's M5 two-tab test, desk objects instead of boxes). Two tabs of one headless Chrome join
// the same `?room=` document over a BroadcastChannel (core's bootstrap — `docs.join`). Tab A stays in front (a
// tab that loses focus blurs its editor, which would end the session); tab B is read through its DOCUMENT, which
// the channel's messages reach without a frame, then brought to the front to draw. The checks: a spawn in A
// reaches B; A's keystrokes are LIVE in A and cross NOTHING while the session is open; Escape commits the session
// and B's document holds the text with A's seeds — the same hand — and B draws it; 1 s without input commits the
// next session with A's editor still on the note; an undo in A takes the session back in B too.
//
// THE M5 ROWS, BY NAME ("M5 two-tab convergence" — D5a; graybox's `two-tab`, the M5 exit test, ported before the
// graybox retires): graybox's assertions re-aimed at DESK objects, through the same two tabs — a note spawned in A
// arrives in B where it lies; a real drag in A moves it while held with NOTHING crossing, lands as ONE commit, and B
// converges on A's position exactly; ⌫ deletes it in both; ⌘Z in A restores it in both (the same key, the same place,
// the same hand); a mini mat's INSIDE is edited (the note dropped into it) and B has it inside, and ⌘Z takes it back
// out in both. Objects cross by their durable KEY (`__desk.room`) — the tabs' entity ids differ.
//
// THE WHITEBOARD ACROSS THE ROOM (D3t-a): A picks a board up and lays a stroke BY HAND; its ONE child — the same path, the same
// samples' times — arrives on B's board and B draws it; ⌘Z and ⇧⌘Z in A (the board still in hand — the document's history) are
// seen in B. THE NOTEBOOK ACROSS THE ROOM (D3t-b — two-tab-notebook.mjs): a stroke by hand in A arrives on B's page (B holds its copy
// open), a page A turns turns in B, ⌘Z in A is seen in B.
//
// THE CALENDAR ACROSS THE ROOM (D3t-c): A selects a day on a desk calendar and writes a line on it through the one editor; its ONE
// `desk.event` child — the text and A's seeds, the same hand — arrives on B's pad and B's print lays it; ⌘Z in A takes it off both.
// Exit 0 = passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { notebookAcrossRoom } from "./two-tab-notebook.mjs";

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
    const VK = { Escape: 27, End: 35, z: 90, Backspace: 8, Enter: 13 };
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

  // ---- M5 two-tab convergence (graybox's exit test, re-aimed at desk objects — the header's second paragraph)
  const M5 = "M5 two-tab convergence";
  const K = (k) => JSON.stringify(k);
  const mouse = (T, type, x, y) => T.tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const settle = (T) => T.q("window.__desk.settle(4000)");
  await front(A);
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  await settle(A);
  const n = await A.q("window.__desk.spawn('desk.note', { seed: 31 }, { x: 700, y: 150 })");
  const mm = await A.q("window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 880, y: 560 })");
  const nKey = await A.q(`window.__desk.room.key(${n})`);
  const mmKey = await A.q(`window.__desk.room.key(${mm})`);
  await settle(A);
  const n0 = await A.q(`window.__desk.entity(${n})`);
  // B projects them on its next frames (B forward)
  await front(B);
  const bn = await until(() => B.q(`window.__desk.room.resolve(${K(nKey)})`), 8000);
  const bmm = await until(() => B.q(`window.__desk.room.resolve(${K(mmKey)})`), 8000);
  const bn0 = bn === null ? null : await B.q(`window.__desk.entity(${bn})`);
  check(typeof nKey === "string" && bn0 !== null && bmm !== null && bn0.x === n0.x && bn0.y === n0.y && bn0.w === n0.w && bn0.props.seed === 31, `${M5}: a note spawned in A arrives in B where it lies (key ${nKey}: A's #${n} at (${n0.x}, ${n0.y}), B's #${bn} at (${bn0?.x}, ${bn0?.y}), seed ${bn0?.props.seed}) — and the mini mat with it`);

  // a real drag in A: live in A, nothing crosses while held, ONE commit at the release, B converges exactly
  await front(A);
  await settle(A);
  const c0 = await A.q("window.__desk.room.commits()");
  await mouse(A, "mouseMoved", 700, 150); await mouse(A, "mousePressed", 700, 150);
  for (let i = 1; i <= 8; i++) { await mouse(A, "mouseMoved", 700 + 25 * i, 150); await sleep(16); }
  await sleep(150);
  const heldA = await A.q(`window.__desk.entity(${n})`);
  const midDocB = await B.q(`window.__desk.room.doc(${K(nKey)})`);
  const midCommits = (await A.q("window.__desk.room.commits()")) - c0;
  await mouse(A, "mouseReleased", 900, 150);
  await settle(A);
  const movedA = await A.q(`window.__desk.entity(${n})`);
  const moveCommits = (await A.q("window.__desk.room.commits()")) - c0;
  check(heldA.grabbed && heldA.x > n0.x && midDocB?.x === n0.x && midCommits === 0, `${M5}: held in A the note moves (x ${n0.x} → ${heldA.x}) and nothing crosses — B's document still says x ${midDocB?.x}, ${midCommits} commits mid-gesture`);
  check(moveCommits === 1 && movedA.x > n0.x && !movedA.grabbed, `${M5}: the drag lands ONE commit in A (${moveCommits}) — A moved (x ${n0.x} → ${movedA.x})`);
  const docB1 = await until(async () => { const d = await B.q(`window.__desk.room.doc(${K(nKey)})`); return d !== null && d.x === movedA.x && d.y === movedA.y ? d : null; }, 5000);
  await front(B);
  await settle(B);
  const movedB = await B.q(`window.__desk.entity(${bn})`);
  check(docB1 !== null && movedB?.x === movedA.x && movedB?.y === movedA.y, `${M5}: B converges on A's position exactly — its document (${docB1?.x}, ${docB1?.y}) and its world (${movedB?.x}, ${movedB?.y}) = A's (${movedA.x}, ${movedA.y})`);

  // ⌫ deletes it — in both
  await front(A);
  await click(movedA.cx, movedA.cy);   // a tap selects it (and puts the pen on it — a tap writes)
  await key("Escape");                 // the pen down, the selection kept
  const selA = await A.q("window.__desk.selection()");
  await key("Backspace");
  await settle(A);
  const goneA = await A.q(`window.__desk.entity(${n})`);
  const goneDocB = await until(async () => (await B.q(`window.__desk.room.doc(${K(nKey)})`)) === null, 5000);
  await front(B);
  await settle(B);
  const goneB = (await B.q(`window.__desk.room.resolve(${K(nKey)})`)) === null && (await B.q(`window.__desk.entity(${bn})`)) === null;
  check(movedB?.x === movedA.x && selA.length === 1 && selA[0] === n && goneA === null && goneDocB && goneB, `${M5}: ⌫ on the selected note deletes it in A, and B — which had it — lets it go: its document and its world (selection [${selA}])`);

  // ⌘Z in A restores it — in both: the same key, the same place, the same hand
  await front(A);
  await key("z", 4);
  await settle(A);
  const an = await A.q(`window.__desk.room.resolve(${K(nKey)})`);
  const backA = an === null ? null : await A.q(`window.__desk.entity(${an})`);
  await front(B);
  const bn2 = await until(() => B.q(`window.__desk.room.resolve(${K(nKey)})`), 8000);
  await settle(B);
  const backB = bn2 === null ? null : await B.q(`window.__desk.entity(${bn2})`);
  check(backA !== null && backA.x === movedA.x && backA.y === movedA.y && backB !== null && backB.x === movedA.x && backB.y === movedA.y && backB.props.seed === 31, `${M5}: ⌘Z in A restores it in both — key ${nKey}, at (${backA?.x}, ${backA?.y}) in A and (${backB?.x}, ${backB?.y}) in B, seed ${backB?.props.seed}`);

  // a mini mat's INSIDE edited: the note let go over its face goes in — B has it inside; ⌘Z takes it back out in both
  await front(A);
  await settle(A);
  await mouse(A, "mouseMoved", backA.cx, backA.cy); await mouse(A, "mousePressed", backA.cx, backA.cy);
  for (let i = 1; i <= 8; i++) { await mouse(A, "mouseMoved", backA.cx + ((880 - backA.cx) * i) / 8, backA.cy + ((560 - backA.cy) * i) / 8); await sleep(16); }
  await sleep(40);
  await mouse(A, "mouseReleased", 880, 560);
  await settle(A);
  const inA = await A.q(`window.__desk.entity(${an})`);
  await front(B);
  const inB = await until(async () => { const id = await B.q(`window.__desk.room.resolve(${K(nKey)})`); const e = id === null ? null : await B.q(`window.__desk.entity(${id})`); return e !== null && e.parent === bmm ? e : null; }, 8000);
  await settle(B);
  const insideB = await B.q(`window.__desk.insideView(${bmm})`);
  check(inA?.parent === mm && inB !== null && inB.x === inA.x && inB.y === inA.y && inB.w === inA.w, `${M5}: the mini mat's inside is edited — the note went in (A's parent #${inA?.parent} = the mat) and B has it inside B's mat (#${inB?.parent}) at the same place in the inside's units (${inB?.x.toFixed(1)}, ${inB?.y.toFixed(1)})`);
  check(insideB !== null && insideB.presence > 0, `${M5}: B draws the mat's inside (presence ${insideB?.presence})`);
  await front(A);
  await key("z", 4);
  await settle(A);
  // (a room's root objects are children of its root canvas entity — the parent the note had before the drop — and the undo
  // may re-mint a handle: the note is found by its key again)
  const outAId = await A.q(`window.__desk.room.resolve(${K(nKey)})`);
  const outA = outAId === null ? null : await A.q(`window.__desk.entity(${outAId})`);
  await front(B);
  const outB = await until(async () => { const id = await B.q(`window.__desk.room.resolve(${K(nKey)})`); const e = id === null ? null : await B.q(`window.__desk.entity(${id})`); return e !== null && e.parent === bn0.parent ? e : null; }, 8000);
  check(outA?.parent === n0.parent && outA.active && outA.x === movedA.x && outA.y === movedA.y && outB !== null && outB.active && outB.x === movedA.x && outB.y === movedA.y, `${M5}: ⌘Z takes it back out in ONE step — on the desk again in A (${outA?.x}, ${outA?.y}) and in B (${outB?.x}, ${outB?.y}), each a member of its root frame`);

  // ---- THE WHITEBOARD ACROSS THE ROOM (D3t-a): a stroke laid BY HAND in A — ONE child, its samples' times — arrives on B's board
  //      and B draws it; the history in A is the document's, and B sees both the undo and the redo
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 1800, y: -100, zoom: 1 })");
  await front(A);
  const wbA = await A.q("window.__desk.spawn('desk.board', { cap: 'green' }, { x: 2400, y: 300 })");
  const wbKey = await A.q(`window.__desk.room.key(${wbA})`);
  await front(B);
  const wbB = await until(() => B.q(`window.__desk.room.resolve(${K(wbKey)})`), 8000);
  check(typeof wbB === "number", `the whiteboard spawned in A reaches B (key ${wbKey}: A's #${wbA}, B's #${wbB})`);
  await front(A);
  await settle(A);
  for (const [type, clickCount] of [["mousePressed", 1], ["mouseReleased", 1], ["mousePressed", 2], ["mouseReleased", 2]]) { await A.tab.send("Input.dispatchMouseEvent", { type, x: 600, y: 400, button: "left", clickCount }); await sleep(16); }
  const handA = await until(async () => { const h = await A.q("window.__desk.hand()"); return h?.settled === true && h.e === 1 ? h : null; }, 3000);
  check(handA !== null && handA.entity === wbA, "A picks the board up (a double-click)");
  // the melamine's top-left on the desk is (2400 − 240 + 9, 300 − 160 + 9); in hand a desk point is at the frame's centre + (p − c)·s
  const wfA = handA?.frame ?? { cx: 600, cy: 392, s: 1 };
  const melA = (mx, my) => [wfA.cx + (2169 + mx - 2400) * wfA.s, wfA.cy + (149 + my - 300) * wfA.s];
  const [sx0, sy0] = melA(80, 120);
  await mouse(A, "mouseMoved", sx0, sy0); await mouse(A, "mousePressed", sx0, sy0);
  for (let i = 1; i <= 10; i++) { const [x, y] = melA(80 + 24 * i, 120 + 30 * Math.sin(i / 2)); await A.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await sleep(20); }
  const [sx1, sy1] = melA(320, 120 + 30 * Math.sin(5));
  await sleep(30);
  await mouse(A, "mouseReleased", sx1, sy1);
  const rowsA = await until(async () => { const r = await A.q(`window.__desk.kinds.strokeRows(${wbA})`); return r.length === 1 ? r : null; }, 3000);
  check(rowsA !== null && rowsA[0].ink === "green" && rowsA[0].timed === rowsA[0].points.length && rowsA[0].points.length >= 10, `A lays ONE stroke by hand: its child, in the ink in hand (${rowsA?.[0]?.ink}), ${rowsA?.[0]?.timed} timed samples`);
  await front(B);
  const rowsB = await until(async () => { const r = await B.q(`window.__desk.kinds.strokeRows(${wbB})`); return r.length === 1 ? r : null; }, 8000);
  check(rowsB !== null && JSON.stringify(rowsB[0].points) === JSON.stringify(rowsA?.[0]?.points) && rowsB[0].timed === rowsA?.[0]?.timed, `the stroke arrives on B's board — the same path, the same ${rowsB?.[0]?.timed} times`);
  await settle(B);
  const inkB = await B.tab.evaluate(`window.__desk.kinds.inkAt(${wbB}, ${JSON.stringify(rowsA?.[0]?.points.slice(2, -2) ?? [])})`, { awaitPromise: true, timeoutMs: 15000 });
  check(inkB !== null && inkB.alpha.length > 0 && inkB.alpha.every((a) => a > 96), `B draws it: its raster's coverage under the path ${inkB?.alpha.slice(0, 5).join(", ")}… (every sample > 96)`);
  // (each tab is read while in front: a background tab draws no frame, and its world projects the document at its frames)
  await front(A);
  const inHandA = (await A.q("window.__desk.hand()")) !== null;
  await key("z", 4);
  const undoneWbA = await until(async () => (await A.q(`window.__desk.kinds.strokeRows(${wbA})`)).length === 0, 3000);
  await front(B);
  const undoneWbB = await until(async () => (await B.q(`window.__desk.kinds.strokeRows(${wbB})`)).length === 0, 8000);
  check(inHandA && undoneWbA && undoneWbB, `⌘Z in A (the board in hand: ${inHandA}) takes the stroke away (A: ${undoneWbA}) — and B sees it go (B: ${undoneWbB})`);
  await front(A);
  await key("z", 12);
  const redoneWbA = await until(async () => (await A.q(`window.__desk.kinds.strokeRows(${wbA})`)).length === 1, 3000);
  await front(B);
  const redoneWbB = await until(async () => (await B.q(`window.__desk.kinds.strokeRows(${wbB})`)).length === 1, 8000);
  check(redoneWbA && redoneWbB, `⇧⌘Z in A brings it back (A: ${redoneWbA}) — and B sees that too (B: ${redoneWbB})`);
  await front(A);
  await key("Escape");

  // ---- THE NOTEBOOK ACROSS THE ROOM (D3t-b): two-tab-notebook.mjs — a stroke by hand in A on B's page, a turn followed, ⌘Z seen
  await notebookAcrossRoom({ A, B, front, settle, mouse, key, check, until, sleep, K });

  // ---- THE CALENDAR ACROSS THE ROOM (D3t-c): a line written in A — ONE desk.event child, its ink cell — arrives on B's pad with
  //      A's seeds and B's print lays it; ⌘Z in A takes it off B's pad too
  const PX = -4000;
  const PY = 0;
  for (const T of [A, B]) await T.q(`window.__desk.setCamera({ x: ${PX - 1300}, y: ${PY - 950}, zoom: 0.42 }); window.__desk.calendar.pinToday('2026-09-24')`);
  await front(A);
  const padA = await A.q(`window.__desk.spawn('desk.calendar', { month: '2026-09' }, { x: ${PX}, y: ${PY} })`);
  const padKey = await A.q(`window.__desk.room.key(${padA})`);
  await front(B);
  const padB = await until(() => B.q(`window.__desk.room.resolve(${K(padKey)})`), 8000);
  check(typeof padB === "number", `the desk calendar spawned in A reaches B (key ${padKey}: A's #${padA}, B's #${padB})`);
  await front(A);
  await settle(A);
  const box17 = await A.q(`window.__desk.calendar.dayBox(${padA}, '2026-09-17')`);
  const at17 = await A.q(`window.__desk.calendar.screenOf(${padA}, ${box17.x + box17.w / 2}, ${box17.y + box17.h * 0.8})`);
  await A.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at17[0], y: at17[1], button: "none" });
  await sleep(120);
  await click(at17[0], at17[1]);
  const sel17 = await A.q(`window.__desk.calendar.selection(${padA})`);
  check(sel17?.anchor === "2026-09-17", `A selects 17 September on its pad (${sel17?.anchor})`);
  // ⏎ picks the pad up first (a day 101 px wide), the pen begins; the line is typed and kept with ⏎ — ONE transaction
  await key("Enter");
  await until(async () => { const h = await A.q("window.__desk.hand()"); return h?.settled === true && h.e === 1; }, 3000);
  await typeKeys("dentist 3pm");
  await key("Enter");
  const eA = await until(async () => (await A.q(`window.__desk.calendar.entries(${padA})`)).find((e) => e.text === "dentist 3pm" && e.id > 0) ?? null, 2000);
  const cellA = eA === null ? null : await A.q(`window.__desk.calendar.inkOf(${eA.id})`);
  check(eA !== null && cellA?.parent === padA && cellA.seeds.length > 0, `A writes "dentist 3pm" on it: ONE desk.event child (#${eA?.id}, its seeds ${cellA?.seeds})`);
  for (let i = 0; i < 3 && (await A.q("window.__desk.hand()")) !== null; i++) { await key("Escape"); await sleep(200); }
  await front(B);
  const eB = await until(async () => (await B.q(`window.__desk.calendar.entries(${padB})`)).find((e) => e.text === "dentist 3pm" && e.id > 0) ?? null, 8000);
  const cellB = eB === null ? null : await B.q(`window.__desk.calendar.inkOf(${eB.id})`);
  check(eB !== null && eB.start === eA?.start && eB.end === eA?.end && cellB?.parent === padB && cellB.seeds === cellA?.seeds, `the line arrives on B's pad — the same day, A's seeds, the same hand, glyph for glyph (B's #${eB?.id}: ${cellB?.seeds})`);
  const printedB = eB !== null && await until(async () => ((await B.q(`window.__desk.calendar.lines(${padB}, '2026-09')`)) ?? []).some((l) => l.entry === eB.id), 3000);
  check(printedB, "B's print lays it on 17 September");
  await front(A);
  await key("z", 4);
  const offA = await until(async () => !(await A.q(`window.__desk.calendar.entries(${padA})`)).some((e) => e.text === "dentist 3pm"), 1500);
  await front(B);
  const offB = await until(async () => !(await B.q(`window.__desk.calendar.entries(${padB})`)).some((e) => e.text === "dentist 3pm"), 3000);
  check(offA && offB, `⌘Z in A takes the line off in ONE step (A: ${offA}) — and off B's pad (B: ${offB})`);
  await front(A);

  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors in either tab");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
