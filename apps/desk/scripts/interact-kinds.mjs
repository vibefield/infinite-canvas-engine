// rig:interact's D3w section — the whiteboard, the print, the notebook and the desk calendar AT REST, from the
// world, through core's generic systems (a click selects and the object wears D4a's brackets — its kind's own ring
// retired; the hover is each kind's — a board's the cursor's, a print's edge lifts 2.2, a book rises 3.5, a pad's
// tape is its handle; a drag lifts by the kind's height, lands where it was let go and is ONE undo step; ⌫ removes
// it and ⌘Z brings it back) — and the print's OWN carry: a press lifts it, the grab point rides the finger, a flick
// glides it on and the mat's grip stops it, and it lands where the LAW says (the rig replays photo.ts `stepPhoto`
// over the desk's own steps from the body the hand let go) in ONE transaction. Each object is laid in its own clear
// stretch of the desk, far from the notes.
import { boardFrame, bookFrame, calendarFrame, photoFrame } from "../../../packages/desk/src/kinds/index.ts";
import { frameOnScreen } from "../../../packages/desk/src/marks/layout.ts";
import { stepPhoto } from "../../../packages/desk/src/photo/photo.ts";

/** @param {Record<string, any>} t the rig's helpers: q, qa, entity, entities, mouse, click, key, sleep, settle, check, near, META, SHIFT */
export async function kindsRig(t) {
  const { q, qa, entity, entities, mouse, key, sleep, settle, check, near, META, SHIFT } = t;
  // a click, then a human's pause: a release and a far pointer move coalesced into ONE frame can leave core with an Active
  // drag recognizer started at the move's point, capturing the clicked object (seen for a note, a board and a notebook
  // alike — core's input coalescing under synthetic events; not this slice's)
  const click = async (x, y, extra = {}) => { await t.click(x, y, extra); await sleep(120); };
  const cam = (x, y, zoom) => q(`window.__desk.setCamera({ x: ${x}, y: ${y}, zoom: ${zoom} })`);
  const typeOf = async (type) => (await entities()).filter((e) => e.type === type);
  /** The desk's marks as last drawn (D4a): ONE object wearing the brackets, locked on — the selection as the product shows it. */
  const marks = () => q("window.__desk.marks()");
  const bracketed = (m) => (m?.objects ?? []).length === 1 && m.objects[0].style === "brackets" && m.objects[0].t === 1 && m.objects[0].alpha === 1;
  const worn = (m) => (m?.objects ?? []).map((o) => `${o.style} t ${o.t} α ${o.alpha}`).join(", ") || "no marks";
  /** The brackets stand on the kind's own silhouette (D4a's `frame`, on the geometry the world resolved) under the live camera. */
  const onFrame = async (m, frame) => {
    const f = m?.objects?.[0]?.frame;
    const want = frameOnScreen(frame, await q("window.__desk.camera()"));
    const same = f !== undefined && ["cx", "cy", "hx", "hy", "angle", "r"].every((k) => near(f[k], want[k], 1e-6));
    return { same, said: f === undefined ? "no brackets" : `(${f.cx.toFixed(1)}, ${f.cy.toFixed(1)}) ±(${f.hx.toFixed(1)}, ${f.hy.toFixed(1)}) turned ${f.angle.toFixed(4)} r ${f.r.toFixed(1)}` };
  };
  /** Press at `from`, walk to `to` in `steps` samples `gap` ms apart; `hold` ms still before the release (0 = let go moving). */
  const carry = async (from, to, steps, gap, hold) => {
    await mouse("mouseMoved", from[0], from[1]);
    await mouse("mousePressed", from[0], from[1]);
    await sleep(60);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps); await sleep(gap); }
    if (hold > 0) await sleep(hold);
  };
  const release = (at) => mouse("mouseReleased", at[0], at[1]);
  /** A pointer passing over: no button held (CDP's helper sends `left` by default; a real mouse never moves with a button down and no press). */
  const hover = (x, y) => mouse("mouseMoved", x, y, { button: "none" });
  /** The key lands on the next tick: poll up to 250 ms for the one ghost, and what `probe` reads while it fades. */
  const ghostAfterDelete = async (probe) => {
    await key("Backspace", "Backspace", 8);
    for (let i = 0; i < 25; i++) { const g = await q("window.__desk.stats().ghosts"); if (g >= 1) return { ghosts: g, seen: probe ? await probe() : null }; await sleep(10); }
    return { ghosts: 0, seen: probe ? await probe() : null };
  };

  // ---------------------------------------------------------------- the WHITEBOARD at world (4000, 0): screen = world − (3400, −400)
  console.log("-- the whiteboard --");
  await cam(3400, -400, 1);
  await click(20, 780);   // the bare mat: nothing selected
  const board = await q("window.__desk.spawn('desk.board', {}, { x: 4000, y: 0 })");
  await settle();
  await click(600, 400);
  await sleep(700);
  let b = await entity(board);
  const bSel = await marks();
  check(b.selected && bracketed(bSel) && b.geometry.ring === 0, `board: a click on the melamine selects it — it wears the brackets, locked on (${worn(bSel)}); its kind draws no ring (handed ${b.geometry.ring})`);
  const bOn = await onFrame(bSel, boardFrame(b.geometry));
  check(bOn.same, `board: its brackets stand on its frame — the aluminium's outside as drawn, square, its corner: ${bOn.said}`);
  await hover(640, 420);
  await sleep(500);
  b = await entity(board);
  check(b.flux.hover > 0.9 && b.geometry.lift === 0, `board: hovered (${b.flux.hover.toFixed(2)}) it does not rise — a board's hover is the cursor's (lift ${b.geometry.lift})`);
  const r0 = await q("window.__desk.kinds.replays()");
  await q(`window.__desk.kinds.stroke(${board}, { ink: 'blue', tip: 'bullet', points: [[40, 60], [120, 50], [200, 80]] })`);
  await settle();
  check((await q(`window.__desk.kinds.strokes(${board})`)) === 1 && (await q("window.__desk.kinds.replays()")) === r0 + 1, "board: a stroke laid as its CHILD entity (one transaction) replays the ink once");
  await carry([600, 400], [540, 360], 6, 30, 200);
  const bHeld = await entity(board);
  await release([540, 360]);
  await settle();
  const bMoved = await entity(board);
  check(bHeld.grabbed && bHeld.geometry.lift > 6, `board: held it lifts toward the law's 12 units (${bHeld.geometry.lift.toFixed(1)})`);
  check(near(bMoved.cx, bHeld.cx) && near(bMoved.cy, bHeld.cy) && bMoved.cx < 4000, `board: let go, it lies where it was held (${bMoved.cx.toFixed(1)}, ${bMoved.cy.toFixed(1)})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  const bBack = await entity(board);
  check(near(bBack.cx, 4000) && near(bBack.cy, 0) && (await q(`window.__desk.kinds.strokes(${board})`)) === 1, `board: ⌘Z puts it back in ONE step (${bBack.cx.toFixed(1)}, ${bBack.cy.toFixed(1)}) — its stroke stays`);
  await click(600, 400);
  const nBoard = (await entities()).length;
  const { ghosts: bGhosts } = await ghostAfterDelete();
  await settle();
  check((await entity(board)) === null && (await entities()).length === nBoard - 1 && bGhosts === 1, `board: ⌫ removes it — a ghost fades (${bGhosts}), the entity is gone`);
  await key("z", "KeyZ", 90, META);
  await settle();
  const [bRestored] = await typeOf("desk.board");
  check(bRestored !== undefined && (await q(`window.__desk.kinds.strokes(${bRestored?.id ?? 0})`)) === 1, "board: ⌘Z brings it back WITH its stroke (the children return with the board; the ink replays)");

  // ---------------------------------------------------------------- the PRINT at world (4000, 1500): screen = world − (3400, 1100)
  console.log("-- the print --");
  await cam(3400, 1100, 1);
  await click(20, 780);
  const print = await qa("window.__desk.kinds.print({ x: 4000, y: 1500 })");
  await settle();
  await click(600, 400);
  await settle();
  let p = await entity(print);
  const pSel = await marks();
  check(p.selected && bracketed(pSel) && near(p.cx, 4000) && near(p.cy, 1500), `print: a tap selects it — it wears the brackets (${worn(pSel)}); the hand lifted it and laid it back where it was: no transaction`);
  const pOn = await onFrame(pSel, photoFrame(p.geometry));
  check(pOn.same, `print: its brackets stand on its sheet — its own axes at its turn, its corner: ${pOn.said}`);
  await hover(640, 420);
  await sleep(600);
  p = await entity(print);
  check(p.flux.hover > 0.9 && near(p.geometry.centre[2], 2.2, 1e-3), `print: hovered, its edge lifts the law's 2.2 (${p.geometry.centre[2].toFixed(3)})`);
  // the carry: slow, and the finger stops before letting go — no flick: it lands where the finger left it, ONE transaction
  await q(`window.__desk.kinds.watch(${print})`);
  await carry([600, 400], [520, 350], 8, 30, 250);
  const pHeld = await q(`window.__desk.kinds.body(${print})`);
  await release([520, 350]);
  await settle();
  p = await entity(print);
  check(pHeld !== null && pHeld.hold !== null && pHeld.h > 10, `print: held it rises toward the hand's 24 (${pHeld?.h.toFixed(1)}), the grab point on the finger`);
  check(near(p.cx, 3920, 1e-6) && near(p.cy, 1450, 1e-6), `print: a stopped finger throws nothing — it lands where the finger left it (${p.cx.toFixed(3)}, ${p.cy.toFixed(3)})`);
  check((await q("window.__desk.kinds.moves()")) === 1, `print: its Position moved in ONE frame — one transaction (${await q("window.__desk.kinds.moves()")})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  p = await entity(print);
  check(near(p.cx, 4000) && near(p.cy, 1500), `print: ⌘Z puts it back in ONE step (${p.cx.toFixed(1)}, ${p.cy.toFixed(1)})`);
  // the FLICK: let go while moving — it glides on, grips, and lands where the law says, in ONE transaction
  await q(`window.__desk.kinds.watch(${print})`);
  await carry([600, 400], [760, 400], 8, 16, 0);
  await release([760, 400]);
  await sleep(200);
  await settle();
  const flick = await q(`window.__desk.kinds.flick(${print})`);
  p = await entity(print);
  let law = null;
  if (flick !== null) { const body = { ...flick.body }; for (const dt of flick.dts) stepPhoto(body, dt); law = body; }
  check(flick !== null && flick.body.vx > 200, `print: the flick is the finger's last 70 ms (${flick?.body.vx.toFixed(0)} u/s)`);
  check(law !== null && near(p.cx, law.x, 1e-6) && near(p.cy, law.y, 1e-6) && p.cx > 4000 + 160 + 20, `print: it glided past the release and lands where the LAW says — photo.ts stepPhoto over the desk's ${flick?.dts.length} steps: (${law?.x.toFixed(3)}, ${law?.y.toFixed(3)}) = (${p.cx.toFixed(3)}, ${p.cy.toFixed(3)})`);
  check((await q("window.__desk.kinds.moves()")) === 1, "print: carried, flicked and glided — its Position moved ONCE (one transaction)");
  await key("z", "KeyZ", 90, META);
  await settle();
  p = await entity(print);
  check(near(p.cx, 4000) && near(p.cy, 1500), `print: ONE ⌘Z undoes the carry and the glide together (${p.cx.toFixed(1)}, ${p.cy.toFixed(1)})`);
  await click(600, 400);
  await settle();
  const nPrint = (await entities()).length;
  await key("Backspace", "Backspace", 8);
  await settle();
  check((await entity(print)) === null && (await entities()).length === nPrint - 1, "print: ⌫ removes it (it lifts and fades as it goes)");
  await key("z", "KeyZ", 90, META);
  await settle();
  const [pRestored] = await typeOf("desk.photo");
  check(pRestored !== undefined && (await q("window.__desk.handle.local('photo').pictures().ready")) >= 1, "print: ⌘Z brings it back — its picture from the store");

  // ---------------------------------------------------------------- the NOTEBOOK at world (4000, 3000): screen = world − (3400, 2600)
  console.log("-- the notebook --");
  await cam(3400, 2600, 1);
  await click(20, 780);
  const book = await q("window.__desk.spawn('desk.notebook', { seed: 7, angle: 0.04 }, { x: 4000, y: 3000 })");   // never set down quite square
  await settle();
  await click(600, 400);
  await hover(20, 780);
  await sleep(700);
  let k = await entity(book);
  const restZ = k.geometry.rigid.t[2];
  const kSel = await marks();
  check(k.selected && bracketed(kSel) && k.geometry.ring === 0, `notebook: a click selects it — it wears the brackets, locked on (${worn(kSel)}); its kind draws no ring (handed ${k.geometry.ring})`);
  const kOn = await onFrame(kSel, bookFrame(k.geometry.frame, k.geometry.theta, k.geometry.cx, k.geometry.cy, k.geometry.angle));
  check(kOn.same && near(kSel.objects[0].frame.angle, k.props.angle, 1e-12), `notebook: its brackets stand on its footprint — the case where it lies, at its turn (${k.props.angle.toFixed(4)}): ${kOn.said}`);
  await hover(610, 420);
  await sleep(700);
  k = await entity(book);
  check(k.flux.hover > 0.9 && near(k.geometry.rigid.t[2] - restZ, 3.5, 1e-3), `notebook: hovered, it rises the law's 3.5 (${(k.geometry.rigid.t[2] - restZ).toFixed(3)})`);
  await carry([600, 400], [550, 360], 6, 30, 300);
  const kHeld = await entity(book);
  const kHeldMarks = await marks();
  await release([550, 360]);
  await settle();
  const kMoved = await entity(book);
  check(kHeld.grabbed && kHeld.geometry.rigid.t[2] - restZ > 15 && bracketed(kHeldMarks) && kHeld.geometry.ring === 0, `notebook: held it lifts toward 30 through the desk eye (${(kHeld.geometry.rigid.t[2] - restZ).toFixed(1)}) — the selection's brackets go with it (${worn(kHeldMarks)}), no ring`);
  check(near(kMoved.cx, kHeld.cx) && near(kMoved.cy, kHeld.cy) && kMoved.cx < 4000, `notebook: let go, it lies where it was held (${kMoved.cx.toFixed(1)}, ${kMoved.cy.toFixed(1)})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  k = await entity(book);
  check(near(k.cx, 4000) && near(k.cy, 3000), "notebook: ⌘Z puts it back in ONE step");
  await click(600, 400);
  await settle();
  check((await q("window.__desk.kinds.booksDrawn()")) === 1, "notebook: the pass draws it");
  const { ghosts: kGhosts, seen: drawnGhost } = await ghostAfterDelete(async () => { await sleep(40); return q("window.__desk.kinds.booksDrawn()"); });
  await settle();
  check((await entity(book)) === null && drawnGhost === 0 && kGhosts === 1, `notebook: ⌫ and it is gone AT ONCE — its ghost is kept out of the pass (${drawnGhost} drawn, ${kGhosts} ghost)`);
  await key("z", "KeyZ", 90, META);
  await settle();
  check((await typeOf("desk.notebook")).length === 1 && (await q("window.__desk.kinds.booksDrawn()")) === 1, "notebook: ⌘Z brings it back");

  // ---------------------------------------------------------------- the DESK CALENDAR at world (4000, 6000), zoom 0.42 (its tape at screen y ≈ 23)
  console.log("-- the desk calendar --");
  const z = 0.42;
  const cx0 = 4000 - 600 / z;
  const cy0 = 6000 - 400 / z;
  await cam(cx0, cy0, z);
  await click(20, 790);
  const pad = await q("window.__desk.spawn('desk.calendar', { month: '2026-09' }, { x: 4000, y: 6000 })");
  await settle();
  const tapeY = 400 + (-1852 / 2 + 28) * z;
  await click(600, 400);
  await settle();
  check(!(await entity(pad)).selected, "pad: a click on its PAPER is not the pad's (the lab's 'not taken') — nothing selected");
  await click(600, tapeY);
  await sleep(700);
  let c = await entity(pad);
  const cSel = await marks();
  check(c.selected && bracketed(cSel) && c.geometry.ring === 0, `pad: a click on its TAPE selects it — it wears the brackets, locked on (${worn(cSel)}); its kind draws no ring (handed ${c.geometry.ring})`);
  const cOn = await onFrame(cSel, calendarFrame(c.geometry.cx, c.geometry.cy));
  check(cOn.same, `pad: its brackets stand on its sheet's footprint, square to the mat: ${cOn.said}`);
  await hover(700, tapeY);
  await sleep(500);
  c = await entity(pad);
  check(c.flux.hover > 0.9 && c.geometry.lift === 0, `pad: hovered on its tape (${c.flux.hover.toFixed(2)}) it does not rise (its corner's peek is D3t's)`);
  await carry([600, tapeY], [560, tapeY + 30], 6, 30, 400);
  const cHeld = await entity(pad);
  await release([560, tapeY + 30]);
  await settle();
  const cMoved = await entity(pad);
  check(cHeld.grabbed && cHeld.geometry.lift > 2, `pad: carried by its tape it lifts toward the law's 3 (${cHeld.geometry.lift.toFixed(2)})`);
  check(near(cMoved.cx, cHeld.cx) && near(cMoved.cy, cHeld.cy) && cMoved.cx < 4000, `pad: let go, it lies where it was held (${cMoved.cx.toFixed(1)}, ${cMoved.cy.toFixed(1)})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  c = await entity(pad);
  check(near(c.cx, 4000) && near(c.cy, 6000), "pad: ⌘Z puts it back in ONE step");
  const camBefore = await q("window.__desk.camera()");
  await carry([600, 500], [650, 540], 6, 20, 0);
  await release([650, 540]);
  await settle();
  const camAfter = await q("window.__desk.camera()");
  c = await entity(pad);
  check(camAfter.x < camBefore.x && near(c.cx, 4000) && near(c.cy, 6000), "pad: a drag on its paper PANS the desk; the pad stays");
  await click(600, 400 + (tapeY - 400) + (camAfter.y - camBefore.y) * -z);
  await settle();
  const sel = await entity(pad);
  if (!sel.selected) { await cam(cx0, cy0, z); await settle(); await click(600, tapeY); await settle(); }
  const nPad = (await entities()).length;
  await key("Backspace", "Backspace", 8);
  await settle();
  check((await entity(pad)) === null && (await entities()).length === nPad - 1, "pad: ⌫ removes it");
  await key("z", "KeyZ", 90, META);
  await settle();
  check((await typeOf("desk.calendar")).length === 1, "pad: ⌘Z brings it back");
  void SHIFT;
}
