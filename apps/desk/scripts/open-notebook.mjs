// rig:open §12 — THE NOTEBOOK IN HAND (design-015 §6/§8; D3t-b), driven by rig:open (open.mjs hands in its tab and helpers):
// the held bar's tools live — ‹ › · the four pens (the fountain pen in hand, marked) · undo —, the crosshair over a page, a
// stroke by hand on the right page — live mid-stroke, ONE `desk.stroke` child on page 1 with each sample timed, the page's
// raster inked under its path, ADOPTED (no replay at its landing) —, ⌘Z · ⇧⌘Z · the bar's undo, a pen by its key (`4`) and by
// its slot (felt), two taps on a page are two dots, the turns — → and the bar's › and ‹, a click on either page's outer 30 %
// (two in a row turn two, the book stays in hand), a pinch that travels over the gutter — each moving the durable `spread`,
// which ⌘Z never walks back; the fore-edge corner's peek; put down and picked up again — the book opens where it was left and
// the ink is where it was.
// A spread-point (u, v) is in units from the held spread's centre (the gutter), through the pose seam's frame.

export async function notebookRows(t) {
  const { q, settle, mouse, click, dbl, key, check, until, sleep, hand, landed, settledInHand, META } = t;
  const nb = await q("window.__desk.spawn('desk.notebook', { seed: 11, angle: -0.05 }, { x: 320, y: 620 })");
  await settle();
  await dbl(320, 620);
  check(await settledInHand(), "a double-click on a second notebook picks it up");
  await sleep(400);
  const bar = () => q("(() => { const el = document.querySelector('[data-ice-selection-menu]'); return { tools: [...el.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool), hot: [...el.querySelectorAll('[data-tool][aria-pressed=\"true\"]')].map((b) => b.dataset.tool), dim: el.querySelectorAll('[data-tool].is-dim').length }; })()");
  const b1 = await bar();
  check(JSON.stringify(b1.tools) === JSON.stringify(["turn:-1", "turn:1", "pen:felt", "pen:ball", "pen:fountain", "pen:red", "undo"]) && b1.dim === 0, `the notebook's held bar is live: ${b1.tools.join(" · ")} (${b1.dim} dim)`);
  check(JSON.stringify(b1.hot) === JSON.stringify(["pen:fountain"]), `the pen in hand is marked — the fountain pen, and only it (${b1.hot.join(", ")})`);
  const f = (await hand()).frame;
  const at = (u, v) => [f.cx + u * f.s, f.cy + v * f.s];
  const nbq = (js) => q(`window.__desk.notebook.${js}`);
  const leaves = () => nbq(`leaves(${nb})`);
  const strokes = () => nbq(`strokes(${nb})`);
  const cursor = () => q("document.querySelector('canvas')?.parentElement?.style.cursor ?? null");
  await mouse("mouseMoved", ...at(60, -40));
  check(await until(async () => (await cursor()) === "crosshair", 1000), `over a page's writing the cursor is the pen's crosshair ("${await cursor()}")`);
  /** A stroke by hand from spread-point `from` to `to`: the press, `n` frames of moves, the release. */
  const write = async (from, to, n = 10, mid = null) => {
    await mouse("mouseMoved", ...at(...from)); await mouse("mousePressed", ...at(...from));
    for (let i = 1; i <= n; i++) { await mouse("mouseMoved", ...at(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n + Math.sin(i) * 3), { buttons: 1 }); await sleep(20); if (i === n >> 1 && mid) await mid(); }
    await sleep(30);
    await mouse("mouseReleased", ...at(...to));
  };
  const replays0 = await nbq("replays()");
  let mid = null;
  await write([30, -60], [120, -50], 10, async () => { mid = (await nbq("hand()"))?.live; });
  check(mid?.samples > 2 && mid?.page === 1, `mid-stroke the pen's stroke is in hand, live on page 1 (${mid?.samples} samples)`);
  check(await until(async () => (await strokes()).length === 1, 1500), "the lift: ONE desk.stroke child of the book");
  const s1 = (await strokes())[0];
  check(s1?.tool === "pen" && s1.ink === "fountain" && s1.page === 1 && s1.timed === s1.points.length && s1.points.length >= 10, `…on page 1 (the right page — sheet 0's recto), the fountain pen's, each sample timed (${s1?.timed} of ${s1?.points.length}), in page units`);
  await settle();
  check((await nbq("replays()")) === replays0 + 1, `…and the page ADOPTED it — its landing no replay (${(await nbq("replays()")) - replays0} since the pickup: the page taking its layer at the first sample)`);
  const inner = s1.points.slice(2, -2);
  const ink1 = await nbq(`inkAt(${nb}, 1, ${JSON.stringify(inner)})`);
  check(ink1?.alpha.every((a) => a > 96) === true, `the page's raster is inked under the path: ${ink1?.alpha.slice(0, 6).join(", ")}… (every sample > 96 of 255)`);
  // the history is the document's
  await key("z", "KeyZ", 90, META);
  check(await until(async () => (await strokes()).length === 0, 1000), "⌘Z takes the stroke back (the child entity goes)");
  const cleared = await until(async () => (await nbq(`inkAt(${nb}, 1, ${JSON.stringify(inner)})`)) === null || (await nbq(`inkAt(${nb}, 1, ${JSON.stringify(inner)})`)).inked === 0, 1000);
  check(cleared, "…and the page is clean again");
  await key("z", "KeyZ", 90, META | 8);
  check(await until(async () => (await strokes()).length === 1, 1000), "⇧⌘Z restores it");
  await q("document.querySelector('[data-tool=\"undo\"]').click()");
  check(await until(async () => (await strokes()).length === 0, 1000), "the bar's undo does the same");
  await key("z", "KeyZ", 90, META | 8);
  await until(async () => (await strokes()).length === 1, 1000);
  // a pen by its key, then by its slot
  await key("4", "Digit4", 52);
  const hotIs = (id) => until(async () => JSON.stringify((await bar()).hot) === JSON.stringify([id]), 1000);
  check(await hotIs("pen:red"), "`4` takes the red pen — the bar's mark moves with it");
  await q("document.querySelector('[data-tool=\"pen:felt\"]').click()");
  check(await hotIs("pen:felt"), "the bar's felt slot takes the felt pen");
  await write([30, 20], [110, 30], 8);
  check(await until(async () => { const r = await strokes(); return r.length === 2 && r[1].ink === "felt" && r[1].page === 1; }, 1500), "a second stroke, in felt, on the same page — its own child");
  // two taps on a page are two dots, never a way back
  await dbl(...at(80, 80));
  await sleep(300);
  check((await hand()) !== null && (await strokes()).length === 4, `two taps on a page are two dots — still in hand (${(await strokes()).length} strokes)`);
  // THE TURNS: the keys and the bar
  const turns0 = (await nbq("hand()")).turns;
  const spreadIs = (n) => until(async () => { const l = await leaves(); return l.spread === n && l.airs.length === 0 && l.pending === null; }, 2500);
  await key("ArrowRight", "ArrowRight", 39);
  check(await spreadIs(1), "→ turns a page: the sheet flies over and `spread` is 1");
  await q("document.querySelector('[data-tool=\"turn:1\"]').click()");
  check(await spreadIs(2), "the bar's › turns another: `spread` 2");
  await key("ArrowLeft", "ArrowLeft", 37);
  check(await spreadIs(1), "← turns back: `spread` 1");
  await q("document.querySelector('[data-tool=\"turn:-1\"]').click()");
  check(await spreadIs(0), "the bar's ‹ turns back again: `spread` 0");
  // a click on a page's outer 30 %: the right on, the left back; two clicks in a row turn two and never put it down
  await click(...at(160, 10));
  check(await spreadIs(1), "a click on the right page's outer share turns it: `spread` 1");
  await click(...at(160, 10));
  await sleep(60);
  await click(...at(160, 10));
  check(await spreadIs(3) && (await hand()) !== null, "two clicks there in a row turn two — `spread` 3, the book still in hand");
  await click(...at(-160, 10));
  check(await spreadIs(2), "a click on the left page's outer share turns back: `spread` 2");
  // by hand: a pinch on the right page's turn that travels over the gutter takes the sheet with it; let go, it goes
  await mouse("mouseMoved", ...at(165, 0)); await mouse("mousePressed", ...at(165, 0));
  let held = null;
  for (let i = 1; i <= 12; i++) { await mouse("mouseMoved", ...at(165 - (320 * i) / 12, -6 * Math.sin(i / 3)), { buttons: 1 }); await sleep(24); if (i === 8) held = (await nbq("hand()"))?.turning; }
  check(held !== null && held?.sheet !== null && held?.side === 0, `a pinch on the right page's turn that travels takes its sheet into the hand (sheet ${held?.sheet})`);
  await sleep(30);
  await mouse("mouseReleased", ...at(-155, 0));
  check(await spreadIs(3), "let go past the vertical it goes over: `spread` 3");
  const turned = (await nbq("hand()")).turns - turns0;
  check(turned === 9, `each completed turn is one transaction of \`spread\` (${turned} written for the 9 turns: → › ← ‹, a click, two, a click back, the pinch)`);
  await key("z", "KeyZ", 90, META);
  check(await until(async () => (await strokes()).length === 3, 1000) && (await leaves()).spread === 3, "⌘Z takes back the last ink, never a page (`spread` still 3): a turn is off the undo stack");
  await key("z", "KeyZ", 90, META | 8);
  await until(async () => (await strokes()).length === 4, 1000);
  // the peek: over the right page's fore-edge corner the corner lifts
  await mouse("mouseMoved", ...at(172, 108));
  check(await until(async () => { const l = await leaves(); return l.peekOn && l.peek > 0.9; }, 1500), "over the right page's fore-edge corner, the corner peeks up");
  await mouse("mouseMoved", ...at(60, 0));
  check(await until(async () => { const l = await leaves(); return !l.peekOn && l.peek === 0; }, 1500), "…and lies down when the pointer leaves it");
  // put down and pick up again: where it was left, its ink where it was
  await key("ArrowLeft", "ArrowLeft", 37); await key("ArrowLeft", "ArrowLeft", 37); await key("ArrowLeft", "ArrowLeft", 37);
  check(await spreadIs(0), "back to the first spread (← ← ←: they fan)");
  await key("Escape", "Escape", 27);
  check(await landed(), "Esc puts the notebook down");
  await settle();
  await dbl(320, 620);
  check(await settledInHand(), "picked up again");
  await settle();
  const again = await nbq(`inkAt(${nb}, 1, ${JSON.stringify(inner)})`);
  check(again?.alpha.every((a) => a > 96) === true && (await leaves()).spread === 0, `the ink is where it was: page 1's raster under the first stroke's path (${again?.alpha.slice(0, 4).join(", ")}…), the book open where it was left`);
  await key("Escape", "Escape", 27);
  await landed();
  await key("ArrowRight", "ArrowRight", 39);
  await sleep(200);
  check((await leaves()).spread === 0, "on the desk → is nobody's: the tools' keys route only while held");
  await settle();
}
