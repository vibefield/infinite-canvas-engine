// rig:open's D3t-c section — THE DESK CALENDAR AT WORK (CALENDAR.md §5; design-015 D3t-c), through the same page-level synthetic
// events (CDP Input.* — nothing reaches the OS) on a pad spawned far from the rig's notebook, note and whiteboard, today pinned to
// 24 September 2026. The checks read the WORLD (the pad's entries, its pins, its durable month), the pad's local (the month laid
// bare, the turn, the marks) and the page's pixels:
//
// - a click on a day at rest SELECTS it — the marks' brackets drawn on its cell and nowhere else (the frame before and after, byte
//   for byte outside the cell), the one editor lent; ⇧-click stretches it over a run;
// - ⏎ on a day under 150 px on screen PICKS THE PAD UP first and the pen begins; the line typed is a draft until ⏎ keeps it — ONE
//   `desk.event` child (its text and the hand's seeds, a glyph each: the `ink` cell) and its line on the print; a run's is a band;
// - a click on a line selects it, ⌫ takes it off (one step), ⌘Z brings it back;
// - the ROLL: a click on the foot (the corner lifted under the pointer first) rolls September up — and ⌘Z after it takes the last
//   EDIT, never the roll (a roll is not an edit — D-D3t-c.5); a click on the roll brings it back; pulled and held, short of a
//   third it falls back and past it it goes, and a flick short of a third goes; ] [ PageDown PageUp turn it; → over 30 September
//   walks into October and the pad follows;
// - IN HAND (a double-click on the tape): the held bar's tools live (‹ › today · the pen), › and ‹ ‹ turn the month, today rolls
//   home and selects the 24th, → is the bar's ›, t is today;
// - a note let go on a day STICKS (its pin, the day's drop mark while carried), rolls away with September (veiled: not drawn) and
//   comes back with it, carried off it is UNSTUCK; a stuck note deleted takes its pin with it and ⌘Z brings both back.
//
// Two things of the page the rows step around (neither the calendar's): at 0.42 a SELECTED pad fills the view's height and the
// selection menu (D4a) stands clamped over its foot's middle, so the foot is pressed a quarter in; core's drag follows the finger
// from where it crossed the slop — a first step behind it — so a note is carried closed-loop to where its centre must land.
import { decodePng } from "./png.mjs";
import { CALENDAR } from "../../../packages/desk/src/calendar/law.ts";
import { dayOfKey } from "../../../packages/desk/src/calendar/month.ts";
import { padFrame } from "../../../packages/desk/src/calendar/pad.ts";

/** The pad's sheet: its size, the tape across its head. */
const F = padFrame(CALENDAR);

export async function calendarRig(t) {
  const { tab, q, settle, mouse, dbl, key, sleep, check, until, hand, META } = t;
  const SHIFT = 8;
  // a click, then a human's pause (interact-kinds.mjs: a release and a far move coalesced into one frame can start a drag)
  const click = async (x, y, extra = {}) => { await mouse("mouseMoved", x, y, extra); await mouse("mousePressed", x, y, extra); await sleep(30); await mouse("mouseReleased", x, y, extra); await sleep(120); };
  const typeText = async (s) => { for (const ch of s) { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); await sleep(15); } };
  const X = 8000;
  const Y = 8000;
  const Z = 0.42;
  const camX = X - 1300;
  const camY = Y - 950;
  await q(`window.__desk.setCamera({ x: ${camX}, y: ${camY}, zoom: ${Z} })`);
  const pad = await q(`window.__desk.spawn('desk.calendar', { month: '2026-09' }, { x: ${X}, y: ${Y} })`);
  await q("window.__desk.calendar.pinToday('2026-09-24'); window.__desk.calendar.pinZone('America/Los_Angeles')");
  await settle();
  const cal = (m, ...a) => q(`window.__desk.calendar.${m}(${[pad, ...a].map((v) => JSON.stringify(v)).join(", ")})`);
  const ent = (id) => q(`window.__desk.entity(${id})`);
  const month = async () => (await ent(pad)).props.month;
  const roll = () => cal("roll");
  const sel = () => cal("selection");
  const entries = () => cal("entries");
  /** The turn done: nothing in flight, nothing pending, and the month laid bare is `m`. */
  const rolledTo = (m, ms = 5000) => until(async () => { const r = await roll(); return r !== null && r.turn === null && r.pending === null && r.shown === m; }, ms);
  const onSheet = (sx, sy) => q(`window.__desk.calendar.screenOf(${pad}, ${sx}, ${sy})`);
  /** A desk point on the screen through the DESK EYE the pad is drawn with (a flat camera mapping is ~50 px off at 0.42). */
  const onDesk = async (wx, wy) => { const g = (await ent(pad)).geometry; return onSheet(wx - g.cx + F.W / 2, wy - g.cy + F.H / 2); };
  const dayAt = async (day, fy = 0.5) => { const b = await cal("dayBox", day); return b === null ? null : onSheet(b.x + b.w / 2, b.y + b.h * fy); };
  // the foot a quarter in from the left: at 0.42 the sheet fills the view's height, so the selection menu (D4a) stands clamped over
  // the foot's middle while the pad is selected — a press there is the menu's (a person presses the foot beside it)
  const foot = () => onSheet(F.W * 0.25, F.H - 18);
  const rollAt = () => onSheet(F.W / 2, F.T + 20);
  const tapeAt = () => onSheet(F.W * 0.74, 20);
  /** The page as composited, once two captures in a row agree (world.mjs's `capture`): RGBA, device px. */
  const shot = async () => {
    let prev = null;
    for (let i = 0; i < 6; i++) {
      await tab.send("Page.bringToFront");
      const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
      if (data === prev) break;
      prev = data;
      await sleep(50);
    }
    return decodePng(Buffer.from(prev, "base64"));
  };
  const pressAt = (k, code, vk, modifiers = 0) => key(k, code, vk, modifiers);

  // ---- a day at rest: a click selects it — the brackets on its cell, and nothing else on the page changes
  const at2 = await dayAt("2026-09-02", 0.8);
  check((await q(`window.__desk.calendar.partAt(${at2[0]}, ${at2[1]})`))?.part === "day", "calendar: 2 September's cell is a DAY to the pad's parts at rest");
  await mouse("mouseMoved", at2[0], at2[1], { button: "none" });
  await sleep(300);
  await settle();
  const before = await shot();
  await click(...at2);
  await settle();
  const after = await shot();
  const s1 = await sel();
  const m1 = await cal("marks");
  const d2 = dayOfKey("2026-09-02");
  const box2 = await cal("dayBox", "2026-09-02");
  const [bx0, by0] = await onSheet(box2.x, box2.y);
  const [bx1, by1] = await onSheet(box2.x + box2.w, box2.y + box2.h);
  let inCell = 0;
  let outCell = 0;
  const dpr = after.width / 1200;
  for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
    const o = (y * after.width + x) * 4;
    if (before.rgba[o] === after.rgba[o] && before.rgba[o + 1] === after.rgba[o + 1] && before.rgba[o + 2] === after.rgba[o + 2]) continue;
    const cx = x / dpr;
    const cy = y / dpr;
    if (cx >= bx0 - 3 && cx <= bx1 + 3 && cy >= by0 - 3 && cy <= by1 + 3) inCell++; else outCell++;
  }
  check(s1?.anchor === "2026-09-02" && s1.focus === "2026-09-02" && m1?.days?.[0] === d2 && m1.days[1] === d2, `calendar: a click on 2 September selects it — the pad's selection (${s1?.anchor} … ${s1?.focus}) and its marks (days ${JSON.stringify(m1?.days)})`);
  check(inCell > 200 && outCell === 0, `calendar: the brackets are drawn on its cell and nowhere else — ${inCell} device px changed in the cell, ${outCell} outside it`);
  const ed1 = await q("window.__desk.calendar.editor()");
  check(ed1.lent && ed1.focused && !(await ent(pad)).selected, `calendar: the one editor is lent to the calendar and focused (lent ${ed1.lent}, focused ${ed1.focused}); the pad itself is not selected`);
  // ⇧-click 4 September: a run
  const at4 = await dayAt("2026-09-04", 0.8);
  await click(...at4, { modifiers: SHIFT });
  const s2 = await sel();
  const m2 = await cal("marks");
  check(s2?.anchor === "2026-09-02" && s2.focus === "2026-09-04" && m2?.days?.[0] === d2 && m2.days[1] === d2 + 2, `calendar: ⇧-click stretches it over a run (${s2?.anchor} … ${s2?.focus}; marks ${JSON.stringify(m2?.days)})`);
  await click(...at2);

  // ---- ⏎ on a day under 150 px picks the pad up first; the draft is no entity until ⏎ keeps it — ONE event child and its line
  const n0 = (await entries()).length;
  const drawn0 = (await q("window.__desk.calendar.tiles()")).drawn;
  await pressAt("Enter", "Enter", 13);
  const up = await until(async () => { const h = await hand(); return h !== null && h.entity === pad && h.settled && h.e === 1; }, 2500);
  const w0 = await q("window.__desk.calendar.writing()");
  check(up && w0?.pad === pad && w0.entry === 0 && w0.draft === "", `calendar: ⏎ on a day 101 px wide picks the pad up first (in hand ${up}) and the pen begins on it — a new line (writing ${JSON.stringify(w0)})`);
  await typeText("dentist 3pm");
  await sleep(100);
  const w1 = await q("window.__desk.calendar.writing()");
  const e1Draft = await entries();
  check(w1?.text === "dentist 3pm" && w1.draft === "dentist 3pm" && e1Draft.filter((e) => e.id > 0).length === n0 && e1Draft.some((e) => e.id === -1 && e.text === "dentist 3pm"), `calendar: the line is a DRAFT while written ("${w1?.text}") — printed, but no entity yet (${e1Draft.filter((e) => e.id > 0).length} entities, the draft #${e1Draft.find((e) => e.id < 0)?.id})`);
  await pressAt("Enter", "Enter", 13);
  await sleep(150);
  const e1 = (await entries()).filter((e) => e.text === "dentist 3pm");
  check(e1.length === 1 && e1[0].id > 0 && e1[0].start === d2 && e1[0].end === d2 && (await entries()).length === n0 + 1 && (await q("window.__desk.calendar.writing()")) === null && (await sel())?.entry === e1[0].id, `calendar: ⏎ keeps it — ONE desk.event child of the pad on 2 September, the line kept selected (${JSON.stringify(e1[0])})`);
  const inkCell = e1[0] ? await q(`window.__desk.calendar.inkOf(${e1[0].id})`) : null;
  const nSeeds = inkCell === null ? 0 : Buffer.from(inkCell.seeds, "base64").length / 4;
  check(inkCell?.parent === pad && inkCell.text === "dentist 3pm" && nSeeds === "dentist 3pm".length && inkCell.ink === "felt", `calendar: …a child of the pad (#${inkCell?.parent}), its ink cell the text and the hand's seeds, a glyph each (${nSeeds} seeds for ${inkCell?.text?.length} units), in the pen's ink (${inkCell?.ink})`);
  const printed = await until(async () => ((await cal("lines", "2026-09")) ?? []).some((l) => l.entry === e1[0]?.id && l.day === d2 && !l.band), 1500);
  const t1 = await until(async () => { const t = await q("window.__desk.calendar.tiles()"); return t.pending === 0 && t.drawn > drawn0; }, 3000);
  check(printed && t1, `calendar: …and the print lays its line on the day (${printed}), its tiles redrawn (${(await q("window.__desk.calendar.tiles()")).drawn - drawn0} drawn, none pending)`);
  // a run in hand is a band: 14 … 16 September, ⇧-click, then just typing (a word that does not begin with a tool's key: in hand
  // `t` is today and `p` the pen — the prototype's table has both "just type" and `t`)
  const hAt = async (day) => { const b = await cal("dayBox", day); return onSheet(b.x + b.w / 2, b.y + b.h * 0.8); };
  await click(...(await hAt("2026-09-14")));
  await click(...(await hAt("2026-09-16")), { modifiers: SHIFT });
  await typeText("away");
  await sleep(100);
  await pressAt("Enter", "Enter", 13);
  await sleep(150);
  const band = (await entries()).find((e) => e.text === "away");
  const bandLine = band ? await until(async () => ((await cal("lines", "2026-09")) ?? []).some((l) => l.entry === band.id && l.band), 1500) : false;
  check(band?.start === dayOfKey("2026-09-14") && band.end === dayOfKey("2026-09-16") && bandLine, `calendar: in hand, a run typed on is ONE entry across it, printed as a band (${JSON.stringify(band)})`);
  // Esc lets the line kept go (the keys go back to the hand); Esc again puts the pad down
  await pressAt("Escape", "Escape", 27);
  await sleep(100);
  const let1 = await sel();
  const still = (await hand()) !== null;
  await pressAt("Escape", "Escape", 27);
  check(still && let1 === null && !(await q("window.__desk.calendar.editor()")).lent && (await until(async () => (await hand()) === null, 2500)), `calendar: Esc lets the line go (selection ${JSON.stringify(let1)}, still in hand ${still}), Esc again puts the pad down`);
  await settle();

  // ---- a line at rest: a click selects it, ⌫ takes it off (one step), ⌘Z brings it back
  const line = ((await cal("lines", "2026-09")) ?? []).find((l) => l.entry === e1[0]?.id);
  const lineAt = line ? await onSheet(line.box.x + Math.min(line.box.w, 60) / 2, line.box.y + line.box.h / 2) : null;
  if (lineAt) await click(...lineAt);
  const s3 = await sel();
  check(s3?.entry === e1[0]?.id && (await cal("marks"))?.entry === e1[0]?.id, `calendar: a click on the line selects IT (selection's entry ${s3?.entry}, marked ${(await cal("marks"))?.entry})`);
  await pressAt("Backspace", "Backspace", 8);
  await sleep(150);
  check(!(await entries()).some((e) => e.text === "dentist 3pm") && (await entries()).length === n0 + 1, `calendar: ⌫ takes the selected line off the pad (${(await entries()).length} entries left)`);
  await pressAt("z", "KeyZ", 90, META);
  await sleep(150);
  const back1 = (await entries()).find((e) => e.text === "dentist 3pm");
  check(back1 !== undefined && back1.start === d2, "calendar: ⌘Z brings it back in ONE step");

  // ---- THE ROLL at rest: the foot (the corner lifts under the pointer first) rolls September up — and it is not an edit
  const ft = await foot();
  check((await q(`window.__desk.calendar.partAt(${ft[0]}, ${ft[1]})`))?.part === "foot", "calendar: the sheet's foot is the FOOT to the pad's parts");
  await mouse("mouseMoved", ft[0], ft[1], { button: "none" });
  const peeked = await until(async () => ((await roll())?.peek ?? 0) > 0.2, 1500);
  check(peeked, `calendar: under the pointer at the foot the corner lifts (peek ${(await roll())?.peek?.toFixed(2)})`);
  await click(...ft);
  const mid = await roll();
  check(mid?.turn !== null && mid?.turn?.dir === 1, `calendar: a click on the foot rolls the month UP (the turn ${JSON.stringify(mid?.turn)})`);
  check(await rolledTo("2026-10") && (await month()) === "2026-10", `calendar: …October laid bare, the document's month October (${await month()})`);
  // the undo stack's top is the band's line (the ⌫ above was undone): ⌘Z takes it, and the roll is not on the stack at all
  await pressAt("z", "KeyZ", 90, META);
  await sleep(200);
  check((await month()) === "2026-10" && (await rolledTo("2026-10", 800)) && !(await entries()).some((e) => e.text === "away") && (await entries()).some((e) => e.text === "dentist 3pm"), `calendar: ⌘Z after the roll takes the last EDIT (the band goes), never the roll — ${await month()} stands`);
  await pressAt("z", "KeyZ", 90, META | SHIFT);
  await sleep(150);
  check((await entries()).some((e) => e.text === "away") && (await month()) === "2026-10", "calendar: ⇧⌘Z brings the band back; the month stands");
  const rl = await rollAt();
  check((await q(`window.__desk.calendar.partAt(${rl[0]}, ${rl[1]})`))?.part === "roll", "calendar: under the tape is the ROLL");
  await click(...rl);
  check(await rolledTo("2026-09") && (await month()) === "2026-09", `calendar: a click on the roll brings September back down (${await month()})`);
  // by hand: pulled and HELD before the release (the pause decays the finger's velocity: no flick) — short of a third it falls
  // back, past it it goes; a quick flick short of a third goes too (the way it was flicked)
  const ft2 = await foot();
  const pull = async (dy, steps, gap, hold) => {
    await mouse("mouseMoved", ft2[0], ft2[1]);
    await mouse("mousePressed", ft2[0], ft2[1]);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", ft2[0], ft2[1] - (dy * i) / steps, { buttons: 1 }); await sleep(gap); }
    const p = (await roll())?.turn?.p ?? 0;
    if (hold > 0) await sleep(hold);
    await mouse("mouseReleased", ft2[0], ft2[1] - dy);
    return p;
  };
  const pShort = await pull(60, 8, 30, 250);
  check(pShort > 0.03 && pShort < 1 / 3 && (await rolledTo("2026-09")) && (await month()) === "2026-09", `calendar: a short pull on the foot (held at ${pShort.toFixed(2)} of the sheet) falls back (${await month()})`);
  const pLong = await pull(500, 8, 30, 250);
  check(pLong > 1 / 3 && (await rolledTo("2026-10")) && (await month()) === "2026-10", `calendar: a long one (held at ${pLong.toFixed(2)}) rolls it away by hand (${await month()})`);
  await click(...(await rollAt()));
  check(await rolledTo("2026-09"), "calendar: …and the roll brings it back");
  const pFlick = await pull(160, 3, 16, 0);
  check(pFlick < 1 / 3 && (await rolledTo("2026-10")) && (await month()) === "2026-10", `calendar: a flick short of a third (${pFlick.toFixed(2)}) goes the way it was flicked (${await month()})`);
  await click(...(await rollAt()));
  check(await rolledTo("2026-09"), "calendar: …and the roll brings it back again");
  // the keys (a day selected: the keys are the days'): ] [ PageDown PageUp, and → over the month's edge
  await click(...(await dayAt("2026-09-30", 0.8)));
  await pressAt("]", "BracketRight", 221);
  check(await rolledTo("2026-10") && (await month()) === "2026-10", "calendar: ] turns to October");
  await pressAt("[", "BracketLeft", 219);
  check(await rolledTo("2026-09") && (await month()) === "2026-09", "calendar: [ turns back to September");
  await pressAt("PageDown", "PageDown", 34);
  check(await rolledTo("2026-10"), "calendar: PageDown turns to October");
  await pressAt("PageUp", "PageUp", 33);
  check(await rolledTo("2026-09"), "calendar: PageUp turns back");
  await pressAt("ArrowRight", "ArrowRight", 39);
  const s4 = await sel();
  check(s4?.focus === "2026-10-01" && (await rolledTo("2026-10")) && (await month()) === "2026-10", `calendar: → walks the days — over 30 September onto 1 October, and the pad follows (${s4?.focus}, ${await month()})`);
  await pressAt("ArrowLeft", "ArrowLeft", 37);
  check((await sel())?.focus === "2026-09-30" && (await rolledTo("2026-09")), "calendar: ← walks back and the pad follows");
  await pressAt("Escape", "Escape", 27);
  await settle();

  // ---- IN HAND: a double-click on the tape picks it up; the held bar's tools live; › ‹ ‹ today; → is the bar's ›
  await dbl(...(await tapeAt()));
  check(await until(async () => { const h = await hand(); return h !== null && h.entity === pad && h.settled && h.e === 1; }, 2500), "calendar: a double-click on the tape picks the pad up");
  await sleep(400);
  const bar = await q("(() => { const el = document.querySelector('[data-ice-selection-menu]'); return el ? { tools: [...el.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool), dim: [...el.querySelectorAll('[data-tool]')].filter((b) => b.disabled).length } : null; })()");
  check(JSON.stringify(bar?.tools) === JSON.stringify(["month:-1", "month:1", "today", "pen"]) && bar.dim === 0, `calendar: the held bar's tools are live: ${bar?.tools?.join(" · ")} (${bar?.dim} dimmed)`);
  // idle-zero in hand (D7): a pad has no cover — once the carry settles nothing of it moves
  await settle();
  const padN0 = await q("window.__desk.submits().total");
  await sleep(600);
  const padN = (await q("window.__desk.submits().total")) - padN0;
  check(padN === 0, `calendar: idle-zero with the pad held and still: ${padN} submits in 600 ms`);
  const tool = (id) => q(`document.querySelector('[data-ice-selection-menu] [data-tool="${id}"]').click()`);
  await tool("month:1");
  check(await rolledTo("2026-10") && (await month()) === "2026-10", "calendar: the bar's › turns to October");
  await tool("month:-1");
  await tool("month:-1");
  check(await rolledTo("2026-08", 7000) && (await month()) === "2026-08", `calendar: ‹ ‹ rolls two months back — one turn after another (${await month()})`);
  await tool("today");
  const home = await rolledTo("2026-09", 7000);
  const s5 = await sel();
  check(home && (await month()) === "2026-09" && s5?.anchor === "2026-09-24" && s5.focus === "2026-09-24", `calendar: today rolls home and selects the 24th (${await month()}, ${s5?.anchor})`);
  await pressAt("ArrowRight", "ArrowRight", 39);
  check(await rolledTo("2026-10"), "calendar: in hand → is the bar's ›");
  await pressAt("t", "KeyT", 84);
  check(await rolledTo("2026-09"), "calendar: t is today");
  for (let i = 0; i < 3 && (await hand()) !== null; i++) { await pressAt("Escape", "Escape", 27); await sleep(150); }
  check(await until(async () => (await hand()) === null, 2500), "calendar: Esc puts it down");
  await settle();

  // ---- A NOTE STUCK TO A DAY: let go on 23 September it sticks (the drop marked while carried); it rolls away with September
  //      (veiled — not drawn) and comes back with it; carried off it is unstuck
  const note = await q(`window.__desk.spawn('desk.note', { seed: 11 }, { x: ${X + 1150}, y: ${Y + 300} })`);
  await settle();
  const papers = async () => (await q("window.__desk.stats()"))?.frame?.kinds?.paper ?? -1;
  /**
   * Carry a note by hand so that its CENTRE ends on the desk point `to`: core's drag follows the finger from where it crossed the
   * slop (a first step behind it), so the finger is walked there and then nudged by what is left, as a person watching the note
   * does; `held` reads the desk before the release.
   */
  const carryNote = async (to, held) => {
    const n = await ent(note);
    const a = await onDesk(n.cx, n.cy);
    const b = await onDesk(to[0], to[1]);
    await mouse("mouseMoved", a[0], a[1], { button: "none" });
    await sleep(60);
    await mouse("mousePressed", a[0], a[1]);
    await sleep(60);
    let [x, y] = a;
    for (let i = 1; i <= 10; i++) { x = a[0] + ((b[0] - a[0]) * i) / 10; y = a[1] + ((b[1] - a[1]) * i) / 10; await mouse("mouseMoved", x, y, { buttons: 1 }); await sleep(20); }
    await sleep(80);
    const m = await ent(note);
    x += (to[0] - m.cx) * Z;
    y += (to[1] - m.cy) * Z;
    await mouse("mouseMoved", x, y, { buttons: 1 });
    await sleep(120);
    const seen = held ? await held() : null;
    await mouse("mouseReleased", x, y);
    await settle();
    return seen;
  };
  const g0 = (await ent(pad)).geometry;
  const b23 = await cal("dayBox", "2026-09-23");
  const on23 = [g0.cx - F.W / 2 + b23.x + b23.w / 2, g0.cy - F.H / 2 + b23.y + b23.h / 2];
  const dropMark = await carryNote(on23, async () => (await cal("marks"))?.drop);
  const pins1 = await cal("pins");
  const nStuck = await ent(note);
  const [c0x, c0y] = await onSheet(b23.x, b23.y);
  const [c1x, c1y] = await onSheet(b23.x + b23.w, b23.y + b23.h);
  const [nx, ny] = await onDesk(nStuck.cx, nStuck.cy);
  check(dropMark === dayOfKey("2026-09-23"), `calendar: carried over the pad the note marks the day it would stick to (drop ${dropMark})`);
  check(pins1.length === 1 && pins1[0].note === note && pins1[0].day === "2026-09-23" && !pins1[0].veiled && nx > c0x && nx < c1x && ny > c0y && ny < c1y, `calendar: let go, it STICKS to 23 September — its pin (${JSON.stringify(pins1)}) and the note glided into the day (${nx.toFixed(0)}, ${ny.toFixed(0)})`);
  const shown1 = await papers();
  await click(...(await foot()));
  check(await rolledTo("2026-10"), "calendar: the foot rolls September away");
  await settle();
  const pins2 = await cal("pins");
  const hidden = await papers();
  check(pins2.length === 1 && pins2[0].veiled && hidden === shown1 - 1, `calendar: the note goes with its month — veiled (${pins2[0]?.veiled}), not drawn (${shown1} → ${hidden} papers in the frame)`);
  await click(...(await rollAt()));
  check(await rolledTo("2026-09"), "calendar: the roll brings September back");
  await settle();
  const pins3 = await cal("pins");
  check(pins3.length === 1 && !pins3[0].veiled && (await papers()) === shown1, `calendar: …and its note with it — shown (${!pins3[0]?.veiled}), drawn again (${await papers()} papers)`);
  await carryNote([X + 1150, Y + 300]);
  const nOff = await ent(note);
  check((await cal("pins")).length === 0 && Math.abs(nOff.cx - (X + 1150)) < 16 && Math.abs(nOff.cy - (Y + 300)) < 16, `calendar: carried off the pad it is UNSTUCK — no pin, the note where it was let go (${nOff.cx.toFixed(0)}, ${nOff.cy.toFixed(0)})`);

  // ---- a stuck note deleted takes its pin with it (one step); ⌘Z brings both back
  await carryNote(on23);
  check((await cal("pins")).length === 1 && (await cal("pins"))[0].day === "2026-09-23", "calendar: stuck again to 23 September");
  const nAt = await ent(note);
  await click(...(await onDesk(nAt.cx, nAt.cy)));
  await pressAt("Escape", "Escape", 27);
  await sleep(80);
  const picked = await q("window.__desk.selection()");
  await pressAt("Backspace", "Backspace", 8);
  await sleep(200);
  check(JSON.stringify(picked) === JSON.stringify([note]) && (await ent(note)) === null && (await cal("pins")).length === 0, `calendar: ⌫ on the stuck note (selected ${JSON.stringify(picked)}) deletes it — and its pin goes with it`);
  await pressAt("z", "KeyZ", 90, META);
  await sleep(250);
  const pins4 = await cal("pins");
  const nBack = pins4.length === 1 ? await ent(pins4[0].note) : null;
  check(pins4.length === 1 && pins4[0].day === "2026-09-23" && nBack?.type === "desk.note" && !pins4[0].veiled, `calendar: ⌘Z brings both back in ONE step — the note and its pin to 23 September (${JSON.stringify(pins4)})`);
  await q("window.__desk.calendar.pinToday(null)");
  await settle();
}
