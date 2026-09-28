// rig:two-tab — THE NOTEBOOK ACROSS THE ROOM (design-015 §6/§8; D3t-b), driven by two-tab.mjs (its two tabs and helpers): a
// notebook spawned in A reaches B; both pick their copy up (Held is each tab's own); A writes a stroke BY HAND on its right page —
// ONE child on page 1 with its samples' times — and it arrives on B's page (the same path, page and times) and B's page raster
// draws it; A turns a page (→) and B's `spread` and its book in hand follow (the sheet turned there too); ⌘Z in A takes the ink
// back and B's page is clean again.

import { dblClick } from "./timing.mjs";

export async function notebookAcrossRoom(t) {
  const { A, B, front, settle, mouse, key, check, until, sleep, K } = t;
  for (const T of [A, B]) await T.q("window.__desk.setCamera({ x: 2600, y: -100, zoom: 1 })");
  await front(A);
  const nbA = await A.q("window.__desk.spawn('desk.notebook', { seed: 5, angle: 0 }, { x: 3000, y: 300 })");
  const nbKey = await A.q(`window.__desk.room.key(${nbA})`);
  await front(B);
  const nbB = await until(() => B.q(`window.__desk.room.resolve(${K(nbKey)})`), 8000);
  check(typeof nbB === "number", `the notebook spawned in A reaches B (key ${nbKey}: A's #${nbA}, B's #${nbB})`);
  /**
   * A double-click at the notebook's place in a tab (the camera puts its case's centre at (400, 400)): picked up, settled — and OPEN.
   * The hand's pose settles a frame or two before the book's own motion has it open (`turnable`: theta past 0.93 π); a press in that
   * gap is the OBJECT's, not the pen's (core decides a press's kind at WentDown — `partOf` answers "frame" until the book is turnable),
   * and the stroke never begins. So the desk is waited quiet after the pick-up: the opening is the last thing moving (found at D6).
   */
  const pickUp = async (T, id) => {
    await front(T);
    await settle(T);
    await dblClick(T.tab, 400, 400, { move: false });   // the four events as one batch (K-H — timing.mjs)
    const h = await until(async () => { const h = await T.q("window.__desk.hand()"); return h?.settled === true && h.e === 1 && h.entity === id ? h : null; }, 3000);
    await settle(T);
    return h;
  };
  const handB = await pickUp(B, nbB);
  const handA = await pickUp(A, nbA);
  check(handA !== null && handB !== null, "A picks its notebook up, and B its copy (each tab's hand is its own)");
  // a stroke by hand on A's right page: (u, v) in units from the spread's centre, through A's pose frame
  const fA = handA?.frame ?? { cx: 600, cy: 392, s: 1 };
  const at = (u, v) => [fA.cx + u * fA.s, fA.cy + v * fA.s];
  await mouse(A, "mouseMoved", ...at(40, -40)); await mouse(A, "mousePressed", ...at(40, -40));
  for (let i = 1; i <= 10; i++) { const [x, y] = at(40 + 8 * i, -40 + 6 * Math.sin(i / 2)); await A.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 }); await sleep(20); }
  await sleep(30);
  await mouse(A, "mouseReleased", ...at(120, -40 + 6 * Math.sin(5)));
  const rowsA = await until(async () => { const r = await A.q(`window.__desk.notebook.strokes(${nbA})`); return r.length === 1 ? r : null; }, 3000);
  check(rowsA !== null && rowsA[0].page === 1 && rowsA[0].tool === "pen" && rowsA[0].timed === rowsA[0].points.length && rowsA[0].points.length >= 10, `A writes ONE stroke by hand: its child on page ${rowsA?.[0]?.page}, the ${rowsA?.[0]?.ink} pen, ${rowsA?.[0]?.timed} timed samples`);
  await front(B);
  const rowsB = await until(async () => { const r = await B.q(`window.__desk.notebook.strokes(${nbB})`); return r.length === 1 ? r : null; }, 8000);
  check(rowsB !== null && JSON.stringify(rowsB[0].points) === JSON.stringify(rowsA?.[0]?.points) && rowsB[0].page === 1 && rowsB[0].timed === rowsA?.[0]?.timed, `the stroke arrives on B's page — the same path on page ${rowsB?.[0]?.page}, the same ${rowsB?.[0]?.timed} times`);
  const inner = rowsA?.[0]?.points.slice(2, -2) ?? [];
  const inkB = await until(async () => { const r = await B.q(`window.__desk.notebook.inkAt(${nbB}, 1, ${JSON.stringify(inner)})`); return r?.alpha.every((a) => a > 96) === true ? r : null; }, 3000);
  check(inkB !== null, `B's page draws it: its raster under the path ${inkB?.alpha.slice(0, 5).join(", ")}… (every sample > 96)`);
  // A turns a page: B's spread follows, and its book in hand turns with it
  await front(A);
  await key("ArrowRight");
  const turnedA = await until(async () => (await A.q(`window.__desk.notebook.leaves(${nbA})`))?.spread === 1, 3000);
  await front(B);
  const turnedB = await until(async () => { const l = await B.q(`window.__desk.notebook.leaves(${nbB})`); return l?.spread === 1 && l.turned === 1 && l.airs.length === 0; }, 8000);
  check(turnedA && turnedB, `→ in A turns a page (A: ${turnedA}) — B's \`spread\` follows and its book in hand turns the sheet too (B: ${turnedB})`);
  // ⌘Z in A (the book in hand — the document's history): the ink goes, in B too
  await front(A);
  await key("z", 4);
  const undoneA = await until(async () => (await A.q(`window.__desk.notebook.strokes(${nbA})`)).length === 0, 3000);
  await front(B);
  const undoneB = await until(async () => (await B.q(`window.__desk.notebook.strokes(${nbB})`)).length === 0, 8000);
  check(undoneA && undoneB && (await B.q(`window.__desk.notebook.leaves(${nbB})`))?.spread === 1, `⌘Z in A takes the ink away (A: ${undoneA}) — B sees it go (B: ${undoneB}); the page stays turned (a turn is off the undo stack)`);
  for (const T of [B, A]) {
    await front(T);
    await T.tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await T.tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await until(async () => (await T.q("window.__desk.hand()")) === null, 3000);
  }
}
