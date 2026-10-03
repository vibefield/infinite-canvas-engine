# Changelog

All notable changes to ICE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semver](https://semver.org) (pre-1.0: minor versions may break APIs).

## [Unreleased]

> **Published as `0.15.0-desk.1` on the `next` dist-tag (2026-10-03)** — a prerelease carrying everything below (the nine 0.15.0 asks,
> I20–I28, VibeField's desk migration) for its landing branch to pin exactly while the branch is open (its DK-D12). The section stays
> `[Unreleased]` until 0.15.0 is cut; later prereleases are `0.15.0-desk.N`. Nothing of 0.14.0's surface moves.

**The 0.15.0 asks (M23) — VibeField's desk migration (track DK) files nine against the desk, petitions I20–I28; each lands as
its own block here as it is built.** Additive, every one but I28 — a behaviour change by the product's law, with no API change:
nothing of 0.14.0's surface moves.

### Added

<!-- petition I23 — the capture door (2026-10-02; the first of the 0.15.0 asks) -->
- **THE CAPTURE DOOR — `handle.capture({ rect?, scale? }) → Promise<ImageBitmap | undefined>`** (petition I23, the first of the
  0.15.0 asks — VibeField's covers, thumbnails and "Send to…"; DK-D25, James: "frozen desk should be still and consume no render
  time at all, do it properly"): the desk as the LAST PRESENTED frame showed it — the same camera, theme, selection marks, hand and
  tray — as a bitmap of `rect` (CSS px of the view; the whole view when absent) at the view's dpr × `scale` (1; a thumbnail asks
  0.25). Inside (`Ground.capture`, ground.ts `captureFrame`): that frame's inputs drawn ONCE MORE — every view in the tree at the
  scaled dpr (`scaledInputs`: the root's, each live inside's, the departed desk's, the hand's, the marks', the tray's) — into a
  readable `capture/still` texture through `encodeFrame`, now the ONE encoding of a frame that the swap chain, the capture and the
  Node oracle share (the held frame through `renderHeldFrame`, its encoders named `capture` so the profiler closes no frame on them;
  at the view's size the standing desk copy is reused); the rect's device pixels copied to a `capture/readback` buffer, mapped, and
  handed back tight (the swap chain's BGRA turned to RGBA, alpha 255, no premultiplication or colour-space conversion on the way into
  the ImageBitmap). The slots are prepared for a new `RenderTarget`, `"capture"`: the board's and the print's passes keep the frame's
  residency under it as under the hand, so a thumbnail's coarser asks evict nothing. Nothing is kept of any frame — both resources are
  destroyed before the promise settles — the swap chain is never touched, no frame is counted (`redraws`, `perf().frames`, no engine
  step), one submit of its own, the memory ledger's own `capture` line while the still lives and none after. Honest `undefined`,
  never a throw, while `status()` is `failed` or `degraded`, before the first frame has been presented, or when the device is lost
  mid-copy (the map rejects); a malformed option throws at the call (`checkCapture`). Captures serialize; one asked for the same
  picture while another is in flight shares its bitmap. Witnesses: units (the GPU half on the fake device — the scaled still, the
  rect's copy, the tree walk, the lost device, the held path; the door — the counts, the bytes channel for channel, degraded and
  lost), the oracle's new scene `capture-desk-z1` (`captureCheck`: at 1× the capture's sha-256 IS the golden's; at 0.25× it is the
  frame drawn at dpr 0.5, maxΔ 0; a rect is the frame's crop, maxΔ 0 — the other 112 stills byte-identical), and `rig:capture`, the
  nineteenth rig (on the showcase with the loop parked by `freeze("cover")`: the still of 2400 × 1600 in 30 ms the first time, 28–29
  warm; the thumbnail of 600 × 400 in 4 ms, 2.5 warm; a rect; the share; the oracle still staged FROM THE WORLD at maxΔ 0 on
  3,840,000 px; a live capture; the lost device). `docs/api-reference.md` lists it beside `setTheme`.

<!-- petition I20 — the hand's reserves and the held bar's travel, host-settable (2026-10-02) -->
- **THE HAND AS A HOST SETS IT — `deskLayer({ hold: { top?, band?, travelMs? } })`** (petition I20 — VibeField's tools in hand under
  its head, MC-D4; DK-12): CSS px and ms, read at the mount, each `HOLD`'s when absent (56 · 72 · 340). `top` is the reserve above the
  held object's reading fit and `band` the reserve below it — `readingTarget(extent, vp, spread, face, reserves?)` takes them
  (`HoldReserves`, the builder's `hold`); a phone keeps `HOLD.topPhone` and `HOLD.marginPhone`, and its one-page decision (Q-p) is made
  on its own numbers whatever the host reserves, so the notebook's own `readingTarget(…, true).single` still agrees with the hand.
  `travelMs` is the held bar's travel (M1): the bar is the host's, so the desk carries it on the selection's anchor
  (`HeldAnchor.travelMs`, present only when the host set one) and `@ice/react`'s `<SelectionMenu>` travels over it, there and back
  (`backMs` stays). A malformed number (negative, NaN, infinite) throws at the mount, by its name, before the canvas is made. Absent, the
  desk and its anchors are 0.14.0's byte for byte. Witnesses: `packages/desk/test/hold-reserves.test.ts` (the fit 116 under the top and
  100 above the foot at 800 and 640 px tall; `HOLD`'s identity; the phone; the refusal), `packages/objects/test/hold-reserves.test.ts`
  (the real layer: a notebook picked up under `{ 116, 100, 560 }` and the anchor's travel; without, `HOLD`'s fit and the anchor's four
  keys), `packages/react/test/held-bar.test.tsx` (560 there, and back over the last travel told), and rig:open §14 (a page mounted as
  VibeField mounts it, `rig.html?hold=116,100,560`: the notebook's fit 116 / 100 to the micro-pixel, the bar's travel measured on the
  page's clock within a frame of 560).

<!-- petition I21 — the pegboard lay's foot inset, host-settable (2026-10-02) -->
- **THE DRAWER'S FOOT — `deskLayer({ tray: { foot? } })`** (petition I21 — the pegboard rises behind VibeField's line, FC-D3/MC-D7;
  DK-13): CSS px, default 0, read at the mount. The pegboard's laid content ends `foot` above the board's bottom edge — the HEADER's
  mirror (design-018 R4, rev 5): the face's portal clip ends at the foot's line (`faceClip(rect, vh, foot)`; a specimen wholly past it is
  culled), so does the tags' scissor, and the VEIL lays the plain board over the foot, whole, fading out over `DRAWER.fade` above the
  line — a second quad in the veil's ONE draw (`vs_veil`'s vertices 6–11, `tray_veil`'s ramp; the pass's block carries the foot in
  `fade.z`) — so no specimen, shadow, accessory, tag or hole shows there and nothing is cut square under the line; the board itself runs
  to its edge. The scroll's range grows by it (`scrollRange(vw, vh, bottom, foot)`; core's clamp takes the face less the foot), so the
  last line comes to rest whole a pitch above the line. Core's pose seam names it (`TrayScreenFrame.foot`, beside `head`): a specimen
  scrolled into the foot is bare board there, never hovered or taken. `contentShown(rect, y, foot)` is the CPU law; `TrayOptions` the
  type. A malformed foot throws at the mount. Absent, 0.14.0 byte for byte — the oracle's 113 stills unchanged — and with the foot on the
  drawer still draws three times (the board, its accessories, the veil) over the same instances. Witnesses:
  `packages/desk/test/tray-foot.test.ts` (the kernel's lay under the drawer's law at every scroll, the range's end, the flux, the pass's
  block and its one veil draw, the tags' scissor, the refusal), core's `tray-take.test.ts` and `tray-specimens.test.ts` (the pick, the
  clamp), `packages/objects/test/tray-foot.test.ts` (the real layer: the frame, the range, the six's last line drawn whole above the line)
  and the oracle's NEW still `tray-foot` (tray-scrolled's still under a foot of 88: the foot is its bare board byte for byte with not a
  pixel of a hole, and above the foot's ramp it is tray-scrolled byte for byte), drawn in Chrome by rig:parity and FROM THE WORLD by
  rig:world on a page mounted with the foot (`rig.html?trayFoot=88`), maxΔ 0 both.

<!-- petition I22 — a kind's word in hand, on the selection's anchor (2026-10-02) -->
- **THE WORD IN HAND — `open.readout` → `HeldAnchor.readout`** (petition I22 — MC-D9 "readouts"; DK-12): a kind declares its word
  beside its held tools — `readout?: string | ((ctx: HeldReadoutContext) => string | undefined)` on its `open` binding, `ctx` the read
  side of what its held tools' acts are handed (`world`, `entity`, `props()` as the world holds them now) and its own desk state
  (`local`, as `open.page` and `open.openness` read it); a readout never writes. The layer reads it each time it recomposes the
  selection's anchor — the pickup, a mode taken up, an act run, every frame drawn while held — and publishes it as
  `anchor().held.readout`, so a host's bar (VibeField's, DK-D23) prints it as data. `undefined`, "" or a non-string: no word, and the
  anchor is 0.14.0's (no key). A readout that throws is caught at the kind's boundary — the anchor keeps the tools and carries no word,
  the frame never sees it — and said once a page on the console, naming the kind (never a strike against it: I24 keeps the word's own
  catch, below). The
  reference kinds that have a word declare it: the notebook "Page N" — the page it is open at as its ‹ › count it, read from the spread a
  turn is heading for, so the word moves no later than the frame the document's spread does — and the desk calendar its month's name;
  the example's desk clock (`examples/desk-clock`, a plugin kind: `clockWord`) the time its hands show ("10:08:42"; to the minute without
  its seconds hand; 24-hour on its ring). `@ice/react`'s `<SelectionMenu>` does not print it (ICE's demo chrome stays as it is —
  DK-D23, MC-D11 deferred). Witnesses: `packages/desk/test/held-readout.test.ts` (kinds of its own on the fake device: the props and the
  desk state at the pickup and after an act, in the frame that draws it; a string, none, "" and a non-string; the throw contained — no
  reflector fault — and said once), `packages/objects/test/held-readout.test.ts` (the notebook's Page 1 → Page 2, never heard behind the
  document's spread; the calendar's September → October in the first frame after the act), `examples/desk-clock/test/clock.test.ts`.

<!-- petition I24 — fault containment per kind (2026-10-02) -->
- **FAULT CONTAINMENT PER KIND — one bad kind is drawn as MISSING, said once, never the desk down** (petition I24 — VibeField DK-D22:
  a plugin's kind runs in the renderer realm on the host's device, contained per kind by ICE; DK-9 admits a third-party kind only
  behind it). AT CREATE every kind's pass is made in parallel as before but SETTLED ALONE, each in its own error scope
  (`createKindPasses`: a scope around what a kind does before its first await — where a WGSL error is raised — and a window around
  them all, a fault's attribution made by remaking each kind alone): a kind whose WGSL will not compile or whose pipeline fails
  validation is REFUSED and the rest boot — `status()` stays `ready`, the compile error never reaches the device's handler (before
  I24 one rejected `create` failed the whole desk, and an uncaptured error said `degraded` for the device as a whole). PER FRAME every
  call into a kind's world half — `resolve`, `record` (and what a remake asks with them), `chip`, `hit`, its desk state's `tick` and
  `due`, the hand's, a ghost's, the tray's specimens' — is caught at the kind: a STRIKE, the frame going on without that object (its
  record reset, made afresh next time); at THREE (design-009 §16's ladder, I17's words) the kind is QUARANTINED. What the selection's
  anchor asks of a kind — I22's `open.readout` and `open.swatches` — is contained at the CALL instead, never a strike: no word, or the
  slots their glyphs, said once a page (the anchor is recomposed at the host's rate, on every `selection.anchor()`, and only in hand —
  counted, a host's reads would decide when a kind goes and every such fault would retire its kind with its object in hand; and it
  draws nothing of the desk). `swatches` had no catch at all: a throw escaped every frame's publish and the host's `anchor()`. A missing kind stops
  costing, not merely drawing: nothing of it is called again, its passes are swapped out of every slot and disposed (`Ground.quarantine`;
  a kind the flat card composes turns the card off — its pixels, more draws), its desk state's `dispose` called, its drivers parked, its
  raster asks dropped and charges forgotten (`RasterBudget.forget`) — and its objects wear the desk's own MISSING FACE (`MISSING_OBJECT`,
  `missingFace`): a faint hatched card the size of the object's box, no text, pickable by its box (the object itself: a tap selects
  it, a drag moves it). The same face for an object whose type has NO kind on this desk (before, invisible — VibeField's ghost stubs):
  one face for "nothing can draw this". Said ONCE: `DeskLayerStatus.faults: readonly { kind, reason }[]` (absent while none — a
  state for the desk's life, so a host that subscribes late reads it; `onStatus` hears each kind once, a boot refusal riding the boot's
  own `ready`) and one `console.error`; a strike before the third is a `console.warn` alone. The ledger: `due().kinds[kind] ===
  KIND_MISSING` (−1); apps/desk's dev panel says the kinds too. Nothing costs while nothing faults: the missing face is made at the
  first one asked for (no pipeline, no buffer before), the boundary's try/catch allocates nothing, idle-zero holds with a missing kind
  registered. The FAULT FIXTURE: examples/desk-clock `brokenClockKind`, `DeskClockBroken` (its WGSL names what nothing declares) and
  `DeskClockFaulty` (its record throws from its third call, its hit always) — VibeField's playground v2 registers them (DK-7).
  Witnesses: units (`packages/desk/test/kind-faults.test.ts` on a fake device that refuses the WGSL as a compiler does and keeps
  WebGPU's error scopes; the fixture's own), the oracle's new still `fault-missing-z1` (the showcase with the broken clock registered —
  on the desk and in a mini mat's live inside: byte for byte the showcase outside their boxes, the face in them; the other 114 stills
  byte-identical with the refused kind registered on the one desk; the creation's error scopes clean — Dawn's own compiler refused it),
  rig:parity on it (maxΔ 0), and rig:clock's rows 11–15 (`rig.html?plugins&broken`: the boot ready, the quarantine said once, the
  ledger rows, both faces, a press in each box selects its entity). `docs/api-reference.md` says what a kind's author can expect.

<!-- petition I25 — the kind set: the rule, measured; the door deferred (2026-10-02) -->
- **THE KIND SET — the rule, measured; the door deferred: a desk's kinds are fixed for its layer's life, a host remounts to change
  them, and the remount is MEASURED** (petition I25, answer 2 — the rule, for 0.15.0; VibeField's plugin runtime, DK-9: enable,
  update, remove). A desk's kinds are the set it was MOUNTED with
  (the catalog's object types and `deskLayer({ objects })`, compiled by `Ground.create`). A type registered AFTER the mount adds no
  kind and is refused honestly: its objects wear petition I24's missing face (the builder draws by a kind only when the desk was
  mounted with it) and the desk says so ONCE a type — a `console.warn` naming the type, its kind and "remount to draw it (petition
  I25)"; the tray hangs no specimen of it. Before, the builder resolved the late kind off the world's catalog and handed the ground a
  record under a name it never compiled: `ground: no kind "…" is registered` threw out of every frame that showed one. THE MOUNT'S
  COST as each boot went: `perf().boot` (`DeskLayerBoot` — `device`, `compiled`, `presented`: ms since the mount; three stamps and one
  promise a mount, nothing a frame). Measured by `rig:remount` (the twentieth rig; `__desk.remount()` remounts the product's `<Desk>`
  on a new generation, same engine and document): the showcase — six kinds and the clock — remounted five times a run, ten runs, on
  an Apple M1 Max (Chrome 154 headless, 1200 × 800 @ 2): the device in hand 4–6 ms, the passes compiled 34–52 ms, the first frame
  presented 92–124 ms (medians 4.3–5.4 / 35–40 / 100–113), two runs under another landing gate's load (14–21) among them; the page's
  first mount, cold, 30–38 / 173–210 / 188–236 ms at load 5–14 and 45–102 / 215–274 / 245–301 ms under that load — a cold mount past
  250 ms, no remount near it. A remount within 250 ms: the door (`handle.kinds.replace`, the petition's answer 1) stays deferred. Nothing outlives its generation: the memory ledger reads
  ZERO after every unmount — a generation with a kind refused at create and one quarantined at three strikes included, then one
  mounted clean — and the document is untouched (its snapshot byte for byte, no commit). Found and fixed on the way: a kind QUARANTINED
  while the ground was being made (its desk state's `tick` threw three times in the boot's frames) kept its pass in the ground that
  arrived, and its objects' missing-face records were handed to it — the frame lost; the boot now quarantines it in the new ground. And
  the editor's dispose ends a lease still held: a typing session open at an unmount commits and lifts its claim (before, it stayed
  open for good — its idle commit cleared, its claim held). The app: `__desk.remount()` / `__desk.generation`; what a mount adds to
  the engine goes with it (the flight pin's and the glyph feed's tick systems, and a devtools dock left open, outlived their mount —
  rig:remount counts them). Witnesses:
  `packages/desk/test/kind-set.test.ts` (the late type, the tray, `perf().boot`, the document across a remount, the ledger at zero
  across generations), `packages/desk/test/kind-faults.test.ts` (the kind quarantined while the ground is made),
  `packages/objects/test/note-session.test.ts` (the session open at the editor's dispose), rig:remount. `docs/api-reference.md`
  states the rule, the numbers and where the document's survival is proven; Plugin parity: your kind is compiled at the layer's mount.

<!-- petition I26 — the room's other people, host-settable (2026-10-03) -->
- **A HOST THAT DRAWS ITS OWN PEERS — `deskLayer({ cursors: false })`** (petition I26 — VibeField draws each peer by face, from
  `usePresencePeers`; DK-16, presence on the mat): default `true`, read at the mount. `false` — the host the layer is mounted in
  (`createDeskHost`, `<Desk>`) mounts no remote cursors: no plane, no reflector, so no peer is drawn twice. The remote cursors are the
  dom's (design-015 §9) and the desk reaches the dom as an opaque factory, so the word travels back on the handle:
  `DeskLayerHandle.cursors` (the option as read, `true` when absent), read through dom's structural `LayerHandle.cursors?` when the
  factory returns. The presence session, core's derived hands (`CursorVisual "remote"`), `usePresencePeers` and the OS cursor are
  untouched. Absent, byte-identical: the boot registers the same reflectors in the same order — the oracle's 115 stills and every rig
  as before. Found in the build: that reflector is the desk host's ONE observing reflector (the desk's and the OS cursor's are
  `always`), so it is what armed the world's reactive layer — and strata's dev access enforcement with it — at the mount; with
  `cursors: false` the host arms nothing, and the world arms at the host's own first observer (`usePresencePeers` is one — core's
  petition-7 pin S5, arming comes from the mount). Witnesses: `packages/dom/test/desk-host.test.ts` (two peers' hands: no plane, no
  reflector, nothing drawn, the host arming nothing; absent or `true`, both drawn), `packages/react/test/facade.test.ts` (the
  petition's acceptance 1 on a real presence session — `<Desk>` with `cursors: false` and two peers: no cursor element,
  `usePresencePeers` lists both; absent, both drawn), `packages/desk/test/cursors.test.ts` (the handle's word), and rig:collab's
  third tab (`rig.html?…&cursors=false`: A draws Carol's cursor; her world holds both other people and their hands; her page draws
  nobody's — no chip, no reflector, the desk's pixel where Alice's chip would be). `docs/api-reference.md` lists it beside `grid`,
  `hold` and `tray`.

<!-- petition I27 — the desk's pick at a screen point (2026-10-03) -->
- **THE DESK'S PICK — `handle.pick({ x, y }) → PickResult | null`** (petition I27 — VibeField's right-click selects the object under
  the pointer, then grows the bar into its menu; DK-11, Chrome on the Mat MC-D6): the object at a point (CSS px of the view — a
  pointer event's client point less the container's rect) as the desk's own pick resolves it, so what a primary click there selects:
  `PickResult { entity, type, canvas, part }` — the entity, its `type` (`PrefabId`), the `canvas` it lies in (the board root, or the
  container entered), its kind's `part` under the point (`""` the object itself; a named part is the kind's, which a click works and
  does not select). No second hit path: core's `picking` system wrote `TouchesExact` from a closure-private exact pick, now ONE function
  (`pickExact`, l1-pick.ts) that the system and a new out-of-tick door share — `InteractionStack.pickAt(sx, sy) → PointPick |
  undefined`, the same index, sibling order, wires and frame source on the world the last tick left, the camera as it stands, the
  drawer's inertness; `createDeskHost` hands it to the layer as `LayerContext.pickAt` (the desk's structural `DeskLayerContext.pickAt?`),
  and the handle answers through it. Synchronous and read-only — no redraw, no wake, no write; it never selects (the host does,
  `ops.setSelection`). `null` over the bare mat and its rulers (printed on it), on chrome with no type (a resize handle), while an
  object is in hand or the pegboard drawer is out (the desk inert to the pointer — D4b, design-017 §4), before the first frame and
  while `status()` is `pending` or `failed`; `degraded` picks. A malformed point throws. Two of the petition's words amended in the
  build (its file says so): a point on a LIVE mini mat's face picks the mini mat, not the object drawn in its inside — the inside's
  objects are no members of the frame (not Active, not in the spatial index; `Selected ⇒ Active`; `ops.setSelection` takes none), so a
  click there selects the mini mat and an inside pick would need a second hit path; entered, they pick with the mini mat as their
  canvas. And in hand the whole desk is null, not the hand's object alone (the desk is inert in hand). Witnesses:
  `packages/core/test/frame-pick.test.ts` (the door against a real press at each point — content, band, part, canvas; through a
  zoomed camera; two overlapping; the drawer out; read-only), `packages/dom/test/desk-host.test.ts` (the context carries
  `stack.pickAt`), `packages/desk/test/pick.test.ts` (the petition's acceptance 1 as amended, each pick checked against a click's
  selection: a note, the bare mat, a part, two overlapping and reordered, a live inside's note → its mat, entered → the note with the
  mat as its canvas, held → null though the stack's pick finds the hand's object, before the first frame, a resize handle, the drawer,
  `degraded` and lost, read-only), and rig:interact's pick row (acceptance 2: a real right-click's point through a `contextmenu`
  listener against a primary click's selection, at ten points of a showcase — the note on top where two overlap, twice — all agreeing;
  ten picks in one task draw, wake and select nothing). The oracle's 115 stills byte-identical. `docs/api-reference.md` lists it beside
  `capture`.

### Changed

<!-- petition I28 — a secondary button never acts (2026-10-03; the last of the 0.15.0 asks) -->
- **A SECONDARY BUTTON NEVER ACTS** (petition I28 — the bar's right-click opens VibeField's menu, and only that; DK-11): a secondary
  (right) or middle press is a POINT for the interaction stack, never a GESTURE. Before, core's recognizers read no button — a right
  press-release over an object selected it, a right drag moved it and committed, a right press on a part worked it, a right
  double-click entered a container or picked up an openable, and in the hand a right click on the soft desk put the object down.
  No new field: the adapter has always carried PointerEvent `buttons` on every fact, and a pointerdown's mask IS the button that
  pressed (a second button joins a held press as a pointermove), so the stack reads the press's button off the pointer on its
  `WentDown` tick (`pressButton`, core's internal press-button.ts). PRIMARY — bit 1 (a mouse's left, a touch, a pen's tip), 32 (a pen's
  eraser end, which the board's eraser reads) or none (a synthetic down that names no button, as every press was) — spawns as before.
  SECONDARY spawns nothing: no tap, long press, drag or multi-tap rejoin, so nothing selects, works a part, drags, commits, enters or
  opens. MIDDLE spawns only its drag, and only where `dragRoute` pans it (the bare canvas — design-003 §4.4's device convention, which
  already existed there); over an object, a handle or a port it is now a point, where before it moved, resized or connected. The hand
  (design-015 §8, `heldInput`) takes the primary press too: a secondary press — or a middle one with nothing to pan — keeps no
  `HeldPress`, so it puts nothing down, works no part (a notebook's turn) and is no tool's press; brought close, the middle drag still
  pans. What a secondary press still does: ingest moves the pointer's point, and `picking` its exact pick, its part and its hover —
  what `handle.pick` and a host's `contextmenu` read; the touch-to-stop of the camera's inertia (any press); and the host's own
  surfaces close on their own DOM events (the desk's editor commits on the blur a press elsewhere brings — it only ever OPENED on a
  primary `click`). The adapter never listens for `contextmenu`: it is the host's, untouched. Witnesses:
  `packages/core/test/secondary-button.test.ts` (the real stack with a recording sink and a part: a right press over an object held
  past the long press spawns nothing while its point, pick and part read the object; no PartTap; a right drag moves, grabs, commits
  and pans nothing as the pointer and its pick follow; on the bare canvas it clears no selection; a middle press spawns nothing over
  an object and only its drag on the canvas, which still pans, its click keeping the selection; touch, a pen's tip and eraser, and a
  no-button down select; a right or middle double-click enters and opens nothing; the hand — no press kept, nothing put down, the
  middle pan brought close), `packages/dom/test/pointer-adapter.test.ts` (a right press-move-release's facts carry 2/2/0 with their
  points and nothing is prevented; a `contextmenu` reaches the container's listener and the page's, unprevented, enqueuing nothing),
  and rig:interact's I28 row (on I27's showcase, a real right-click at the ten points selects nothing and puts the editor on nothing
  while the host's pick names what is there — a primary click on a note then does both; with the editor on, a right-click on the bare
  mat ends its lease and keeps the selection; the mat pinned, a right drag on a note and on the bare mat, a middle click and a middle
  drag on the note: the still byte-identical, no commit). The oracle's 115 stills byte-identical. `docs/api-reference.md` says it
  under `@ice/dom`.

## [0.14.0] — 2026-10-02

**The first publish since 0.11.0, and it carries M20 + M21 + M22** — the desk (design-015), the kit and the
pegboard (design-016/017), the tray refined (design-018). Neither `0.12.0` (cut 2026-08-31, `903f892`) nor
`0.13.0` (cut 2026-09-07, `40c9ae8`) was published to npm — the registry's `latest` is still 0.11.0 — so the
registry goes 0.11.0 → 0.14.0 in one step, and an upgrading consumer meets all three cuts' breaks. Their dated
sections stay below as history; the block below routes through them in the order an upgrade meets them, and this
section's `### Removed` is 0.14.0's own break list, export by export.

### Breaking, at a glance

From 0.11.0 an upgrade meets three cuts' breaks, in this order; each is spelled out with its migration in its own
section.

**First 0.12.0's — `WidgetSurface` is now `WidgetSurfaceKind`** (`[0.12.0]` › Breaking, narrowly): the
`"dom" | "gl"` union that types `defineWidget({ surface })`, renamed. The migration is ONE identifier, and a consumer
that passes `surface: "dom"` without ever naming the type is unaffected. 0.12.0's `### Added` and `### Fixed` do NOT
ship (`[0.13.0]`'s head says why).

**Then 0.13.0's — design-013 rebuilt the presentation layer in three phases** (`[0.13.0]` › Breaking, at a glance).
**Phase A**, where a card presents is a FACT, not a policy: `defineWidget({ presentation })` and the whole
`SurfacePresentation` family are RETIRED, and `@vibecook/ice/dom` loses the presentation registry and its policy.
**Phase B**, the ground IS the compositor: the old composited leg is deleted, and `compositedNextProfile` is now
`compositedProfile`. **Phase C**, the stratified ground is that same engine and `three` leaves `@ice/ground`:
`ground()`, `groundHost` and `GroundProgramDefinition` are deleted and **`groundField()`** replaces them, a canvas
type's ground `program` id is refused BY NAME, and `GridConfig` loses `spacings`, `fadeOut` and `levelWeight`.

**Then this one's — design-015 made the desk the ONE presentation:** every object under the camera is drawn by one
WebGPU renderer from the world, and the DOM lives only in screen space. What it replaced is deleted, not deprecated
— there is no compatibility alias — and it takes with it things 0.12.0 and 0.13.0 renamed, added or reshaped:
`WidgetSurfaceKind` (and `defineWidget`'s `surface` itself), `compositedProfile` with every profile, `./ground` with
the subpaths 0.13.0 gave it, core's `GridConfig` (the desk's grid is `/desk`'s own) and the ground's field
declaration (`presentation.ground`'s `glyph`, `grid`, `wires` and `guides` are refused by name; `ground: {}` stays a
bare marker). In the order an upgrade meets them:

- **`@vibecook/ice/r3f` and `@vibecook/ice/ground` are gone** (design-015 D5b — the desk is the one
  presentation), and with them the unpublished cuts' `./r3f/webgpu`, `./ground/compose`, `./ground/packs` and
  `./ground/engine`: the GL islands, `createGLBridge`, `<GLViews>`, the magnet field and the ground's engine. What
  the ground proved carries as law in `/desk`; an object under the camera is a desk KIND with its own pass.
- **`defineWidget` loses the DOM/R3F widget faces.** `surface`, `component`, `chrome`, `animated`, `preview`,
  `instancePreview` and `sizeMode` — and a container's `framePreview` — are REFUSED at definition: the JS caller
  TypeScript cannot stop gets a throw, not a silent drop. A widget's FACE is its `object` kind binding
  (`defineObject` in `/desk`); a widget without one is faceless. `WidgetSurfaceKind` and `SizeMode` are gone.
- **`three` is no longer a peer**, nor `@react-three/fiber`, and the `stats-gl` dependency is struck; `react` and
  `react-dom` stay optional peers. `pack:audit` walks every entry and fails on any `three`, `@react-three` or
  `stats-gl` edge.
- **Four new entries, nine in all:** `.` · `/kernel` · `/dom` · **`/desk`** (the renderer, `deskLayer`,
  `defineObject`, the kind registry, the theme) · **`/desk/engine`** (the raw-WebGPU engine) · **`/desk/objects`**
  · **`/desk/kit`** (the render kit the six kinds share, public for a plugin kind) · `/react` · `/devtools`.
  `/dom` is SCREEN SPACE only and gains `createDeskHost`.
- **`<InfiniteCanvas>` is `<Desk engine layer={deskLayer(…)}>`** in `/react` (`keymapOverrides?`, and `onReady?`,
  which may return a cleanup); its `ground`, `grid`, `glRoute`, `measureQueue`, `profile` and `chrome` props are
  gone with the planes they configured. The desk draws the selection's marks itself; `<SelectionMenu>` is the menu
  placed over them.
- **The six reference kinds and `DESK_ENGINE`** (`/desk/objects` — `/desk` names no kind): the note, the mini mat,
  the photo print, the whiteboard, the notebook and the calendar (`desk.note` · `desk.minimat` · `desk.photo` ·
  `desk.board` · `desk.notebook` · `desk.calendar`; `DESK_OBJECTS`), their default look (`deskPalette`,
  `deskTheme`) and the preset: `createCanvasEngine(DESK_ENGINE)` is the desk — `desk.select` in hand (a bare-mat
  drag pans, shift draws the marquee), the scale-free zoom, the plain wheel zooming about the pointer, the
  zoom-through on. They compile against the public entries alone, as a plugin kind does; `examples/desk-clock` is
  the third-party witness.
- **The pegboard tray** (design-016 K3 · K5, design-017, design-018): the widget tray is a drawer the desk draws.
  A kind hangs on it by declaring a `tray` entry on `defineWidget`/`defineObject`; a drag takes a copy off (one
  create transaction, one undo step); core's `openTray`/`closeTray`/`toggleTray`/`scrollTray` and
  `setTrayCategory`/`trayCategories` drive it, `/react`'s `<TrayBar>` is its handle and its category chips, and
  while it is open the desk under it is inert.

Every item above is spelled out with its migration: 0.14.0's in the sections that follow (its break list, export
by export, is `### Removed`), 0.13.0's and 0.12.0's in their own dated sections below.

**design-015 — the desk (M20), LANDED; ships as 0.14.0 (D-D17 — the version bump and the publish
are the release cut, not this ledger).** Every object under the camera is drawn by one WebGPU
renderer from the world; the DOM lives only in screen space. The ladder built the desk BESIDE the
old presentation and deleted the hybrid in one commit at D5b — `packages/r3f`, `packages/ground`,
dom's world-space half, core's surface infra, the profiles, the widget React binding, every app but
`apps/desk`. **0.14.0 BREAKS: the break list is the `### Removed` section below.** Everything under
`### Added` was additive when it landed; D5b is what turned the additions into the only way.

**design-016 — the kit and the pegboard (M21), LANDED; it rides the same 0.14.0 cut.** The rulers on the product's
desk, a GPU profiler, a public render kit the built-in kinds move onto (and into their own package), the 10,000-object
gates, and the pegboard widget tray. Its blocks below are headed `design-016 K<n>`.

**design-018 — the tray, refined (M22), LANDED; the same 0.14.0 cut.** James's visual round on the pegboard tray: the
board's edge in place of the cream rim, the holes seeing the desk under the board, specimens fading at the top edge, the
notch and the lip retired for a DOM `<TrayBar>`, and category filters — then (R4) a clear header under the edge, a longer
fade below it, and the filters as label tape on the header. Its blocks below are headed `design-018 R1/R2/R4`.

### Added

<!-- design-015 D1 (2026-09-25) -->
- **`@ice/desk`** (`packages/desk`, a private workspace package; the umbrella does not export it
  yet): the desk prototype (`vibe-field/draft/ground` at its 2026-09-25 snapshot) moved in —
  the raw-WebGPU engine (`src/engine`, byte-identical to `@ice/ground`'s), the lattice laws, the
  cutting mat (its gobo, the Sun and the Moon, the rulers, the shared lamp), the design-006
  flight and the portal chain, the MINI MAT (the desk's container), and the passes of the note,
  the notebook, the whiteboard, the calendar and the photo print; `ground.ts` is its composition
  root. Its Node oracle (`pnpm --filter @ice/desk oracle`, Dawn through tsx) renders the
  prototype's 38 scenes BYTE-IDENTICAL to the prototype's own renders, and its 20 checks (cut,
  continuity, sealed, lod, light, chain, night, ruler, paper) pass. Walls: `desk-only-core-kernel`,
  `nobody-imports-desk`, and `@ice/ground` ↔ `@ice/desk` never import each other.
- **`apps/desk`**: a parity page drawing every desk oracle scene through the engine in Chrome;
  `rig:parity` = Chrome vs Node at maxΔ 0 on all 38 scenes (a free-port CDP probe; a red scene
  needs a second witness). `gate:landing` now also runs the desk oracle, the `apps/desk` build and
  its `rig:parity`.

<!-- design-015 D2a-core (2026-09-25) -->
The desk's core half (design-015 §4.2 · §5 · §9): a widget can be a GPU OBJECT, and the
prototype's input conventions exist as settings. ADDITIVE — nothing breaks yet: every
`dom`/`gl`/`video` widget compiles, equips, mounts, stacks and transitions as before, every
default is today's, and nothing carries the new facts until an object or the new op puts them
there.

- **`surface: "object"` — a widget that is a GPU object** (`defineWidget`; design-015 §5.2,
  D-D16). `WidgetSurfaceKind` gains `"object"` — its own literal, not a `SurfaceKindValue`: an
  object carries no surface fact. `WidgetDef` gains `object?: unknown` (the kind binding —
  opaque to core, carried by identity for the desk's renderer to dispatch on through
  `widgetTypeFor`) and `stratum?: DeskStratum` (`"pads" | "sheets" | "things"`); `component`
  is optional so an object can omit it. The compiled `WidgetType` carries `object` and
  `stratum` (an object that declares none is a `"things"`). Refused at definition: an object
  without a binding, an object with a component / chrome / `animated` (`null` / `false` are
  the explicit "none"), a binding on any other surface, an unknown stratum, and an object that
  lists a behaviour writing `SurfaceTarget`. No standard surface behaviour is attached to an
  object. `defineContainer({ surface: "object", object, stratum })` makes a container object
  (the mini mat).
- **What an object gets, and what it does not.** Equip stamps its capability tags, its runtime
  behaviours, `WidgetEquipped` and a runtime **`Stratum { band }`** (pads 0 · sheets 1 · things
  2 — `STRATUM_BANDS`, `DEFAULT_STRATUM_BAND`), and NONE of the six surface facts, so Band /
  Demand / Residency never see it. A view widget that declares a `stratum` gets `Stratum` too
  (none does today). The cull classifies an object (`Visible`/`Culled` is the desk renderer's
  working set) but the mount store gives it no entry — no DOM host, no portal, no island, no
  transition retention. `@ice/dom`'s `widgetSurfaceKind` answers `undefined` for one.
- **`presentationPlanesOf(widget)`** — the planes one widget type presents on (the rule
  `prepareTransition` always applied, named: `gl` → `gl`, a component or chrome → `dom`) plus
  the object's: `["ground"]` alone. A nav flight out of a frame with a visible object now
  requires the `ground` plane.
- **Pick order is paint order across kinds.** `compareStackOrder` ranks by `Stratum.band`
  first (absent = things), then the sibling / StackZ order as before — so `pickTopAt`, the
  l1 frame tier, the drop target and every renderer sort put a pad under a note however the
  sequence is ordered. An all-dom board is one band and ranks exactly as it did (pinned
  against a verbatim copy of the old comparator).
- **The tape — `Locked` and `ops.setLocked(ids, locked)`** (design-015 §5.1, *Marks on the
  Mat* Q-e/Q-g). A durable tag (`tag:Locked` in the document: it syncs and undoes) with one
  writer: `ops.setLocked(ids: readonly Entity[], locked: boolean)` writes it on the current
  frame's widgets whose state differs in ONE transaction (one undo step, none when nothing
  changes) and refuses on a read-only document like every write op. A taped widget is never
  moved or resized by a gesture — moveClaim and resizeClaim give it no rider; the untaped
  members of its selection still move — and the marquee passes over it; it stays selectable
  and pickable.
- **The wheel mode** (`GestureSettings.wheel: "pan" | "zoom"`, `wheelZoomRate` — defaults
  `"pan"` and `0.0016`; `type WheelMode`; `createCanvasEngine({ settings: { gestures: { wheel,
  wheelZoomRate } } })`). `"pan"` is today's camera, byte for byte. `"zoom"` is the desk's
  law, the prototype's: a plain wheel's Δy zooms about the pointer by
  `zoom · exp(−Δy · wheelZoomRate)`, its Δx moves nothing, and a pinch zooms by the same law;
  CameraLimits clamps as ever.
- **`WheelZoomStep { ratio, anchorX, anchorY, tick }`** — this frame's WHEEL zoom (ratio > 1 in,
  < 1 out), written by `cameraControl` change-only (the step frame, one reset to ratio 1, nothing
  while idle), for the systems that run after it: design-015 §9's zoom-through is the first.
  Touch pinches, pans, flights and ops are not recorded.
- **`ToolRoute.canvasDragShift`** — the route of a shift-held canvas drag, defaulting to the
  tool's own `canvasDrag` (every existing tool routes shift as before). The desk's select tool
  is `{ canvasDrag: "pan", canvasDragShift: "marquee" }`: the bare mat pans, shift draws the
  marquee; space / middle / touch still pan above it.
- **Infinite zoom, end to end.** `settings.zoom: { min: 1e-8, max: 1e8 }` (design-015 §9's
  `ZOOM_MIN`/`ZOOM_MAX`) holds through the desk's wheel, `ops.zoomTo`, `ops.zoomToFit` and a
  nav flight in and out: the camera stays finite and invertible at 1e-7 and 1e7 and returns
  home. One fix rode it: the kernel's `flightCamera` tested "equal zooms" with an ABSOLUTE
  1e-12 on 1/zoom, which near zoom 1e-8 let two zooms a few ulps apart through to the anchored
  form and threw the view centre up to 4× past its endpoints; the test is relative now, and
  every flight whose zooms differ takes the same path as before.

<!-- design-015 D2a-render (2026-09-25) -->
- **The desk's kind registry** (`@ice/desk`; design-015 §4.2, and §5.2's render half): the desk's
  composition root (`ground.ts`) names no kind. A kind registers a `KindProgram { name, stratum,
  create }`; its `KindPass` (`spawn`, `tune?`, `prepare(encoder, SlotContext, records, KindExtra)`,
  `drawRange`, `drawOver?`, `dispose`) is prepared per slot and drawn in ranges.
  `Ground.create({ device, canvas, mat, kinds })` takes the registry; `SlotInputs.objects` (`{ kind,
  record }` in paint order) replaces the per-kind lists, and a portal's `at` indexes it; the draw walks
  the strata (pads · sheets · things — the literal set of core's `DeskStratum`) and cuts each into
  runs of one kind, one draw per run, a sheet with a live inside splitting its run (the inside, then
  the sheet's marks over it). `GroundStats.kinds` counts the root's records by kind name. The note,
  the mini mat and the whiteboard are kinds by thin adapters (`@ice/desk/kinds`: `DESK_KINDS`,
  `deskKinds(text)`), their shaders untouched. The oracle builds its root slot from the registry and
  renders its 38 scenes byte-identical to D1's; Chrome = Node at maxΔ 0 on every one.

<!-- design-015 D2a-world (2026-09-25) -->
- **The desk renders, picks and idles FROM THE WORLD** (`@ice/desk`; design-015 §4.4–§4.6, §5.2's
  world half). A kind is whole: `ObjectKind<G, R, L>` extends D2a-render's `KindProgram` with
  `resolve(ctx) → G`, `record(G, ctx) → R`, `hit(G, wx, wy) → "content" | "frame" | part | null`,
  `reach`, `reads?`, `theme?(palette, name)`; `ObjectContext` hands it the entity's CENTRED rect
  (`rectOf` — ICE's top-left `Position` + `Size` converted in one place), its props, the flux
  (`lift · hover · ring · fade`), its look, the lamp, the slot's view, the grid, dt and a host-pinned
  asset. `paperKind()` and `minimatKind()` wrap the D2a-render programs (`@ice/desk/kinds`);
  `defineObject(def)` (`@ice/desk/object`) compiles an object through core's `defineWidget({ surface:
  "object", object: kind, stratum: kind.stratum })`; `Note` (`desk.note`: text · pen · paper · seed)
  and `MiniMat` (`desk.minimat`: name · vinyl, a container accepting both, its portal the face insets)
  are the reference objects (`@ice/desk/objects`). The object colours are the app's: a kind's
  `theme()` reads `papers`/`pens`/`vinyls` off the palette.
- **The builder, the pick source, the ambient, the reflector** (`@ice/desk/compose`, DOM-free).
  `createDeskBuilder(world, { objects })` turns the current nav frame's Active objects into
  `SlotInputs.objects` in paint order (`compareStackOrder` — stratum first — the `Grab` set last),
  culls by rect ⊕ `reach` against the view ⊕ 200 CSS px, runs the springs per entity outside the
  world and SNAPS each when settled, keeps a deleted object's GHOST fading 220 ms in its last paint
  position, caches every fact per entity and refreshes it from a `coarse: false` change journal
  (`changed()` pulls; `wakes()` names the reason); pins by entity — `pin(e, asset)` (a committed
  raster) and `pinFlux(e, { lift | hover | ring })` (a still's `held`, never a `Grab`) — outlive a state
  the builder has not made yet. `createPickSource(builder)` mirrors the kinds' `hit` on the same
  geometry the pass drew: `undefined` before geometry (B9), `"outside"` on a miss, `pad` the widest
  reach. `createAmbient()` is the wind that idles (§4.6, D-D9): `live | idle | still`, the wind's
  SPEED easing to 0 over `settleMs` after `idleMs`, the tilt follower snapping WITH the wind (a filter's
  tail is not a frame), reduced motion ⇒ still, `pin()` for a parity still. `createDeskReflector()`
  paints only on pulled dirt (`always: true`, early-out — no `getCurrentTexture`, no submit) and
  `instrumentSubmits(device)` proves it.
- **`deskLayer(opts)` and the desk app** (`@ice/desk/host`; apps/desk). The layer factory is
  structurally a react `GroundLayerFactory`: it inserts its canvas before the content plane,
  acquires its OWN device, compiles the ground from the catalog's object kinds, sets
  `framePick.current` and clears it at dispose; its handle carries the parity hooks (`pinMat`,
  `pinRaster`, `pinFlux`, `clearRasters`, `clearFlux`, `setPlate`/`setNoise`/`setGlyphs`,
  `configureMat`) and the instruments (`submits`, `stats`, `wakes`, `geometryOf`, `fluxOf`,
  `lastInputs`, `dirty`). `@ice/react` gains one additive prop, `chrome?: boolean` — `false` skips the
  P4 DOM selection reflector (the desk draws its own). `engine/device.ts`'s DOM touch moved to
  `host/surface.ts`: `desk-dom-free` is true and gated. apps/desk is the real desk (React 19: `w` a
  note, `m` a mini mat, ⌫, ⌘Z/⇧⌘Z, `d` the theme), D1's parity page kept as `parity.html`
  (`window.__parity`); `window.__desk` is the rigs' door. Witnesses in `gate:landing` after
  `rig:parity`: `rig:world` — every mat, ruler and paper oracle scene spawned as entities through
  `setScene` and drawn by the real reflector path = the Node render at maxΔ 0 (20/20);
  `rig:interact` — select → ring, hover → a mini mat rises, drag → one undo step, ⌫ → a 220 ms ghost,
  shift-drag marquee, the wheel `exp(−Δ·0.0016)` about the pointer, a bare drag pans (24/24);
  `rig:idle` — 0 submits over 240 frames after the ease (10/10).

<!-- design-015 D3r-a (2026-09-25) -->
- **The photo print is a desk kind; the prints and the whiteboards have pixel witnesses** (`@ice/desk`;
  design-015 §4.2, §5.2): `photoProgram(text)` · `PhotoKind` · `PHOTO_KIND` (`"photo"`, stratum `things`,
  registered in `DESK_KINDS` after the whiteboard). `PhotoPass` gains `spawn(mat)` (a slot's own buffers on
  the shared pipeline, samplers and pictures), `tune(from)` and `drawRange(first, end)` over the prints it was
  handed — the prototype drew its prints in a render pass of their own after the ground's; the desk draws them
  as runs in its one pass, byte for byte the same. A print inside a mini mat's face is lit by the lamp of the
  desk the mini mat lies on (`prepare(…, lit)`, a `LIT_ELSEWHERE` pipeline override as the note's; a print on
  the root draws exactly as before). Pictures stay the pass's resources: a record names its `Picture` (null =
  the paper alone). The Node oracle gains twelve scenes — prints at rest, held, by night, stacked, far off,
  between two notes and inside a mini mat; whiteboards at rest, with a replayed stroke list, selected, by
  night, close — from a committed picture (`tools/make-photo-fixture.mjs`), and a check for each (`photo`,
  `order`, `board`, `ink`, `ring`, `lit`). apps/desk: `rig:parity` holds all 50 to Chrome (three inked-board
  scenes kept within a named, measured 1-LSB bound: the two hosts' Dawns quantise six of the ink raster's
  stamp texels differently), and `rig:proto-parity` (new; `DESK_PROTO` = the frozen snapshot) holds the ten
  stageable ones to the prototype's own photo lab and board bench, byte for byte. The 38 D1 scenes unchanged.

<!-- design-015 D3r-b (2026-09-25) -->
- **The notebook and the desk calendar are desk kinds** (`@ice/desk`; design-015 §4.2, §5.2's render half):
  `notebookProgram(text)` · `NotebookKind` · `NOTEBOOK_KIND` (`"notebook"`, stratum `things`) and `calendarProgram(text)` ·
  `CalendarKind` · `CALENDAR_KIND` (`"calendar"`, stratum `pads`), registered in `DESK_KINDS` after the photo print (the
  calendar first — the prototype's lab rendered the pad's layer before its frame and the books' after it). Both are LAYERED:
  their pass renders every one of its objects into a target of its own in `prepare` — the books' shadow maps and 4× layer,
  the pads' 4× layer — recorded into the frame's command encoder after the mat's wind, and lays it in one draw. The registry
  gains one notion, `KindProgram.composite`: the ground draws such a kind as ONE run after every other run of its stratum (so
  the books lie over every other thing — a note laid on a notebook draws under it, the named limit — and the pads under the
  sheets and the things, as the prototype drew them). Both are ROOT ONLY (D-D18): a spawned slot's pass draws nothing. The
  law and the product's look are the host's (`kind.law`, `NotebookKind.ruleInk`, `CalendarKind.alpha`); the pad's print stays
  the host's Canvas 2D raster (`kind.pass.uploadTile/writeTable`). `NotebookPass` gains `layer(encoder, size, dpr)` ·
  `composite(pass, scissor?)` · `screenBox` (`render` is their composition), `CalendarPass` the same (`renderLayer` and
  `underlay()` unchanged). The Node oracle gains nine scenes — a closed book, an open spread, a book held, a book over a
  note, a book by night; the whole pad, rolling, with two notes stuck to days, by night — built as the prototype's main lab
  builds them, the pads without their print; four checks (`book`, `bookOrder`, `pad`, `padNote`) and an error-scope probe
  over the desk's creation and every frame (in apps/desk's parity page too). `rig:parity` holds all 59 to Chrome (the nine
  new at maxΔ 0); `rig:proto-parity` holds them to the prototype's own main lab, byte for byte (and drives the parity page
  again — it had thrown since D2a-world moved it to `parity.html`); `rig:cost` (new) re-measures NOTEBOOK.md §9 and
  CALENDAR.md §9 through the registry beside the prototype. The 50 existing scenes unchanged.

<!-- design-015 D2c (2026-09-25) -->
- **A note's writing is data, its ink a cache, and typing a gesture** (`@ice/desk`, `@ice/core`; design-015
  §6.1, D-D13). The note (`desk.note`) gains `seeds` — each glyph's own hand, base64 of little-endian u32s
  (`encodeSeeds`/`decodeSeeds`/`seedsFor`; a glyph with no stored seed writes `glyphSeed(seed, i)`, a new
  note's hand) — and its `text` and `seeds` are ONE conflict group, `ink` (`NOTE_INK`): one cell, written in
  one transaction. Core gains `Editing` (catalog/desk.ts), the runtime rider the one focused editor stamps on
  the note it writes; `makeDefaultMayDiverge` reads it as a gesture claim. `createNoteTyping({ world, docs })`
  (`@ice/desk/objects`) is the session: `begin` (the claim) · `input(value)` (the seeds carried, the cell
  written LIVE through the guarded live writer) · `commit()` (ONE undoable transaction; a session that nets to
  nothing — the same text in the same hand — commits nothing and puts the cell back exactly) · `end()`. So ⌘Z
  undoes a typing session, never a keystroke, and a remote edit during a session follows strata's claimed-cell
  rule (dropped while the cell diverges, lost to the session's commit; applied when the session nets to nothing).
- **The text raster seam and the writing** (`@ice/desk/kinds`). `TextRaster` — `metrics(face)` (undefined
  while the face loads), `version()`, `raster(layout, face, box, band, bleed) → r8` — is what the paper kind
  calls; `inkRaster({ faces: penFaces({ caveat, "caveat-bold", kalam }) })` (`@ice/desk/host`) is the
  browser's, the prototype's lab/ink.ts on an OffscreenCanvas with the app's face URLs; the Node oracle has none
  and keeps its committed raster. `createWriting()` is the paper kind's own state on one desk: layouts keyed by
  the face, its version, the hand's law, the size, the seed, the text and its seeds; rasters keyed by the layout,
  the √2 band (`rasterBand`, hysteresis) and the bleed — re-rastered on an edit or a rung crossing only, only
  within 200 CSS px of the view; residency in the paper pass's shelves (a new size frees the old rect, a note
  that leaves the desk gives its rect back, full pages evict what no one drew in two frames, else the sheet
  draws blank and `stats().blanks` counts it); a pinned still wins; the 110 ms wipe and the 530 ms caret as
  flux. The kind contract gains `ObjectKind.local(host) → KindLocal` (threaded as `ObjectContext.local`,
  `tick(now)` and `forget(e)`), and `createDeskBuilder` takes `locals` and tells them when an entity is
  forgotten — which closes the page-slot leak across delete/undo. `InkShelves.trim()` gives back a layer's
  trailing empty rows.
- **The one focused editor** (`@ice/desk/host`): `createNoteEditor()` — one invisible platform `<textarea>` in
  screen space (transparent text, caret and selection, no pointer events, design-007's `data-canvas-keyboard`
  claim), placed each frame over the note's drawn geometry by one plain transform (translate · rotate ·
  translate). A tap (within the drag slop, on the stack's exact hit) focuses the note with the caret at the tap;
  `input` writes live; 1 s without input commits the session; Escape, blur, a press elsewhere, a delete or a nav
  cut end it. `deskLayer` takes `text` (the app's raster), `docs` (the document typing commits into) and
  `idleMs`; its handle gains `writing()`, `editor()`, `typing`; the drawing reflector gains the `ink` wake.
  apps/desk ships the OFL faces (Caveat 500/600, Kalam 400, with OFL.txt), joins a `?room=` over a
  BroadcastChannel, and adds `window.__desk.note`. Witnesses in `gate:landing`: `rig:sticky` (35 — the text
  raster = the committed ink-note-1.r8 byte for byte; a note written live = its committed still at 0 px; the
  editor's rect = the sheet's; live keys, the wipe, the blink alone at rest; the caret at the tap; the hand-off
  at 0 px; one ⌘Z per session; the ladder re-rasters at crossings only; delete while writing; no page leak; IME)
  and `rig:two-tab` (10 — a typed note crosses a room only when its session commits, with its seeds).
  `rig:interact`'s delete presses Escape first: a tap now writes.

<!-- design-015 D2b (2026-09-26) -->
- **The mini mats' nested desks and the flight, FROM THE WORLD** (`@ice/desk`, `@ice/core`; design-015 §9,
  MINIMAT.md §3–§5, PORTAL.md §2.4 · §8 · §9; the plan's D2b). A container drawn in a slot gets its INSIDE:
  its `ChildOf` children (cached against strata's per-parent order stamp, sheets before things), their
  bounds as the content, the view through the kind's own `face(G)` (`insideViewOfFace` — the flight's
  numbers, so the far LOD and the live inside agree to the bit), the children as their kinds chip them
  (`chip(G, ctx)` — a note as paper with its writing greeked: the still's pinned lines, else the hand's
  own layout; a mini mat as vinyl with its border; ≤ 64 per face) — and, past the gate (presence > 0 on
  the face's short side, 140 → 220 CSS px; depth < 4; the 16 largest faces first), a LIVE slot: the
  children built under the inside's camera at rest, recursing (the belt of 4; the ground's chain of 6).
  `ObjectKind` gains `face?`, `chip?`, `insideGrid?`; a container's `record` receives `ctx.inside
  { content, view, chips }`. THE FLIGHT: the departed desk from the frame's `Retained` widgets in sibling
  order under `departedCameraOf` — an enter as ONE tree through the face (`at` = the container's row), an
  exit and a frozen flight as two whole slots — with `flightPresent`/`flightLights` (the opacities, the
  lamp HANDOVER), the arriving desk dressed for its landing (`c1z`), the departed for the cut (`fromZ`).
  The CUT FRAME holds every spring (D-D2b.7): while the flight sits at p = 0 the departed desk IS its
  pre-cut frame. Ghosts go with the frame (a nav cut drops them; they fade on the frame's own clock).
- **The nav geometry SEAM — the desk is the authority on its containers' faces AS DRAWN** (design-015 §9's
  found subtlety): `stack.navGeometry.current: NavGeometrySource` beside `framePick`; `face(container,
  cam) → NavFace { face, arrival, affine, camera, presence, covers(px) }` — as drawn when the container is
  in the frame this frame (a held mini mat's face reads 2 % larger), at rest when it is not. Core's nav
  reads it first (`resolveNavFace`; `fallbackNavFace` — the static portal rect, the default framing, a
  sharp-cornered cover test — for every app that mounts none): `enterContainer` starts the flight from the
  seam's exact camera and lands on ITS arrival (an empty desk's is the prototype's, centred on its origin
  at zoom 1 — D-D2b.2); `exitTo` composes the chain from the seam's faces. `NavOpts` gains `face`,
  `arrival`, `c0` (an op's own word) and `transition: "cut"` — no motion, landing on the CONTINUITY camera
  (c0 in, the solve out), the zoom-through's cut (`"none"` still lands on the arrival). `NavCamera.zoom`
  is f64.
- **The enter GESTURE and the ZOOM-THROUGH are core's.** `navTap` (after `selectBehavior`): a double-tap
  on a container asks to enter, on the bare frame to leave — two INSTANT taps within
  `multiTapWindowMs`/`multiTapSlopPx` (`NavTapMemo`), not a `MultiTap(2)` opt-in, which would delay the
  first tap's selection by the window (D-D2b.1). `zoomThrough` (after `cameraControl`; reads D2a-core's
  `WheelZoomStep`): a wheel zoom in that leaves the topmost Active container's face at presence 1
  covering the view by `in` px cuts into it; a wheel out that leaves the frame's face short of covering by
  `out` px cuts back out; no cut while a flight drives; a touch pinch never cuts (D-D2a.6 → D-D2b.5).
  Ops are structural, so both write the one-tick `NavIntent` and the facade applies it on the ENGINE's
  new `afterStep` hook (D-D2b.4 — a host loop may drive the raw engine); a zoom-through cut states
  `NavRedress { kind: in|out, from, frame, epoch }`, and the desk re-dresses over 320 ms in log space
  with the lamp on the same ramp. `settings.nav.zoomThrough { enabled, in, out, gate }` seeds
  `ZoomThroughSettings` (`ZOOM_THROUGH_DEFAULTS`: off, 2, 6, [140, 220]); the desk turns it on. react's
  keymap: ⏎ enters the one selected container, Esc leaves the frame when no gesture is live to cancel.
- **Drop-into goes through the portal affine** (design-015 §9, D-D6, D-D18): an all-object drag's
  candidate is the topmost container whose FACE holds the set's CENTRE (`l3-drop`); at the release the
  object lands at `(n − M.o) / M.s − size/2`, its size kept — it takes the inside's scale; ⌥ held keeps it
  on this desk; a non-accepting container is scenery, never a fly-back; `interaction.drop: "into" |
  "never"` (`"never"`: no `Provides`, and read off the compiled type — D-D18's kinds). View widgets keep
  every rule they had.
- **The desk layer** fills the seam at mount, gains `pinGreek`, `setPortals`, `pinLodZoom`, `freeze`,
  `holdRedress`, `navFace`, `insideViewOf`, `flightCameraAt`; the reflector composes the nested inputs
  (the entered mini mat's inside grid at depth > 0, the portals, the departed slot, the presentation,
  the light, the dressing) and wakes on `NavRedress`. apps/desk: `setScene` spawns every inside as
  children and flies a nav scene for real (the still drawn once so the face is as drawn, then the op, the
  flight PINNED at p by a system after `navFlight`); `window.__desk` gains depth/flight/enter/exit/
  pinFlight/pinRedress/freeze/redress/portals/navFace/insideView/taps, `DeskEntity.parent/active`;
  `t` cycles the selected mats' vinyl. Witnesses in `gate:landing`: `rig:world` now draws the minimat,
  chain and nav scenes (38/38 at maxΔ 0); `rig:portal` (the live counts; THE CUT — the frame before the
  flight and its first frame the same PNG, the flight from the seam's camera; the landing shows the
  inside's own mini mat live; the exit lands on the saved camera with the same PNG as before; a mini mat
  laid inside shows its inside; the gate 0 → 0.63 → 1; the zoom-through in as the same PNG, then by a
  real wheel with the `NavRedress` fact, and out; live insides off/on; the quiet loop); `rig:nav` (the
  nav scenes as stills; a live flight — the camera flies, held midway both desks draw, the landing exact,
  the loop quiet; the exit lands back exactly; a wheel mid-flight yields; a real double-click flies in
  and out; THE PRESS + DOUBLE-CLICK CUT — a HELD mini mat double-clicked, the flight from the face as
  drawn, the same PNG); `rig:interact` gains drop-into, ⌥ keeps it, the vinyl key.

<!-- design-015 D4a (2026-09-25) -->
- **The desk's chrome is drawn by the renderer** (`@ice/desk`; design-015 §7, *Marks on the Mat* v2 — Q-a…Q-k):
  a MARKS pass, stratum 5, ONE instanced draw of SDF records in the ROOT's pass after every stratum (the composites
  included), in SCREEN px — the chrome keeps its size at every zoom. `GroundOptions.marks` (its shaders:
  `marksShaders(text(MARKS_SHADER_FILES))`) and `GroundFrameInputs.marks` (a `MarksInput`). The page's reference drawing
  code, number for number (`MARKS` in theme.ts, with every ink's token): focus BRACKETS in the pencil #79B5F8 over a cast
  keyline — 6 px out, reaching 16 (≤ 30 % of a side), 1.5 px, the 1-device-px hairline at 42 % between them, the corner
  r + 6 ≤ 10; the lock-on from 8 px further out on `--vf-ease-lift` (180 ms), the leave 120 ms; ONE ring under 24 px on
  screen; knobs (7 px) only where the object resizes; several = member ticks (4 out, reach 8, 62 %) under ONE union 10 px
  out, square to the mat; the VELLUM marquee (cream 11 %, 7 % cool by night, its pencil edge, corner brackets, the count
  by the cursor) folding onto the union in 240 ms on the island ease; the LASER snap guides (added light: bloom
  9·5·2.6 px at 7·16·32 %, the #FF4FA3 line and #FFD6EA core, 14 px past the aligned objects, faint wall to wall, flares at
  the aligned corners, centres dotted, a 160 ms strike at 1.8×) with the equal gaps in 10 px mono laser pills (the rulers'
  own glyph atlas); your extent on the rulers in pencil; masking TAPE on a taped object (the object's attachment: it zooms
  with it and is moonlit by night — the pencil and the laser are light and are not). The kinds' own selection ring retires:
  the builder hands them ring 0, so a selected object's pixels are the unselected object's (`ObjectKind.frame?` — each
  kind's silhouette as drawn: `paperFrame` · `miniMatFrame` · `boardFrame` · `photoFrame`; the notebook's and the
  calendar's come with their world halves). `assembleMarks` is ONE rule set shared by the builder (`compose/marks.ts`: the
  facts read — `Selected`, `Locked`, `Grab`, `Resizable`, core's `GuideLine`/`SpacingBar`, the marquee preview (the ground
  layer's new `readMarquee`), the gestures, `Editing` — the flux stepped and snapped: lock-on, leave, union, fold, strike,
  the tape's press and lift, and the tape's GIVE, a drag that meets tape shivering the object 2.2 px for 360 ms) and the
  Node oracle's stills. The desk handle's `selection` publishes the anchor a menu is placed from.
- **`<SelectionMenu>`** (`@ice/react`): the ONE screen-space element (design-015 §2), placed from the desk's anchor by one
  plain `translate()` — 10 px above the marks, flipped below under the rulers' band, 16 px from the sides — stepping aside
  for any gesture and while a note is being written (90 ms out, back 200 ms after). An app-extensible list of acts
  (`SelectionAction`): ICE ships Duplicate (not for tape), Tape it down / Lift the tape, More (every act with its key) and
  Delete past a rule, red only under the pointer; the §13 glyphs as inline SVG; the tray's ink as CSS custom properties.
  apps/desk adds a stub Send first. `placeSelectionMenu`, `defaultSelectionActions`, `SELECTION_GLYPHS` exported.
- **The desk's keys and the tape** (`@ice/core`, `@ice/react`): ⌥ as a move starts leaves a copy where it lay, just under it,
  in the move's one transaction (`LeavesCopy`, `CommitCreate.order`); ⌘ held holds the snap off; ⇧ locks the drag to its
  dominant axis and the snap corrects along it alone (`systems/drag-mods.ts`); ⇧⌘L tapes the selection or lifts the tape
  (`toggleTape`); arrows pass a taped widget over (`nudgeSelection`, exported — apps/desk binds ⇧ to one lattice cell, 20);
  Clean Up flows around tape; a taped selection shows no grips; a copy of a taped widget is untaped. Witnesses: 13 Node
  marks stills + board-selected with the `marks` check (maxΔ 0 outside the marks' band by their CPU mirror, the pencil's
  byte where a stroke is solid, knob faces, laser pills) and `unlit` by night; the D1 stills with a selection keep their
  prototype pixels under `prototypeRing` (BASELINE_DIR); `rig:parity` Chrome = Node; `rig:world` the brackets FROM THE
  WORLD at maxΔ 0; `rig:interact` 42 (brackets not a ring, the menu 10 px above and away during a drag or while writing,
  the laser on a snap, the vellum and its fold, the tape's give and the marquee passing it over, ⇧⌘L).
  Over D2b: the marks are the ROOT slot's (a live inside and the departed desk add none), so inside an entered mini mat
  they are the inside's, under the entered camera, and `rig:interact` (47) selects a note inside one to witness that.
  Core's enter clears the selection, so the brackets leave at the cut. `rig:nav`'s press + double-click cut now holds
  the cut frame to the pre-cut frame outside the selection's marks band (by their CPU mirror). `rig:nav` and
  `rig:sticky` leave the DOM menu out of their captures, as `rig:world` does. `rig:proto-parity` draws a still that
  has a selection the prototype's way (the parity page's `prototypeRing`), as the oracle's BASELINE check does.

<!-- design-015 D3w (2026-09-25) -->
- **The whiteboard, the photo print, the notebook and the desk calendar from the world, at rest** (`@ice/desk`;
  design-015 §5–6, D-D5, D-D12, D-D18). Each kind gains its WORLD half beside its render half — `boardKind()`,
  `photoKind()`, `notebookKind()`, `calendarKind()` (`@ice/desk/kinds`: resolve · record · hit · reach · theme · local) —
  and each an object through `defineObject` (`@ice/desk/objects`; all six in `DESK_OBJECTS`): `desk.board { cap, tip }`,
  `desk.photo { blob, width, height, border, angle }`, `desk.notebook { title, cover, ruling, seed, spread, angle }`,
  `desk.calendar { month, weekStart, tape, pen }`. Each world half's records are the Node oracle's own for the same
  object, number for number (units hold them to `oracle/frame.mjs` on a stub device); hits go through the geometry the
  pass draws — the notebook's and the calendar's through the SAME desk eye (the geometry carries it). The colours are
  the palette's (`BoardPalette`, `NotebookPalette`, `CalendarPalette`); the notebook's ruling ink and the calendar's
  print presences reach their root pass through the kind's own state. At rest: a board's hover is the cursor's, a
  print's edge lifts 2.2, a book rises 3.5, a pad is carried by its TAPE (its paper is not taken: a press there pans);
  a deleted notebook is gone at once (its ghost's record is kept out of the pass).
- **Data children** (design-015 §5.1, D-D5): a board's strokes and wipes are entities `desk.stroke { tool, ink, tip,
  erase, points, speed }` `ChildOf` the board — `points` base64 of LE f32 (x, y) pairs — laid by `addStroke(tx, board,
  spec)`, one transaction a stroke, and the board's ink is a CACHE of them (`BoardInk` replays when their order stamp
  turns or the look changes; `boardOps` = the bench's `sketch`); a pad's events `desk.event { start, end, text, seeds,
  ink }` and pins `desk.pin { day }` + the relation `desk.pins` (pin → note) are children of the pad (`addEvent`,
  `pinNote`, `daySlot`; read-only in this slice). The kinds read them through the host (`KindHost.children`,
  `worldChildren`), never the world.
- **A print's bytes and its carry** (D-D12): the app provides a content-addressed `BlobStore` (`put` → SHA-256 hex,
  `get`; `createMemoryBlobStore`, `hashBytes`, `RGBA_TYPE`); the photo kind fetches a print's blob the first time it
  meets it and makes ONE pass `Picture` per blob, dropped with its last print — raw RGBA by itself, anything else through
  the host's decoder (`decodePicture`, `@ice/desk/host`). A print is not core-movable: `createPhotoCarry` holds it on the
  finger (the kinematic pin), lets it go with the finger's last 70 ms (capped 4200 u/s) and the kind steps its body
  through the air and the mat's Coulomb grip at 240 Hz — flux, the document still — then commits ONE transaction when it
  comes to rest (its Position and its raise). `deskLayer` takes `blobs`; its handle gains `local(name)` (a kind's own
  state: a still's pose pins — `Prints.pin`, `Books.pin`, `Pads.pin`, flux, never a Grab — a print's body and flick).
- **Over D2b and D4a** (the integration). The kinds' own selection ring is retired: a selected board, print, notebook or
  pad wears the desk's BRACKETS, and the oracle retires the notebook's ring as well (`bookOf`; `prototypeRing` keeps the
  lab's). Each world half hands the marks its silhouette (`ObjectKind.frame`): `boardFrame` and `photoFrame` (D4a's),
  `notebookFrame`/`bookFrame` (the case's FOOTPRINT on the mat at its turn; open, the whole spread) and `calendarFrame`
  (the sheet, square to the mat). The oracle's marks read the same functions, and books and pads now take part.
  A whiteboard RESIZES (`resizable: true`): the knobs D4a draws on it are core's handles, and its world half is drawn
  from its rect, so its ink replays at the new size. The whiteboard, the notebook and the desk calendar are ROOT objects
  (`interaction.drop: "never"`, D-D18): no container takes one. A TAPED print answers a press-drag with the tape's
  give: the carry refuses it and tells the marks (`PhotoCarryOptions.refused` → `DeskBuilder.meetTape`). The selection
  menu stands over each kind. `setScene` goes through D2b's recursive spawn, so its things nest: a print lies inside a
  mini mat, while a board, a notebook or a pad inside one is refused (D-D18). New marks stills: `marks-book-z2.2` and
  `marks-pad-z0.42`.
- apps/desk: `W` a board, `b` a notebook, `C` a calendar, paste or drop an image for a print; `setScene` stages every
  board, print, notebook and pad scene (strokes and pins as children, poses as flux pins); `window.__desk.kinds`.
  Witnesses in `gate:landing`: `rig:world` 38 → 61 scenes from the world (58 at maxΔ 0; the three inked boards kept
  within rig:parity's named 1-LSB bound). Its new rows: every board, print, notebook and pad still, a print inside a
  mini mat lit by its host's lamp (photo-inside-z1), a selected book and a selected pad. `rig:interact` 47 → 102: each
  kind's select (its brackets on its own frame, its menu above them), hover, drag with its lift and one undo step,
  delete and ⌘Z; a board's stroke child and its knob's resize; the print's flick landing where `stepPhoto` over the
  desk's own steps lands it, its Position changing once; a taped print's give; a board let go over a mini mat's face
  staying on the desk.
- Owed: a print's drop-into. A print is not core-movable (its carry is its own, D-D3w.4), so a print let go over a
  mini mat's face stays out until the carry learns the face (prints do nest: a scene lays one inside). A print's
  resize: the oracle draws D4a's knobs on a selected print, but a print's extent is its picture's aspect, not its
  Size, so it stays `resizable: false` and wears none from the world. A resize lifts a board (core's `Grab` is also the
  carry's, and a board reads it as its lift).

<!-- design-015 D5a (2026-09-26) -->
- **The exit tests the retired apps carried, moved onto the desk BY NAME** before anything is deleted (design-015 §11.6;
  docs/implementation-plan.md's cross-cutting rule: every design exit test lives in CI). **M5** graybox `two-tab` →
  `rig:two-tab`'s nine rows "M5 two-tab convergence": graybox's assertions re-aimed at desk objects through two real tabs
  on `?room=` — a note spawned crosses where it lies; a real drag moves it live in A with nothing crossing, lands as ONE
  commit, and B converges exactly; ⌫ deletes it in both; ⌘Z in A restores it in both (same key, place, hand); a mini
  mat's inside is edited (the note dropped into it) and B has it inside and draws the inside; ⌘Z takes it back out in
  both. **M8** nodeboard `cascade` + `port-churn` → `packages/core/test/m8-cascade.test.ts` and `m8-port-churn.test.ts`
  on core alone (nodeboard's rig minus the app, its node types as desk objects); port-churn is one row stronger — the
  spawn observer runs from the first frame (nodeboard's attached after boot, so a select tool lighting every visible
  port went unseen). **M9** nodeboard `collab` → `apps/desk/test/collab.test.ts` (two desk engines as the app boots
  them, over nodeboard's Bus and fake clock: the seeder's desk — notes and a mini mat with an inside — converges key for
  key and a new note crosses; A's cursor and a one-object selection project onto B and B derives the `CursorVisual
  "remote"`; the boot in a room touches no storage) and the live **`rig:collab`**: two tabs through the ws relay the
  rig starts itself (`pnpm relay`'s server on a free port) converge on an add, a real drag and a delete, and each SHOWS
  the other's cursor at the peer's world point through its own camera (to 0.5 px, before and after a pan). **M10**
  moodboard `exit-imports` →
  `apps/desk/test/exit-imports.test.ts`: apps/desk imports only THE SURFACE — exactly what it imports today, each entry
  one its package's `exports` publishes — ONE constant on one line, so the umbrella rename is a one-line change.
- **Retired with their subject, by name** (recorded in M20, not dropped): **M6** cardboard `exit-trace` and
  `cull-reenter` (the DOM widget runtime: naive handlers composing per the pinned contract, React state kept across
  cull/re-enter — there is no DOM widget left to trace) and **M7** glboard `gl-router` (the GL islands' first-tap router
  path — there are no islands).
- **A room's other people are `@ice/dom`'s remote cursors** (design-015 §1/§3 keep dom's screen-space half): a peer's cursor
  is screen-space DOM positioned from its world point through this desk's camera, in the peer's presence colour with its
  name on a chip — the reflector `<InfiniteCanvas>` already mounts (`chrome={false}` gates only the P4 chrome), fed by the
  presence the desk now joins with. Nothing of a peer is drawn in the marks pass: a GPU remote hand and a peer's
  selection brackets were built and REVERTED in their own commit (the brief's ruling D-D5a.1 is dropped — the design
  outranks it). Agent presence (the *Marks on the Mat* agent hand and page flag) is a later slice. The presence palette —
  violet and the warm hues, none a green of the mat's nor the pencil's blue — is the product fixture's `PRESENCE_INKS`.
- **The desk joins rooms with presence** (apps/desk `joinDeskRoom(engine, opts)`): `?room=`, `?relay=ws://…` (the ws
  relay — core's `webSocketByteChannel`), `?name=`/`?color=` (an identity; else one drawn from the presence palette), an
  injected channel and clock for the units. In a room nothing reads or writes storage.
- **The last prototype harnesses** (design-015 §11.3): **`rig:ruler`** — ruler.mjs's check rows on a live frame: the
  atlas up; ink in both bands on every `ruler-*` still and up a zoom ladder through one decade, each band ALSO held to
  the same frame bare (the harness's own bar was cleared by the mat's lattice alone — the red proof found it); a 7 px
  pan moving the print's brightest tick 14 device px; the label mirror = the root mat's uploaded ruler uniforms, and 11
  labels 100 px apart at zoom 1; rulers off. **`rig:cost`** gains the mat's rows (MAT.md §5, day and night) and the
  rulers' (RULER.md) beside the records. **The zoom sweep** (zoom.mjs) as world stills: `zoom-z{0.11…1.5}` (the product's
  fade-in window, the 0.99 → 1.01 decade wrap among them) and `zoom-sparse-z{0.2,0.99,1.01}` (a still may state its
  `fadeIn`), drawn from the world by `rig:world`. **The tweak panel** becomes apps/desk's DEV PANEL (the backtick; screen-
  space DOM, its look built from the desk's inks): the mat, the rulers, the lattice, the night, the colours, the mini
  mat's law, its vinyl, the live insides, the springs, the flight's response and the zoom-through, projected through the
  layer's handle and core's live settings; "reset to product" IS the product; `rig:panel`.
- **D-D2b.7's witness restored**: `rig:nav` §7 — a double-click lands while a dropped note's lift and a mini mat's
  hover rise are both moving; the flight pinned at p = 0 with the flux UNFROZEN: only the builder's p = 0 hold keeps the
  cut still (400 ms, maxΔ 0; red without the hold: the lift falls, 8,111 px move).
- New doors (`@ice/desk`): `handle.tuneLaw(kind, law)` — a kind's law, live (`ObjectKind.tune?`, `KindPass.setLaw?`;
  the mini mat's); `DeskLayerOptions.springs` (the object the builder reads each frame);
  exports `SPRINGS`/`ObjectSprings` (`/host`) and the night's model — `nightLight`, `dayLuminance`, `MatLight` (`/theme`).
  apps/desk gains its vitest units and `window.__desk.room` (keys, the document by key, the local commit count) and
  `__desk.panel`.
- Witnesses in `gate:landing`: `rig:parity` 74 → 85 and `rig:world` 61 → 72 (the sweep, from the world), Chrome = Node at
  maxΔ 0; `rig:two-tab` 10 → 19 (M5's nine); `rig:nav` 25 → 26; NEW `rig:collab` 9, `rig:ruler` 23, `rig:panel` 13.
  Units: core + 2 (M8), apps/desk 12 (M10 5, M9 3, the panel's params 4); desk unchanged at 418.
  Every new witness proven red by a sha-checked mutate → run → restore (the counts and the mutations are in the slice's
  commits).
- Owed: a peer in another nav frame — core's presence cursor is in the peer's own frame's units and presence carries no
  frame, so dom's reflector shows every peer's cursor through THIS desk's camera: a peer who entered a mini mat shows at the
  wrong place on a root desk (and the other way round) — as it did in the retired apps. The prototype's paper, hand and notebook laws are not live in the dev panel (the kinds take
  them at construction — `tuneLaw` is the door for each), nor is the flight's octave model (core's flight exposes its
  response alone). rig:ruler's 1× row (the atlas re-rendered at a changed device ratio) is not carried: apps/desk makes
  its atlas once at boot.

<!-- design-015 D4b (2026-09-26) -->
THE OPENING (design-015 §8, *Marks on the Mat* v2's Opening): an object is picked up INTO THE HAND —
no camera move — and the desk behind it goes out of focus; put down, it flies home and lands where it
lay. ADDITIVE beside the desk: nothing here reaches a `dom`/`gl` board.

- **`Held` is the fact** (core, runtime tag; one writer `ops.open(entity)` / `ops.putDown()`; at most one
  held object; `HeldView { zoom, panX, panY }` beside it as the user's facts). `open` refuses a type
  without `openable` (`defineWidget`'s new object-only word — `defineObject` sets it from the kind's
  `open` binding) and a second object while one is in hand; it selects what it picks up and cancels
  live gestures; a nav cut puts the hand down. The double-tap router asks `open` for an openable target
  before the container test (`HeldIntent`, applied after the tick as `NavIntent` is).
- **The desk behind is inert** (core `systems/held.ts`, the head of `react`): while something is held
  every local pointer carries `HandledByWidget` + `WheelHandled` — no pick, no tap, no drag, no
  selection change, and BOTH wheel consumers skip it: the camera never hears a held gesture. The
  pointer is mapped through the pose seam `stack.heldPose` (`HeldPoseSource.frame(e)`, beside
  `framePick`/`navGeometry`) into `HeldPointer`; the routes are desk.js's: ⌘/ctrl-wheel or pinch zooms
  the object about the pointer (rate 0.0105, 0.72 … 3×), a plain wheel and a middle/Space drag pan it
  once brought close, in past 0.72× puts it down and MUTES the rest of that gesture (`HeldMute`), a
  click on the soft desk or two taps on the object put it down.
- **The kind's opening** (`ObjectKind.open`): `extent`, `pose` (`camera` | `eye`), `openness`, `spread`,
  `tools` (declared; built at D3t). The notebook opens its spread under the desk eye (a cover spring in
  its `Books` state — the palm's 1.4 Hz ζ .78 — and a rise of H·(1 − 1/grow)); the board and the
  calendar their own rect, flat. `hold/pose.ts` is the hand's pure math (the reading size, the pose
  between, the pose as a camera, the phone's single page, the focus).
- **The render path** (`@ice/desk`): the builder's HAND flux (560 ms up on the island ease, the cover
  past 42 %; 140 ms lead + 440 ms home, landing once shut) draws the held object as a slot of its own
  under the pose's CAMERA; the ground's `renderHeldFrame` (shared with the Node oracle) makes the desk
  copy ONCE per stamp (half dpr, dual-Kawase blur, its own submit first), lays the hand (a bare slot into
  a premultiplied full-size target, the day's light by night) over the copy mixed toward the blur by the
  carry, dimmed 8 %·e, through the reading light (saturate .62 · brightness .82). At e = 0 the rest path.
- **The held bar** (`@ice/react` `<SelectionMenu>`): the one menu travels to the foot (340 ms, M1) —
  Send · the kind's tools (dim) · Done — hides while landing, back 200 ms after; the keymap: ⏎ picks up
  an openable / enters a container, Esc puts down first, the desk's keys go quiet in hand.
- **apps/desk**: Tab walks the objects in reading order; `__desk.hand/open/putDown/pinHold/heldView/
  holdCopies/holdCost`; `setScene` takes `hold` and a scene's own `view`; `rig:open` (every way back,
  the mute, held zoom and pan, the keyboard, idle-zero in hand, the copy standing, the cost) joins
  `gate:landing`; `rig:world` draws the seven `hold-*` stills (Chrome = Node); the oracle's `held` check
  (the rest frame at e = 0 byte for byte; the object's reach past its box bounded; renders identical).

<!-- design-015 D3t-a (2026-09-26) -->
THE TOOLS IN HAND (design-015 §8's held bar made live, §6's whiteboard in hand, the print's owed carry).

- **The held bar's tools** (core `widget/held-tools.ts`): a type's `heldTools` — each a glyph, its keys (`"1"`,
  `"mod+z"`) and a kind: a **mode** (`ops.useHeldTool(id)` makes it the object's ACTIVE tool — the runtime
  `HeldTool { id, prev }`, the user's fact; a `toggle` mode chosen again hands back the one before) or an **action**
  (runs its op with a `HeldToolApi`: one transaction, the document's `undo`/`redo`, the object's `props`/`setProps`);
  no kind = declared only (dim). `ops.open` puts the type's `heldTool(props)` (else the first mode) in hand,
  `putDown` takes it off. The keymap asks the held type's tools first, and only while held; the bar's slots are live,
  the mode in hand marked in cream — *Marks on the Mat* Q-f — and only it. The pose seam answers a PART
  (`HeldPoseSource.part` → `HeldPointer.part`); a press on the `content` part with a mode in hand is the tool's
  (`HeldPress` `tool` — never a tap that puts the object down); the mode's `cursor` shows over the surface.
- **The whiteboard in hand**: four markers (`1`–`4`) and the eraser (`e`, a toggle) as modes, cursor none; undo and
  redo — the document's history over its stroke entities; `t` cycles the capped marker's tip and ⌘⌫ wipes (one
  transaction), keys only. The pen driver (`@ice/desk` objects/pen.ts) lays a stroke LIVE a frame at a time (a frame
  the pointer rested is the pen resting — its bleed), lifts it as ONE `desk.stroke` child with its samples' times,
  which the ink ADOPTS rather than replays, and at the put-down writes the capped marker's ink off the undo stack.
  THE MARKER (board/pen.ts — the bench's `poseOf` and springs, shared by the kind, the oracle and the units) is
  taken up as the board comes into the hand, drawn by the board's pass in the ink's own frame, hovering or
  pressed, and laid down in the ink last used; the wet layer dries on the frame's clock.
- **`desk.stroke` v2** carries `times` (base64 LE f32 ms offsets — D-D3w.2's codec); v1 migrates to an empty one and
  keeps its `speed`. An object declares its DATA prefabs (`defineWidget({ data })` — the Board's strokes): the engine
  catalog stamps, gates and resolves them, and the M9 runner migrates one by its own chain (`definePrefab({ migrate })`).
- **The print's carry**: Esc cancels it (no flick, flown home, nothing committed); a carried or gliding print paints
  above its siblings (`KindLocal.lifted`) and is picked where it is drawn (`FramePickSource.lifted()` — asked first);
  `interaction.wheelTurns` (core `pressWheel`: a holding press's wheel is the widget's, summed in `PressWheel`) — the
  wheel twists a carried print about the finger, and its rest commits the turn.
- **Witnesses**: oracle stills `hold-board-pen/wet/dry-e1-z1` (Chrome = Node, D-D3r-a.5's ink bound); `rig:open` §11
  (the whiteboard in hand, 30 rows), `rig:two-tab` (a stroke by hand in A arrives on B's board), `rig:interact` (the
  print's owed rows).

<!-- design-015 D3t-b (2026-09-26) -->
THE NOTEBOOK IN HAND (design-015 §6's notebook on D3t-a's seam; NOTEBOOK.md §6–8): its page strokes as data, its pens, its turns.

- **Page strokes are the book's DATA**: `desk.stroke` **v3** carries `page` (sheet i's recto 2i + 1, its verso 2i + 2; 0 = none —
  a board's, where every v2 stroke migrates); a notebook's stroke is tool `pen`, its ink the pen's name, its path in PAGE units
  (`s` from the gutter, `y` from the head) with D3t-a's `times`. The Notebook declares the prefab as its `data`.
- **The pages' ink is a cache** (`@ice/desk` notebook/pages.ts `PageInk`): the pass's eight layers handed out LRU to the pages in
  view with ink, each page REPLAYED from its strokes when they are not what its raster holds (an undo, a redo, a peer's, the look,
  an eviction); a page whose ink is gone gives its layer back. The raster is pure arithmetic (notebook/raster.ts — the
  prototype's Canvas2D stroke re-expressed: the midpoint quadratic, round caps, source-over, straight alpha), so the Node
  oracle and the desk lay the same bytes; `NotebookPass.uploadInk` takes those bytes (`writeTexture`), never a canvas.
- **The pen in hand** (objects/leaf.ts `createNotebookHand`, `handle.notebook()`): a press on a page's writing with a pen in hand
  lays a stroke LIVE into its page — each segment drawn the moment it is final, only its rectangle uploaded — through the SAME desk
  eye the book is drawn with; the lift is ONE `desk.stroke` child in one transaction, which the page ADOPTS (no replay, even if
  its landing is late). The fountain-pen law over the samples (`nibWidths`: thinner as the hand hurries; a resting sample keeps
  its width). ⌘Z/⇧⌘Z in hand are the document's history over the strokes; a held book's changed strokes wake the desk.
- **The held bar's tools are live**: ‹ › (←/→, PageUp/PageDown), the four pens — the note's, modes `1`–`4`, their slots the
  palette's inks, a crosshair over a page, the fountain pen in hand at the pickup — undo, and redo on keys alone.
- **The turns are PARTS**: in hand the kind's `hit` answers `turn` (a page's outer 30 %), `content` (the rest of a page — the
  pen's) and `frame` (the case, the endpapers). Core's held input makes a press on a named part the kind's (**`HeldPress` kind
  `part`**, every press carrying the part it began on) — never a tap that puts the object down: two clicks on a turn turn two
  pages; two taps on the case still put the book down. A pinch that travels takes the sheet over the gutter (let go past the
  vertical or flung it goes, else it falls back); a click turns (the right page on, the left back); the keys and the bar count
  their turns on the book (the runtime `PageTurns`) and the hand turns by the count. A completed turn moves the durable `spread`
  in ONE transaction, OFF the undo stack; the sheets in hand are a motion kept frame to frame (motion.ts `stepLeaves`), heading
  for the spread asked one sheet a frame (a run of turns fans); the right page's fore-edge corner peeks under the pointer.
- **A portrait phone reads page by page**: `OpenBinding.page` (0 the right … 1 the left, sprung) centres the page in view
  (`readingTarget`/`heldFrame` take a `face`); a step from the right page turns its sheet and follows it to its verso.
- **Witnesses**: oracle stills `hold-book-ink-e1-z1`, `hold-book-turn-ink-e1-z1`, `hold-book-ink-night-e1-z1` (an open spread
  written on both faces, a sheet mid-turn with its ink riding it, by night) Chrome = Node at maxΔ 0, from the world too;
  `rig:open` §12 (the notebook in hand, 35 rows; §8's two taps now land on the case), `rig:two-tab` (a stroke by hand in A on B's
  page, a turn and ⌘Z seen), the units' parity of the ink table and every page's raster with the oracle's.

<!-- design-015 D3t-c (2026-09-26) -->
THE DESK CALENDAR AT WORK (design-015 §6's calendar in hand and at rest; CALENDAR.md §2–§5 ported whole).

- **The print from its events** (`@ice/desk` calendar/print.ts — the prototype's display list, DOM-free): the month,
  the two small months, the weekdays, the ISO weeks, the Moon, the colophon; today ringed in hot, the past ticked in
  pencil; each entry a line in the note's hand — a time set apart, a run of days a highlighter band, a stuck note's day
  giving its foot, "+N more". Its TILES are a cache (calendar/printing.ts `PrintTiles`): the coarse levels for the
  sheet, the view's rung and the one under it, each tile keyed by what it shows (an edit redraws its cell's tiles
  alone), EMPTY where nothing prints, within the frame's budget; the `PrintRaster` seam draws them (host/print.ts: one
  CPU-raster OffscreenCanvas a tile). A host with no canvas PINS a sheet's committed tiles — exactly: a blank pin is a
  blank sheet, whatever the owner pinned before.
- **Its entries and pins are DATA children** (`desk.event {start, end, text, seeds, ink}`, `desk.pin {day}` + the
  `desk.pins` edge — the Calendar declares `data: [EventPrefab, PinPrefab]`). An entry's writing is its ONE `ink`
  cell (D-D3t-c.1); a new line is a draft the pad prints until its session ends and spawns it whole — one
  transaction, never an empty entity (D-D3t-c.4).
- **The days** (host/calendar-input.ts, objects/calendar-writing.ts, objects/calendar-hand.ts): the pad's parts
  through the desk eye (`partAt`: the tape, the roll, the corner, the foot, the sheet in motion, a line, a day); a
  click selects a day (⇧ a run) or a line — the runtime `PadSelection`, marked as the marks' brackets drawn on the
  sheet itself (D-D3t-c.3); ⏎, a double-click or just typing writes through the ONE editor, lent to the calendar
  (a day under 150 px on screen picks the pad up first); ⌫ takes a line off (one step); the arrows walk the days
  and the pad follows over a month's edge; t goes home; ⌘Z/⇧⌘Z are the document's.
- **The ROLL** (calendar/turn.ts): a month rolls up from its foot or corner and comes down off the roll under the
  tape — a click, a flick, or past a third by hand; the corner lifts under the pointer; ] [ PageDown PageUp and the
  held bar's ‹ › turn it, today rolls home. The document's `month` is the TARGET and moves ONE transaction per
  completed roll, off the undo stack (D-D3t-c.5: a roll is not an edit).
- **Notes stuck to days**: let go over a day a note sticks (its pin + the glide into `daySlot`, one transaction;
  the day marked while carried), rides with the pad and into the hand, goes with its month (veiled — not drawn,
  not picked — while its month is not shown), and is unstuck when carried off (D-D3t-c.6). Core: a DEPENDENT
  relation (`defineRelation(name, { dependent: true })` — the destroy cascade takes the edge's source: deleting a
  stuck note takes its pin, and one ⌘Z brings both) and RIDERS (`defineWidget({ riders })`, moved in the drag's one
  transaction).
- **Witnesses**: the committed print (`oracle/prints.mjs`, `fixtures/assets/print-2026-{09,10}` — apps/desk
  `scripts/print-fixture.mjs --write` reads the live print back from the world); oracle stills
  `pad-print-z0.42`, `pad-print-roll-z0.42`, `pad-print-note-z0.85` with a print check (Chrome = Node at maxΔ 0 in
  rig:parity and from the world in rig:world, which then holds the live print to the committed bytes, tile for
  tile); `rig:open` §12 (the calendar at work, 52 rows); `rig:two-tab` (a line written in A arrives on B's pad, with
  A's seeds, and ⌘Z in A takes it off both).

<!-- design-015 D6 (2026-09-26) -->
PERFORMANCE — PERSISTENT RECORDS, THE O(1) PAN PROVEN BY ITS COUNTERS, THE 1,000-OBJECT GATES (design-015 §2 · §2.5 ·
§4.3 · §11.4).

- **Persistent records** (`@ice/desk` engine/records.ts `createRecordStore`; §4.3): per kind a GPU storage buffer
  indexed by a SLOT ALLOCATOR — a record keyed by its entity (a ghost's negated) keeps its slot while it is drawn and
  is written only when its record object changed (identity: the builder hands the same object while nothing moved);
  the draw list an index buffer (`order`, binding 9 in the four passes' WGSL — paint index → slot) rewritten only when
  membership, order or visibility changed; slots freed and reused, the capacity doubling (the pass rebinds on
  `version`); a slot's block (the mini mat's chips) beside it. No keys = transient, the oracle's form — byte-identical:
  101 renders sha256-equal to main `f7db939`. Paper, print, board and mini mat carry stores; the notebook and the
  calendar keep their layers.
- **The builder reuses what stood** (compose/builder.ts): a row's record is remade only when its facts moved (`stale`,
  from the journal), its flux (a spring this frame), a law, look, theme or grid (`remakeAll`), its zoom or dpr (a
  `rezoom` kind — the paper's ink band, the mini mat's lattice — at its SLOT's zoom, which a lifted face moves with the
  root camera still: rig:nav's cut frame, a lattice 1 LSB stale), the tape's give, its slot, or its kind restless; a
  composite is remade every build it is drawn. The paint-ordered LIST stands until the membership moves (a spawn, a
  despawn, an Active flip) and is re-sorted only when the order does (siblings, a stratum, a Grab, a kind lifting);
  `verify()` re-resolves every reused record against a fresh one (`sameRecord`) and counts the mismatches — the checker
  that catches a look changed under the builder's feet.
- **The cull rides the spatial index** (§2.5; `stack.index` through `LayerContext.spatial`, @ice/dom desk-host.ts): the
  candidates are the index's answer for the view, its margin and the kinds' reach, asked again only when the view
  leaves a hysteresis band (the margin again) or the world moved; the exact rect test per candidate; the index's
  one-tick lag after a nav cut falls back to the linear cull for that build.
- **The idle tick**: the selection RING's spring is removed, not zeroed (springs.ts, the panel's two rows, `pinFlux`'s
  type) — since D4a the marks draw the selection, and a spring feeding a retired zero kept the desk live for a second
  after every selection change (the D4a landing's owed item; on main the marks-world test only ever saw that spring:
  38 frames past the lock-on). The kinds' `tick(now)` name the RESTLESS kinds each flush (`reflector.restless`) and the
  builder asks the lifted tier of those alone; the writing's residency and `noteAt` read the builder's word on what is
  drawn (`KindHost.drawn`) — a reused record makes no draw call. Found on the way: BoardInk woke on ANY known board's
  stale stamp (D-D3t-b.11) — now a DRAWN board's only.
- **The raster budget** (engine/budget.ts `createRasterBudget`, 192 MB by default — `DeskLayerOptions.rasterBudget`):
  one LRU ledger for every raster a kind keeps as a cache — a board's ink with its mips and layers (evicted, `stamp`
  −1: it replays from its strokes when next drawn), the notebook's page rasters (5.6 MB each), the calendar's tile
  texture (charged once, always kept); each kind answers `keeps(key)` for what is on screen, the host trims once a
  tick; `handle.memory()` / `__desk.memory()` the ledger. On the stress scene after the pans: 134.9 MB resident (six
  boards 93.7, the calendar 41.3), 0 evictions.
- **The gates** (`rig:stress`; docs/benchmarks.md § design-015 D6 — BEFORE and AFTER on this Mac, medians over 7 rounds
  with the load): pan 1.38 → 1.07 ms JS/frame; a frame's work 118 resolves → 1.4, 1,002 queried and sorted → 0, 1,021
  visited → 211 (the index's candidates); uploads 56.3 → 35.2 KB (the slots' camera blocks alone); heap +210 → +59 KB;
  drag of 50 3.36 → 3.14 ms. CHECKED, never soft: the members neither queried nor sorted on a camera move; the cull
  visiting candidates alone; ≤ 3 resolves a frame on a pan (the composites and the entrants); the stores writing no
  standing record (0.38 written a frame against 1.38 remade — `__desk.records()`, the stores' counters through
  `KindPass.records`); a `nudge` (30 frames × ½ px inside the hysteresis band) writing 0 records and 0 draw lists, the
  camera riding the slot uniforms alone; idle 0 submits. NOT met, owed with numbers: idle's desk flush 2.07 ms/s
  against ≤ 0.1 (33 µs a tick — the kinds' polled ticks; wants a registered wake, a design change); the composites
  remade every drawn build (1 resolve a frame on any camera move); `rezoom` kinds remade on any zoom delta (66.7
  resolves a frame on a zoom); a restless kind remaking every record of its kind (65 on a note edit). `rig:stress` at
  3 rounds (41 s, 15/15) is a `gate:landing` leg; the 7-round table run is 85 s.
- **Witnesses**: units records.test.ts (change-only writes proven red against a per-frame pack; a changed record writes
  its slot alone; the draw list on a reorder; free and reuse; grow; transient; blocks; invalidate),
  builder-persistent.test.ts (a camera move resolves and records NOTHING; a fact write remakes ONE; a spring remakes
  until it snaps; the rezoom kind at its slot's zoom; the cull's hysteresis — a pan within it asks nothing, past it
  once, the drawn set the linear cull's; `verify` red on a look changed in place), budget.test.ts (LRU beyond the cap,
  what the owner keeps spared, a re-charge counted once), marks-world (the lock-on's frames counted: whole on the first
  frame at or past 180 ms and the builder quiet THAT frame); the oracle 101/101 sha256-equal to main; rig:nav 26/26 in
  four runs (the cut frame maxΔ 0), rig:interact's selection row (the ring 0 at every sample, the desk quiet within
  600 ms), rig:stress 15/15 at 7 and at 3 rounds.
- **Found by gate:landing**: rig:two-tab's notebook pick-up pressed the pen the instant the HAND settled, a frame or two
  before the book's own motion had it open (`turnable`: theta past 0.93 π) — core decides a press's kind at WentDown and
  `partOf` answers "frame" until then, so the press was the object's and no stroke began (a throwaway log in the leaf
  read `turnable: false` at the failing press, `true` a frame later). A latent race whose odds D6's frame timing moved
  (4 of 6 one-tab replays, always after a whiteboard stroke laid by hand); the rig now waits the desk quiet after the
  pick-up (two-tab-notebook.mjs `pickUp`) — 39/39 three times running.

<!-- design-016 K1 (2026-09-27) -->
- **The rulers print on `apps/desk`'s desk** (design-016 §3): the app mounts its own grid (`DESK_GRID` — the engine's
  with the print on; `DEFAULT_MAT_CONFIG.ruler.on` stays false, RULER.md §5: a host prints them on the root slot); `u`
  toggles them through the dev panel's params, so the key, the panel row and the saved desk agree (`PARAMS_VERSION` 2 —
  a desk saved "off" before boots with them on; the panel applies its saved tweaks at install); the rulers' glyph atlas
  follows the device's ratio and the panel's text size; the panel's rulers section reaches the ground demo's parity (fine
  ticks from/full, labels from/full, text size/inset/gap, characters). With the print on, the selection's extent, the laser
  ticks and the menu under the top band show on the product's desk. `rig:ruler` (23 → 37 rows) witnesses the product as it
  boots — no `setScene`, the runtime atlas.
- **`startRafLoop(engine, beforeStep?)`** (`@ice/dom`): an optional hook run before each step that runs (never while
  parked), inside the step's `try` — where a host reads what the platform changes without an event.

<!-- design-016 K2 (2026-09-27) -->
- **The GPU profiler** (design-016 §4, K-L5 "measured on real frames"): ICE read nothing from the GPU; now it reads every
  drawn frame. Both device paths ask for `timestamp-query` whenever the adapter has it (`EngineGpu.hasTimestampQuery`
  is real). `instrumentPasses(device)` (`@ice/desk`) wraps the encoders — draws and instances by the kind that drew,
  `setPipeline`/`setBindGroup`/passes, every labelled pass timed, each encoder's queries resolved inside its OWN command
  buffer (no submit added), read back through a 3-slot `mapAsync` ring that never waits (a full ring drops the sample).
  `instrumentMemory(device)`: live GPU bytes by label through `createTexture`/`createBuffer`/`destroy` (the formula in
  gpu-memory.ts; the logical size), kept from the layer's boot under `deskLayer({ gpuLedger: true })` (D-K2.2).
  `createGpuProfiler` / `handle.profiler()`: one report per frame — `span` (first begin → last end, THE headline), `busy`
  (the passes' union), `sum` (never the frame: D-K2.4 measured it overstating 52 and understating 8 of 60 frames),
  passes, counts incl. submits/writes/upload bytes, byKind, uploads, cpu `encode`/`flush`, memory, `quantised` (every
  delta a 100 µs multiple — `--disable-dawn-features=timestamp_quantization` names the fix) — rolling p50/p95/max,
  `capture(n)` → a Chrome trace-event JSON (Perfetto). `ablateKinds` / `window.__desk.perf.kindCost()`: per-kind GPU cost
  by ablation (saturated, drained, round-robined batches, an A/A control and its noise floor) — every kind draws in the
  one `ground` pass. Unarmed, nothing is installed; armed, no submit and no wake.
- **`@ice/devtools` gains the `gpu` slot**: `attachDevtools(engine, { gpu })` + `handle.gpuFrame(report, stats)` fed
  through the structural mirrors `GpuPanelFrame`/`GpuPanelStats` (devtools cannot import desk; apps/desk asserts the
  assignability at compile time) — the span's p50/p95/max, the passes on the span, the calls, by kind, uploads,
  memory, the quantisation warning, "capture 120 frames"; the host lanes `desk flush` / `encode` / `gpu` beside
  strata's. `packages/devtools/README.md` says how to open it and what each number means. apps/desk mounts the dock on
  `~` (⇧`), arming the profiler while it is open — its code a chunk of its own, loaded on the first press.
- **Changed, quietly**: `instrumentSubmits` is no longer installed at boot — the layer's `submits()` installs it on first
  ask (D-K2.1), `detach()` restores exactly what was there (no bound copy left as an own property), submits share ONE tap
  (`tapSubmits`), and `copyExternalImageToTexture` (a print's picture, the calendar's tiles) counts as an upload.
  rig:gpu (16 rows) joins `gate:landing`; rig:stress asserts `crossOriginIsolated` and reports the pan's real-frame GPU
  span p50/p95 with its draws / pipelines / bind groups a frame, and each kind's cost at the pan's end.

<!-- design-016 K4a (2026-09-27) -->
- **The render kit — `@ice/desk/kit` / `@vibecook/ice/desk/kit`** (design-016 §5, K-L1 · K-L3): what the six kinds share,
  made public — the slot's view and its WGSL (`kitWgsl(names, own, text)` composes the shared modules BY NAME: view,
  portal, sdf, light — lamp, gobo, night, noise — ruler), `MatPass` as an interface (the mat is `CuttingMat implements
  MatPass`), sdf, springs, mips, seeds, `LayeredKind`, the notebook's 3D kit (eye, rigid placement, paper texture, mesh
  writer, book records, `book.wgsl`, the layer composite), strokes and inking, the hand's pens and faces, the editor
  lease's types, the typing docs. Every type the kind contract names is nameable from a public entry (a d.ts test holds
  it); `pack:audit` reads nine entries.
- **One view block per slot** (K-L3): the mat's uniforms are the block every kind binds — no kind keeps a copy
  (`view.w` carries the objects' presence; the mat reads its own from `presence`, 864 → 880 B — D-K4a.1); a kind with no
  objects in a slot is skipped; one wind target per plate serves every slot; knobs and layered records are written when
  they change. rig:stress's pan: uploads 35.2 → 6.3 KB a frame, `writeBuffer`s 68 → 10.1, the JS step 1.12 → 0.91 ms;
  the golden byte-identical through every step.
- **The walls** (dependency-cruiser): `kinds-import-only-the-sdk` (a kind's files — `KIND_FILES` — import, inside the
  desk, only the kit, the engine and the contract's modules; outside it core's and kernel's entries), `no-kind-imports-a-kind`
  (a kind names another only by its registry name — the mini mat accepts `"desk.note"`, the calendar asks the host for
  `"paper"`: D-K4a.3), `the-kit-imports-no-kind`; 121 private import statements (41 kind→kind) → 0. The kind specs left
  `theme.ts` for their kinds (`PAPER`, `BOOK`, `BOARD`, `MINIMAT`), the numbers they shared are `kit/physics.ts`, and the
  mini mat's portal gate is the engine's `PORTAL.gate`.

<!-- design-016 K3 (2026-09-27) -->
- **The pegboard drawer** (design-016 §7 · design-017 §1–§7, K-L6): James's SDF pegboard (`research/sdf-pegboard`) as
  the desk's widget tray — a drawer of hardboard that slides up from the bottom of the view on widgetlab rev 1's curve
  (`340 ms cubic-bezier(0.32,0.72,0,1)`), a WINDOW onto an infinite board: the SKÅDIS lattice (stadium slots, odd rows
  shifted half a pitch, filleted rims), the tempered face, the paler punched edge and the plaster wall behind, shaded in
  CLOSED FORM head-on (no march, no history, no jitter — every frame final; turned-lattice tone and grain; the wall lit
  through the slots by the research's own HOME lamp; the desk's day and night colour laws) in the root pass after the
  marks, 0.22 ms at 2400×1600; the scroll's whole rows carried on the CPU so the pattern is exact 10⁶ rows down; a band
  past the ends. Facts in the world: a runtime `Tray` entity per view (open, scroll, stretch, lip) — never durable or
  synced — written by core's ops `openTray` / `closeTray` / `toggleTray` / `scrollTray` and by `trayInput` (beside the
  hand's: while open every pointer is the tray's and the desk is inert; Esc closes the tray first; the desk's keys go
  quiet). The renderer's word on the drawer as drawn is the `TrayPoseSlot` seam; the desk handle's `tray` door;
  apps/desk opens it on `a` or its lip (the notch). `rig:tray` (24 rows) joins `gate:landing` (fifteen rigs); four tray
  stills join the golden (105). Its specimens and taking one are K5.

<!-- design-016 K4b (2026-09-27) -->
- **`@ice/objects` — the six kinds leave the desk** (design-016 §5, K-L1 · K-L2): the note, the mini mat, the photo
  print, the whiteboard, the notebook and the calendar live in their own package, one folder each (their WGSL, their
  units, their DOM half), compiled only against the desk's PUBLIC entries (`@ice/desk`, `/kit`, `/engine`) and core's —
  exactly what a plugin kind is. `@vibecook/ice/desk/objects` publishes them (with `DESK_OBJECTS`, `DeskCanvas`,
  `DeskPalette`); `@vibecook/ice/desk` names no kind — `pack:audit`'s ninth question greps the desk's built entries for
  21 needles read from the kinds (type ids, WGSL keys). A kind DECLARES its DOM half: `defineObject({ host: { lend,
  editor, mount } })` (`ObjectHost`, `hostOf`) — `deskLayer` builds whatever the registered objects declare (the note's
  editor, the calendar's print raster and input), so the seam's four fenced exceptions are gone (D-K4b.1); the text
  raster and the picture decoder stay desk services lent to every kind (D-K4b.2); the container law (`insideViewOfFace`,
  `FACE_RADIUS`, `FACE_CHIPS_MAX` …) is the kit's (D-K4b.3). The oracle and the committed golden live in
  `packages/objects/oracle` (D-K4b.4); each package generates its own shader text (D-K4b.6). Walls:
  `objects-imports-only-the-sdk`, `desk-never-imports-objects`, `no-kind-imports-a-kind`, `objects-dom-half-is-its-objects`,
  `nobody-imports-objects`. `ZOOM_MIN` / `ZOOM_MAX` are exported from `@ice/desk` (the one symbol K4a's moves left
  unreachable).

<!-- design-016 K6a (2026-09-27) -->
- **Prints and whiteboards draw as instanced runs, under ONE residency budget** (design-016 §6, K-L4): every picture is
  a layer of one thumbnail array (its mip chain's tail from the first level ≤ 512², always resident); a print large on
  screen asks for a DETAIL — the chain from `floor(lod)`, sized to the screen, re-decoded from the blob — bound in one of
  8 pool slots, an unbound detail an LRU cache, all under the raster budget (`DEFAULT_RASTER_BUDGET` 192 → 256 MB — the
  thumbnails and bound details, D-K6a.1); the print's record carries its layers, so a run of N prints is ONE draw of N.
  A whiteboard's raster follows its zoom rung (2 texels per device px, a power of two 1…4 — zoom 1 at 2× is the old 4),
  its far LOD a thumbnail in a shared array, its ink bound in pool slots, eviction keeping the thumbnail (D-K6a.2); a run
  of N boards is one draw. The shared array is the kit's `LayerArray`. The notebook's and calendar's big textures are
  made on first use and let go 5 s undrawn or with the last object (D-K6a.3). Measured on the mixed stress desk: live GPU
  memory 904 → 351 MB (20 × 4096² pictures: 1,942 → 78.8 MB; no notebook or calendar: 164 → 0.3 MB and 42 → 1.0 MB);
  draws 55 → 42 a frame, photo 19 draws → 6 for 19 prints. rig:stress gains mixed sibling order, real pictures and a
  `pictures` scenario (31 rows).

<!-- design-016 K5a (2026-09-27) -->
- **The kinds hang on the pegboard** (design-017 §8, K-L2 · K-L3): a kind declares a TRAY ENTRY —
  `defineWidget`/`defineObject({ tray: { label, props?, hang: { w, h, pegs, accessory }, order?, category? } })`, compiled
  by core (`compileTrayEntry`) onto `WidgetType.tray` — and the catalog's types that carry one ARE the tray's contents (a
  plugin kind appears by declaring one; no engine list names a kind). The kernel's lattice law (`kernel/src/tray.ts`:
  `PEG_LATTICE`, `layTray`, `trayScrollMax`, `hangError`) lays them in (category, order, type) order across the board's
  columns, every peg on a punched hole's centre, a clear row between rows. The tray entity (a `Container`) roots a
  runtime canvas of `Specimen` entities — never Active, never durable or synced — laid by `createTrayLay` and re-laid on
  a width or catalog change. Each specimen is drawn by its OWN kind in a slot of its own under the drawer's camera, hung
  on an SDF accessory (hook, shelf, clip, rail) with its shadow on the board by the lamp, a name tag under it; hover lifts
  it. The six built-ins declare theirs (the note on two hooks, the print clipped, the notebook and the mini mat on
  shelves, the calendar on a hook, the whiteboard on a rail). A slot's layered pass lets its layer go 5 s undrawn
  (`KindPass.idle`, `LayeredKind.idle` — the tray's notebook and calendar 137 → 0.7 MB and 134 → 2.2 MB after the drawer
  shuts). `rig:tray` 24 → 34 rows; the golden 106 (a fifth tray still, `tray-scrolled`).

<!-- design-016 K6b (2026-09-27) -->
- **The desk zooms without a stall** (design-016 §6): a kind's record depends on the zoom only through its RUNG —
  `ObjectKind.rung(RungContext)`; the builder remakes a rung kind's record only when its rung moves (the mini mat keeps
  `rezoom`: its lattice ramps continuously, D-K6b.1). Rasters go through ONE frame queue (`engine/rasters.ts`,
  `KindHost.rasters` / `.remake`): kinds ask, the host drains once a tick before the build, nearest the view's centre
  first within "shows nothing → magnified stand-in → minified" (D-K6b.2), at most `RASTER_BUDGET_MS` (4 ms, `rasterMs`) a
  turn; the old raster stands meanwhile (a rung short reads √2 soft for 14–18 frames); an edit is laid at once so the ink
  never lags the caret (D-K6b.3); a board's first replay and density raise queue too, and a board with no ink draws bare
  (D-K6b.6). rig:stress's `zoom-written` (240 written notes, 8 boards, 1 → 0.35 → 0.72): the worst frame 192.84 → 5.81 ms,
  0 frames over 8 ms in every round, p95 26.35 → 4.75 ms, records remade a frame 120 → 1, convergence ≤ 18 frames.

<!-- design-016 K5b (2026-09-27) -->
- **Taking one off the pegboard** (design-017 §9): a press on a specimen (+4 px) lifts a COPY ×1.06 about the grab point
  (the specimen stays hung); leaving the drawer slides it away and hands the copy to core's `insertByDrag` (a one-tick
  `TrayIntent` applied after the step, `anchor` = the grab point — no centre-snap —, `home` = the specimen) at |Δ| 0 px; the
  ghost grows out of the copy on the drawer's curve and the ordinary drag runs (snap, drop targets, into a mini mat per the
  kinds' rules); release = ONE create transaction, selected, one undo step. Esc, a rejected drop or a release back over the
  drawer cancels (the ghost flies home shrinking; nothing enters undo); a release inside the drawer puts the copy back. The
  tray entry gains `take` (what a taken object is made with — the kind's defaults unless it says; D-K5b.1) and
  `tray.local` (a specimen drawn with the kind's desk state — the note's words, the print's procedural `sample:dusk`, the
  pad's month; D-K5b.3/4/5); the name tags are label-maker TAPE (`TRAY_TAG_STYLE` "tape"; "pill" restores the chips —
  D-K5b.7); `DESK_OBJECT` — the desk canvas places anything that provides it (D-K5b.2). rig:tray 34 → 47 rows.
- **Fixed on the way:** the board pass's pen materials defaulted to black until a desk board had drawn, so the tray's board
  specimen changed with scene order (a board record made without the desk's local now carries its look's `materials`); a
  specimen's raster was re-asked every frame and never laid under K6b's queue (the queue's `shows` now includes what the
  tray drew).

<!-- design-016 K7a (2026-09-27) -->
- **The loop sleeps at rest — registered wakes** (design-016 §6; design-015 §11.4's idle gate, owed since M20): the frame
  gate learns `wake(reason)`, `wakeWhen(name, due)` and `nextStep`; `startRafLoop` schedules no frame once the engine is
  quiet (no wake pending, no registered time due, no settle reporter busy) for three steps; kinds declare when they are next
  live (`KindLocal.due`), the tray's release and the raster queue's waiting asks are registered too, and every door from
  outside wakes it. At rest the engine's step and the desk's flush cost 0.000 ms/s (were 10.41 / 2.94), the page 0.14–0.23
  ms/s, 0 submits (D-K7a.1, D-K7a.3 — the calendar's hand no longer keeps a desk with a pad awake).
- **The books' layers**: shadow maps kept while the lamp and the book stand still; the 4× colour+depth and resolve sized to
  the books' SCREEN BOX (`BoxTargets`, kit) — the notebook on screen 136.4 → 24.8 MB (D-K7a.4 re-blessed 13 book/pad scenes
  and five tray stills at maxΔ 1: the rasteriser is not exactly translation-invariant); a layer nothing of which moved is
  laid again undrawn, compared by content — a held frame standing 2.86 → 0.18 ms.
- **Allocation**: a pan's allocation measured truthfully (D-K7a.5: rig:stress pins the young generation, so the row reads
  allocation, not the scavenger's phase) and cut 502 → 223 KB a frame (a defect — the reflector dropped the host's EMPTY
  restless set, so every object's `lifted()` was asked every frame —, the mount-store cull by batch columns, springs at
  rest not stepped, the veil ask by index); the ≤ 64 KiB gate is NOT met and reads MISS.
- **Fixed**: rig:open's desk-copy row timed the GPU's ramp after the idle rows (a warm batch first); rig:stress's boards
  row read across three CDP round trips (read in-page).

<!-- design-016 K8a (2026-09-27) -->
- **Plugin parity — the open seams** (design-016 §5, K-L2: whatever a built-in kind can do, a plugin kind declares the
  same way). **Services** are an open registry by typed key — `serviceKey<T>(name)`, `service(key, value)`,
  `KindHost.use?(key)`, `ObjectDomHost.use`, `deskLayer({ services })`; a kind lends under a key (its `lend` receives a
  `LendHost` with `use` + `wake`) and any kind uses it; the text raster, the picture decoder, the byte store and the
  calendar's print raster are entries; a name lent twice is a mount error naming both lenders (D-K8a.1). **The ONE
  editor** is the desk's (`createDeskEditor`): every kind leases it through the `TextPart`s its `ObjectHost.text`
  declares — a tap-routed part (the note's body) or one its own half leases (the calendar's day line) (D-K8a.2).
  **Placement and `accepts` by provides-keys** — `DESK_OBJECT`, `CONTAINABLE`, `PINNABLE` in `@ice/desk`; the desk canvas
  places what provides `DESK_OBJECT`, the mini mat accepts `CONTAINABLE` (D-K8a.3). **Chips** name their FINISH and a
  container declares the finishes it draws (`ObjectKind.faceLaw: { radius, chips, finishes }` — the container's own
  numbers; D-K8a.4). **Held-tool glyphs**: `HeldGlyph` is a name of the bar's set or `{ path, fill? }` — the held bar
  draws a plugin's drawing (D-K8a.6). **Menu acts**: `defineObject({ menu })` → `WidgetType.menu`, run by
  `ops.runMenuAction`; the selection menu shows a kind's acts when every selected type declares them (D-K8a.7; the mini
  mat's vinyl left App.tsx). Every seam wakes the sleeping loop where it changes something visible.
- **Changed (0.14.0, unreleased API — renamed or reshaped at K8a):** `ChipKind` → a chip's `finish` (`ChipFinish`,
  `PAPER_FINISH`, `VINYL_FINISH`); `NoteEditor` → `DeskEditor`, `createNoteEditor` → `createNoteBody` (`NOTE_BODY`, the note's
  half); `NoteEditorOptions` → split in two, `DeskEditorOptions` (`createDeskEditor`: the container, the world, the text
  parts, `idleMs`, `wake`) and `NoteBodyOptions` (`createNoteBody`: the desk's `editor`, the world, the note's `driver`,
  `geometryOf`, `font`, `hand`, `now`); `ObjectHost.editor` → `ObjectHost.text`; `pinGreek(e, GreekPin)` → `pinAsset(e, asset)` (D-K8a.8); `KindHost`'s
  `text` / `print` / `blobs` / `decode` → `use(key)` (the desk's own doors — `pass`, `children`, `drawn`, `budget`,
  `rasters`, `remake`, `wake` — stay fields); `insideViewOfFace` takes the container's radius; `@ice/objects` no longer
  exports `DESK_OBJECT` (it is `@ice/desk`'s).

<!-- design-016 K7b (2026-09-28) -->
- **Scale: the flat-card pipeline, the far LOD, `rig:scale`** (design-016 §6, K-L2 · K-L4): a kind declares a
  `CardMaterial` — its own WGSL functions over uniquely named bindings — and `card/card.ts` composes every material into ONE
  pipeline with a dispatch, so interleaved notes, prints and whiteboards draw as ONE run (byte-identical to each kind's own
  pixels: 0 of 3,840,000 px differ; no kind is named). `CardPass.on` switches it; it is ON by default (D-K7b.2 — on this
  Apple GPU draws cost nothing and the composed shader ~5 % GPU, but hundreds of draws cost CPU and driver time elsewhere).
  The far LOD: a note below [48, 64] CSS px greeks its writing with its chip's lines and holds no raster (a crossfade across
  the band — 0 px differ at either end), a board at rung 1 takes no slot and asks nothing, prints show their thumbnail
  tier (D-K7b.3; 24 far scenes re-blessed). `rig:scale`: 10,000 objects in mixed kind order with real pictures — its light
  run (N 3,000, ≈ 2,000 drawn at zoom 0.2) joins `gate:landing` (sixteen rigs), the full run beside it. At zoom 0.2: draws
  674 → 19, GPU 4.79 → 4.60 ms (min), the pan's JS 2.84 → 2.30 ms, memory under its budget (23,744 → 117 evictions); idle
  asleep. Still MISSED: the pan's JS ≤ 2 ms and the 256 MB budget at the full 10,000 (board thumbnails at scale).

<!-- design-016 K8b (2026-09-28) -->
- **A third-party kind in its own package: the desk clock** (`examples/desk-clock`, `@ice-examples/desk-clock`, private —
  design-016 §5, K-L1 · K-L2): an analogue clock written the way a VibeField plugin will be, importing ONLY the published
  entries (`@vibecook/ice`, `/desk`, `/desk/kit`, `/desk/engine` — a unit reads them from the umbrella's exports map and a
  cruiser rule `examples-import-only-the-published-entries` fails anything else). Its own WGSL (a metal bezel, a recessed
  dial, SDF numerals and its own stroke font, faceted hands and their shadows, a glass glint, lume by night — the kit's
  light by name), an instanced pass on the slot's view block, durable props (style, 24-hour ring, seconds, zone), a
  REGISTERED WAKE (the next second or minute its hands need — never polled; seconds on: a submit per wall second and
  none between), a tray entry (a hook), a menu act with its own glyph, an opening with five held tools, a chip inside a
  mini mat, a round pick. apps/desk registers it beside the six (`c` sets one down, `s` its act); `rig:clock` (11 rows)
  joins `gate:landing` (seventeen rigs); the oracle's kind list is OPEN (`createOracleDesk({ objects })`) and five clock
  stills join the golden (111); `dts:check` compiles the clock against the umbrella's BUILT declarations. D-K8b.1: a
  plugin kind's logic is its desk state (`local`), drivers (input on one desk) or `defineBehavior` (a fact to sync, undo
  or keep) — design-015 §5.2's `behaviors: [noteTyping]` is superseded (typing is flux committed whole).

<!-- design-018 R2 — the tray's bar and its filters (2026-09-28) -->
- **The drawer's handle is DOM: `<TrayBar>`** (design-018 §5; `@ice/react`): one pill in the selection menu's ink, reading the desk
  handle's `tray` door structurally — at the view's foot while the drawer is shut ("Objects", the pegboard glyph; `a` still toggles),
  riding the drawer's top edge while it is out, `min(vh − 16, drawer.y − 10)` frame by frame (no render per frame, no rAF of its
  own), stepping aside in hand and when nothing hangs. Its downs are chrome's (`data-canvas-interactive`): a click on it never
  reaches the desk. apps/desk mounts it beside `<SelectionMenu>`; the menu's `--ice-menu-*` values now live once, both islands declaring them.
- **The tray filters by category** (design-018 §6): a runtime `Tray.category` ("" all) beside `open`, set by core's
  `setTrayCategory(world, id)` — the lay hangs only its entries, the board starts again at its top, and a category the frame hangs
  none of falls back to all; `trayCategories(world)` lists what the current frame hangs (`{ id, label, count }`, in the lay's
  order), with `trayCategory` and `trayEntryCount`. The bar's chips show them — All · Paper · Surfaces (· Things with the example
  clock); a plugin's `category` is its own chip. The built-in id `surface` is now `surfaces`.
- **The tray door hears the drawer** (`DeskLayerHandle.tray`): `category(id?)`, `categories()`, `anchor()` (`TrayAnchor` — the drawer
  as drawn, the view, the hand, the entries, the chips) and `subscribe(listener)`, told after each frame that moved it, never at rest.
  `rig:tray` drives the bar by real clicks on its rect (its button, the chips, the plugin's own chip); the rigs that hold the page's
  pixels to the renderer's hide it through the desk's door, `__desk.bar(false)` — rig:world, nav, portal, sticky, ruler, open and
  rig:tray's pixel rows (rig:parity's page has no chrome; rig:collab, clock, gpu and panel read nothing it covers).

<!-- design-015 D5b (2026-09-26) -->
<!-- design-018 R1 (2026-09-28) -->
- **The pegboard tray, refined — the board (design-018 §2–§4, R1).** The drawer reads as a hardboard panel lying over the cutting mat:
  - **Its edge** is an ARRIS — a 1.5 px quarter-round in the face's own material, lamp-lit where the outline faces the lamp, falling
    to the room's shade on the far side, with a faint shadow of the window's lip on the board along the lamp's side (`DRAWER.inner`);
    its corners a panel's 10 px. The cream rim (`DRAWER.rim`, its strips laid over everything, `TrayPass.drawRim`) and the finger
    notch (`DRAWER.notch`, `.notchRound`, ground.ts's three scissors round it) retired. The face runs to the outline: the scroll's
    range and the pose's `face` take the whole drawer.
  - **Shut, it is wholly off the view**: `drawerRect(vw, vh, p)` (its `lift` gone) rests it below the view by its shadows' reach
    (`SHADOW_REACH`, 62 px), and at p 0 the tray pass lays, uploads and draws NOTHING. The lip's drawing and its spring retired —
    `DRAWER.lip`, `.lipHover`, `.liftHz`, `.lipDrag`, `.lipPad`, `TrayPin.lift`, `TrayFrameInputs.lift`, `TrayFluxState.lift`,
    `TrayFacts.lip`; the specimens' hover keeps its 7 Hz as `DRAWER.hoverHz`. (The lip's INPUT and its fact are R2's.)
  - **The holes see the desk**: a hole shows what lies under the drawer as drawn — the mat's green, its grid lines, its leaves, a note
    laid there — in the board's shadow: premultiplied black at `1 − (1 − dim)·f^(1/2.2)`, `f` the lamp through the slot and the room's
    light cut by the cavity, encoded as the mat's own shade. The board lies ON the mat (`PEG.thick` 0.1, `PEG.gap` 0.03 — 0.13 pitch,
    the height the drawer's own lamp shadow is pushed by); `TRAY.cavity` 0.9 · 1 · 0.1; the research's plaster (`TRAY.research.wall`,
    `TRAY_LOOK.wall`, the record's `wall`) retired.
  - **The fade**: the specimens, their shadows, their accessories and their tags fade out over `DRAWER.fade` (28 px) below the face's
    top edge instead of being cut — a top FEATHER on the portal chain (`clips[i].z`, 0 everywhere else: every other scene
    byte-identical), so every kind that keeps the kit's contract fades with no code of its own, the plugin clock included. The notebook
    and the calendar honour the chain now, at the kit's composite, each object as one (`layerComposite` takes `view` + `portal`; new
    `layerCompositeLayout(device, label)`; `BoxTargets(…, samples, view)` binds the slot's view block).
  - Witnesses: rig:tray (a) the fade — seven kinds on the smoothstep's quarters, the tags and the accessories on its ramp · (b) the
    holes see the desk · (c) no notch · (d) shut, no tray draw; the five tray stills re-blessed, the other 107 scenes byte-identical.
  - **The holes fade at the top edge too** (James, 2026-09-28): within the same band a hole CLOSES into the plain face as the
    specimens fade — its opening scaled by their ramp (`tray.wgsl tray_board`: what it no longer opens is the face, its fillet's
    relief flattened by the same share), so the board is whole at the edge and every hole is as punched a band below it; the row
    that peeked 3 px under the edge at rest (D-R1.7) is gone with it. rig:tray (e) reads the opening 0.13 · 0.41 · 0.72 · 0.95 at
    6 · 12 · 18 · 24 px under the edge against the ramp's 0.12 · 0.39 · 0.71 · 0.94; the five tray stills re-blessed again.

<!-- design-018 R4 — the header (2026-09-28) -->
- **The drawer has a HEADER, and the filters are label tape on it** (design-018 R4 — James: "make the fade stronger and more gap, and
  design the filters nicely at that empty safe top space instead"):
  - **A clear band under the edge**: `DRAWER.header` (48 px) under the face's top edge where nothing hangs — no specimen, shadow,
    accessory or tag — and no hole opens: the plain face. Below it the content and the holes fade in over `DRAWER.fade`, now 32 px
    (R1's 28 ran from the edge itself). The face's portal clip starts at the header's foot with its feather F (so the scissor and the
    cull start there too), the tray's `fade` uniform carries (F, H) for `tray_board`'s holes and `tray_accessory`, and the tags' ramp
    and scissor start at the foot; `contentShown(rect, y)` is the law on the CPU.
  - **The lay starts below it**: kernel `TRAY_SPACING.top` 0.5 → 2 pitches, so at rest nothing laid is faded (every footprint at
    ≥ 99 % of the ramp — the desk's test holds the two numbers together). Every line hangs one row (40 px) lower, the scroll's range
    grows by the same, and the stagger's parity puts the first line half a pitch further left.
  - **The pose seam carries it**: core `TrayScreenFrame.head` (the flux publishes the arris + the header) — a specimen scrolled under
    the header is never hovered or taken there; a press there is the board's.
  - **The chips are LABEL TAPE in the header** (`<TrayBar>`): All · Paper · Surfaces · Things in the specimens' own tag language —
    the embosser's near-black tape and its raised capitals (the desk's `MARKS.label`; `DESK_TAPE`, custom properties an app
    re-points as it does the ink), the page's mono stack, 26 px, a top-lit gloss, the capitals embossed, a contact shadow down the
    tray lamp's direction, a 1 px lift on hover, the brass focus ring — the CHOSEN one cream tape with ink letters. Centred on the
    drawer and in the band, following the slide and fading in over its last part; past the band's width they scroll inside it, each
    end fading where more tape lies beyond; by night the tape steps back as the tags do (`TrayAnchor.night`, the theme's), the cream
    one to the brightness their capitals reach. The pill keeps the handle alone — "Objects" at the foot, "× Objects" riding the edge.
    `placeTrayBar` returns both islands (`{ y, head }`); `TrayAnchor.drawer.header` says where the band is.
  - Witnesses: rig:tray (a) and (e) retargeted to the header (nothing in it, the ramp's quarters under it), the bar rows (the chips
    found in the header by their DOM rects, none in the pill), and a rest row (nothing laid faded; the chips over bare board, at rest
    and with the first line run up under them); the five tray stills re-blessed, the other 107 scenes byte-identical.
<!-- design-018 R5 — the veil (2026-09-28) -->
- **What hangs in the ramp fades INTO the board, never see-through over a hole** (design-018 rev 5 — James: "at the edge fading,
  somehow the holes are displayed on top of objects"). R1–R4 faded a specimen by turning it transparent (the face clip's feather), so
  in the ramp the holes behind it showed through it. The specimens, their accessories and their tags are now opaque to the face clip's
  top (no feather; `tagFadeOf` retired — the tags have no fade of their own), and the tray lays a VEIL last, over everything the drawer
  holds: the plain board (`tray.wgsl tray_veil` — `tray_drawer`'s own pixel with every hole closed: its face, its edge, the edge's
  inner shadow), whole in the header and fading out over its ramp. So a specimen and the holes behind it fade into the board together.
  One quad (`TrayPass.drawVeil`, the `tray/pegboard/veil` pipeline), only where the pixel is wholly inside the outline. `tray_board`
  takes the holes' opening as an argument (1 under the specimens, 0 in the veil). rig:tray (f): the note laid across the ramp, pixels
  over a punched hole against those over the face row by row — worst |Δ| 1.0 of luminance (with R4's feather, 33.8). The five tray
  stills are re-blessed; the other 107 are byte-identical.

### Removed — THE DELETION (design-015 §1 · §11.5; D-D1 · D-D2 · D-D3 · D-D14 · D-D15; the 0.14.0 break list)

The hybrid is gone: no DOM under the camera, no GL islands, no old ground engine, no presentation
profiles, no React widget faces. `three`, `@react-three/fiber` and `stats-gl` leave the package's
dependency graph entirely (`pnpm install` resolves 80 fewer packages); the desk is the one
presentation and `apps/desk` the one app. Grep and depcruise witnesses: no `three`, no
`packages/r3f`, no `packages/ground`, no world-space half of `packages/dom`, no `SurfaceTarget`, no
`layoutsubtree` anywhere (§11.5); the desk oracle's 92 renders are sha-equal before and after (the
deletion moves no pixel). Each line below is an export or an entry a consumer could have named.

**Entries of `@vibecook/ice` (`packages/ice`):** `./r3f`, `./r3f/webgpu`, `./ground`,
`./ground/compose`, `./ground/packs`, `./ground/engine` are gone; `./desk` (the desk — the
renderer, `deskLayer`, `defineObject`, the kind registry, the theme, the shaders' text, the blue
noise), `./desk/engine` (the raw-WebGPU engine) and `./desk/objects` (the six reference kinds) are
new. Eight entries: `.` · `/kernel` · `/dom` · `/desk` · `/desk/engine` · `/desk/objects` · `/react`
· `/devtools`. The `three` and `@react-three/fiber` peers and the `stats-gl` dependency are struck;
`react`/`react-dom` stay optional peers. `pack:audit` now walks EVERY entry and fails on any
`three`, `@react-three` or `stats-gl` edge (`no-three`, §3); the plates it checks for are the
desk oracle's `gobo-b`/`gobo-c`.

**Packages deleted whole:** `@ice/r3f` (islands, `IslandRender`, the GL plane adapter,
`BoardGLCanvas`, preview capture, the WebGPU renderer leg, `createGLBridge`, `<GLViews>`,
`useIslandFrame`, the GL pointer router — 4,383 src lines) and `@ice/ground` (the 09-07 engine:
the magnet `Field`, the dot/needle/line glyphs and poles, the card pass and `vfFrame`, `DomRender`
· `DomCompose` · `IslandRender` · `VideoIngest`, the residency trunk, the copy budget, the shield,
the stills, the HiC adapter, the nav fill pass, its oracle and `groundlab` — 11,092 src lines).
What the ground PROVED carries as law in `@ice/desk` (its `engine/` is the prototype's, byte for
byte, D1); its overlay seam (`overlay` · `soup` · `wires-collect` · `guides-collect`, 940 lines) is
NOT carried as code: the desk's marks pass draws the guides as lasers and the marquee (D4a), and no
desk kind declares a port yet, so a wires pass has nothing to draw — it is owed to the first kind
that does (recorded below). `submit-instrument` the desk already had (`instrumentSubmits`).

**`@vibecook/ice` (core):**
- `defineWidget`: `WidgetDef.surface`, `component`, `chrome`, `animated`, `preview`,
  `instancePreview`, `sizeMode` and the container's `framePreview` are gone; a widget's FACE is its
  `object` kind binding (design-015 §5.2), optional — a widget without one is faceless (the desk
  draws nothing for it) and gets no `Stratum` unless it declares one. The retired fields are REFUSED
  at definition for the JS caller TypeScript cannot stop (the `presentation` precedent). `openable`
  requires a binding. `WidgetType` loses `surface`, `component`, `chrome`, `sizeMode`, `animated`,
  `previewComponent`, `previewProps`, `instancePreviewProps`; `WidgetContainerDef`/`WidgetContainerEntry`
  lose `framePreview`; `ContainerDef` loses `surface` and `framePreview`. `WidgetSurfaceKind` and
  `SizeMode` are gone. `defineContainer({ object, stratum })` still makes a container object.
- The presentation vocabulary (`catalog/surface.ts`): `SurfaceKind`, `SurfaceTarget`,
  `RequestedDemand`, `SurfaceDemand`, `SurfaceBand`, `TextureRef`, `NO_TEXTURE`, `effectiveTarget`
  are gone. `Retained` stays (the nav crossfade's pin). Equip stamps no surface fact.
- The surface infra: `installSurfaceInfra`, `ResidencyOptions`, `SurfaceInfraOpts`,
  `createSurfaceBandSystem`, `createSurfaceDemandSystem`, the residency module (`layer-allocator`,
  `residency-system`, `texture-table` — every export), the surface contract (`SurfaceKindValue`,
  `SurfaceFpsBucket`, `SurfaceDemandValue`, `DEFAULT_SURFACE_DEMAND`, `PAUSED_SURFACE_DEMAND`,
  `toFpsBucket`, `demandIntervalMs`, `foldDemand`, `WidgetSurface`, `WidgetSurfaceView`,
  `WidgetSurfaceSeams`, `createWidgetSurfaceView`), three's backend-texture read (`backendTexture`,
  `backendTextureIsSrgb`, `backendTextureRecord`, `BackendLike`, `BackendTextureRecord`,
  `RendererWithBackend`) and the GL allocation ledger (`createGpuAllocationLedger`,
  `GpuAllocationLedger`, `GpuAllocationStats`, `GpuAllocatorHandle`, `GpuAllocatorRegistration`,
  `GpuReservation`) are gone. `acquireCompositorDevice` stays, slimmed of its three rules
  (`EngineGpu`, `AcquireDeviceOpts`, `GpuUncapturedError`, `GpuUnavailableError`), as the device
  injection door (`createCanvasEngine({ compositorDevice })`).
- The three standard surface behaviours — `domAtRest`, `alwaysGpu`, `alwaysDom`,
  `STANDARD_SURFACE_BEHAVIORS`, `registerStandardSurfaceBehaviors` — are gone; the engine registers
  no behaviours of its own (`engine.behaviors.list()` is the app's), and the compiler's exact-name
  attestation for them went with them. `defineEngineBehavior` and the `ice:` reservation stay.
- The pipeline: `PHASE_GROUPS` loses `present:infra` — eleven phases, design-002 §2's table as first
  written.
- The mount store: `WidgetRuntime` is `{ cullSystem }`; `store`, `mountSystem`, `flush`, `MountEntry`,
  `WidgetMountHold`, `WidgetMountStore`, the keep-mounted LRU and `retainForTransition` are gone;
  `installWidgetRuntime(engine)` and `createWidgetRuntime(world)` take no options. `Visible`/`Culled`
  is the desk renderer's working set.
- Measurement: `MeasuredSize`, `createMeasureQueue`, `MeasureQueue`, `MeasureEvent`,
  `createMeasureIngest` and `CanvasEngineOpts.measureQueue` are gone; every "effective size"
  (the cull, the selection chrome, the breakpoint tiers, presence, `arrange`, the frame view and
  preview, drop placement) is `Size`. `MeasuredSize` leaves the published behaviour read surface.
- The transition planes: `PresentationPlane` is `"ground"` alone (was `"ground" | "dom" | "gl"`);
  `presentationPlanesOf` is gone; a flight prepares `ground` when either canvas type declares a
  ground or a visible object stands in the departing frame.
- Settings: `RUNTIME_BUDGETS.keepMountedWidgets` and `.fboBytes`, `CHROME_DEFAULTS.selectionReach`,
  `ChromeSettings.selectionReach` (the shield's reach) and `createCanvasEngine`'s
  `budgets.keepMounted` / `budgets.fboBytes` / `settings.chrome.selectionReach` are gone.
  `CanvasEngine.gpu` (the ledger) and `budgets.keepMounted`/`fboBytes` are gone;
  `budgets.framePreviewChildren`/`framePreviewBytes` stay.
- `EngineCatalog.framePreviewRendererForContainer` and `FramePreviewChild.previewModel` are gone
  (the container's React preview renderer and the instance-preview model).

**`@vibecook/ice/kernel`:** `surface-geometry` (`geometry`, `SurfaceGeometry`, `SurfaceExtent`,
`RasterStrategy`), `zoom-bands` (`ZOOM_BANDS`, `selectBand`, `isOutOfBand`, `fboPixelSize`),
`eviction` (`selectEvictions`, `computeIslandPhase`, `EvictionCandidate`, `IslandPhase`), `lift`
(`LIFT_EASE`, `FADE_EASE`, `LIFT_DURATION_MS`, `easedValue`) and coords' island helpers
(`worldToIsland`, `islandToWorld`, `compositeCameraFrustum`, `worldRectToComposite`) are gone.
`planeCssTransform` stays. `atlas-pack` is PARKED (exported, unread).

**`@vibecook/ice/dom` — SCREEN SPACE ONLY (D-D15):** `createPlanes`/`Planes`,
`createPlaneTransformReflector`/`CameraPlanes`, `createGrayboxReflector`, `createDomWidgetsReflector`
(+ `DomWidgetsHost`, `DomWidgetsOptions`, `DomWidgetsReflector`), `createDomWritebackReflector`
(+ `DomWritebackHosts`, `DomWritebackReflector`), `createSourceCanvas` (+ `SourceCanvas`,
`SourceCanvasEffects`, `SourceCanvasOptions` — the L1 `<canvas layoutsubtree>`), the Widget Surface
contract (`compositedSurfaces`, `stratifiedSurfaces`, `widgetSurfaceKind`, `CompositedSurfacesOptions`,
`StratifiedSurfacesOptions`, `WidgetSurfaceDemandSeam`), `createChromeReflector` (P4), the
measurement adapter (`attachMeasureAdapter`, `MeasureAdapter`, `wireMeasurement`, `MeasureWiringHosts`,
`MeasureWiringOpts`) and the pointer adapter's GL route (`GLRoute`, `GLRouteVerdict`,
`PointerAdapterOpts`; `attachPointerAdapter(host, queue)` takes two arguments) are gone.
`CanvasHost` loses `contentPlane` — no DOM element carries a camera transform (§2 law 2).
`attachWidgetFocus(host, lookup?)`'s lookup is optional. **New:** `createDeskHost({ container,
engine, layer })` — the vanilla mount (host → the desk's layer → reflectors [layer · cursor ·
remoteCursors] → pointer adapter → focus → viewport → rAF loop), typing the desk structurally as
`LayerFactory`/`LayerContext`/`LayerHandle` (`DeskHost`, `DeskHostOptions`).

**`@vibecook/ice/react`:** `<InfiniteCanvas>` → **`<Desk engine layer keymapOverrides? onReady?>`**
(wraps `createDeskHost`; `DeskProps`, `DeskHandle { engine, host, layer, focus }`; the
`ground`, `grid`, `glRoute`, `measureQueue`, `profile` and `chrome` props are gone with the planes
they configured; no compatibility alias). `GroundLayerFactory`/`GroundLayerHandle`/
`InfiniteCanvasHandle`/`InfiniteCanvasProps` → `LayerFactory`/`LayerHandle`/`LayerContext`
(re-exported from dom). `WidgetRoot` (+ `WidgetComponentProps`, `WidgetHosts`, `WidgetRootProps`),
`WidgetPreview`/`WidgetPreviewProps`, the preview snapshots (`getPreviewSnapshot`,
`hasPreviewSnapshot`, `setPreviewSnapshot`, `subscribePreviewSnapshots`, `PreviewImage`), the surface
content seam (`SurfaceContentContext`, `surfaceContentOf`, `useSurfaceContent`, `ContentRenderSlot`,
`ContentRenderSlots`, `ContentSink`, `SurfaceContent`, `TextureDescription`), the presentation
profiles (`PresentationProfile`, `PresentationProfileName`, `ProfileBootContext`, `stratifiedProfile`,
`compositedProfile` — one presentation, DK-D8), `WidgetHiddenContext`, `ChromeOwnerContext`,
`ChromeOwner` and `useChromeOwner` are gone. `useWorldComponent`/`useSelected` no longer freeze
under a hidden portal (there are none). The hooks, `EngineProvider`, `useCommit`, the keymap and
`<SelectionMenu>` stay.

**`@vibecook/ice/devtools`:** `createGlPanel` (+ `GlPanel`, `GlPanelCorner`, `GlPanelOptions`,
`GlPanelStats`), `DevtoolsOpts.glPanel` and `DevtoolsHandle.glStats` are gone; `DockSlotId` is
`"profiler" | "observer"`.

**`@ice/desk` (workspace):** its entries mirror the umbrella's — `.` (the root barrel), `./engine`,
`./objects` (+ `./oracle/*` and `./assets/*`, the rigs' doors, which the umbrella does not ship);
`./host`, `./compose`, `./kinds`, `./theme`, `./shaders`, `./noise`, `./object` fold into the root.
`deskLayer`'s mount context takes `host: { container }` (no content plane) and prepends its canvas.
`defineObject` no longer passes `surface: "object"`; `objectKindOf` reads the binding.

**The nine apps** (`graybox`, `pointerlab`, `cardboard`, `glboard`, `nodeboard`, `moodboard`,
`widgetlab`, `widgetlab-desktop` with its Electron shell, truffle mesh and HiC probes, `groundlab`)
are deleted (D-D14). Their exit tests were ported or retired BY NAME at D5a (§11.6): M5 two-tab →
`rig:two-tab`; M8 cascade + port-churn → core tests; M9 collab → `apps/desk`'s collab test +
`rig:collab`; M10 exit-imports → `apps/desk/test/exit-imports.test.ts` (THE SURFACE now mirrors the
umbrella's entries); M6 `exit-trace`/`cull-reenter` and M7 `gl-router` retired WITH their subject.
`electron` and `@vibecook/truffle` leave `allowBuilds`; the `@react-three/fiber` patch leaves
`patchedDependencies`. `gate:landing` = the desk oracle → the `apps/desk` build → its twelve rigs →
`pack:audit`.

**Tests retired with their subjects:** core's `surface-*`, `residency/*`, `gpu-allocation-ledger`,
`measure-ingest`, `widget-preview-schema` suites and the `behavior-idle-snapshot` bench
(`domAtRest`'s idle row — its numbers stay in `docs/benchmarks.md` as history); dom's world-space
suites; react's profile, portal, preview and `chrome-prop` suites; kernel's `surface-geometry`,
`zoom-bands`, `eviction`; devtools' GL panel cases. The coordinator's suite is ported to the one
plane (the two cases that were ABOUT a second plane are recorded there as retired, not faked).

**Owed after D5b:** the string between objects — a wires pass on the desk (`wires-collect` + `soup`
were the ground's; the first desk kind with ports brings it back); the M3 baseline re-measured on
`apps/desk`'s stress rig (D6); the design-004/005 amendments live in `draft/` (the orchestrator's
snapshot); VibeField's migration (plugin ABI `surface`/`component`, plugin-sdk re-exports,
design-kit's chrome + GL, the five product cards) is its OWN program (D-D17) — VibeField pins
0.11.0 and is untouched.


<!-- design-015 D7 — the fix wave's removals (the surface lens; each nothing had read since D5b) -->
**Removed at D7 — dead settings and exports, named so a caller learns what stopped:**
- **`defineCanvasType`'s `presentation.ground.{glyph, grid, wires, guides}`** — validated, never read since D5b, now
  REFUSED by name at definition time (like `program` since C2). What each did until D5b: `glyph`/`grid` chose and tuned
  the dot/line/magnet grid the mat replaced; `wires: false` hid the root slot's wire overlay (dom's, gone with the
  world-space half); **`guides: false` hid the snap guides — since D5b the desk's marks draw them as lasers ALWAYS,
  and the flag silently did nothing.** `presentation.ground` itself stays as a bare marker (`ground: {}`): a type that
  declares it still requires the `ground` plane for a flight. The catalog's empty-glyph check went with `glyph`.
- **`presentation.preview.background` and `.renderer`** (refused by name) and the catalog's
  **`framePreviewBackgroundForContainer`** — opaque tokens for the frame-preview renderers that left at D5b.
  `preview.projection` stays.
- **core's ground-layer configs, the whole module:** `GridConfig`, `GridMagnetConfig`, `DEFAULT_GRID_MAGNET_CONFIG`,
  `DEFAULT_GRID_CONFIG`, `WiresConfig`, `DEFAULT_WIRES_CONFIG`, `SnapGuidesConfig`, `DEFAULT_SNAP_GUIDES_CONFIG`. The
  desk's grid is `@vibecook/ice/desk`'s own `GridConfig` (its fade-in and its mat).
- **`DeskLayerHandle.configureGrid`** — it read only `fadeIn`; `configureFadeIn` is the live door.
- **kernel `planeCssTransform`** (the retired planes' camera transform — the DOM is screen space, §2.2; D5b's note
  kept it, nothing read it) and **`tessellateCubic`** / **`Tessellation`** (the retired @ice/ground wires pass's).
- **`EngineGpu.hasCoreFeatures`** (three's compatibility-mode signal; see "One device per engine" below).
- **`SelectionBox`** (component) and **`VisualOf`** (relation), with the pooled selection-box ENTITY `selectionChrome`
  spawned beside the handles: the P4 DOM chrome that drew the box left at D5b, nothing read it, and it was rewritten
  every frame the union moved (every drag frame). A non-resizable multi-selection's group box went with it (the desk's
  marks draw every selection's look). The 8 resize handles stay — picking reads them — and `settings.chrome.liftScale`
  stays with them: it places the handles about a lifted card (the review read it as the box's alone).
- **`DeskLayerHandle`'s per-kind doors** — `typing`, `writing()`, `pen()`, `notebook()`, `calendar()`, `pinRaster`,
  `clearRasters` — replaced by ONE `driver(type)`: a kind DECLARES its drivers in `defineObject({ drivers })` and the desk
  wires them generically (the kind-drivers seam, D7), so a third-party openable kind gets its driver too.
- **`desk.calendar`'s `month` default** is `""` (it was the literal `"2026-09"`): a pad spawned without a month shows the
  month of its own today, in its zone.

<!-- design-018 R2 (2026-09-28) -->
- **The tray's lip as INPUT** (design-018 §5): `Tray.lip` (its hover fact), `TrayPress` kind `lip` and `TRAY_INPUT.handlePx` /
  `lipDragPx` / `lipPadPx` — a shut drawer takes no pointer, and a press at the bottom centre is the desk's; the lip's "pointer"
  cursor went with them (the lip's drawing and its lift are R1's). The built-in tray category id `surface` (now `surfaces`).

### Fixed

<!-- core (2026-09-26) -->
- **A click whose release shares its frame with a far move no longer leaves a ghost drag.** Found under CDP
  input in `apps/desk` (the D3w build dodged it with a 120 ms pause after each click); a hand reaches it with
  a quick tap and a flick of the cursor. `pointerIngest` folds a tick's events into one sample per pointer, and the
  fold ran PAST a transition: a release and a move 500 px on, coalesced, published `WentUp` at the MOVE's
  point. The tap failed its slop; the drag measured its dead zone to a point reached after the release, went
  Active on the clicked object and — its one-tick `WentUp` spent — stayed Active, the object following the
  cursor until the next press. The press, the release and the move all in one tick picked at the far point,
  so the click selected whatever lay there instead. Now **a pointer's fold ends at its transition** (down,
  up, cancel): the first event past one ends the tick's drain, and it and everything behind it — every
  pointer, every key, arrival order kept — are the next tick's facts; moves and wheel deltas between
  transitions still fold. And **a Possible drag that sees its pointer's release fails**, dead zone crossed
  or not: pressed travel can still fold into the release's own tick (a flick, a starved frame), and a drag
  promoted there never saw its release — such a flick is now no gesture at all. Held by
  `trace/coalesced-release.test.ts` (the click folded into one tick and across two, the flick, the cut's
  prefix order — each red on the pre-fix source) and `rig:interact` §8d (a press, a release and a far move
  sent back to back; the press stepped alone, then the release and the move together). By design, a press
  that shares its frame with the moves after it now picks, and anchors its recognizers, at the press — not
  at the last of those moves (in `rig:interact` §3 the drag's slop now eats one sample).
- **The selection is always a subset of the current frame's members** (design-011's `Selected ⇒ Active`,
  now held in the world). Found at D4a's landing: a note dropped into a mini mat stayed `Selected` inside it.
  Nothing drew that selection (the marks belong to the root slot), yet every consumer that does not filter by
  membership could still reach it: the arrow nudge, ⇧⌘L's tape, a drag of the rest of the selection, a resize,
  Clean Up. `activeMembership` now deselects a widget in the same flush that classifies it out of the frame:
  a drop, a peer's reparent, an undo or a redo that carries it away. It also journals `Selected`, so a
  selection written onto a standing non-member is dropped the next tick (the undo stack's restore of a stale
  key, an app's raw write). The tray's select-on-drop no longer selects a twin created inside a container.
  Held by `consume-selection.test.ts` (6 cases, each red on the pre-fix source) and `rig:interact` §8b:
  after the drop nothing is selected, an arrow key nudges nothing inside, and ⌫ deletes nothing there. On
  the pre-fix desk, the selection still held the note and the arrow moved it 1 px inside the mat; ⌫ was
  already safe, because `deleteSelection` filters by membership.
- **A drop into a container now honours ⌥ at the drag's start.** D4a's ⌥ latches `LeavesCopy` on the
  recognizer, and the plain move's release commits a copy at the origin; the consume path ignored it. So ⌥ at
  the start, released before the drop, sent the object into the mini mat and left no copy. Under the recorded
  (provisional) design, the consume now does both in its ONE transaction: the original goes inside, and a
  copy stays at the origin on this desk, in the original's lifted place on top (`order: "last"`, since
  `{ before: original }` would name a sibling that is no longer in the frame). One ⌘Z undoes both. ⌥ held
  throughout still keeps the moved object out and leaves the copy. Held by `consume-copy.test.ts` (all four ⌥
  combinations; the start-only row is red on the pre-fix source) and `rig:interact` §8b (the copy at the
  origin and the note inside; one ⌘Z removes the copy and brings the note back).
- **Arbitration decides once per pointer per tick, over every claimant.** A strata system body runs once per
  matching chunk, and the recognizer kinds live in different archetypes. So the tie rule (Pinch > Drag >
  LongPress > Tap) never compared, say, a Tap with a Drag. The first batch's claimant won and failed the
  rest; a later batch read `ClaimedBy` before the flush, claimed too, and failed back. A tie could leave the
  pointer claimed by a Failed recognizer, both gestures dead. `arbitration` is now a tick system: it collects
  the tick's claimants, then decides. A claimant that loses the tick's tie fails even from a terminal phase
  (a Tap's `Recognized`), so a pointer gets one outcome, not a drag AND the tap it beat. That matches the
  drag-first case, where tap-then-drag already fails the pending tap. `runIf` skips ticks with no fresh
  claim. The ties the stack can produce: a long-press hold on the tick the drag leaves its dead zone (a
  long-press slop wider than the drag's), and a multi-tap window that closes on the tick a new drag on the
  same pointer activates. Held by `trace/arbitration-batches.test.ts` (hand-made claimants in both spawn
  orders, plus the two ties through the pipeline; all 7 red on the pre-fix source, 4 of them red with only
  the terminal-loser rule reverted) and `rig:interact` §8f (the desk at a 20 px long-press slop, the loop
  parked by the frame gate and stepped by hand to the exact tick). With the fix the drag takes the note and
  it follows by (40, 20); before it, the note never moved. `window.__desk` gains `gestures(patch)`.

<!-- design-015 D7 — the fix wave, the surface lens (2026-09-26) -->
- **The published quickstart runs** (D7 surface #1). `Palette` is typed `{ canvasBg, select }`, but `deskLayer` builds
  every kind's look at the mount and the board's, the note's, the notebook's and the calendar's `theme()` throw without
  their materials; the only complete palette was the oracle's fixture, which the package does not ship, and the README
  imported it from "`./palette` — apps/desk/src/palette.ts is the model". Now `@vibecook/ice/desk/objects` SHIPS the
  reference objects' default look — `deskPalette(name)` / `deskTheme(name)` / `DeskPalette` and `PRESENCE_INKS` (the
  fixture's table moved to `src/objects/palette.ts`; `oracle/fixtures/vf-theme.ts` re-exports it; the theme gate's second
  home moved with it, D-D7-C.1) — and the desk's ENGINE PRESET: `DESK_ENGINE` (`deskSelect`, `DESK_TOOLS`, `DeskCanvas`,
  `DESK_OBJECTS`), so `createCanvasEngine(DESK_ENGINE)` is the desk the README promises — the plain wheel zooms about the
  pointer, a bare-mat drag pans (shift marquees), the zoom is scale-free, the zoom-through is on. Core seeds the
  active tool from the ROOT canvas type's default (D-D7-C.2; `select` when it names none) — the desk's tool was in hand
  only after an app's `setTool`. A mount whose palette cannot answer throws BEFORE it touches the page (no canvas left in
  the container, no reduced-motion listener armed over a binding in its TDZ). "Wired into node graphs" is gone from the
  README (no kind has ports). Held by `packages/desk/test/quickstart.test.ts` (the READMEs' imports against the umbrella's
  exports map, both themes' looks, the failed mount on a fake page, the preset's resolved settings — each red on its
  pre-fix source). apps/desk takes the shipped preset and palette like a third party.
- **The oracle holds a COMMITTED pixel golden** (D7 surface #2). The only before/after check could not go red:
  `baselineCheck` ran only under `BASELINE_DIR`, which gate:landing never set, and answered a missing file with a SKIP
  (`BASELINE_DIR=/typo` exited 0); rig:parity and rig:world compare Chrome to Node renders the SAME commit wrote, so a
  WGSL or constant edit that moves pixels the same way in both hosts passed unless a property check happened to cover
  it. Now `packages/desk/oracle/shas.json` pins every scene's sha-256 (101 scenes) and the oracle — gate:landing's first
  step — FAILS on a moved pixel, a scene with no entry, or an entry with no scene; `ORACLE_BLESS=1` re-blesses (a
  deliberate event: the file's diff IS the pixel change, committed with its why — on another GPU or driver as well).
  A missing baseline file FAILS. Red proof: the marker ink darkened 3 % (`ink.wgsl`, both hosts alike) — the pre-fix
  oracle exits 0 (every property check passes), the golden fails 7 scenes; `BASELINE_DIR=/typo` exits 1 (was 0).
- **The rigs see the faults the engine contains** (D7 surface #3). Every rig's "no page errors" row listened to
  `Runtime.exceptionThrown` and `Log.entryAdded` only; the reflector flush catches every throw and `console.error`s it,
  Chromium never sends console-API messages to the Log domain, and apps/desk passed no fault sink — a kind's record
  throwing on some frames skipped those frames with every row green. Now the facade takes **`onReflectorFault`**
  (forwarded to the engine's flush; default unchanged: `console.error`, the frame skipped), apps/desk's engine routes
  each contained reflector or guest fault into `DESK_FAULTS` = **`window.__desk.faults`** (and still to the console),
  and the rigs share `watchPage` (exceptions · `Runtime.consoleAPICalled` at error/assert · the Log domain) and
  `faultsOf` (`scripts/cdp.mjs`): every "no page errors" row also holds the faults to none, and rig:world gains the row
  it lacked. Red proof: rig:idle with a reflector throwing on alternate frames and one page `console.error` injected —
  the pre-fix rig passes 10/10, the fixed one fails its row (3 console errors + 3 faults listed); the unit
  (`apps/desk/test/faults.test.ts`) is red with the facade's forwarding reverted.
- **M10 holds the product to the UMBRELLA's surface** (D7 surface #4). THE SURFACE admitted `@ice/desk/oracle/*` and
  "published" read the WORKSPACE package's exports map, so M10 could not go red for an entry `@vibecook/ice` does not
  ship — and the product's own modules imported the oracle (the palette, the presence inks, the plates, the prints),
  which is why the unpublished palette (#1) went unseen. Now `apps/desk/test/exit-imports.test.ts` reads each page's
  module graph: THE PRODUCT (`index.html` → `main.tsx`, static and dynamic edges, type-only included) imports THE
  SURFACE only, and every SURFACE entry must be one `packages/ice/package.json` publishes (read back through
  `packages/ice/src/<entry>.ts` to its workspace barrel); THE RIGS' pages may add the oracle's door. The oracle
  staging moved out of the product (D-D7-C.3): `src/rig/` (`stage.ts` ← `scene.ts`, `scene-kinds.ts`,
  `oracle-fixtures.ts` ← `fixtures.ts`, `harness.ts`) loads only on the new **`rig.html`** (the desk + the harness,
  which opens `window.__deskRig`); `window.__desk.setScene` and `kinds.print` go through `src/rig-door.ts` and refuse
  by name on the product page; every `rig:*` drives `rig.html`. The parity page (`parity.html`) is test-only and keeps
  its oracle imports. Red proof: the new test over the pre-D7 `apps/desk/src` is red on exactly the four product files
  (`palette.ts`, `desk.ts`, `fixtures.ts`, `scene-kinds.ts`).
- **One device per engine** (D7 surface #6). `acquireCompositorDevice` still carried the three.js creation rules and
  the islands' header (the changelog's "slimmed" was not yet true), and nothing read `engine.compositorDevice`: the
  facade's doc said to hand it to `deskLayer({ gpu })` — an option that takes a `GPU`, not an `EngineGpu` — and the layer
  always acquired its own device, so an app following the doc ran TWO devices and `errors()` never saw the desk's GPU
  errors. Now the door is slimmed (a plain adapter and device, `requiredFeatures` opt-in, the `addEventListener` error
  log armed before any consumer; `EngineGpu.hasCoreFeatures`, three's compatibility-mode signal, is REMOVED), dom's
  `createDeskHost` hands `engine.compositorDevice` to the layer as `LayerContext.gpu`, and `deskLayer` DRAWS WITH IT
  (`adopt` in `@vibecook/ice/desk/engine` wires its loss and errors like `acquire` does) — never acquiring a second one,
  never destroying the app's; with no engine device it acquires its own as before. `handle.device()` is the device the
  layer draws with. The facade's, core's and `ground.ts`'s docs say so. Held by `packages/desk/test/device.test.ts` (the
  engine's device drawn with, no second `requestAdapter`, `errors()` holding the desk's error, the device alive after
  dispose; the own-device path destroyed at dispose) and `packages/dom/test/desk-host.test.ts` — red with the layer's
  or the host's hunk reverted.
- **`selectionChrome` produces only what picking reads** (D7 surface #8): the 8 resize handles. The selection-box
  entity, its `SelectionBox` value (rewritten every drag frame) and the handles' `VisualOf` edges to it are gone (see
  `### Removed`). Held by `core/test/selection-chrome.test.ts`: a selection spawns the 8 handles and NOTHING else, a
  non-resizable single or multi selection spawns nothing — both red on the pre-fix producer (9 entities: the box).
- **The workspace's approvals and the product's plates are checked** (D7 surface #9). (a) `pnpm-workspace.yaml`'s
  `allowBuilds` still held pnpm's placeholders — `"set this to true or false"` for `electron` and `@vibecook/truffle`
  (D5b's install wrote them) — under a comment, and a changelog line, saying both had left; neither is in the lockfile.
  Removed, and `scripts/check-workspace.mjs` (run by the root `gen:check`, so `ci`) holds every approval to a boolean
  for a package the lockfile resolves — red on the pre-fix file (four rows). (b) `apps/desk/assets/gobo-{palm,canopy}-1.rgba`
  (2 × 1 MB) had no generator in ICE, only a comment citing the prototype's. The generator moved in:
  `apps/desk/tools/make-gobo-plate.mjs` (the prototype's, its image path and PNG previews left behind), whose
  `--check` — apps/desk's `gen:check` — regenerates `palm --seed 1` and `canopy --seed 1` and fails on any differing
  byte (both reproduce byte for byte; one flipped byte in the palm plate → FAIL).
- **The docs say what the code does** (D7 surface #10). `docs/api.html` documented `defineWidget`'s `surface`/`component`
  as required and `sizeMode`/`animated` as fields (all refused since D5b — an `object` row replaces them), gave
  `createCanvasEngine` a `measureQueue` (so did `api-reference.md`), budgets it no longer has, and a quickstart and
  "Try it" blocks built on `<InfiniteCanvas>` and deleted apps; its renderer entry described portals, islands and a
  keep-mounted LRU. `docs/index.html` still showed "Six planes, one camera", GL islands, the keep-mounted LRU,
  `MeasuredSize` and the GL router, and "React and R3F components … wired into node graphs". The READMEs said
  `/desk/engine` holds "device, surface, passes" (the swap chain is `/desk`'s; no pass ships there);
  `api-reference.md`'s `defineTool` row lacked `canvasDragShift`; JSDoc named `@ice/desk/host` (not an entry),
  `<InfiniteCanvas>` as the menu's engine provider, "three adopts it", and the retired `SurfaceTarget` as current.
  Each fixed; `scripts/check-docs.mjs` (the root `gen:check`, so `ci`) pins the ten rows — red on the pre-D7 tree.
- **`pack:audit` audits what ships** (D7 surface #11). It sought the plates by NAME (a plate inlined as base64 passed),
  walked the SOURCE graph for three though its header said all checks read `dist/`, and checked neither the d.ts, the
  exports targets, the externals against the declared dependencies, nor that each entry imports in Node; and
  `fix-dts-specifiers` rewrote and guarded bare `@ice/<pkg>` only — a subpath like `@ice/desk/objects` was neither
  rewritten nor caught. Now eight rows, all off `dist/`: the plates (the oracle's two and apps/desk's two) by three
  base64 needles of their own bytes; the blue noise; the WGSL; the chunks' own imports three-free; every external a
  declared dependency or peer and every dependency used (or ambient: `@webgpu/types`); every exports target present;
  the d.ts resolving (relative specifiers land, no `@ice/*` survives, bare ones declared); and a Node `import()` of
  every entry. `fix-dts-specifiers` maps a subpath through the workspace package's exports map and its guard refuses
  any quoted `@ice/…`. Red proofs (each injected into dist/, the pre-fix audit exit 0, the fixed exit 1): the palm
  plate inlined as base64; a chunk importing `three`; an unresolved d.ts specifier; a missing exports target; an
  undeclared `left-pad`; a module-scope `document` touch. The pre-fix `fix-dts-specifiers` left
  `"@ice/desk/objects"` in place and exited 0; the fixed one rewrites it and refuses an unmapped subpath.
- **Two vacuous units test their subject** (D7 surface #12). `desk/test/mat.test.ts`'s decade-wrap row compared
  `lineWeight(cell)` with ITSELF; it now goes through the lattice's own rung choice (`lod()`): at five decade
  boundaries k0 steps by one, and every line class's drawn alpha — the max over the rungs whose lattice holds it, as
  `mat.wgsl` draws — is the same just below and just above (red with `fine: mid / 5` in `lod()`, where the old row
  stayed green). `core/test/m8-port-churn.test.ts` counted only the ports ALIVE at the end, blind to ports spawned and
  reaped mid-pan (inherited from nodeboard); it now also counts every port destroyed during the run (`onDestroy`
  fires before teardown) — red under a mutation that lights the viewport's ports while the camera gestures and reaps
  them when it stops (6 ports; the old count saw 0).
- **The rigs wait on conditions, not sleeps** (D7 surface #13). rig:two-tab read B after a fixed 300 ms to prove a
  negative (nothing crosses while A's session is open), and its second row's 300 ms left a ~0.7 s stall enough for the
  1 s idle commit to land first — a spurious red; rig:sticky slept 60/300/900 ms for the wipe's frames, its end and the
  idle commit; rig:nav slept 60 ms for the exit flight to start. Now two-tab witnesses the negative by A's OUTBOUND
  count (`room.commits()` — an update A never sent cannot cross, at any delay) and reads the second row's negative only
  while the session is provably still open; sticky and nav wait on the event itself (`until`, now shared from
  `scripts/cdp.mjs`). Red proof: a 0.9 s host stall after the second session's keystrokes → the pre-D7 two-tab fails
  that row, the new one passes 39/39. (Under CPU ×12 throttling the pre-D7 sticky and nav still passed: their sleeps
  are conditions now, but the spurious red the review predicted for them did not reproduce here.)
- **The lint blind spots close** (D7 surface #14). `desk/test/dom-free.test.ts`'s regex missed `navigator?.gpu`
  (optional chaining), `instanceof HTMLCanvasElement|ImageBitmap|…` and `new ImageData|DOMMatrix|Path2D`; it sees
  them now, with self-test rows for every shape (and a bare type still passing). `editor-law.test.ts` read only
  desk/src/host lines naming "transform"; it now also reads dom's and react's DOM code for a camera transform — a
  style `zoom`/`scale` write, or an INTERPOLATED `scale(`/`matrix(` (a static stylesheet's press effect passes).
  `pnpm run depcruise` walks `apps/` too (their builds and results excluded), and `no-three` binds there. Red proofs:
  a planted `navigator?.gpu` in `desk/src/springs.ts` passes the pre-D7 dom-free, fails the new; a planted
  `style.scale = String(cam.zoom)` in dom's remote cursors passes the pre-D7 editor law, fails the new; an
  `import "three"` in apps/desk passes the packages-only walk, fails the new one (`no-three: apps/desk/src/blobs.ts → three`).

<!-- design-015 D7 — the fix wave, the law and the renderer (2026-09-26) -->
- **The desk's writers ask the version gate** (D7 law #1): typing, the pen, the notebook's leaves, the print's carry and the
  calendar's writing and hand committed straight through the store and never read a READ-ONLY verdict (a document written by a
  newer build, or carrying a pack newer than this one); every desk writer now takes its session from the writer's gate, a
  session refuses to begin on a read-only document, and a verdict flipping mid-session commits nothing.
- **A note sticks and unsticks at the LANDING, inside the move's own transaction** (law #2): one undo step for a drop onto a
  day, and Esc keeps the pin. New core door `docs.extendCommits(fn)` — an extender writes into a gesture's own transaction
  after its writes; a cancelled gesture reaches none.
- **The calendar**: a rolled month is held until the DOCUMENT speaks, so a lost race follows the peer (law #3); its lease's
  undo and delete go through the facade (#9); a forgotten pad re-acquires no kind state (#10); pending tiles, a culled board's
  ink stamp and a wipe on an undrawn note no longer keep the desk awake (law #5–#7); ONE clock seam for today and the zone —
  the day turns over, and the committed print is pinned to `PRINT_ZONE` (render #6, #7).
- **In hand**: no tap writes into a note while an object is held (law #4); `Held` is scoped to the frame (#8); the flight home
  picks where it is drawn (#11); a tap during a nav flight is not a double-tap's half (#12); the held desk copy is made once
  under the default ambient too, the layered passes keep state per render target, and a held board or pad goes idle (render
  #1–#3); an ink LANDING refreshes the copy (#5).
- **Never silent**: a kind's per-slot cap now counts and logs what it drops (`GroundStats.dropped`, render #4); an uncaptured
  GPU error takes the layer to `degraded` (#8).
- **`desk.stroke` v4** stores each stroke's fibre `seed` (v3 → v4 stamps −1, positional as before), so a peer's earlier
  stroke no longer re-seeds mine on replay (law #13).

<!-- design-016 K1 (2026-09-27) -->
- **The desk follows a change of the device's ratio** (`createDeskHost`): a ratio-only change — another display, the
  browser's zoom, an emulated ratio — resizes nothing and (emulated) fires no `(resolution)` media-query `change`, so the
  viewport, the canvas and the rulers' atlas kept the old ratio until a window resize. The host reads `devicePixelRatio`
  before every step and re-syncs the viewport when it moved; at rest it writes nothing and idle still submits nothing.

<!-- design-016 K-H (2026-09-28) -->
- **The landing gate tells the truth under load** (M21 K-H): in M21 most grades cost a 20–25 minute re-run because a
  TIMING row went red under load and passed alone. Now every cost row is measured WARM (an untimed batch first) and
  asserts the MINIMUM over ≥ 7 rounds with the host's load printed beside (load only ever adds time to a drained batch —
  D-KH.1); the per-kind A/A control is judged PAIRED against its own spread (z ≤ 4 or |T| ≤ 2 % of the frame, 21 rounds,
  a pooled second witness, a redraw witness — D-KH.2/.3; the old rule could not fail a mismatch); the desk copy's cost is
  its GPU Δ plus its main-thread Δ (D-KH.4); rig:stress's zoom-written judges each frame at its best round (D-KH.7). The
  races: every Chrome binds its OWN CDP port (port 0, read back — other sessions on the host used the same from-ports,
  so a rig could drive another session's browser), the collab relay binds port 0 and says "listening" only once bound,
  oracle-reference fetches retry with backoff, the laser rows are paced by the desk (a slow 2 px creep had turned the
  drag into a long press), double-clicks go in ONE batch that waits until the desk has taken them, rig:tray's pulls,
  flights home and arrival are read in the page, a progress watchdog replaces the one-span budget, screenshots use
  `optimizeForSpeed` (parity 19.5 → 2.3–5.3 s a scene at load 280). `apps/desk/scripts/timing.mjs`'s header is the pattern
  every new timed row follows. Proven: three back-to-back gates exit 0 at load 55–175 (one with a second gate beside it),
  and four deliberate regressions (a 2 ms stall in the desk copy, doubled pegboard shading, a mismatched A/A, 9 ms before
  every raster run) go red every time.

<!-- design-016 K9 — the fix wave, FW-A: the inert desk and the keys (2026-09-28) -->
- **The desk under the open pegboard drawer is inert to the PICK too** (K9 law #1, P1): `trayInput`'s `HandledByWidget` is a
  same-phase structural stamp `picking` never saw (a tag lands at the phase boundary, after the pick), so the exact hit stayed live
  THROUGH the drawer — a click on a specimen over a note lent the editor to the note under it, a click over a calendar pad selected a
  day (a double-click began writing, and at zoom < 0.3 flew the pad into the hand), and the hover rose on the dimmed desk. `picking`
  now reads `Tray.open` itself and answers the bare canvas for every local pointer while the drawer is out — on the flip too, so a
  note hovered as the drawer opens by key lets go with the pointer still; `tapHit` and the calendar's `tapOn` refuse outright
  meanwhile. The header claim that picking "never hears of what the tray takes" (core `systems/tray.ts`) is corrected; design-017 §4
  owes the same errata. Witnesses in core, desk and objects (the law reviewer's probe as `objects/test/tray-inert.test.ts`) and a
  rig:tray row.
- **The desk app's own keys are quiet on the inert desk** (S3, P1): `unlessInert` is exported from `@ice/react` and wraps the app's
  `w` `m` `b` ⇧W ⇧C `t` Tab ⇧Tab and its ⇧ arrows (which replace the core keymap's gated ones) — under the open drawer they made,
  walked and nudged objects, and ⇧→ moved a notebook in hand. `a`, `d`, `u`, the backtick and `~` stay live. Two rig:tray rows.
- **Tab while a lease holds the editor goes nowhere** (S4, P1): a Tab the lease declines is preventDefaulted — it used to move the
  page's focus to the selection menu's first button, ending the lease, so the next letters were the desk's shortcuts.
- **A double-tap pairs on the taps' OWN timestamps** (S6, P2 — K-H's product call): `navTap` and the hand's two-taps put-down time
  the pair by the down EVENT's `PointerButtons.downMs` (the adapter's `e.timeStamp`), the frame's `now` only as the fallback for an
  input with no time, never the frame clock — a 400 ms main-thread stall between two taps 110 ms apart no longer unpairs them.
- **A tool's letter is bound only where its tool is legal** (S8, P2, pre-M21): the keymap sets, at the press, the first registered
  tool on that letter the current canvas allows — on the desk `v` and `c` threw "not legal in the current CanvasType" and `h` left
  it in pan for good; `desk.select` now answers `v`.

<!-- design-016 K9 — the fix wave, FW-B: the app's lifetime and the docs (2026-09-28) -->
- **`<Desk onReady>` may return a cleanup** (K9 surface S1, P1): under StrictMode the discarded first mount's side effects
  ran on — a second room join (the black fail screen under `?room=`), a second paste/drop listener (one paste made two
  prints), a glyph `feed()` rAF loop at 60/s for ever. `onReady` is now typed `void | (() => void)` (React's effect shape);
  apps/desk cancels its feed, undoes its listeners and joins its room once per engine. `rig:lifetime` (a Vite DEV server,
  StrictMode on) joins `gate:landing` — eighteen rigs.
- **A pinned theme holds** (S5, pre-M21): the theme control was made on every render, leaking `prefers-color-scheme`
  listeners that flipped a `d`-pinned theme back at the OS's dusk/dawn switch; made once, its listener in an effect.
- **`DeskLayerHandle.onStatus(listener)`** (S9): a device lost after boot now says "the GPU was lost — reload" instead of a
  blank page; with no WebGPU the fail screen shows the message, the stack goes to the console (S14).
- **A `tick` without `due` is said once** (law #2): a kind local that ticks but never says when it is next due keeps the desk
  awake for ever — a once-per-page notice; the API reference's plugin-parity list gains `KindLocal.due`, `KindHost.wake`,
  `KindPass.idleAt` and what each costs if missing. check-docs reads the rig count from the gate script.

<!-- design-016 K9 — the fix wave, FW-C: the tray (2026-09-28) -->
- **The drawer cancels a take only where it is DRAWN** (K9 surface S2, P1): after the hand-off the drawer's full open rect
  stayed a no-drop zone although it had slid away — 44 % of the view refused new objects; a release now cancels only over
  the drawer as drawn while it still slides (D-K9-c.1). The wheel stays the tray's until quiet after a close (S7 — a flick's
  momentum no longer zooms the desk); the scroll clamps when its range moves (S10, D-K9-c.2); the band lets go on a fading
  tail (S11, D-K9-c.3: 1,250 → 33 ms pulled on a fling); grab/grabbing cursors (S12); the drawer hangs only what the current
  frame takes (S13 + law #3, D-K9-c.4 — skipped, not dimmed); rig:two-tab opens the drawer in a `?room=` session.

<!-- design-016 K9 — the fix wave, FW-D: residency and the renderer (2026-09-28) -->
- **Whiteboards past the thumbnail array's layer cap no longer vanish** (K9 render R1, P1): the device asks for the adapter's
  `maxTextureArrayLayers`; a board past the cap borrows a spared layer or is drawn bare and counted in `dropped`.
- **A plugin card material that will not compile is left out of the flat card, said once — never the desk down** (R3, P1).
- **The thumbnail arrays RESIDE in the budget at what is in use** (R2, D-K9-d.1): charged at capacity, kept and never shrunk,
  they had filled the 256 MB budget in the gate's own scene — no picture detail was ever fetched and every other cache was
  evicted each tick; now `used × chain`, outside the LRU, the caches' room `cap − resident` floored at a quarter, an emptied
  array let go (the gate's scene builds details again). A carried print or board un-slots nothing (R4, D-K9-d.2: a `hand`
  render target); a written note holding no raster shows its greek at any size (R6, D-K9-d.3 — 23 stills re-blessed, one
  added: golden 112); between-frame GPU work is its own profiler frame (R7); rig:scale's memory rows are checks (R5).
- **An on-screen whiteboard past the raster pool no longer re-asks a raster every frame** (D-K9-d.4, found by the fix
  wave's own gate on a quiet host — K6a/K6b's residency: made, never bound, evicted, asked again; 17,149 → 171 evictions).

<!-- design-018 R2 (2026-09-28) -->
- **A click on DOM chrome over an object no longer lends it the editor**: the desk's DOM halves listen on the container in the
  capture phase, before any handler of the chrome's, and `tapHit` read the live hit under the pointer — a click on the selection
  menu, or on the tray's bar at the view's foot, over a note began typing into it. `tapHit` answers no object for a pointer the
  ingest marked `OverInteractive`.
- **A press the open drawer took, shut under it (Esc, `a`), is let go**: it fell into the lip's branch, and a board press dragged
  10 px up after Esc opened the drawer again.

## [0.13.0] — 2026-09-07 · a git release point, NOT published to npm

**Install 0.14.0 for everything below.** The cut was real (`40c9ae8`, CI green, pack
dry-run 317 files) and the entry stays rather than being folded upward, but no publish
went out before design-015 replaced the presentation it describes, and the registry goes
0.11.0 → 0.14.0 in one step — so the head below ("the first publish since 0.11.0") and
`[0.12.0]`'s "Install 0.13.0" name a publish that never happened: 0.14.0 is it. The
blocks dated after the 7th (C4 · S1–S4 · S4r · the copy's cost) were written here after
the cut; `40c9ae8` does not contain them.

**The first publish since 0.11.0.** `0.12.0` was CUT on 2026-08-31 (`903f892`) and
never published to npm — the registry's `latest` is still 0.11.0. Its dated section
stays below as history, and its BREAK ships here: `WidgetSurface` →
`WidgetSurfaceKind` is as real as this section's, so an upgrading consumer must read
both. **Its `### Added` and `### Fixed` items do NOT ship here** — design-013 superseded
them inside the same unpublished window, so an upgrader who adopts them from that
section writes code 0.13.0 refuses. `defineWidget({ presentation })` is RETIRED by
Phase A (a kind's own behaviour is the one writer of `SurfaceTarget`);
`CompositorSourceVideo.onArrival` left with the compositor source registry at Phase B;
and 0.12.0's fixes to `ground()`, `groundHost` and `ground({ lift })` describe three
functions Phase C deleted. Read that Added and that Fixed as the history of a cut
nobody installed, never as this release's surface.

### Breaking, at a glance

design-013 rebuilt the presentation layer in three phases, and each one broke
something. In the order an upgrade meets them:

- **Phase A — where a card presents is a FACT, not a policy.**
  `defineWidget({ presentation })` and the whole `SurfacePresentation` family are
  RETIRED; a kind's own behaviour is the one writer of `SurfaceTarget`, and declaring
  nothing is still right for almost every widget. `@vibecook/ice/dom` loses the
  presentation registry and its policy. The `ice:` behaviour namespace is reserved.
- **Phase B — the ground IS the compositor.** The old composited leg is deleted:
  `compositedNextProfile` is now `compositedProfile` and the profile name is
  `"composited"`; core's `compositor-registry.ts`, r3f's `webgpu-pool` /
  `retained-quads` / `webgpu-sources`, and ground's `compositor/*` and
  `atlas-allocator` are gone. The package gained `./ground/compose`,
  `./ground/packs` and `./ground/engine`.
- **Phase C — the stratified ground is that same engine, and `three` leaves.**
  `ground()`, `groundHost` and design-011's `GroundProgramDefinition` with its
  transition ladder are deleted; **`groundField()`** replaces them.
  `presentation.ground` on a canvas type is a FIELD DECLARATION
  (`{ glyph, grid, wires, guides }`), and a `program` id is refused BY NAME at
  definition time with the migration in the message. `GridConfig` loses `spacings`,
  `fadeOut` and `levelWeight`; the workspace subpaths
  `@ice/ground/programs/{dot-grid,line-grid,magnet-grid}` are gone. **The ground is
  OPAQUE now** and writes the bytes the theme and the config name, so the stratified
  profile's colours change on screen by the amounts C1 and C1d measured.
  `@ice/ground` no longer declares `three` at all, and the `three` peer floor rises
  to `>=0.185.0`.

**`three` is still a declared peer, and it is still optional.** "The cut" does not
mean ICE stopped needing three — it means nothing outside `./r3f` and `./r3f/webgpu`
needs it. The GL ISLANDS are the whole reason, `three/webgpu`'s renderer and its own
`PMREMGenerator` are why the floor moved to 0.185, and the pack audit MEASURES the
claim rather than asserting it — at every publish (`prepack` runs it) and at every
landing (`pnpm run gate:landing`), 252 modules over the nine non-island entries, 0 edges
to `three`. An app that imports no islands can install none.

Every item above is spelled out with its migration in the sections that follow.

### Review fixes before publish (C4, 2026-09-08)

0.13.0 was CUT on 2026-09-07 and never published, so the Phase C review's fixes fold into
this section rather than into a 0.13.1 — the version stamp is unchanged and there is no
release for a patch to correct (D-C4.1; 0.12.0 above set the precedent that an unpublished
cut is history, not a contract). What changed after the cut is below; everything else in
this section is as it was written on the 7th.

<!-- design-013 C4a · C4b · C4c blocks land under this heading -->

<!-- design-013 C4a (2026-09-08) -->

#### Fixed — `@vibecook/ice/ground`

- **A nav cut no longer pops the departed grid.** The flight's second slot took its field
  config only when the canvas TYPE changed, so a `grid` re-tune (the react prop) and a
  same-type enter — a board inside a board — left it drawing in a stale config. The config
  is now snapshotted at every canvas-session change, and a re-tune at rest moves it too (one
  mid-flight still does not: the departed frame keeps what the cut left it with).
- **A lost device ends the ground layer** instead of leaving the last frame painted while the
  DOM pans above it: the ground is disposed, the canvas removed so the page shows through,
  `available()` false and `status()` `failed`. Both profiles — the stratified layer's own
  device and the composited profile's app-owned one.
- **An ordinary board no longer re-collects its overlays every painted frame.** With no wires
  and no guides the empty result was also the cache's "nothing cached" sentinel, so both
  collectors ran on every frame; an empty collection is now a cached answer.
- **A promoted card that outgrows its destination draws its plate, not a stretched raster.**
  A card that copied once and then grew inside its band kept its texture ref, so the refused
  copy left the old pixels stretched over it; the refusal now clears the standing write.
- **A refused destination is no longer re-minted every frame.** All three of DomRender's
  realise paths allocated a full texture and destroyed it again on each flush while the
  texture table refused; they now back off until the handle or the table's revision moves,
  keeping the debt.
- **A remounted content element gets its boundary back.** DomCompose's change-only cache was
  keyed by the entity, so a React remount of a card's content kept the record from the old
  element and never wrote the clip, the lift or the hold on the new one.
- **A live remote cursor no longer wakes the ground every frame.** `cursorVisualPoles` watched
  `Position` with a Tier-1 query observer, and a system that merely DECLARES a write on that
  column stamps it every tick it runs; it now pulls a change collector, like the overlays.
- **Past the source cap the far cards drop, never the cursor:** poles pack before the cards.
- **The `line` glyph is one CSS pixel wide on every monitor.** Its law was read as device px,
  so a retina screen drew a half-pixel line whose peak alpha swung with the sub-pixel phase
  and shimmered under a pan.
- **`parseCssColor` takes every CSS hex form** — `#rgb`, `#rgba` and the eight-digit form with
  its alpha, beside `#rrggbb`, `rgb()` and `rgba()`. Three of them used to come out mid-gray,
  silently; an unparsable colour now says so once per distinct string.
- **A glyph name nothing registered says so** (once per name) instead of falling back to the
  dot in silence, and a live portal whose inside canvas type does not resolve is counted
  (`GroundHostStats.portalsUnresolved`) rather than silently drawn in its parent's config.
- **A pooled slot's overlays cost no GPU memory until they draw.** Every portal slot and the
  flight's departed slot minted a uniform buffer and a bind group per registered overlay at
  acquisition, for data they never carry.
- **The world's journals drain from the first tick**, not from the first tick after the device
  and the pipelines resolved: the pre-ready return sat above the pulls.

#### Changed — `@vibecook/ice/ground`

- **`groundField()` with no `theme` follows `prefers-color-scheme` at the mount** (light where
  `matchMedia` is absent — Node, a lab) instead of always the light palette; a dark product
  that ported `ground()` across verbatim got a white viewport. A later switch is still the
  app's `setTheme`. The new `defaultTheme()` is exported from `@vibecook/ice/ground/compose`.
- `lineUniformValues(cfg, theme, dpr?)` takes the frame's device-pixel ratio and uploads the
  law's widths in device px; `LineLaw`'s widths are the unit its owner authors in (the cutting
  mat's stay device px, the `line` glyph's are CSS px).
- `ContentResidency` gains `unwrote(entity)` and `revision()`. `DomHostWriter` loses `forget()`
  (it had no callers) and `createDomHostWriter`'s third `isAlive` argument (the cache is a
  `WeakMap` keyed by the element, so it needs neither a liveness oracle nor a sweep).
- `DomRenderStats` gains `backedOff`; `GroundHostStats` gains `portalsUnresolved`.

<!-- design-013 C4b (2026-09-08) -->
**core + r3f.**

- **`docs.close()` no longer takes the host's viewport and the user's camera with
  it.** `DocSession.close()` is a strata `world.reset()`, and a reset clears
  RESOURCES as well as entities — so a `docs.create()` / `docs.open()` / `docs.join()`
  on a MOUNTED canvas came out the far side with `Camera`, `Viewport`, `ActiveTool`,
  `CameraLimits`, `GestureSettings`, `PointerSettings`, `SnapConfig`, `ChromeSettings`
  and `StageMode` all `undefined`, and neither ground host could build until the next
  ResizeObserver fire. `createCanvasEngine` now seeds those through one function and
  re-seeds after every close, carrying the LIVE values across: the box, the view, a
  host's tuned settings and a held stage background are the engine's, never the
  document's. The join re-bootstrap path (a `PendingImportError` quarantine, whose
  reset happens inside `joinDoc`) re-seeds too.
- **`PresentationTransitionCoordinator.ownerOf(plane)`** (new) answers the id of the
  adapter holding a plane, or `undefined`. `register` still throws on a second claim,
  and this is the question that throw answers.
- **A second `<GLViews>` over one engine no longer unmounts the React tree.** The `gl`
  plane registration ran inside a `useEffect` with no guard, so the second mount threw
  from an effect. `claimGlPlane(transitions)` (new export) claims the plane only when
  it is free and returns the unregister — or `undefined`, claiming nothing. One owner,
  no throw, and the plane is freed for the next mount either way.
- **`createGLBridge` accepts the `CanvasEngine` itself** (`GLBridgeHost = Engine |
  CanvasEngine`, new type) and takes `transitions` and `gpu` from it; the options stay
  as overrides. Every host used to repeat `{ transitions: ce.transitions, gpu: ce.gpu }`,
  and one that forgot got a GL plane with no owner and a snap instead of a flight, with
  nothing saying why. A bare `Engine` still works and carries neither seam.
- **A refused realise BACKS OFF** (`IslandRender`). A handle the residency's table
  refuses was re-rendered every flush — allocate a full target, paint it, be refused,
  destroy it, forever, spending Hot content's owed animation time on frames nobody
  sees. The card is now skipped whole (it draws the plate, which is honest) until the
  world names a different handle or the residency's revision moves. A backend that has
  not RESOLVED the target yet is unchanged: that is a delay, not a decision, and it
  still retries next frame.
- **`ContentSink.revision?(): number`** (new, optional) is that second retry
  condition — the residency saying "a refusal might land now". A residency that
  publishes none is retried on a new handle alone.
- **`IslandRenderStats.skippedRefused`** (new) counts the flushes the backoff skipped;
  a climbing `skippedRefused` beside a still `unrealised` is what "the table will not
  take this card" looks like from outside.
- Recorded, no code change: `picking`'s declared `access.write: [PointerPart]` is a
  column-wide stamp taken every frame `live()` runs, so a CONSUMER's Tier-1 observer of
  that column would wake on every spring frame. Nothing inside ICE observes it that
  way. The note is at the declaration.
- Corrected at source: glboard's bridge has no `transitions` and is owed none — it
  builds a bare engine and has no nested-canvas nav, so no switch ever asks for the
  plane. The review read it as a missing owner.
- **Only the world's OWNER resets it** (`DocSession.close()`). Strata's double-attach
  guard is per STORE, not per world, so attaching a second session to one world does
  not throw — it silently supersedes the first, and the first session's `close()` then
  reset the SECOND one's entities and every resource out of existence. A session now
  claims the world when it attaches and resets only while the world still points at
  it; a superseded session tears down its own binding and stops. The facade never
  reached this (two independent guards in `closeDoc`, neither of which was pinned —
  they are now), but `createDocSession`/`openDocSession`/`close` are exported and the
  ordering hazard was one edit away.

<!-- design-013 C4c (2026-09-08) -->

**The desktop lab's light mode, and two leaks under its board Canvas
(`apps/widgetlab-desktop`).** No package API changed here — this is the app that
mounts the two grounds, and every fix is in it or in the rigs that grade it.

- **Light mode was a dark board.** The app painted its page from a dark/light toggle
  and handed BOTH ground arms a hardcoded dark theme, so the OPAQUE ground cleared to
  `#171717` under a `#FAFAFA` page (the composited arm since B8, the stratified arm
  since C2). One projection now feeds both surfaces — `src/ground-theme.ts`, the app's
  background and dot ink substituted into the product palette while the card, the
  frame, the hairline, the accent and the `vf-frame` pack section stay as `THEMES` has
  them — and a `setTheme` effect re-projects the live layer, so a switch never re-boots
  the canvas. **Apps that pass a theme to `groundCompose`/`groundField` should project
  their own page background into it the same way:** the ground is opaque, so its
  `canvasBg` IS what the user sees behind the cards.
- **The renderer lease kept a stale build.** A real unmount swept while a build was in
  flight; the remount started a second one; the first arrived, passed the old
  `everRetained && retained === 0` guard, was installed and then overwritten — a
  `WebGPURenderer` parked on the app-owned device for the process. Every build now
  carries a generation and the sweep count it began under. The lease is also keyed on
  the device and rebuilt when it changes, and its `dispose()` frees a live renderer at
  once and an in-flight one on arrival.
- **The PMREM environment target leaked per Canvas mount.** three 0.185.1's
  `PMREMGenerator.fromScene` returns a render target the CALLER owns and the
  generator's own `dispose()` frees its internals only; the cleanup was `onTex(null)`,
  a dropped reference. Since C0 that target sits on the app-owned device, so it lived
  for the process. An env slot owns it and disposes it on cleanup and on a renderer
  change.
- **The counters moved off the module.** Renderer and PMREM-target censuses live on
  the lease and the env slot and reach the rigs through the board Canvas's
  `onInstruments` hook, so two mounts cannot stomp each other's numbers.
- **Witnesses.** The `app` and `stratified` rigs each gained a LIGHT-MODE phase that
  flips the app's own `dark` state and reads the ground canvas beside the page's
  `--canvas-bg`, with the pre-flip byte as the control; the `app` rig's cross-backend
  compare now asserts the two arms are actually different images (pixels AND hashes),
  its `diffCaptures` refuses two captures of different dimensions instead of shearing
  them, and its remount phase counts PMREM targets as well as renderers. 21 new unit
  tests carry the code fixes, each proved red with its fix reverted.


<!-- design-013 C4d (2026-09-08) -->

- **The pixel witnesses now have exit codes** (D-C4.11). The Phase C review found four
  checks that could not fail; these four bullets are them.
  `apps/groundlab/scripts/ab.mjs oracle` (the `rig:parity` harness) ASSERTS maxΔ 0 per
  page scene, prints PASS or FAIL with the numbers, and exits with the number of scenes that
  missed — it used to print a maxΔ nobody read and `process.exit(0)` unconditionally, which
  is how it reported success against a dist that had never been built. It also preflights
  before Chrome starts: a missing `apps/groundlab/dist/index.html` or a missing
  `packages/ground/oracle/results/oracle-<scene>.rgba` names the command that produces it and
  exits 1. A boot failure or a throw is 1. (The Dawn oracle already exited non-zero on a
  failed check; verified by corrupting one expectation, not by reading the code.)
- **`pnpm run gate:landing`** — the new root script: the Dawn oracle → the lab's build →
  `rig:parity` → `pack:audit`, in that order, each gating the next. It is REQUIRED at every
  landing and is deliberately NOT part of `pnpm run ci`: the oracle needs Dawn, which the CI
  runner has not been probed for (D-B1.4's finding is carried, not resolved).
- **`npm publish` runs the pack audit.** `packages/ice`'s `prepack` was `build`; it is
  `pack:audit` now (which builds first), so the "0 edges to `three` outside the island
  entries" claim above is measured on the bytes being published, by the publish itself.
- **A type-only import is a dependency-cruiser EDGE** (`tsPreCompilationDeps: true`). Without
  it, `import type { X } from "three"` was invisible to the `three-only-in-r3f` wall, which
  stood only because `@types/three` happens to be absent from every walled package. Turning
  type edges on made 21 TYPE-ONLY import cycles visible in `@ice/core` and `@ice/react`
  (`behavior/types.ts` ⇄ `guards/guarded-tx.ts` is the shape — both sides `import type`);
  `no-circular` now carries `viaOnly: { dependencyTypesNot: ["type-only"] }` so it keeps
  meaning what it always meant, a RUNTIME cycle. It also surfaced a latent one: `depcruise
  packages` was walking `packages/ice/dist`, so the cruise answered differently depending on
  whether anything had built (483 modules on a clean tree, 778 after) — and the `.d.ts`
  barrel cycles tsc emits by design would have turned `pnpm run ci` red for anyone who ran
  `gate:landing`, a publish or a build first. This repo's own build output is excluded now
  (`^packages/[^/]+/dist/`, anchored so a DEPENDENCY's `dist` stays in the graph where the
  walls can see it) and the cruise is hermetic. No consumer-visible surface changes.

design-013 Phase A — the presentation FACTS move into the world, and the
decision about them moves onto the behaviours door. Where a card presents used
to be a session-local map beside the world (`PresentationRegistry`) driven by
an app-wired policy; it is now a component with one writer, and that writer is
the entity's own kind behaviour.

### Breaking

- **`defineWidget({ presentation })` is RETIRED.** The three-valued
  `SurfacePresentation` (`live-dom | composited | picture`) it declared is gone
  with it — `picture` was never a third place for pixels to come from but a
  paused demand on a GPU target. A definition still passing the field throws at
  definition time rather than being quietly ignored. Migration, one line each:

  | was | now |
  | --- | --- |
  | `presentation: { pin: "live-dom" }` | `behaviors: [alwaysDom]` |
  | `presentation: { pin: "composited" }` | `behaviors: [alwaysGpu]` |
  | `presentation: { default: "picture" }` or `{ pin: "picture" }` | `behaviors: [alwaysGpu.with({ paused: true })]` |
  | `presentation: { default: "composited" }` | `behaviors: [alwaysGpu]` |

  The last row is not exact and says so: a `default` without a `pin` was
  promotion-eligible from a composited start, and no standard behaviour has
  that shape. A kind that wants it writes its own behaviour, which is
  design-013 §0's whole point. **Declaring nothing is still right for almost
  every widget** — a definition that names no surface behaviour is given its
  kind's default (`domAtRest` for `surface: "dom"`, `alwaysGpu` otherwise), so
  the ratified default is no longer something an app can fail to wire.

- **`@vibecook/ice/dom` loses the presentation registry and its policy:**
  `createPresentationRegistry`, `createPresentationPolicy`,
  `DEFAULT_PRESENTATION`, `PresentationRegistry`, `PresentationPolicy`,
  `PresentationPolicyOptions`, `declaredPresentation`, `presentationPinned`,
  `widgetPresentationPins`. `createDomWidgetsReflector` no longer takes a
  `presentation` option — it reads `SurfaceTarget` from the world.
- **Core loses the `SurfacePresentation` family:** the type itself plus
  `SurfacePresentationDecl`, `ResolvedSurfacePresentation`,
  `defaultPresentationFor`, `presentationIsLegal`,
  `surfacePresentationDeclError`, `resolveSurfacePresentation`.
  `WidgetType.presentation` is gone.
- **`WidgetSurface.presentation` → `WidgetSurface.target`** (`"dom" | "gpu"`),
  and the seam `WidgetSurfaceSeams.presentationOf` → `targetOf`. Both profiles'
  factories answer it: `compositedSurfaces` from the world's `SurfaceTarget`,
  `stratifiedSurfaces` from the kind. `compositedSurfaces` also drops its
  required `presentation` option and makes `demandOf` optional — absent, it
  answers from the `SurfaceDemand` clamp.
- **The type `SurfaceDemand` is now `SurfaceDemandValue`, and the type
  `SurfaceKind` is now `SurfaceKindValue`** (landed with A1a). design-013 §5
  gives both bare names to COMPONENTS, and a value and a type of one name
  re-exported from two modules collide at the package surface without a
  compile error. Migration is one identifier each.
- **A bare entity in the mount store is no longer promotable on grab.** The old
  policy promoted anything it was handed and refused only what it knew had no
  live-dom mode; the target is now a component, and `targetOf` reads a missing
  one as `dom`. So a mount entry with no widget type — a hand-built rig entity,
  a port, a ghost — stays in the content plane through a grab where it used to
  reach the canvas. This is the intended reading (there is no compositor source
  for such a thing either), and it is listed because a rig that leaned on the
  old behaviour will see the difference.
- **`defineWidget` refuses a type that lists TWO behaviours writing
  `SurfaceTarget`** (one of the standard three, or any behaviour declaring it in
  `writes:`). It used to accept them and attach both. An entity has one kind and
  that kind's behaviour is the sole writer of its target (design-013 §5), so
  `behaviors: [alwaysDom, alwaysGpu]` now throws at definition time naming both.
- **The `ice:` behaviour namespace is RESERVED for the engine.**
  `defineBehavior("ice:anything", …)` throws. The namespace carries two
  privileges — the compiler's `orderIndependent` attestation on declared writes,
  and an exemption from the published-read-surface warning — and a pack that
  named itself into it inherited both, including the one that silences strata's
  report of a second writer on a component. Rename to your own namespace; a name
  that merely starts with the same letters (`iceberg:x`) is unaffected.

<!-- design-013 C3 (2026-09-07) -->
- **The `three` peer floor rises from `>=0.160.0` to `>=0.185.0`** (design-013 §8 Phase C,
  C3 — D-C3.1). The peer is still OPTIONAL and still declared, but the versions it is
  declared against are now only the ones the GL islands actually run on: `./r3f/webgpu`
  builds `three/webgpu`'s `WebGPURenderer`, and the desktop board's environment path needs
  that module's own `PMREMGenerator` (C0), neither of which exists at 0.160. A consumer
  pinned below 0.185 was already broken on those two subpaths; the manifest now says so
  instead of promising a floor it could not meet. Consumers who never import `./r3f` or
  `./r3f/webgpu` need no `three` at all — see below.
- **`three` is gone from the ground.** `@ice/ground` (`@vibecook/ice/ground`,
  `./ground/compose`, `./ground/packs`, `./ground/engine`) declared `three` as a peer and a
  dev dep for the stratified leg's `WebGPURenderer` + TSL; C2 deleted that leg and C3 struck
  the declarations. **The `three` peer of `@vibecook/ice` now exists for ONE reason: the GL
  ISLANDS.** "The cut" does not mean ICE stopped needing three — it means nothing outside
  `./r3f` and `./r3f/webgpu` does, and the pack audit measures that rather than asserting it:
  252 modules reachable from the nine non-island entries, 0 edges to `three`, externals
  exactly `@vibecook/strata-ecs` (+ its `durable`/`ephemeral`/`tools` subpaths), `loro-crdt`,
  `rbush`, `react` and `react-dom`. A dependency-cruiser rule (`three-only-in-r3f`) makes it a
  CI failure for any of kernel/core/dom/react/ground/devtools/ice to import three again.

<!-- design-013 C2 (2026-09-07) -->
- **The stratified profile's ground is the ENGINE's, and the three-based leg is deleted**
  (design-013 §8 Phase C, C2 — D-C2.1…D-C2.6). `@ice/ground` (`@vibecook/ice/ground`) no longer
  exports `ground()`, `groundHost`, `GroundLayer`, `GroundFactory`, `GroundContext`,
  `GroundHostLayer`, `GroundProgramControl`, design-011's
  `GroundProgramDefinition` / `GroundProgramInstance` /
  `GroundProgramInput` / `GroundSourceDeclaration` / `GroundProgramTransition` /
  `GroundPrepareContext` / `GroundProgramStatus` / `GroundProgramCacheOptions` /
  `FrozenGroundPresentation` / `GroundPresentation` / `GroundActivationContext`,
  `frameChildrenSource` and its two limits, `GroundFrameChildren*`, `GroundPass` / `GroundFrame`
  / `GroundReflector`, the renderer's `readGroundRendererStatus` and every `GroundRenderer*`
  type, `collectMagnetLevels` / `collectMagnetSources` / `magnetFieldScale` / `resolveMagnet` /
  `MAX_MAGNET_SOURCES` / `MagnetLevel` / `ReadSpatial`; the workspace subpaths
  `@ice/ground/programs/{dot-grid,line-grid,magnet-grid}` (`dotGridGroundProgram`,
  `lineGridGroundProgram`, `magnetGridGroundProgram`) are gone.
  **Three names are REPURPOSED rather than deleted, which is the quieter break:**
  `GroundHostOptions` (`compose/host.ts:91`) and `GroundHostStats` (`:224`) are now the
  ENGINE host's options and instruments — the pair `groundField` and `groundCompose` share —
  and `GroundOptions` (`compose/ground.ts:54`) is `Ground.create`'s. An old import of any of
  the three still COMPILES and means something else, so a stale annotation goes wrong at the
  first field you read rather than at the import. What replaces the factories, one of them:
  **`groundField(opts?)`** — the same engine host `groundCompose` is (one host, two
  factories, D-C2.3), acquiring its OWN WebGPU device, drawing the field, the live portals, the
  flight's second slot and the two overlays under the DOM planes, and NO cards (the DOM draws
  them). Migration:

  | was | now |
  | --- | --- |
  | `ground({ grid, wires, guides, poles, passes, forceWebGL, profile, rendererOverride })` | `groundField({ grid, wires, guides, poles, theme?, config?, grids?, gpu?, onDevice? })` — no WebGL2 fallback, no timestamp profile, no extra `passes` (an overlay is `Ground.create({ overlays })`'s) |
  | `groundHost({ programs, fallback, cache, onProgramFault })` | `groundField(…)` — the canvas type declares its glyph (below); there is no program to prepare, cache, fall back to or quarantine |
  | `layer.reflector.rendererStatus()` / `.rendererProfile()` / `.redraws()`, `layer.device()`, `layer.programs.*` | `layer.field.status()` / `.device()` / `.redraws()` / `.stats()` / `.config()` / `.setTheme()` |
  | `magnetGridGroundProgram({ poles })` | `groundField({ poles })` — a pole flagged `pointer: true` rides the field's analytic cursor (D-C2.2) |

  **The ground is OPAQUE now.** The old canvas cleared to transparent and the page's CSS
  background showed through it; the engine clears to its theme's `canvasBg` and writes the
  bytes the theme and the config name — straight alpha over that ground, in the sRGB swap
  chain, no linear-light compositing and no encode on output (D-C2.6: a configured byte is the
  drawn byte). Pass `theme` (a `GroundTheme` — `themeFrom(name, palette)` over
  `ENGINE_PALETTE[name]` with your page's background as `canvasBg`, or a product's own
  projection); with none, the engine's light or dark theme by `prefers-color-scheme` at the
  mount — light where `matchMedia` is absent, as in Node or a lab (D-C4.4). Pass your own:
  the read is a guess at your page, not knowledge of it. The stratified colours therefore
  CHANGE on screen by the amounts C1 and C1d recorded: a wire at `rgba(120, 132, 145, 0.9)`
  now lands at that colour over the ground rather than lighter, and the line grid's ink
  `[0.75, 0.77, 0.8]` at 85 rather than 157 — lift `lineInk` and the `WiresConfig` colours if
  you want the old look; never a second chain.
- **`presentation.ground` on a canvas type is a FIELD DECLARATION, not a program id**
  (D-C2.4). `{ program: string; wires?; guides? }` became
  `{ glyph?: string; grid?: Partial<GridConfig>; wires?: boolean; guides?: boolean }`: `glyph`
  names the engine's `dot` or `line` or a registered grid program's (`needle`, `mat` —
  `@ice/ground/packs`; an unknown name draws as the dot), `grid` is the same partial the react
  `grid` prop takes and the prop's re-tunes land on top of it. The host resolves it per slot:
  the ROOT slot from the current type at every switch, a live PORTAL's slot from the
  container's inside type (the catalog's binding), and the flight's departed slot keeps the
  config it was drawn with at the cut. A definition still naming `program` throws at
  definition time with the migration in the message; an empty `glyph` is refused by the
  catalog where an empty program id was. A type that declares a ground (any of the four
  fields) requires the `ground` presentation plane to prepare before a flight, as a program id
  did.
- **`GridConfig` loses `spacings`, `fadeOut` and `levelWeight`** (D-C2.1). The ground draws on
  the engine's lattice — a derived decade ladder (`mid = 20·10^k`, fine = mid/10, coarse =
  mid·10) that fades a rung IN by its own cell size and never out — so the classic grid's three
  fixed spacings, its fade-out window and its per-level weights retired with the classic grid.
  `fieldConfigOf` had dropped them silently since B2; a partial naming them is a type error
  now. `DEFAULT_GRID_CONFIG` is `{ dotColor, dotAlpha, fadeIn, dotRadius }`. The magnet block's
  `widgets`, `widgetStrength`, `widgetRadius`, `maxSources` and `fadeZoom` stay declared and
  have no field reader (every on-screen card is a source at strength 1; named as owed).
- **`InfiniteCanvas`'s `GroundLayerFactory` context loses `readSpatial` and `gpu`, gains
  `catalog`.** The magnet grid's broad-phase seam and the snapshot strategy's GPU ledger went
  with the old leg; the engine's catalog is how the ground resolves a portal's inside type. A
  factory written against the old context that reads either field gets `undefined`.
- **`@ice/ground`'s `Pole` gains `pointer?: boolean`** and `FieldFrame.pointer` a
  `strength?: number` (D-C2.2). `localPointerPoles()` flags its poles; `cursorVisualPoles()`
  does not; an app's own `PoleSource` (widgetlab's `haloPoles`) flags the one that is the local
  cursor. The magnet shader's cursor term scales by the strength (`u.flags.z`; 1 by default —
  the oracle's 53 renders are byte-identical).

<!-- design-013 C1d (2026-09-07) -->
- **`GroundTheme` carries a `lineInk`** (design-013 D-C1.4). The engine's new `line` glyph
  paints in a theme role of its own, so the head every pass reads gained one field. `themeFrom`
  fills it from `LINE_GRID.ink[name]` — a host that builds its theme through it needs no
  change; one that writes the object by hand must add the field.

<!-- design-013 B6 (2026-09-07) -->
- **The video kind's contract is a REGISTERED STABLE-TEXTURE HANDLE** (design-013 §9 Q5
  RULED, B6). A live surface's producer no longer publishes a source the compositor samples;
  it states its size once and hands frames over, and the engine copies each ONE time into the
  texture the handle names and closes it. The old shape retained the latest `VideoFrame` and
  re-imported it (`device.importExternalTexture`) on every composite, which is legal only for
  a producer that owns its frames: under a lease protocol the frames are a small pool and a
  held one starves the producer. Migration, on the new profile:

  | was (`CompositorSourceVideo`) | now (`compose.video`, `@ice/ground/compose`) |
  | --- | --- |
  | `sources.register(e, { kind: "video", frame: () => latest, onArrival })` | `compose.video.register(e, { width, height })` once, then `compose.video.arrive(e, frame)` per frame |
  | the consumer retains `latest` and closes the one it replaces | `arrive` owns the frame: it is closed by the copy, by the next arrival that supersedes it, by the demand clamp that refuses it, or by `dispose` — exactly once |
  | `onArrival` wakes the compositor | the copy touches the content residency, which wakes the builder (`WakeReason "content"`) |
  | the source is sampled every composite | the card samples its own stable texture; a frameless frame shows the last good pixels, unchanged |
  | a paused card still handed frames over | `SurfaceDemand paused` ⇒ the arrival is dropped and closed, no copy and no compose frame; an fps bucket is a ceiling on copies |

  `CompositorSourceVideo` itself and the `texture_external` pipeline variant in
  `widget-quad-pass` were UNCHANGED and retired with the old profile at B8 — the ground
  deliberately has none, and the retain-and-import path becomes the rig's own mechanism.
- **`defineWidget({ surface: "video" })` is legal, and a video widget may not carry a
  `component`** (design-013 B6). `WidgetSurfaceKind` used to exclude `video` on the ground
  that it "arrives from a producer, never from `defineWidget`" — but only equip stamps
  `SurfaceKind`, and Band, Demand and Residency all key off it, so the kind was unspeakable
  and a live surface unspawnable. It is declared like any other kind now and equip gives it
  `SurfaceTarget = gpu`. A `component` is refused at definition time: nothing mounts one for
  a non-dom kind but `GLViews`, which takes only `gl`, so it would be silently dead. `chrome`
  is still yours.

<!-- design-013 C0 (2026-09-07) -->

- **The product's GL cards draw on the ground's device** (design-013 §8 Phase C, C0).
  `apps/widgetlab-desktop` built its R3F `<Canvas>` with three's WebGL renderer under the
  composited profile, so `GLViews` refused at mount and every island rendered into targets
  the ground cannot sample — the board's seven GL cards drew nothing. B8 left it owed and
  named one blocker: the environment. `three`'s `PMREMGenerator.fromScene` reads
  `renderer.state.buffers`, which a `WebGPURenderer` has not got ("Cannot read properties of
  undefined (reading 'buffers')"). `three/webgpu` ships its OWN generator with the same
  surface, so the Canvas and the environment both move, and the branch is on the BACKEND
  (`hasWebGpuBackend`), not on the profile — the stratified arm this package's headless tests
  mount is unchanged.
- **`BoardGLCanvas` — the board's GL root as a component** (`apps/widgetlab-desktop/src`),
  so the new `app` rig mounts the SHIPPING wiring rather than a copy of it. It owns the
  Canvas, the environment loader and `<GLViews>`, takes the app-owned device as a prop, and
  LEASES its renderer: R3F disposes a WebGPU renderer nowhere
  (`unmountComponentAtNode` touches only `renderLists`/`forceContextLoss`), so an unmounted
  board canvas would park one on the shared device forever. Disposal is deferred by a task so
  a StrictMode remount re-retains instead of killing a live renderer, and it is safe on an
  injected device — three destroys a device only when it made it.
- **The tray's preview capture needed no change and now says so.** `captureWidgetPreviews`
  builds its own WebGL root on its own canvas and hands THAT renderer to the environment
  factory, so the WebGL `PMREMGenerator` is correct there on both profiles. The App comment
  claiming the whole environment path was WebGL-only was over-broad and is corrected at source.
- **A new rig, `pnpm --filter widgetlab-desktop app`** (`composited-app`): the real demo board
  seeded through the App's own `seedDemoScene`, the seven GL cards each rendering into the
  private target Residency named, and the two lit ones graded against a WebGL control that
  renders THE SAME `Scene` object — not a description of it — with both noise floors read
  first and the environment proved load-bearing by a control with it switched off. The
  seeder is exported for that: every rig page runs inside the Electron shell, where
  `hasDesktopBridge()` is true and `createDemoEngine` leaves seeding to a switchboard join a
  one-window harness never makes.

<!-- design-013 B9 (2026-09-07) — the Phase B review's blockers -->

- **A card is clickable from the moment it exists** (B9, review blocker 1). The ground armed
  its frame pick source at mount and answered `outside` for any card it had no geometry for —
  before its pipelines compiled, before a card's first draw, and for good when `Ground.create`
  rejected — which the router took as a miss: every card unclickable, a tap clearing the
  selection. `FramePickSource.hit` may now return `undefined` ("no geometry"), and
  `pickFrame` keeps the box tier's answer there (`packages/core/test/frame-pick.test.ts`).
- **The clamped oversize destination is refused, never claimed** (blocker 2). Residency clamps
  a Q10 private texture to the device limit uniformly; the L1 copy writes the element's whole
  raster. DomRender now compares `geometry().written` with the destination and counts an
  oversize copy (`DomRenderStats.oversize`) instead of copying past the edge and claiming
  the write — the card draws the plate until its band changes. Projecting the clamp into the
  uv (D11) is owed. A page-array growth the table refuses no longer returns the OLD array to
  a copy that names a layer it lacks; the refused texture is destroyed.
- **A promoted card gets the lift and the hold ONCE** (blocker 3). `DomCompose` wrote
  `scale()`/`opacity` on every card's content element; a `gpu` target's raster baked them and
  the ground applied them again, and the per-frame transform write painted the L1 source
  canvas past DomRender's self-write guard. The writer skips both on `gpu` targets (written
  as empty, so a promotion clears and a demotion restores). `createDomHostWriter` takes an
  `isAlive` predicate and sweeps its entity-keyed store on its own tick.
- **`Retained` cannot leak past a cut** (blocker 4). `publishNavCut` releases the departed
  set (a cut mid-flight ends the flight, and the tick that owned the release never ran for
  an inactive resource), and `startNavFlight` releases the earlier set before pinning the new
  one.
- **The `gl` presentation plane has an owner again** (blocker 5). B8 deleted the retained-quad
  adapter that owned it on the stratified profile and the composited leg never had one, so a
  cross-type enter with any island on the board was gated to a SNAP on both. `GLViews`
  registers `GL_PLANE_ADAPTER` (`@ice/r3f`; prepares instantly, no visual of its own) on both
  profiles: under `composited` the ground's departed slot draws the islands from the
  residency; under `stratified` the islands cut at the switch — their outgoing-quad
  transition is owed.
- **`onPart` reaches the app OUTSIDE the notify.** The compose layer called the app back from
  inside a resource observer, and the app's action is an op — a close button despawns. A
  structural write inside an observer's emit is IGNORED in strata's dev build (a console
  error) and unguarded in prod; the callback now runs on a microtask, after the frame's
  synchronous step has returned.
- **The hover part is attributed to the EXACT hit.** The router writes `PointerPart` from the
  exact pick, but the builder paired it with `Targets` — the dead-band relation — so a pointer
  crossing from card A onto B's close button inside A's 4 px release band lit A's button. It
  pairs with `TouchesExact` now.
- **Picking re-runs while a card's geometry moves under a still pointer.** `FramePickSource`
  gains `live?()`; the picking system runs while the source says its geometry is moving, so a
  close button that reveals under a motionless pointer is hovered when it arrives, not one
  pixel of movement later.
- Also from the review: a `Ground` resolved after its compose layer was disposed (StrictMode,
  HMR) is disposed rather than leaked; an island render whose resolve texture the backend
  had not allocated yet is NOT marked painted — the target is dropped and the next flush
  renders (`IslandRenderStats.unrealised`); the residency's destroy list is drained on every
  roster tick, drawn or not (a hidden canvas no longer mints textures it never destroys);
  `GroundLayerHandle.compositorReflector` (dead since B8) is gone; the boot rig asserts the
  exit cut over the WHOLE frame, as the docs claim (it was, and is, 0 — the check said inset);
  `pnpm run ci` runs `gen:check`, so the committed WGSL/noise modules are the gate's.

<!-- design-013 B8 (2026-09-07) -->

- **THE OLD COMPOSITED LEG IS DELETED** (design-013 §8 B8, §10.8), in one commit, and the
  profile design-013 built beside it takes the name. `compositedProfile` IS the new one now;
  `compositedNextProfile` is gone with the name `"composited-next"`, and
  `PresentationProfileName` is `"stratified" | "composited"` again. A composited app wires
  `ground={groundCompose({ device, theme })}` from `@ice/ground/compose` — the profile refuses
  a `ground()`/`groundHost()` layer BY SHAPE — a ground handle that carries no `compose`
  (`packages/react/src/profiles/composited.ts:79-85`) — which is what makes the swap loud
  instead of a plausible blank screen. By shape, not by name: any layer without the compose
  seam is refused, whatever produced it.
- **`@ice/ground`'s barrel loses the compositor.** Removed: `createCompositorReflector`,
  `createWidgetQuadPass`, `createDomAtlas`, `createDomSourceBinder`, `createWorldQuadFacts`,
  `createLiftDriver`, `resolveGlSource`, `resolveVideoSource`, `createAtlasAllocator` and
  every type they carried (`CompositeTarget`, `CompositeFrame`, `QuadFacts`, `QuadTexture`,
  `WidgetQuadPass*`, `DomAtlas*`, `DomSourceBinder*`, `LiftDriver*`, `AtlasAllocator*`,
  `AtlasSlot`, `AtlasWasteReport`, `SlotResidency` …). `GroundLayer` loses
  `compositorReflector`, `sources`, `domSources` and `groundTargetLive()`; `GroundOptions` and
  `GroundHostOptions` lose `device`, `sources`, `target`, `order`, `atlas`, `lift` and `video`.
  What the barrel IS, now: the stratified ground, unchanged, plus the two kept LEAVES both legs
  share — `hic-adapter` and `instrumentSubmits` (which MOVED from `src/compositor/` to
  `src/submit-instrument.ts` and is exported from `@ice/ground/compose` as well).
- **`@ice/core` loses the compositor SOURCE REGISTRY.** `createCompositorSourceRegistry`,
  `CompositorSource`, `CompositorSourceDom`, `CompositorSourceGl`, `CompositorSourceVideo` and
  `CompositorSourceRegistry` are gone — the meeting point they existed to be is now the world
  itself (`TextureRef`, written by Residency) and, for a live surface, `VideoIngest`'s door.
  `SurfaceKindValue` survives the file and moves to `core/src/surface/contract.ts`; the export
  from `@ice/core` is unchanged. `createDomWidgetsReflector`'s `sources` option goes with it.
- **`@ice/r3f` loses the old pool and the composited arm.** Removed:
  `WebGpuRenderTargetPool`/`WebGpuRenderTargetPoolOpts`, `createIslandSourceBinder` and its
  types (`GlSourcePoolLike`, `IslandSourceBinder`, `IslandSourceBinderOpts`, `SourcesLike`),
  `CompositorBinding` and `GLViews`'s `compositor` prop, `createRetainedQuadTransitionAdapter`
  with `RetainedQuadPool`/`RetainedQuadTransitionOptions`, `PassContext.sources`, and
  `GlFrameStats.retainedQuads`. `WEBGPU_ISLAND_SAMPLES` and `webGpuRenderTargetBytes` now come
  from `./island-target` (the same values). An island under the composited profile is
  `createIslandRender` (B5) and nothing else. The retained-quad transition was the STRATIFIED
  profile's outgoing frame; that profile has none until Phase C moves it onto the ground, where
  a departed frame is the flight's second slot (B7).
- **The old profile's rigs are retired**, and what replaced each:
  `board` → `render` (the promote witness, D7) + the `no-full-board-path` unit test carried onto
  Residency + DomRender · `input` → `input`, PORTED to the new profile (it found two real
  defects; see Fixed) · `demand` → `render`'s bucket ladder (30/10/2 fps) · `app-witness` →
  `islands` + `video`, and `islands` gains the cross-kind z check · `island-parity` → `islands`
  (the same method, tighter numbers, in `docs/benchmarks.md`) · `zoom-drift` → `render`'s drift
  readback, 0 px past the slot by construction under both raster strategies. ACCEPTED LOSSES,
  named: `board`'s atlas-waste report (the M19 A2 allocator bench is the unit witness now),
  `parity`'s S1 A/B (moot — the ground IS the compositor), and `demand`'s boot stagger (DomRender
  has no per-frame copy budget yet — owed).
- **`GroundProgram.transition` is NOT deleted here.** §10.8 listed it; that was a scoping error
  and this is its correction. `packages/ground/src/programs/magnet-grid.ts` declares
  `transition: "snapshot"` and is the shipping STRATIFIED grid, so the three outgoing strategies,
  the snapshot ledger and `renderer.capture()` retire at **C2**, with the grid, when design-011's
  `GroundProgram` contract is reshaped. What `renderer.ts` did lose is the composited leg's
  OFFSCREEN target and blit (`offscreen`, `targetTexture()`, the colour target).
- **`defineWidget({ presentation })`** — retired earlier in this same block; B8 is where the last
  code that could have read it goes.
- **`@vibecook/ice` gains three subpaths**: `./ground/compose`, `./ground/packs` and
  `./ground/engine`. The mat pack's blue-noise tile now SHIPS — generated into
  `src/assets/blue-noise.gen.ts` and exported from the packs entry as `blueNoise()` — because a
  published consumer has `dist/` only and a `?url` import of `assets/blue-noise.rgba` reaches
  nothing (D-B8.1; `packages/ice/tools/audit-pack.mjs` is the standing witness). `@ice/ground`'s
  `gen:check` covers the generated module.

### Added

<!-- design-013 C2 (2026-09-07) -->
- **`groundField` — the stratified profile's ground on the engine** (design-013 §8 C2,
  D-C2.3). One WebGPU canvas on a device the layer acquires itself (`navigator.gpu`, or a
  `gpu` handed in), the same frame builder `groundCompose` runs — for the SOURCES (every
  on-screen card's silhouette bends the lattice, as the old magnet grid's `readSpatial`
  sources did), the live portals with their inside's own field config, the flight's second
  slot (the departed frame's field under the departed camera, in the config it was drawn with
  at the cut — design-006 §9 on the stratified profile for the first time, dual-live, no
  snapshot), the wires and the guides gated by the canvas type — and no card frames in any
  slot. A refused adapter, a failed compile or a lost device is a console error and an
  unavailable layer (`field.status()`), never a throw in the frame; the app steps on with the
  DOM board. `onDevice` hands the device over before the first frame (a rig's
  `instrumentSubmits`). Witnesses: `packages/ground/test/compose/{field-host,field-dirty,
  poles}.test.ts` (the switch, the gates, the re-tune, the portal's inside config, the departed
  config, the refusal, idle-zero and the dirty union on a stub device, D-C2.2's bake count on a
  REAL `Field`), and the desktop `stratified` rig (`pnpm --filter widgetlab-desktop
  stratified`): the real DOM board over the engine's ground, the flight's cut at maxΔ 0
  inside the face and out, a 60-step pointer gesture at 0 bakes, a remote pole at one bake per
  move.
- **Poles on the engine — `packPoles`, `PoleSource`, `localPointerPoles`, `cursorVisualPoles`**
  (`@ice/ground`, `@ice/ground/compose`; D-C2.2). A pole flagged as the local pointer rides the
  field's analytic cursor term with its strength — its motion redraws and never re-bakes the
  atlas; every other pole is a degenerate `FieldSource` (`{ cx, cy, hx: 0, hy: 0, r: 0,
  strength }`, the old `[cx, cy, 0, 0, 0, strength, 0, 0]` record) and its move is one bake.
  `groundCompose({ poles })` takes them too.
- **`ENGINE_PALETTE` / `ENGINE_THEMES`** (`@ice/ground`): the engine's own two themes, for a
  host that projects none and as the base a host overrides a role of (`themeFrom(name, {
  ...ENGINE_PALETTE[name], canvasBg })`). ICE ships no design system, so every role names the
  ICE number it is.
- **`slotFieldConfig` / `mergeGridConfig`** (`@ice/ground`): a canvas type's declaration and
  the `grid` re-tunes onto a slot's `FieldConfig`, and `configureGrid`'s one-level merge on
  the magnet block, as pure functions.
- **The composited profile's per-slot configs, for free**: `groundCompose` resolves the root
  slot from the canvas type at every switch and a portal's slot from its inside type through
  the same host (`GroundComposeContext.catalog`, which `<InfiniteCanvas>` now passes) — the
  desktop board's folder draws its whiteboard's `line` grid inside its face.

<!-- design-013 C1d (2026-09-07) -->
- **`line` — the engine's second built-in glyph** (design-013 §8 C1d, D-C1.4). The classic
  line grid is no longer a three `Object3D` program with its own TSL shader and its own decade
  ladder: it is a `SurfaceGlyph` beside the dot in `fieldShaders`, so `glyph: "line"` draws
  with no app registration. It shades the ENGINE's lattice — the same three rungs, the same
  `fadeIn` window by a rung's own cell — through `lattice/line.ts`'s law, which is the cutting
  mat's mechanism without the mat's material: no gobo, no grain, no colour chain. One device
  pixel wide at every zoom and every rung, in the theme's line ink (`LINE_GRID`, projected from
  the old grid's `GridConfig.dotColor`) at the field config's alpha. A host that wants the
  mat's decade hierarchy passes its own `LineLaw` through `FieldConfig.ext.line`. Pinned by
  three oracle scenes (`line-z0.5` · `line-light-z1` · `line-z6.31`), which `rig:parity`
  renders identically in Chrome and in Dawn, and by `test/compose/line-glyph.test.ts`, which
  drives the real `Field` on a device stub.
- **The old-vs-new line grid, RECORDED** (design-013 D-C2.1). The new glyph's LOD is the
  engine's lattice and not the old ladder, so the two are compared, not reconciled:
  `pnpm --filter widgetlab-desktop line-ab` draws both in one headless Electron page, on one
  device, at zooms 0.5 · 1 · 2.5, each arm captured twice as its own control (maxΔ 0). At zoom
  1 and 2.5 the two ladders coincide — same pitch, same phase to the pixel, the same 14.44 %
  and 5.91 % of the frame inked — and the whole difference is colour and width: three's output
  pass encodes the old grid's ink to sRGB (peak 157) where the new writes the theme's bytes
  (peak 85), and the old line is 0.55·dpr device px of half-width against the new's 0.5. At
  zoom 0.5 they part, as the ruling says they must: the old holds a 20 device px grid at
  27.75 % ink, the new promotes a decade to 200 device px at 2.98 %.
<!-- design-013 C1 (2026-09-07) -->

- **The overlays — wires, guides and the tri-soup on the engine, design-013 C1**
  (2026-09-07). The ground's slot had two passes, the field and the frames, and no room for
  anything else. It has a THIRD now, and it is the app's: an OVERLAY is a named pass with a
  STAGE — `under` (after the field, before the cards) or `over` (after them) — created once
  and spawned per slot, exactly as a grid program's surface pass is.
  `Ground.create({ overlays })` / `groundCompose({ overlays })` register them; each slot's
  data rides `SlotInputs.overlays` by name, the `ext` convention. **With none registered
  nothing changes at all:** all 47 of the oracle's existing renders are byte-identical with
  the seam in place and the two overlays registered on every slot set, which is the seam's
  own witness (`packages/ground/test/compose/overlays.test.ts` records the draw calls and
  compares them to a slot built the old way).
  - **The soup pass** (`compose/overlay.ts`): one WGSL entry — a vertex is `xy` in the
    slot's screen px plus `rgba`, the slot's view maps px → clip, `BLEND_OVER`, no depth,
    `cullMode: "none"`. The `DoubleSide` winding find of 2026-07-16 evaporates: WebGPU culls
    nothing by default, and the oracle's `overlay-soup-z1` scene asserts a clockwise and a
    counter-clockwise triangle both land. Its vertex buffers grow by the old `soup-mesh.ts`
    policy and never shrink, and a frame whose soup did not re-collect re-uploads only the
    uniform. The slot's scissor and its portal CHAIN apply as they do to the field: an
    arriving frame's overlays are clipped to the container's face (`overlay-clip-enter-p0.5`).
  - **Wires and guides** are the compose host's two root-slot overlays (`compose/overlays.ts`),
    collected in SCREEN px under the LIVE camera on frames whose facts or camera moved. The
    dirt is PULLED — a change collector over the same components and tags the old
    `passes/wires.ts` and `passes/guides.ts` armed observers on, one for one — so a still
    board wakes nothing however many frames pass. The GATE is the canvas type's
    (`presentation.ground.wires` / `.guides`, both defaulting to on), read at the mount and on
    every canvas switch. Their look still comes from core's `WiresConfig` /
    `SnapGuidesConfig`, now through `groundCompose({ wires, guides })` — the same partials the
    old `ground({ wires, guides })` and the react props take.
  - **Destination-frame truth** (design-011 §7.3): a nested portal slot carries no overlays
    and neither does a flight's departed slot — they cut at the switch, like the stratified
    islands. The departed frame's wires are OWED (a world-space soup whose widths are
    re-collected per frame).
  - The pure halves — `SoupBuilder`, `collectWires`, `collectGuides` — were COPIED across the
    Phase-C wall into `compose/`, since the new leg may not import the old one.
    `packages/ground/test/overlay-collectors.test.ts` runs both implementations over the same
    world and asserts the soups agree element for element, so the copy cannot drift before C2
    deletes the original.

- **A colour-chain difference between the two grounds, measured** (design-013 C1). The new
  `overlay-parity` rig (`apps/widgetlab-desktop`, one Electron page, headless) draws one
  wires-and-guides world through the OLD `ground()` and through the new `Ground`, predicts
  both from the same triangles on the CPU, and reports each against an A-vs-A control. The
  geometry agrees exactly — neither renderer leaves bare a pixel the raster says carries
  soup, over 110k–135k interior pixels — and the new pass matches the colour its config names
  BYTE FOR BYTE. **The old leg does not, and never did:** three composites the overlays in
  LINEAR light and encodes on output, so a wire at `rgba(120, 132, 145, 0.9)` has always been
  drawn lighter than that, and two translucent layers over one another have been drawn a
  different colour entirely — up to 87/255 apart from the configured value. The old chain is
  reproduced exactly by the rig (deep-band maxΔ 1, the encode's own rounding), so the
  difference is named rather than guessed. C2 settles which chain the stratified profile
  keeps. The rig retires with the old leg.

- **The flight on the ground — design-013, B7** (2026-09-07). Under the composited-next
  profile a nav flight is the ground's SECOND SLOT: the departed frame drawn beside the
  arriving one, from the world, every frame. **The descriptor** (`NavTransition`) now carries
  the departed frame's camera at the cut (`fromX/fromY/fromZ`) and `departedCameraOf(t, cam)`
  is the one rule for what the departed frame renders under — that camera ITSELF at p = 0 and
  while frozen, `outgoingCamera` through the affine otherwise; the DOM's departing plane
  (`PresentationTransitionFrame.outgoingCamera`) reads the same rule, so the two agree to the
  bit. **An enter starts from the live portal's exact camera**: `enterContainer` passes
  `outgoingCamera(M, camPre)` — the camera the container's face was already showing its inside
  under — not the continuity solve's ulp-off twin. **The first tick after the cut holds at
  p = 0** (`NavTransition.ticks`): one product frame is drawn at the exact `c0`, so the cut
  changes no pixel on the ground and the motion begins from a frame that exists. **`Retained`**
  is written at last: `startNavFlight` tags the departed frame's cards (the parent's on enter,
  the inside's on exit) and the tick releases them at the landing, on a gesture's yield and on
  abort — Residency keeps their textures for the flight. **The ground's side**
  (`FrameBuilder.flight`, `compose.stats().outgoing`): the departed frame's cards at rest in
  ITS OWN paint order (`buildOrdinals` of the departed parent — a card raised by a drag stays
  on top as it fades), with their content (`page`/`own` from the residency: the departed slot's
  records carry their textures), its own live portals, the entered container a HOLE the
  arriving slot draws through (one tree, `at`) on enter, the departed inside drawn OVER the
  parent on exit; the arriving frame dressed for its landing, the departed for the cut. The
  compose layer owns the `ground` presentation plane (an adapter that prepares instantly —
  without an owner a cross-type enter was gated to a snap). The `next-boot` rig's nav phase,
  through the real React path: the enter cut changes no pixel on the ground (maxΔ 0 over
  2560×1616 — the rest frame vs the held cut frame), one tree through the folder, both slots
  mid-flight, an exact landing, idle-zero inside, the exit's cut frame pixel-identical to the
  inside at rest (maxΔ 0, whole frame), an exact landing on the saved camera, the round trip
  pixel for pixel — ALL PASS. Two findings on the way, both fixed at source: the vf-frame
  pack's button springs reported settled without SNAPPING (a −1e-31 residue read as "hovered"
  to the shader's sign test — a card at rest must resolve exactly as a still of it does), and
  the builder's sibling-order index follows the CURRENT frame, so the departed frame must
  build its own ordinals. Four core tests (`nav-flight.test.ts`), three ground tests
  (`flight.test.ts` — the flight's `c0` equals `portalAt` on the preview's arrival bit for
  bit, on ICE's own data); design-006 amended (§9). The old ground's three outgoing
  strategies go unused under the new profile (B8 did NOT delete them: `programs/magnet-grid`
  declares `transition: "snapshot"` and is the shipping stratified grid, so design-011's
  `GroundProgram` contract is reshaped at C2 with that grid, not here); Q13 (the zoom-through) is
  not taken here.
- **IslandRender — the island half of composited-next, design-013 B5** (2026-09-07). A
  `gl` island now renders into the PRIVATE target Residency allocated for it, and the
  ground draws that texture as the card's content in `own` mode, on the device three
  already adopts. `createIslandRender({ gl, renderer, bridge, world, content })`
  (`@ice/r3f`) installs itself into the compose handle's `renders.island` slot, so it runs
  in design-013 §6's roster order — after the ECS settles, before GpuCompose's submit —
  and never in R3F's own loop, which stays `frameloop="never"` and presents nothing.
  `<GLViews>` selects that arm by reading the ground's content seam off a new React
  context; nothing about the old composited or stratified profiles changes.

  **Targets are keyed by HANDLE, not by entity.** Residency mints a new handle whenever a
  card's destination changes, so a resize allocates a new target and the old one is
  disposed when the table forgets it (`ContentResidency.onForget`, fired after the frame's
  submit). One authority decides what is sampled — the current `TextureRef` — so the
  **pin-blind-resize class dissolves rather than being fixed**: there is no refcount to be
  blind to. `Retained` (which B7 writes) is honoured by Residency's LRU alone; the old
  pools' `pin`/`isPinned`/`retired` refcounts stayed until B8 deleted that leg with them.

  **The demand clamp the old pass never read** (design-013 D10): `SurfaceDemand.mode ===
  "paused" ` renders nothing at all, and a live card's fps bucket is a ceiling on how often
  it renders — with the animation time still BANKED and delivered whole, so a clamped
  bucket changes cadence and never speed. A destination with no target yet outranks the
  clamp: a card that resized must not show its plate for an interval. Eligibility itself is
  unchanged and now shared — `islandPaintable` is the old pass's own predicate, extracted
  to `island-state.ts` so both legs ask one question. The island target's recipe (4× MSAA,
  depth, the sRGB REQUEST whose ANSWER the compose re-encodes on) moved to
  `island-target.ts` for the same reason.

  New in `@ice/react`: `useSurfaceContent()`, `SurfaceContentContext`, `surfaceContentOf`
  and the structural `ContentSink` / `ContentRenderSlot(s)` / `SurfaceContent` /
  `TextureDescription` mirrors of `@ice/ground/compose` (react may not import ground, and
  `@ice/r3f` imports these rather than restating them). New in `@ice/r3f`:
  `createIslandRender`, `createIslandTarget`, `islandPaintable`, and a
  `<GLViews onIslandRender>` prop for rigs. `GroundComposeStats` gains `runs` — the last
  frame's z-run count, the witness that two own textures really interleave in one pass.

- **DomRender — the pixels move, design-013 B4** (2026-09-07). A promoted DOM card's
  content now reaches the GPU. **`createDomRender`** (`@ice/ground/compose`, filling §6's
  reflector-5 slot `compose.renders.dom` once `Ground.create` resolves) copies the card's L1
  host with HTML-in-Canvas straight into the destination its `TextureRef` names — the page
  array's layer at `origin { x: u0·side, y: v0·side, z: layer }`, or a Q10 oversize card's
  own texture — and tells the content residency it WROTE that destination, so the ground
  draws `page` where it drew the plate. `copyElementToTexture`'s `origin` gained a `z` (the
  array layer); nothing else in the adapter changed.
  - **The L1 source canvas is wired in production** for the first time. The react facade
    builds it when the ground's handle carries the adapter's effects
    (`compose.sourceCanvas`, `null` on a host without the origin trial or without a working
    `layoutsubtree`), resizes its bitmap from the same rect `Viewport` comes from, and hands
    it to the dom reflector, which parents every `gpu`-target host under it and brings it
    back on demotion — portal-preserving, as a drag-lift always was. On a MIXED board the
    canvas is pointer-transparent (`createSourceCanvas({ pointerEvents: "none" })`) and the
    hosts it adopts set `pointer-events: auto` on themselves, so `dom`-target cards under it
    keep their hits.
  - **One `geometry()` call sizes both ends.** DomRender owns the L1 host's box while the
    host is canvas-side and writes `geometry().cssSize` — band space under `band`, live-zoom
    space under `crisp` — with `zoom / band` on the placement matrix; Residency reserved
    `geometry().slotSize` from the same pure function on the same facts. `groundCompose({
    raster })` declares the per-kind strategy once and the profile carries that same function
    to Residency, so the two readers cannot disagree. Measured: **0 px written past the slot**
    at zoom 1.9 under both strategies, where the old leg's binder wrote 40,272.
  - **The demand clamp is carried in behaviour** from the old binder: a paused card is
    PARKED (no copy, no wake, outside `pending` — it costs nothing rather than merely
    uploading nothing, and its plate is honest), a bucket DEFERS to the moment it allows
    (behind, never wrong), 0 copies now. An unpainted host's `InvalidStateError` is counted
    and the debt KEPT. `compose.domRender.stats()` reports `{ copies, dirtied, refused,
    unavailable, parked, deferred, pending, resized, pagesLayers, growths }`.
  - **The page array grows** by realloc + a per-layer `copyTextureToTexture` in one encoder
    + a new realisation, the old array dying at the next `collect` — after the submit
    (D-B4.1).
  - `PresentationProfile.hostsBeforeRoster` (opt-in, composited-next only) runs the dom host
    reflector BEFORE the profile's roster, so a promotion is reparented in the same flush the
    render copies from. `hic-adapter` left both dependency-cruiser wall lists: it is a kept
    leaf imported by both legs, not old leg.
  - Exit — the new `next-render` rig: D7's promote diffs **0 of 70,176 px** on the card's
    interior and again on the way back; S8's parity, redefined, is **0 of 70,176 px** against
    a stratified twin page with an A-vs-A control at 0; idle-zero holds with promoted cards
    (0 submits, 0 copies over 361 frames); an animating card copies 23.3/s against 59.8 paint
    marks/s, a paused one 0. Plus 27 node tests and 11 mutation probes.
- **The content term reads the world — design-013, B4a** (2026-09-07). The trunk B4, B5
  and B6 build on: under the composited-next profile the ground now draws a card from the
  TEXTURE its `TextureRef` names — `page` (the layer and the written rect, through the one
  page-array binding) or `own` (the run's texture, the sRGB pipeline chosen by the texture's
  ACTUAL format) — once a render reflector has realised the handle and written the
  destination; the plate until then (`empty` is never sampled: a fresh slot, a re-slot after
  an eviction, a promoted card whose copy has not landed all draw the plate — a write is owed
  per destination, keyed by the ref's own values). **`ContentResidency`**
  (`@ice/ground/compose`, `compose.residency`): `attach(table)` · `realize(handle, texture,
  { owned? })` — every realisation goes through it, a re-realisation of the same handle
  (a page array that grew, D-B4.1) retires the earlier texture at the next `collect`, after
  the submit · `wrote(entity)` · `touch()` (the dirt latch outside the world; the builder
  wakes on it, `WakeReason "content"`) · `contentOf(entity)` · `pagesView()` (the host
  rebinds `Ground.setPages` when it changes) · `collect()` (the table's drain as the destroy
  list, `onForget` for a producer's own object) · `stats()`. **The profile owns its texture
  table** (`createResidencyStore` at install, attached to the ground, passed to the surface
  infra with the device's `maxTextureDimension2D`, disposed last). **Three render slots**
  (`compose.renders.{dom,island,video}`): the profile registers a forwarder for each in §6's
  order (5–7, before DomCompose and GpuCompose), so a render installed after the mount — the
  ground's DomRender, the r3f island root, a video producer — runs in its place. The frame
  builder journals `SurfaceTarget`/`TextureRef`, emits every card's content term, counts
  `textured`, and names each host entry's `target`. Seven tests on a real engine with the
  surface infra installed; the profile test pins the table's ownership; the oracle's 47
  renders byte-identical; `next-boot` at B3b's numbers. No pixel changes until B4 realises
  the first texture.
- **The DOM boundary — design-014, B3b** (2026-09-07). Under the composited-next profile a
  DOM card's host is CONTENT only: chrome exists once, on the ground. **DomCompose**
  (`groundCompose`'s `compose.domCompose`, registered by the profile just before GpuCompose)
  runs the frame's build and writes each card's content element change-only — `clip-path`
  as a polygon marched from the card program's inner distance field (`CardProgram.inner`,
  recomputed only when `clipKey` says the shape moved: the reveal's ~300 ms, never a pan or
  a lift), the lift on `transform`, the hold's opacity — and GpuCompose draws the same
  geometry. **The router's part channel**: the interaction stack carries a `framePick` slot
  (`FramePickSource { pad, hit }`) the ground fills at mount with its last-drawn geometry
  through the program's `pick()`; `picking` widens the hit past the content rect by the
  chrome's reach and asks the source, writing `PointerPart` on the pointer change-only; a
  recognizer spawned on a part carries `DownPart`, arbitration withholds the move route from
  it (a press on a control never lifts the card), the select behaviour hands the tap over as
  the `PartTap` resource instead of selecting, and `groundCompose({ onPart })` is the app's
  action. A rounded corner's void and a press on the chrome band now pick as drawn: the band
  is a drag handle, the corner is the canvas. **`useChromeOwner()`** (`@ice/react`, from the
  profile's `chromeOwner`: `ground` for composited-next, `dom` otherwise) lets an app's card
  shell render bare under the ground — widgetlab's CardShell and its folder view do, so the
  folder's face is the ground's live portal and its DOM minis retire; the STRATIFIED profile keeps
  its CSS chrome (corrected at B8: the deletion took the old COMPOSITED leg, not the stratified
  one, and widgetlab-desktop keeps a stratified fallback for hosts without WebGPU — CardShell's
  dual path retires with that profile in Phase C). The `next-boot` rig's boundary phase: every card's clip written
  as a polygon; the ring band and the shadow skirt read the same on the page with the DOM
  hosts shown and hidden (chrome once), the title differs (content above), the folder's face
  is the portal; a click on the ground-drawn close button reaches `onPart("close")` and
  neither grabs nor deselects; a drag begun on the band moves the card — ALL PASS. Four core
  tests drive the pick through the full stack. A portal's inside now resolves unrevealed
  (`IDLE`), as an unselected card is. Deferred to B4: the D7 promote witness and the parity
  redefinition (both need content the compositor draws); the P4 resize grips stay DOM chrome.
- **The ground's pack seam — design-014, B3s** (2026-09-07). The ground engine now ships
  only what every infinite canvas needs and what depends on a world fact: the lattice and
  the field bake, the DOT glyph, the slot tree and the compositor, the SHELL card (a
  rounded plate at the card's radius, the §5 shadow, a hairline, the ring on selection —
  which is also the drop cue on the accept tier), and the springs on `Selected` / `Grab` /
  the drop pair. Everything that is a LOOK is a pack an app registers through
  **`@ice/ground/packs`**: `needleGlyph` and `cuttingMat` (grid programs — `instanced`
  over the engine's bake, or `surface` with a pass of its own) and `vfFrame()` (a card
  program — VibeField's composed corners, buttons, delete morph and cast light). Three
  seams and no more: a grid program (`field/program.ts`), a card program
  (`card/program.ts` — the record is a HEAD every program shares plus `ext` tail slots the
  program owns, built per program by `frameStruct`; the pass composes one `card.wgsl`
  that calls the program's `shade_card` below the content and `shade_over` above it, so
  the additive seam law is the engine's), and the theme (a head plus one section per
  pack, `themeFrom(name, palette, grid, packs)`; a pack's colour literals live in its own
  `theme.ts`, a home the literal gate accepts). `Ground.create({ card, grids })` and
  `groundCompose({ card, grids, onPart })` register them; the frame builder resolves
  through the program, journals its extra facts, and lets it report a live spring. The
  engine's default glyph is the DOT (ICE's old-leg `DEFAULT_GRID_MAGNET_CONFIG` keeps the
  needle until B8). Moved out of `@ice/ground/compose` into the packs entry: `resolve`,
  `STYLES`/`PRODUCT`/`composeStyle`, `pick`/`sdInner`, the heat's `HEAT`/`irradiance`,
  and every `mat/*` export with `MAT`, `MAT_GRID`, `NIGHT`, `MAT_LIGHT`; `Frame` /
  `FrameUniforms` became `frameStruct(ext)` / `frameUniformStruct(uext)`; `FieldConfig.mat`
  became `ext.mat` (`withMat`, `matConfigOf`); `stepMotion` lost its button inputs (the
  pack's `stepVfSprings`); `GroundTheme` lost the frame's inks and `matLight`
  (`vfSectionOf(theme)`, `matLightOf(theme)`). Witnesses: the oracle's 44 renders through
  the relocated pack are byte-identical to the pre-fold stash; three new shell scenes are
  the engine card's own baseline; the `next-boot` rig with the packs registered is ALL
  PASS at the same numbers; 380 tests. widgetlab registers all three packs as its own
  choice; VibeField registers them through the pin. The DOM boundary (chrome-less hosts,
  CardShell's retirement) is B3b.
- **The composited-next profile draws the world's cards — B3a, compose in plate mode**
  (design-013 §8 B3, 2026-09-07). `groundCompose()`'s GpuCompose now builds every frame
  from the world through the frame builder (`createFrameBuilder`, `@ice/ground/compose`):
  every widget Active in the nav frame, in sibling order, becomes a card frame over the
  theme's plate and a field source; `Selected` runs the reveal, `Grab` IS the lift (scaled
  by `ChromeSettings.liftScale`, read live), the drop pair `OverlapCandidate` /
  `OverlapRejected` with the recognizer's `DragBounds` is the heat — the springs live in the
  builder, never in the world, and a card out of sight forgets them; a container whose face
  passes the gate carries a live portal from `engine.previews` (the snapshot's
  `resolvedView` IS the flight's arrival: `portalAt()` — new — is `portalOf()` past the
  gate on a solved arrival, bit-identical, so the enter cut stays exact on ICE's own data)
  and its frame is a hole cut to the face. The reflector's dirt is PULLED: a strata change
  collector (`coarse: false`, the attestation core's churn guard already makes) journals the
  facts a build reads, the sibling order's own stamp and two out-of-world wakes (a settings
  write, a preview change) complete it — a Tier-1 `observeQuery` on Position/Size woke every
  frame a selection existed, because the selection chrome declares a Position/Size write and
  that is a column-wide stamp. `compose.stats()`, `compose.wakes()`, `compose.geometryOf(e)`
  and `compose.motionOf(e)` are the instruments; `groundCompose({ cards })` tunes the
  builder; the react `ground` factory's context gains `previews`. The `next-boot` rig grows
  a board phase: 6 real widgets and a folder with 3 inside through `spawnWidget`, pixels
  read back off the ground canvas (a card's centre is `--vf-card`, a gap is
  `--vf-canvas-bg`, the folder's face is its inside's ground — a hole — while its bar is the
  plate), idle-zero with cards on the board and again after a selection settles, the lift on
  Grab (scale 1.05 and back), the heat (presence 1 at the accept tier, the plate under the
  light brighter, fade-out on clear) — ALL PASS. Depth-one portals only (a preview child
  carries no entity — D-B3.2 owed); the DOM hosts still paint their own chrome and the
  folder its DOM preview above the ground — B3b takes the DOM boundary (chrome-less hosts,
  `clip-path`), the router's frame hit test and the redefined parity.
- **`compositedNextProfile` and `groundCompose()` — the NEW composited profile, beside
  the old one** (design-013 §8 B2, 2026-09-07). `<InfiniteCanvas profile={compositedNextProfile}
  ground={groundCompose({ device, theme })}>` boots the ground's own canvas as the L0
  layer on the app-owned device and registers design-013 §6's roster in order — DomRender ·
  IslandRender · VideoIngest · DomCompose (inert stubs holding their place until B3–B6) ·
  GpuCompose, the ground's, last — plus the surface infra set the old profile installs. At
  B2 it draws an EMPTY board (the field under ICE's own defaults, the theme's clear colour)
  on a camera or viewport change and nothing otherwise: the `next-boot` rig
  (`apps/widgetlab-desktop`, `pnpm --filter widgetlab-desktop next-boot`) mounts it through
  the real React path and measures one redraw and one submit at boot, 0 submits over 4 s
  idle, and one frame for a camera write. The profile refuses a device-less engine and the
  old leg's `ground()` layer BY SHAPE (a handle with no `compose`, `composited.ts:79-85`);
  dependency-cruiser walls it from the old profile both
  ways. `groundCompose`'s handle maps the react `grid` prop onto the field
  (`fieldConfigOf`) and takes a new theme (`compose.setTheme`). The old profile is untouched.
- **`@ice/ground/compose` — the ground moves in** (design-013 §8 B1 [GROUND PORT],
  2026-09-07). `vibe-field/draft/ground` enters ICE once, into its final home, as a second
  entry of `@ice/ground` beside the old composited leg — which imports none of it and is
  deleted at B8 (done); dependency-cruiser holds the wall both ways, now as the Phase-C fence.
  What it is: the raw-WebGPU
  engine (`@ice/ground/engine`: device, surface, targets, pipelines, shader composition,
  struct layouts), the magnet field on the decade lattice and the cutting mat with its two
  lights, the SDF card frame with the content term and the §7 heat, the live portal's slot
  tree (the chain, the face, the grown fill), the flight's second slot, the theme's engine
  half, and `Ground` itself — `Ground.create({ device, canvas, ...GROUND_SHADERS })` on a
  device the HOST owns (`acquireCompositorDevice()`). The flight's maths import
  `@ice/kernel`'s `nav-flight` (the copy the draft carried is gone; the ported tests pin the
  kernel's functions to the same numbers). WGSL stays the source under
  `packages/ground/shaders/`; `gen:shaders` writes the string module the entry ships and
  `gen:check` gates its freshness. Wired into NO profile yet — B2 registers the new one.
  With it: the Node oracle (`pnpm --filter @ice/ground oracle` — Dawn through `webgpu@0.4.0`,
  EL8-pinned, run by `tsx` because the kernel's imports are extensionless; 44 scenes and 12
  self-checks) whose renders are byte-identical to a stash taken in the draft before the
  move, and the `groundlab` app (`apps/groundlab`: the tweak-panel lab and thirteen Chrome
  rigs, `pnpm --filter groundlab rig:<name>`). The old barrel is untouched.
- **The presentation facts** (design-013 §5): components `SurfaceKind` ·
  `SurfaceTarget` · `RequestedDemand` · `SurfaceDemand` · `SurfaceBand` ·
  `TextureRef`, the tag `Retained`, the `NO_TEXTURE` sentinel, and
  `effectiveTarget(kind, target)` — the one function every reader of
  `SurfaceTarget` goes through, so a `gl` or `video` surface can only ever
  answer `gpu`. All six are stamped at EQUIP with safe defaults and
  value-written thereafter; no component is added or removed at interaction
  rate. `DragBounds` joins them on the Drag recognizer, written by `dropSystem`.
- **The three standard surface behaviours** — `ice:surface.domAtRest`,
  `ice:surface.alwaysGpu`, `ice:surface.alwaysDom` — exported as `domAtRest`,
  `alwaysGpu`, `alwaysDom`, with `STANDARD_SURFACE_BEHAVIORS` and
  `registerStandardSurfaceBehaviors(runtime)`. `createCanvasEngine` registers
  all three before `opts.behaviors`, so a facade app needs no wiring at all.
  `domAtRest` is the ratified dom default: live DOM at rest, GPU the same frame
  as the grab, back one settle window after the release — and the window now
  expires on `FrameInfo.clock`, the engine's clamped-dt human clock, rather
  than `performance.now()`.
- **`present:infra`** — a twelfth pipeline group, after `present`, so a kind
  behaviour registered long after boot still reaches the clamp in the frame it
  writes. `installSurfaceInfra(engine)` installs the Band and Demand systems
  into it as ONE call returning one remover, and `PresentationProfile.install`
  is where a React profile makes that call.
- **`geometry()`** (`@ice/kernel`) — `(size, band, dpr, zoom, raster)` to
  `{ cssSize, backingScale, rasterSize, slotSize, written, placement }`, the
  one call that gives a copy size and its uv together.
- **`createBehaviorRuntime`** is exported from core, with `BehaviorRuntime`,
  `BehaviorRuntimeOpts`, `BehaviorSession` and `BehaviorPresence`. A facade app
  never names it; an imperative host that drives the raw engine needs a runtime
  to register behaviours into.
- **Residency** (design-013 §4) — the module that replaces "atlasing", and the
  third system of the `present:infra` trio. `createLayerAllocator` seats slots
  in fixed 2048² layers keyed `(entity, band)`; `createTextureTable` is what a
  `TextureRef.texture` handle means (`pages` · `own` · a producer's registered
  `stable` texture), refcounted; `createResidencySystem` is the one writer of
  `TextureRef`, gating allocation on `Visible ∨ Retained` and taking cold keys
  only under budget pressure; `createResidencyStore` builds the pair a host
  installs. `installSurfaceInfra(engine, { residency })` (`ResidencyOptions`)
  installs it, and the React composited profile passes it.
  `DEFAULT_RESIDENCY_BUDGET_BYTES` is 256 MB — **a placeholder until B3
  measures one on a real device.** Allocation is computed purely and written to
  the world; nothing is realised on a GPU and **nothing reads `TextureRef`
  before B3**, by design.
- **`ResidencySystemOptions.maxTextureSize`** (also on `ResidencyOptions`, threaded
  through `installSurfaceInfra`), default 8192 — the floor every WebGPU adapter guarantees
  for `maxTextureDimension2D`. An `own` texture request larger than it on either axis is
  scaled down UNIFORMLY — never refused, never squashed per axis; the compose maps the
  whole texture onto the card — and the clamped size is what the residency budget counts.
  Closes design-013 D11: under `band`, `geometry()` asks for `size × band × dpr`, so a
  2000-unit card at band 16 on a dpr-2 display asked for 64,000²; it is 8192×4096 now.

<!-- design-013 B6 (2026-09-07) -->
- **VideoIngest — a live surface on the composited-next profile, design-013 B6**
  (2026-09-07). `groundCompose`'s handle gains **`compose.video`**
  (`createVideoIngest`, `@ice/ground/compose`), installed at the mount into the profile's
  `video` render slot (§6's reflector 7, before DomCompose and GpuCompose):
  `register(entity, { width, height, srgb? })` mints the stable handle Residency names in the
  card's `TextureRef` (whole uv) and realises an `rgba8unorm` (or `-srgb`) texture with
  `COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT` against it; `arrive(entity, source)` queues
  the latest frame (`VideoFrame`, `ImageBitmap`, a canvas, a video element) and closes what it
  supersedes; the reflector copies each queued frame once
  (`copyExternalImageToTexture`, premultiplied, no flip) and says the destination was written,
  which is what wakes the builder; `unregister`, `stats()` (`registered · arrivals · copies ·
  dropped · paused`, with `arrivals === copies + dropped`) and `dispose`. The demand clamp is
  honoured at the door: a paused card's arrival is dropped and closed, and an fps bucket
  allows one copy per `demandIntervalMs`. A registered card whose destination goes away and
  comes back — culled and scrolled back — owes NO new copy: the texture is the producer's, its
  pixels are still in it, and the ingest re-asserts the write (without which a paused live
  surface would draw the plate forever, having no next frame to pay the debt with).
  **Exit rig `next-video`** (`pnpm --filter widgetlab-desktop next-video`): every production is
  one copy and one compose frame (33/33/33 over 181 frames), the fixture's top-left marker
  lands top-left, six distinct liveness colours over eight productions, a paused card at 0
  copies and 0 submits over 181 frames while its producer keeps producing, idle-zero over
  362 frames, and a registered-but-never-fed card on the plate.

### Changed

- **The ported ground's imports lost their `.ts` suffixes** (B2, 2026-09-07 — design-013
  B1's D-B1.1 reversed): every consumer app that typechecks would otherwise need
  `allowImportingTsExtensions`, and a bundled `.d.ts` would carry the suffixes to the
  package's users. The Node oracle already ran through `tsx`, so the suffixes bought
  nothing. 163 specifiers in 43 files; the 44 oracle renders stayed byte-identical.

- **`SurfaceDemand`'s equip default is `live/60/false`** (was `paused/0/false`;
  `RequestedDemand` is unchanged). design-013 D2 chose `paused` to spare "the frame
  between equip and the first clamp", but that frame does not exist — equip's adds land at
  the derive flush and the clamp runs in `present:infra` in the same tick — while the
  default's one real effect is in a host that installs no Demand system, where `paused`
  parked every equipped card forever and `live/60` is exactly the pre-A1a behaviour.
  Breaking only for code that read the stamped value before the first clamp.

### Fixed

<!-- design-013 B8 (2026-09-07) -->

- **A promoted card's L1 host now tracks the camera.** `DomRender`'s `placeHost`
  was reachable only through the copy path, so a card that owed no copy was never
  re-placed and its host stayed where the last copy left it. An L1 host is never
  painted, so nothing LOOKED wrong — but it is the hit-test, focus, caret and IME
  truth for a promoted card, and a pan walked it off the card it belongs to. Found
  by the `input` rig, ported to this profile at B8: **7 of 24 mid-gesture hits
  landed, the host up to 540 px from its card.** DomRender now runs a placement
  pass at the end of every flush over the hosts it owns, change-only. After:
  **24/24, max offset 0.000 px over 120 frames**, and idle-zero unchanged (0
  submits, 0 copies, 0 DOM writes over 361 frames with three promoted cards).
- **…and a pure pan still uploads nothing.** With placement running every frame,
  a 600-frame pan re-uploaded the whole promoted board — 1,404 copies — because
  the placement write raises a paint event naming the host, which
  `changedElements` reports identically to a content edit. `@ice/dom`'s
  `source-canvas.ts` header names the remedy and B8 implements it on this leg: a
  TEMPORAL guard kept by the writer that knows what it wrote. `DomRenderStats`
  gains **`selfDirt`** — the marks dropped as this module's own placement writes.
  After: **0 copies over 600 frames, all 3,606 marks attributed**, and typing
  still reaches the copy path (a filter, not a mute).
- **`promotable()` and `canvasEligible()` are ONE predicate** (`@ice/dom`). They
  disagreed about a `video` card: `promotable` asked the widget definition for
  `!== "gl"` and missed `video` entirely, while `canvasEligible` asked the world
  and excluded both — so a grabbed video widget took the `lifted` branch that
  `canvasEligible` was written to refuse. Reachable since B6 made
  `defineWidget({ surface: "video" })` legal. The one predicate reads the world's
  `SurfaceKind` stamp when it exists and the definition when it does not, which
  neither reader did alone.
- **An `own` texture's `srgb` is the KIND's fact, not a default** (`@ice/core`).
  `ownFor` minted every private handle `srgb: false`, so the table said `false`
  for an island target that IS `-srgb` — a lie that only held because the ground
  reads the texture's actual format rather than the table. `gl` now mints `true`
  and Q10's oversize `dom` slot `false`.

- **A React composited app now DECIDES to promote on drag — the decision half,
  not the pixels.** `infinite-canvas.tsx` built `domWidgets` without a
  `PresentationRegistry` and nothing in `@ice/react` created the policy, so no
  React app had a promotion decision at all; the rigs hand-wired both and were
  the only thing that ever saw one. The standard behaviours are
  engine-registered and the DOM layer reads the world, so there is no decision
  wiring left for an app to forget: a drag flips `SurfaceTarget` to `gpu` and
  every reader sees it. **No pixels move there yet** (errata 2026-09-07: true of
  this entry's commit only — DomRender copies a promoted card's pixels since B4,
  see the B4 entry above). `infinite-canvas.tsx`
  still builds the DOM reflector with no source canvas, so `placementOf` never
  answers `canvas`, no host is reparented, and nothing is composited — the L1
  host path for React lands with design-013 B3/B4. The rigs remain the only
  place a promotion reaches the screen.
- **The old composited leg's demand parking follows the clamp.** When a caller
  passes no `atlas.demand`, `createCompositorWiring` feeds the dom source
  binder from the `SurfaceDemand` component instead of throttling nothing. A
  host that genuinely throttles from elsewhere still passes its own callback.
- **`domAtRest` demotes only what it promoted.** It took ownership of every
  grabbed card whether or not it changed anything, so a card a host had put on
  the GPU by hand came back from its first drag owned — and 250 ms after the
  release was demoted to `dom` for good, since nothing re-promotes a card that
  is not being dragged. Ownership now follows a real change, which is the rule
  the policy this behaviour replaced always had.
- **`domAtRest` refuses a non-dom kind at `init`.** It declared `SurfaceKind` in
  its reads and never looked at it, so a `gl` or `video` widget that named it
  was accepted, presented correctly, and then wrote `dom` on a texture at the
  first demotion — which surfaced as the Band system's dev throw a frame later,
  naming an entity id and no cause. It now refuses exactly as `alwaysDom` does
  (a dev throw naming the widget type; in production a log and no write), and
  never writes the target of a kind it is not for.
- **The behaviour runtime rebuilds its instance snapshot only when membership
  moves.** Every delivery spread the whole instance map into a fresh array, and
  a behaviour that reads a resource delivers every frame — so `domAtRest`,
  attached to every dom widget, paid one O(instances) spread per idle frame for
  a list that had not changed. `ctx.entities()` semantics are unchanged: it is
  still the membership as of phase entry, and a hook that attaches or detaches
  still affects the next frame.
- **Residency review fixes (A3a).** The published atlas layer count now spans the live
  layer ids (`LayerAllocator.layerCount()`, max id + 1 — `retireEmpty()` can leave holes,
  and a card must never name an array index the array does not have); a `world.reset()`
  no longer strands held slots, pinned references or stable registrations (a dead-entity
  sweep on every full walk; `TextureTable.stableOwners()`); an empty layer retires after any
  frame that gave an ATLAS slot back, not only under budget pressure (only an atlas slot
  can empty a layer, and a layer costs its full `layerSize² × bytesPerPixel` from first
  allocation, so retiring an emptied one is what actually returns memory); a producer's `register()` /
  `unregister()` wakes Residency (`TextureTable.revision()`); an unrealised handle is
  forgotten the moment its count reaches zero — only realised handles wait in `drain()`.

### The drag promotes the board, as stills (S1, 2026-09-09)

<!-- design-013 S1 -->
- **`ice:surface.domAtRest` promotes the GESTURE SET.** A grab on any dom card carrying the
  behaviour promotes every dom card carrying it, in the same step, and the whole set demotes
  one settle window after the last release (one window for the set, opened at the last
  release, cancelled by any grab). The reason is stacking: the ground draws a lifted card
  BELOW every resting card the DOM still paints above the canvas (design-012 §6.3's
  rest-state artifact), and under a drag that is the wrong picture for the whole gesture.
  The behaviour still owns only what it changed — a card another writer holds on the GPU is
  neither paused nor demoted. Two new instance fields: `promoteBoard` (default `true`; `false`
  keeps the old one-card promotion, read from the grabbed card) and `stillWhileGrabbed`
  (default `true`; see next).
- **The promoted set are STILLS.** Every card the behaviour promotes for a gesture — the
  grabbed one included — gets `RequestedDemand { mode: "paused" }` for the gesture and its own
  cadence ask back at demotion, so the carry costs the board one copy per card at the pickup
  and none after. `stillWhileGrabbed: false` keeps a card live at its bucket while carried.
- **DomRender: a paused card takes its FIRST picture.** A paused card whose current
  destination has never been written copies ONCE when the world names that destination (a
  promotion, a re-slot, a re-size — the `TextureRef`/`SurfaceTarget` journal), then parks; a
  paint mark still buys nothing. Until now a paused card with no pixels stayed on the plate
  ("honest", design-013 D3) — a plate under a drag is a hole. `alwaysGpu.with({ paused: true })`,
  the old `picture` mode, therefore shows a picture from its first frame. New instrument:
  `DomRenderStats.stills`, the first pictures taken for paused cards.
- **The ground paints HELD cards last.** Paint order on the ground is the stack order, and
  `Grab` is the lift signal (design-004 §1: the lifted plane paints above the content plane;
  the stratified DOM re-parents a grabbed host onto it and back). The compositor had no
  equivalent, so a carried card slid UNDER every later sibling it crossed — invisible while
  only the grabbed card was on the GPU (the DOM neighbours were above it anyway), and the
  first thing the gesture set's overlap witness caught. Held cards now sort after unheld ones
  in the frame builder, keeping their own order among themselves; a release returns the card
  to its ordinal, and "drop on top" stays the product's sibling reorder.
- Witnesses: `packages/core/test/surface-behaviors.test.ts` "the gesture set" (6 cases),
  `packages/ground/test/compose/dom-render.test.ts` the still's first picture and the
  re-slot's new picture (all proven red against the previous sources); the desktop stress
  rig's new `drag` phase (`pnpm --filter widgetlab-desktop stress`) grabs a card on a live
  composited board, reads the overlap's pixel, counts the copies of the carry and the plate
  frames of the pickup, and watches the set come back after the settle. Measured on the
  desktop app at 120 Hz: 24 cards promote as stills in one step with one plate frame and a
  50 ms pickup, carry at 118 fps on 24 copies total; 96 cards likewise with a 167 ms pickup
  (about 1.7 ms per card) and 96 copies; both come back to the live DOM after the settle.

### The levers, built and measured — the copy budget and the batched route (S2, 2026-09-09)

<!-- the levers; James: "try 1 and 2 see how much they improve" -->
- **`groundCompose({ dom })` tunes DomRender** — `{ strategy?, budget?, costs? }` (`DomRenderTuning`,
  exported from `@vibecook/ice/ground/compose`). Absent, DomRender behaves exactly as before: one
  element copy per dirty card, no budget. Both levers are OFF by default in this release; the
  numbers below are the case for turning them on.
- **The copy budget (`budget`).** At most K cards copy per flush, FIFO over the dirty set (a served
  card re-dirtied goes to the back, behind every card still waiting), a gesture's stills first. A
  number is a fixed cap; an object is the adaptive controller: a feed-forward cap keeps the served
  cards' estimated GPU-process time to `target` (0.5) of the frame period it measures from its own
  cadence, the cap shrinks hard when a flush spends over 3 ms of main thread inside its copies (the
  flow-control signature of a saturated GPU process) or when two of the last three flushes came late
  while the copies could be their cause, and it grows by one only after four on-time flushes with
  cards still waiting. The reason it exists: `copyElementImageToTexture` is a fixed ≈0.58 ms of the
  GPU process's ONE main thread per call, and a board past ≈2,800 calls/s stalls the whole app —
  pans, the ground, the lifted card — where a budget keeps the app at the display's rate and lets
  only the promoted cards' cadence degrade. Measured on the stress rig (gpu arm, every card animating,
  M1 Max, 120 Hz; fps at 96 / 192 / 384 cards): **base 48 / 12 / 6 → budget 120 / 88 / 43**, the
  pan 33 / 12 / 6 → 120 / 80 / 38, GPU process 150 % → 65–80 %, each card refreshing ≈8 times a
  second at 96 cards (down from 24 at 48 fps). Past 192 cards the limit is no longer the copies but
  the main thread's own per-frame paint of every animating host inside the source canvas (11 ms at
  192, 23 ms at 384) — a cost the live-DOM arm never pays, and the next thing to look at.
- **The batched route (`strategy: "batched"`).** The served cards of one page layer raster as ONE
  recording: each `drawElementImage`d into the source canvas's own 2D context at its slot inside a
  staging tile cut to the canvas's bitmap at slot boundaries, the tile landed in the page layer by
  one `copyExternalImageToTexture` — where the element route mints a surface, rasters, wraps and
  blits per card. The hosts stay where they are (hit-test, focus, caret, IME untouched), the slot
  atlas stays (a pan still copies nothing), and the staging is cleared right after each copy, so the
  canvas — which IS painted, only its children are not — presents nothing. A tile's copy overwrites
  every slot inside its box, so the WRITTEN neighbours it covers are drawn too; a single dirty card,
  a card the bitmap cannot hold, a refused draw, a failed copy, or a tile the cost model says would
  lose (`costs`: draw 0.1, canvas copy 0.9, element copy 0.58 ms) takes the element route instead.
  Measured: **twice the cards per second at a third of the GPU-process CPU** (96 / 192 / 384 cards:
  3,209 / 2,876 / 4,128 cards/s at 57 / 43 / 56 % against 2,349 / 2,287 / 2,189 at 150 %), fps
  48 / 12 / 6 → 67 / 21 / 11 on its own — its limit is GPU TIME, the render passes the card's
  translucent groups open — and, with the budget, **the budget's frame rates at three times its
  cadence** (120 / 85 / 42 fps with each card refreshing 23 / 11 / 5 times a second against
  8 / 4 / 2). Cost: ≈50–130 MB more GPU-process memory while animating (the 2D surface, its
  copy-on-write duplicates, and Chromium's 128 MB two-second recyclable cache of tile-sized
  intermediates). Witnessed on the live app by the texel readback, the compositor frame stream and
  the overlap pixel on every cell.
- **What neither lever touches: the gesture set's pickup.** With every host promoted at once, the
  longest frame stays 167–185 ms at 96 cards and 322–336 at 192 under every variant — the budget
  spreads the copies over twelve frames and the frame does not move. That frame is the REPARENT of
  every host onto the source canvas and their first layout and paint records, not the copies (the
  S1 note's "the reparent and the first copy" was right about the total and wrong about the split).
  Recorded as owed with the trace that names it.
- New `DomRenderStats` fields: `budget`, `throttled`, `batches`, `draws`, `fallbacks`, `copyMs`;
  the stress rig takes `?copy=element|batched&budget=off|adaptive|<n>` (`STRESS_COPY`,
  `STRESS_BUDGET` on the driver) and the trace recorder `TRACE_COPY`/`TRACE_BUDGET`/`TRACE_PHASE=drag`.
  Witnesses: `packages/ground/test/compose/dom-render.test.ts` "the levers" (13 cases: the FIFO
  queue and the stills' priority, the controller's cap, growth, both shrinks and its recovery from
  the floor, the tile, the neighbours, the cost model, the refused draw, the failed copy, the
  tiling, the composition of the two levers).

### The shell, turned inside out — the plate, the well and the bays (S3, 2026-09-23)

James's direction, 2026-09-23: the selection frame's four corners sat INSIDE the card and
covered its content; the frame belongs outside, wrapping the content to its edge, and a lifted
card should fill it so nothing of it shows while the card moves. His mockup the same day fixed
the look: the v3 plate, turned inside out.

**The shell.** `packs/vf-frame` draws three nested shapes. The CONTENT is the widget's own
rounded rect, never cut. The WELL is a recess in the card's own surface (`--vf-card`, the
record's `surface`), `well` (34 px) wide around the content, its four corners NOTCHED into
rounded bays that house the close and the lock. The PLATE is a rim of §2.2 solid chrome,
`band` (10 px) wide, whose outer corners are the ear's arc centred on each control. The corner
composition is the reference's, moved from the content to the well: ear = control/2 +
clearance (26), bay = control/2 + bayClearance (22), notch = ear + bay − band (38, so 48 from
the outer corner), fillet = ear − band (16). `styleViolations` refuses a bay that would bite
the content.

**The reveal and the un-reveal.** Selection reveals the shell out of the content's edge: the
well and the rim over the first half of the reveal spring, the bays staggered after, the
buttons last. THE LIFT UN-REVEALS IT: the card scales by `ChromeSettings.liftScale` as it
always has, and the shell plays its reveal backwards into the card's edge — buttons first,
then the bays, then the well and the rim — so at the end of the lift the plate's outer edge
IS the lifted card's silhouette, and nothing of the shell shows while the card moves. A
release plays it forward; a grabbed card that was not selected simply scales. The §7 ring
rides the plate's outer edge and leaves with the shell.

- **Breaking (the pack's sheet).** The notched-content frame is retired: `REFERENCE`, `CLEAN`,
  the old `PLAIN`, `REFERENCE_CARD`, `composeStyle`, `CornerSpec`, `PRODUCT_CORNER` and
  `scaleStyle` are gone. The sheet is `shellStyle(spec)` over a `ShellSpec { band, well,
  radius, control?, clearance?, bayClearance?, fillet? }` → `FrameStyle { band, well, radius,
  control, clearance, bayClearance, fillet, btn }`, with `PRODUCT` (the mockup's numbers, its
  two controls), `PLAIN` (no bays) and `STYLES`; `cornersOf`, `outerRadiusOf`, `reachOf`.
  `VfGeometry` carries `shell` (the presence), `wellHalf` / `wellR`, `nw · nh · rho · rf` per
  corner and the buttons; the TAIL is 9 vec4s (was 10): `VF_EXT = 9`, the record 144 + 144 B.
  `choreography.ts` adds `LIFT` (the un-reveal's windows: buttons `[0, 0.35]`, bays `[0, 0.6]`,
  shell `[0, 1]`); `DELETE.notches` is `DELETE.bays`. `pick` routes lock · close · content ·
  frame (the well and the rim) · outside; `sdWell` joins `sdInner` / `sdOuter` / `sdFrame` in
  the CPU mirror. The shader's `Shade.chrome` is per pixel: the rim's colour, or the card's
  own surface inside the well.
- **`CardProgram.reach?(radius)`** (optional, new): how far the chrome reaches beyond the
  content rect at rest (the well and the rim: 44) — the frame builder's cull margin and the
  router's pick pad grow by it. `source()` is the lifted content: a dragged set casts the
  card, never the shell.
- **The DOM boundary reads the lift off the geometry.** `createDomHostWriter` writes the
  host's transform as the resolved inner box over the content rect, per axis (`liftOf`; a
  uniform `scale(s)` here), and the clip's radius likewise (`contentRadiusOf`); the pack
  defines no `inner`, so a DOM host clips with one `inset(0 round r)` and the 720-ray march
  never runs — the pickup's 153 ms clip cost (S2's finding) is gone with it.
- **groundlab.** The frame panel edits the shell (rim, well, radius, control, clearance, bay
  clearance, fillet); `PARAMS_VERSION` 5 drops the older snapshots; `rig:corner` renders the
  two shipped styles (medium + small, dark + light), `rig:reveal` and `rig:probe` read the
  new geometry. The widgetlab composited rig checks the lift as the scale, with the shell gone.
- **Fixed — the oracle's `mirror` was stale since design-014.** Its flat `frame` / `fill`
  overrides sat on the theme's HEAD, which nothing reads, so it compared a predicted white band
  against the chrome's own colour: at `fc6206f` a max error of 217/255 over 4.85% of the pixels.
  The overrides live in the `vf-frame` section now, and the mirror predicts the well's material
  too; the shell mirrors at mean 0.0001/255, max 0.50, 0 pixels over 2.

History: a first cut the same morning (`5fbf943`) read the direction as a thin 8 px ring whose
thickness was the lift's rise; James's mockup replaced it within the hour, and this entry
describes what ships.

Witnessed: groundlab `rig:corner` (product + plain, medium + small, dark + light) and `rig:reveal`
(the shell 0 → 1 over reveal 0 → 0.5, outerR 22 → 26, the bays 0 → 38 over 0.16 → 0.5, the lock
after 0.5); the oracle mirror exact; `gate:landing` green (47 oracle scenes at maxΔ 0, the pack
audit); the seven desktop rigs green (the boot rig's rim and shadow samples and its band-drag
grip moved into the column gap, which no DOM host covers under a 44 px plate); `pnpm run ci`
green in every package but two 5 s timeouts at host load 166–290 (the budget-controller test and
the dom 10k-mount), both green alone; the stress rig's grab at 96 cards on the gpu arm: longest
frame 9.3 ms (167–185 ms under every S2 variant), the pan recomputing 0 clip polygons — the
clip march no longer exists.

Owed from James's live test the same hour (the next slice): a selected card's plate is drawn
under any DOM neighbour it overlaps (the ground paints beneath the DOM; the overlapped cards
must move to the GPU while the shell shows), a dragged R3F card rides under DOM cards (the
gesture set promotes only on a grab of a dom card), and a promoted widget laid out in fixed
pixels is copied as its top-left corner at zoom < 1 (band space shrinks the host's box —
the band-space reflow owed since the first report).

### The review of the shell and the shield, and the copy budget turned on (S4r, 2026-09-23)

<!-- James: "now do a thorough code review, and also help optimize performance" -->
Three read-only reviews of `cad363a` and `6738ded` (the vf-frame shell, the ground's compose path
with the pane, the core's shield) and a profile of the composited profile at 96 cards; every
finding below was verified against the code before it was changed, and each fix carries its
witness. One was a live defect S4 shipped (the first item); the rest are risks the reviews caught
before a user did.

- **A promoted host at zoom < 1 sat at half its screen offset** (DomRender `placeHost`). Blink
  multiplies a transform's translation by the element's own `zoom`, so the `matrix()` S4 wrote on
  a zoomed host landed at zoom × the offset: at band 0.5 every promoted card's host — the hit,
  focus, caret and IME truth of a promoted card — was at half its place (the reviewer's probe in
  Electron 43 / Chrome 150: `zoom: 0.5; matrix(1.4,0,0,1.4,300,200)` lands at x 150, y 100, and
  `elementFromPoint` at the intended point returns the page). The translation is written in
  unzoomed units now. Neither S4 witness could see it: the render rig compared pixels, the boot
  rig's hit check ran at zoom 1. The render rig now promotes a card at zoom 0.45 (at 0.7 the band
  is still 1 and the host carries no zoom — the pass checks the host IS zoomed before it counts),
  reads the host's box on the page against the card's screen rect, and names a far card's host
  by `elementFromPoint` at its centre; the unit test's zoom loop gained 0.45.
- **A held folder's face and slot ride its lifted content.** The pane's picture is mapped onto
  the lifted content (×1.05 while held), but the face it was drawn around and the portal slot
  beneath came from the resting rect, so the bar and its hairline drew 5 % larger than the hole —
  a plate-coloured ring inside the hairline while a folder was carried (the hole had the same
  mismatch; a flat plate hid it). The face is scaled about the card's centre by the lift the
  program resolved and handed to both the slot and the pane; a resting card computes the same
  rect bit for bit (the oracle's scenes). The boot rig grabs the folder and reads three points just
  inside the lifted face's left edge: the plate at rest, the inside's ground while held.
- **The lift's buttons leave before the rim shrinks under them.** The buttons eased IN over
  `held` [0, 0.35] while the rim eased OUT, so for two frames per grab the close button rode the
  shrinking rim over the content (8.7 px over it at h 0.2, its centre inside it at h 0.3, and
  `pick` still answered "close" there). The window is [0, 0.12], easing out with the rim; the
  close button's disc now clears the content by 16 px at its nearest over the whole lift (pinned
  on a 0.01 grid of `held`).
- **The well's field is evaluated only where the frame paints** (`frame.wgsl`). `shade_card`
  computed `frame_well` — four notched corners, the pass's costliest field — on every fragment
  inside the content, where its result is unused (half of a medium card's plate fragments, four
  fifths of a large widget's). It is gated on the frame's coverage; the oracle mirror is exact
  (3.8 M px, mean 0.0001/255, max 0.50, 0 over 2).
- **`styleViolations` judges the bay against the worst content radius.** The bite check used the
  style's resting radius; a card may carry any radius and radius 0 sits nearest the bay, so a well
  of 26 passed at the style's 22 and bit a radius-8 card by 4.5 px. Judged at 0 now; PRODUCT
  clears it by 3.5 px.
- **The delete morph's dot wears the chrome again.** The well collapsed to the same disc as the
  plate, so the dying card's last dot was the card's own surface — five levels over the dark
  ground — where the reference's dot is the frame colour. The well closes to nothing under the
  collapsing plate.

- **The shield counts members of the current nav frame only** (`ice:surface.domAtRest`). Its
  need walked every `Selected` and every dom card with no membership filter, so a selection that
  rode a nav transition (Selected, Culled without Active — the 2026-07-17 field bug the selection
  chrome and the L3 claim already filter for) grew a plate over the folder's own cards, whose
  frame-local rects happen to overlap it, and lifted them live for the whole visit. Both sides of
  the need now skip the codebase's non-member signature; `Active` and `Culled` join the reads.
- **The need is computed once per change, not once per frame.** `changed` fires every frame
  (`FrameInfo` is a polled read) and the need was paid at its top — through every frame of a held
  drag, where the gesture branch never reads it, and every resting frame with a selection. It is
  lazy now (read at the settle's hand-off and in the shield phase only) and cached on the
  behaviour's change journal: a Position/Size/MeasuredSize write, a Selected/Culled/Active flip,
  a death, a full rebuild, instance churn or a different reach recomputes it. A test-only counter
  pins it: 0 computes over 20 resting frames, 0 over 20 drag frames, 1 at the release's hand-off.
- **The selection union box pads a resting member by `selectionReach`.** `systems/chrome.ts`
  padded a Grab-bed member by `liftScale` and nothing at rest, so with the shell the box and its
  eight grips sat on the content edge, 44 world units inside the plate's rim, in the well — the
  ne/nw grips over the close and the lock (grip span 39–49 vs the button's 10–42 on that axis).
  A member at rest pads by the reach on every side, a Grab-bed one by the lift scale as before.
- The owned→shield hand-off has its test (a still the carried selection's plate now covers stays
  on the GPU at the settle, live again); `rectOf` takes a measured size per axis, the rule the
  chrome and the retier apply; a grabbed card the shield already holds is documented as never a
  still. Each fix was shown to fail with its lines removed and pass restored.

- **Profiled, then tuned** (the copy count is the lever; the engine's JavaScript is not).
  A CDP profile of the composited profile at 96 cards on this host: the engine's own main-thread
  JS is 0.8–1.3 ms/frame at idle, 2–3 on a pan or a carry, 5.8 with every card animating — of
  which 1.3 is the copy call itself and ≈3.4 the flow-control wait behind it; React ≤ 0.4 %
  everywhere. Each element copy costs 0.63–0.79 ms of GPU-process CPU at 1.3–2.4k copies/s
  whatever the load, and the renderer's own cost to issue one is 0.028 ms; the GPU process's
  one main thread saturates at 2.3–2.6k copies/s today. So:
  - **The adaptive copy budget is ON by default** (`groundCompose({ dom: { budget: false } })`
    turns it off). S2 built and measured it off; measured again today on the stress rig (gpu arm,
    96 cards, every card animating, budget on vs off): compositor 120.1 fps / p95 9.9 ms / GPU
    process 84 % against 45.3 / 44.8 / 169 %; paint 120.1 / 10.0 / 74 % against 28.7 / 62.6 /
    111 %; compositor + pan 120.1 / 9.3 / 68 % against 40.8 / 45.9 / 171 %; the zoom crossing
    117 / 9.3 / 44 % against 89 / 30.3 / 116 %; ≈280 MB less GPU-process memory across it; the
    pickup unchanged (8.9 vs 9.7 ms). The cost is card cadence — ≈7 refreshes a second per card
    with 96 animating — where the alternative was the whole app at 23–58 fps. The batched route
    stays off.
  - **The paint-order sort reads each card's tier once.** The comparator asked the world for
    `Grab` and `Selected` on every comparison — ≈2.5k component reads per build at 96 cards; the
    cards are bucketed into four tiers by one read each and only the stack order is compared.
  - **The vf-frame tail is one reused array** (four spreads into a fresh 36-number array per
    card per frame was the frame pass's largest allocator on a pan: 23 MB over 3 s at 96 cards),
    and the run split reads the instance list in place instead of copying it.
  Measured and left for a slice of their own, with the numbers in the draft plan: the idle tick
  still walks every card each frame (strata's tick, the reflector's promote scan, residency's
  `written` sweep and DomRender's placement pass ≈ 0.5–1.25 ms/frame at 96 cards at idle-zero —
  first verify at true idle whether the host loop parks on the FrameControl gate); the frame
  pass's per-card geometry objects (≈550–840 KB/frame on a pan or carry at 96 cards, GC 2–7 % of
  busy); whole-component reads (`readPresent`, 2–9 % of busy in every phase) where a field read
  would do.

Witnessed: `pnpm run ci` green in every package (ground 354, core 864, dom 152; no timeouts at
host load 9–23); `gate:landing` green (47 oracle scenes at maxΔ 0, the pack audit); the seven
desktop rigs green — the render rig at zoom 0.45 finds the promoted host zoomed (0.5) with its
page box on the card's screen rect (off by 0.00 px) and a far card's host named by
`elementFromPoint` at its centre; the boot rig reads three points just inside the lifted face as
the plate at rest (28,28,30) and the inside's ground held (23,23,23), the folder's title contrast
227 held vs 227 at rest, exactly 3 clocks shielded; the oracle mirror exact; the stress rig's
pickup at 96 cards on the gpu arm under the new default: longest frame 9.6 ms, the carry 120.2 fps,
and every animated phase at 120 fps (compositor 120.1 / p95 10.1 ms / budget 7, paint 120.1 /
10.0, compositor + pan 120.1 / 10.0, the zoom crossing 119.6 with one 27 ms frame at the band
change) where the gate before it read 45.3, 28.7, 40.8 and 89.2; GPU-process memory 446 MB at the
camera phase against 480.

### What the DOM covers, the GPU takes — the shield, any grab, and band space by `zoom` (S4, 2026-09-23)

James's live test of the shell, the same hour, named three defects around it. All three are one
fact about the composited profile: the ground paints beneath every card the DOM still paints
above the canvas at rest, so anything the ground draws — a selected card's plate, a carried
island — rides under those hosts unless they move to the GPU while it shows.

- **The shield (`ice:surface.domAtRest`).** A selected card's chrome reaches
  `ChromeSettings.selectionReach` past its rect (new, f32, default 0; `createCanvasEngine({
  settings: { chrome: { selectionReach } } })` — widgetlab passes the frame pack's `reachOf(PRODUCT)`,
  44). The dom cards that reach overlaps go to the GPU while the selection shows — LIVE at their
  own cadence, never stills — and come back one settle window after the overlap ends, so clicking
  around a board does not flap them. The selected card itself stays on the DOM, inside its own
  shell. A gesture's demotion hands a card the shield still wants straight over rather than
  dropping it to the DOM for a frame. The behaviour reads `Selected`, `Position`, `Size`,
  `MeasuredSize` and `ChromeSettings` for it.
- **Any grab lifts the board.** The gesture set used to promote only on a grab of one of the
  behaviour's own dom cards, so a carried island (an R3F card, a video) rode under every DOM card
  it crossed. Every `Grab` carrier is the trigger now; the SET is still the behaviour's dom cards.
- **The frame pass paints selected cards after unselected ones**, held cards last (S1's rule): a
  later sibling no longer paints over a selected card's rim.
- **Band space rides CSS `zoom`, not a smaller box.** DomRender laid a promoted host out in band
  space by shrinking its CSS box, and a widget laid out in fixed pixels did not reflow: at zoom < 1
  the copy was the widget's top-left corner, enlarged (James's live test; the band-space reflow
  owed since the first report). The host keeps the widget's own box and `zoom` scales it — content
  and all — to `geometry().cssSize`, the layout box the extent-less copy writes; the placement
  matrix is unchanged; the zoom is cleared when custody returns to the reflector. The render rig
  gains the witness: at zoom 0.7 (band 0.5) a fixed-pixel block on a promoted card sits where the
  live card's does, at its size (edges off by 0 px, area 1.000×).
- **The PANE — a promoted container keeps its bar (`CARD_ABI` 2).** A container the GPU holds
  (a gesture's still, a shield) was drawn as a hole in a plain plate, and its bar's title — the
  DOM host's — vanished for the drag (James's live test). A fifth content mode, `pane`, draws
  the container's own picture (its bar, its hairline) around its face over the plate, and
  nothing inside the face, where the inside drawn beneath shows as through the hole. The face
  rides two new head slots (`face` centre + half extents, `faceR` in the padding after `layer`):
  the head is 160 B (was 144), `CARD_ABI` moves to 2, `frameValues` packs them, `paneContent(page,
  face)` builds one, and the frame builder draws a live-portal container as a pane whenever
  residency has its page. The boot rig holds a card and checks the folder's title contrast is
  the same held as at rest, with the folder on the GPU and its picture written.
- **Rigs.** The boot rig's selection now waits for the shield's pictures and checks that exactly
  the three dom cards the plate overlaps lift (30 px gaps, a 44 px reach) and no other; the
  render rig's `zoomTo` and the band-space pass above.

Witnessed: `pnpm run ci` green in every package (ground 349, core 860, dom 152 — the two 5 s
timeouts S3b hit under load did not recur; host load 199–232 over the chain's last phase);
`gate:landing` green (47 oracle scenes at maxΔ 0, the pack audit); the seven desktop rigs green —
the boot rig lifts exactly the three clocks a selection's plate overlaps and reads their ticks as
the only work after the reveal (3 copies for 3 content marks over 181 frames, 1 submit, self-dirt
0), holds the folder and reads its bar title's contrast 227 held against 227 at rest with the
folder on the GPU and its picture written, and finds it back on the DOM after the settle; the
render rig's band-space pass at zoom 0.7 puts the promoted block on the live one's (edges off by
0 px, area 1.000×); the stress rig's grab at 96 cards on the gpu arm: pickup longest frame
9.7 ms, the carry at 120.6 fps (p95 9.2 ms, max 10.5), the pan recomputing 0 clip polygons.

Owed: DESIGN.md §5 and §7 still describe the notched frame as the selection chrome (the shell
and the shield replace it; the doc is James's); core's selection union box pads by `liftScale`,
an approximation of the shell's reach.

### The copy's cost, named (2026-09-09)

<!-- the HiC pipeline investigation; no package code changed -->
- **Why the always-GPU arm loses to live DOM, measured three ways** (Chromium 150's source,
  a Chrome trace of the composited app, a no-engine micro-benchmark): every
  `copyElementImageToTexture` is a FIXED cost per CALL on the GPU process's main thread —
  about 0.58 ms plus about 0.05 ms per card of content, unchanged across a 44× range of
  texels, the destination and the card count. Per call that thread creates and destroys one
  IOSurface-backed shared image, rasterises the cached paint record through OOP raster as a
  Skia Graphite recording with its own Metal submit (56 % of the copy; four render passes for
  the rig's card, whose translucent groups each open one), wraps the surface for Dawn and
  blits it with `CopyTextureForBrowser` (16 %), across 8 GPU-channel requests and 4
  command-buffer flushes (16 %); the shared image's create and destroy are the other 12 %.
  It saturates at ≈3,000–3,800 calls/s raw (≈2,800 through the engine, whose own
  bookkeeping is 0.03–0.05 ms of main thread per copy), and past saturation the renderer's
  main thread blocks in command-buffer flow control (`GpuChannel::WaitForGetOffsetInRange`,
  43 % of every frame at 192 cards) — the time a CPU profile reports "inside" the copy call.
  Live DOM never enters this pipeline: a compositor-driven animation repaints nothing and a
  paint-driven one rasterises only invalidated tiles, batched on the raster workers, into
  surfaces that persist.
- **The lever is the number of calls.** One call per wrapper element (an immediate child of
  the source canvas holding many cards) carries 23,000 cards/s at a display-capped 120 fps
  against 2,900 one call per card — eight times — with the cost curve fitted from a sweep
  of cards per call. Not adopted: a card's host is laid out at its on-screen position because
  it IS the card's hit-test, focus and caret truth, and a wrapper copies its children where
  they are laid out; the trade is recorded in the draft plan ("HiC pipeline — 2026-09-09")
  and the stress report, undecided.
- Two probes ship in `apps/widgetlab-desktop`: `hic:trace` (`scripts/hic-trace.mjs`: a
  Chrome trace of the stress rig's gpu arm through `contentTracing`) and `hic:micro`
  (`hic-micro.html` + `scripts/hic-micro.mjs`: the no-engine copy with knobs for size,
  content, destination, cards per call, the viewport-sized copy and the 2D
  `drawElementImage` route). Their results directories are gitignored.

## [0.12.0] — 2026-08-31 · a git release point, NOT published to npm

**Install 0.13.0 for everything below.** The cut was real (`903f892`, CI green,
pack dry-run 259 files) and the entry stays rather than being folded upward, but
design-013's Phase A landed before a publish went out and the registry goes
0.11.0 → 0.13.0 in one step. The `WidgetSurface` → `WidgetSurfaceKind` break
below is part of that upgrade.

### Breaking, narrowly

- **`WidgetSurface` is now `WidgetSurfaceKind`.** The `"dom" | "gl"` union that
  types `defineWidget({ surface })` is renamed, because design-012 §11 Q7
  ratifies `WidgetSurface` as the name of the PRESENTATION CONTRACT — the
  per-widget view of kind, current presentation and demand — and the two
  meanings cannot share one name. Migration is ONE identifier: import
  `WidgetSurfaceKind` wherever you imported `WidgetSurface`. A consumer that
  passes `surface: "dom"` to `defineWidget` without ever naming the type is
  unaffected. The union is now DERIVED from the compositor's own kind list
  (`Extract<SurfaceKind, "dom" | "gl">`), so adding a surface kind cannot let
  the two lists silently disagree.

### Added

- **`defineWidget({ presentation })`** — a widget type may declare the mode it
  starts in, or PIN one that policy may not change (design-012 §6.3):
  `{ default?: SurfacePresentation; pin?: SurfacePresentation }`. Refused at
  DEFINITION time when it cannot hold: `live-dom` on a `gl` surface (an island
  has no native paint to fall back to), or a `default` beside a `pin` — the
  latter even when the two AGREE, since a pin has already taken policy out of
  the decision and a `default` beside it reads at the call site as an intent
  that will be honoured. Absent is the ratified default and is right for almost
  every widget; the stratified profile has no promotion and ignores it.
- **`CompositorSourceVideo.onArrival`** — an optional
  `(cb: () => void) => () => void` subscription carried by a registered live
  surface. A producing surface now wakes the compositor BY ITSELF instead of
  compositing only while something else happens to be dirty; the compositor
  holds the subscription and drops it when the source is replaced or removed.
  Optional, and a source that omits it composites exactly as it did before.
- **`@vibecook/ice/r3f/webgpu`** — the WebGPU renderer leg (shared-device
  `WebGPURenderer` adoption) now reaches the published package, mirroring the
  workspace's `@ice/r3f/webgpu`. Deliberately its OWN subpath: importing it
  pulls `three/webgpu`, which must never ride along with plain `./r3f`. Note
  the declared `three >=0.160` peer range is the plain-r3f floor; the device
  injection this subpath performs is verified against three r185 — treat
  ~0.185 as its effective floor.

### Fixed

Fifteen defects from a full-range review (2026-08-31), every fix carrying a
regression test proven red against the pre-fix code. Document integrity: a
legacy schema-2 document now reaches its 2→3 migration instead of gating
read-only on a dependency closure only that migration can satisfy; an envelope
whose optional `rootCanvas` mirror is ABSENT opens healthy (only a PRESENT,
conflicting mirror disagrees); a runtime extension re-arms after a
breaker-rolled-back fault, so its outputs recover on the next dispatch; a
widget spawned into the open frame is selectable before the first `step()`.
Presentation: settle-window demotion returns a card to its DECLARED
`presentation.default` (one grab no longer strips `picture`); despawn clears
the presentation entry, so a recycled entity id no longer inherits
`composited`; a profile refusal in `<InfiniteCanvas>` unwinds cleanly and a
remount reports the real reason instead of "plane already owned"; an adapter
that unregisters while a transition is PREPARING gets its retainer released.
Compositor: one paint on a paused/bucket-0 card no longer spins the compositor
(idle-zero holds for parked demand); a slot the atlas cannot seat is clamped
uniformly and its refusal answered — never a copy across the gutters;
`groundHost` now composites at full parity with `ground()` via one shared
wiring; `ground({ lift })` actually advances the lift and keeps compositing
until the ease settles; the offscreen ground target is disposed with its
layer; the quad pass sweeps bind groups for textures nothing draws;
`freeRect` refuses a double free. Islands: a PINNED render target that
outgrows its size is retired, not destroyed — a nav-crossfade clone keeps its
pixels through the hold.

- **Known issue (composited profile only, confirmed post-cut by a real-GPU
  rig):** a dom card whose live zoom drifts above its atlas band (band
  hysteresis tolerates up to 2×) rasterises larger than its slot, and the
  extent-less copy writes past it — silently into the gutters and the
  neighbouring slot while the raster still fits the page, and as a refused
  (blank) copy when it does not. Reachable by zooming in while a card is
  composited (grabbed, pinned, or resting composited) and then dirtying its
  content. The fix is a pending band-policy ruling; the measurement and the
  options live in `docs/implementation-plan.md` M18. The stratified profile
  is unaffected.
- The entries above are the consumer-visible surface of the design-012
  UNIFIED COMPOSITOR. `docs/implementation-plan.md` M18 carries the whole of
  it — the ladder, the profile model, the measured exits and the standing gaps
  — and `docs/downstream-petitions.md` records what it does and does not ask of
  a consumer. The compositor reaches an app only through the composited
  presentation profile, which a build selects deliberately; a stratified build
  is byte-for-byte the engine it already was.

## [0.11.0] — 2026-08-25

### Changed

- **Grid implementation selection is now build-time.** Classic and magnet
  are independent `GridPassFactory` implementations over the same
  `GridConfig`/`GridPassDeps` contract. The tiny `passes/grid.ts` wiring
  module imports exactly one factory; production currently wires magnet, so
  the classic renderer, material and declarations are unreachable from the
  package entry graph and absent from the runtime bundle. Wiring classic back
  is a single re-export change—there is no runtime renderer switch, retained
  inactive material, or first-toggle compilation path.
- **Magnet is the production grid.** `GridMagnetConfig.enabled` is removed;
  dot/needle remains a live glyph uniform within the one magnet renderer.
  WidgetLab now starts on magnet needle and keeps `?magnet=dot` only as a
  dot-glyph verification preset.

### Fixed

- **Magnet grid: dot glyph is visible on both backends.** The manual
  screen-to-NDC Y flip reversed the dot quad's winding, while the needle's
  reflected orientation basis happened to cancel that flip. Three's default
  `FrontSide` culling therefore rejected every dot before fragment shading.
  The symmetric dot now reflects its local Y to keep both glyph branches
  front-facing (design-010 §10.9).
- **Magnet grid: rest lattice survives zero-source frames.** The TSL builder
  emits site reconstruction at first USE — inside the source loop — so a
  frame with no packed sources (`fadeZoom` valve active, no poles, widgets
  off) garbage-positioned every glyph. `col`/`row`/`screen` are now pinned
  with `.toVar()` before the loop (design-010 §10.9).

## [0.10.0] — 2026-08-25

**The magnet grid — design-010 / M17.** The dot grid's PIXELS become a
field-reactive lattice; its interfaces do not change. Ported from the
vibe-field `draft/magnet-grid` WebGPU experiment (WGSL → TSL) with the
upgrades the experiment lacked: an rbush broad-phase over the ONE spatial
index, N injected poles, and config valves. The classic analytic grid remains
the default renderer — a consumer that never mentions `magnet` is
byte-identical to 0.9.0.

### Added

- **`GridConfig.magnet?: Partial<GridMagnetConfig>`** (+
  `DEFAULT_GRID_MAGNET_CONFIG`): the magnet mode — needle or dot glyphs over
  a superposed field of widget-silhouette SDF sources (rounded rects; a large
  card is a large magnet, needles wrap the silhouette) and injected point
  poles. `configureGrid`/the react `grid` prop deep-merge the `magnet` key one
  level, so partial re-tunes never clobber the block. ABSENCE of the block is
  the off state — the default config deliberately does not carry an explicit
  `enabled: false` (it would ride every consumer that spreads
  `DEFAULT_GRID_CONFIG` into its own grid state and clobber a factory-level
  enable at the configureGrid seam). Perf valves: `maxSources` (≤256,
  largest-screen-area-first; poles never evicted) and `fadeZoom` (the FIELD
  lerps out below a zoom threshold; rest ticks remain — scale 0 also skips
  the spatial query). One read-only storage buffer, `setPBO` on the WebGL2
  fallback — the same node graph compiles on both backends.
- **`GroundOptions.poles` + the `PoleSource` protocol** (`Pole = {x, y,
  strength, space?: "world"|"screen"}`): point sources are INJECTED — the
  grid pass knows no cursor/presence vocabulary, and the cursor effect is
  opt-in by construction. Poles pack as degenerate SDF boxes (half = 0,
  r = 0 reduces exactly to the point-charge formula). Canned wirings:
  `localPointerPoles()` and `cursorVisualPoles()`; apps with their own cursor
  entities write a ~15-line adapter (widgetlab's `?magnet` halo adapter is
  the reference).
- **`GroundContext.readSpatial`**: broad-phase rect reader over the shared
  spatial index (the `readWirePreview` precedent) — the magnet's widget
  sources query viewport ∪ influence-halo instead of walking the document,
  so total document size is irrelevant by construction. The react facade
  wires `stack.index.search` automatically; `SpatialVersion` observation
  wakes re-collects.

### Notes

- Measured (headless, both backends): settled-idle ground redraws are 0 with
  magnet on at +0/+50/+128 widgets; a pointer sweep costs one redraw per
  moved frame. An on-device GPU A-B is still owed before the mode is
  ADVERTISED as default-on anywhere (design-010 §6.4).
- Pole sources that ease (cursor springs) must gate their writing systems
  (`runIf` + `makeVersionGuard`): strata blanket-stamps declared writes on
  every RUN, and an ungated easing system wakes the field's observer every
  tick (design-010 §10.7 — found by this release's redraw instrumentation).

## [0.9.0] — 2026-08-17

**The ephemeral facet byte claim — petition I19.** VibeField's document-room
presence lane fragments ICE presence frames over honestly-lossy 1,150-byte
datagrams, and its probes (PRC4-E22) showed the admission gap: a legal
ephemeral behavior's string/json cells have no byte bound, sixteen at the
per-plugin cap emit a 66 KB presence frame against a 64 KB logical-message
ceiling, and an oversize frame can neither be attributed to its producer nor
dropped without going stale for every OTHER facet riding it. The behavior
declaration — the place that already routes store, write vocabulary, cadence,
and breaker — now carries the producer's own resource claim.

### Added

- **`maxFacetBytes` on `defineBehavior`** (ephemeral only; optional): a hard
  ceiling on the canonical UTF-8 JSON bytes of the behavior's COMPLETE facet
  cell after defaults/merge/serialization — the value placed in the local peer
  blob, deliberately not a wire-frame guess (the host budgets encoding and
  transport headroom on top of the claims it admits, and keeps its independent
  transport cap). Enforced in PRODUCTION at both mint paths: an over-budget
  DEFAULT fails the definition itself — unconditionally, outside the dev-guard
  gate, leaving no residue — and an over-budget `ctx.write` throws BEFORE
  mutating presence, leaving the prior facet intact. In-hook, the throw feeds
  the existing fault ladder (per-entity `onFault` attribution, BF-D18 three
  strikes, I17 withdrawal on quarantine); through the blessed captured-closure
  path the caller gets the same refusal synchronously — the bound cannot be
  bypassed. Identity-bearing: part of the definition signature (a redefinition
  changing only the claim is a DIFFERENT shape) and of `describeBehavior()`
  (absent = no bound attested, so hosts can refuse unattested declarations).
  14 acceptance tests (`behavior-facet-budget.test.ts`), each enforcement
  point mutation-probed.

### Fixed

- **Ephemeral store-routing holes** (the I19 round's audit): the imperative
  `engine.behaviors.attach`/`detach` surface and the durable tx wrapper's
  `tx.attach`/`tx.detach` accepted ephemeral behaviors and wrote their facet
  component through the WORLD — never published, never withdrawn, and
  indistinguishable from a projected remote facet to `ctx.peers()` (a local
  spoof, and a bypass of the claim's two real mint paths). All four now refuse
  with the store-routing rationale; the facet component's only writers are
  `ensureFacet` and `ctx.write`, both presence-routed and both measured.

## [0.8.1] — 2026-08-16

### Changed

- **strata-ecs 0.12.0 → 0.13.0** (published earlier today: petition 11 + the
  d.ts repairs ice 0.8.0's own review surfaced). All six declaring manifests
  move in lockstep — including `apps/*`, the second-copy trap — with the
  single-copy invariants verified (exactly one `strata-ecs@0.13.0` and one
  `loro-crdt@1.13.8` in the lockfile) and the full trace suite green at the
  bump. The `withdrawFacet` cast against the `@internal`-stripped getter is
  RETIRED: deferred facet withdrawal now reads
  `world.inImmediateProjectionUnsafeContext` typed, exactly as petition 11's
  migration note prescribed; the try/catch and the deferral stay (they guard
  the mid-observer-emit boundary — deliberately outside the predicate — and
  teardown-never-throws, not the type). Consumers also pick up strata's
  repaired d.ts (the dangling `LoroDoc`/`ObserverEntityRecord` references)
  transitively.

## [0.8.0] — 2026-08-16

**Facade presence for hosts that own their document lifecycle — petition I18.**
VibeField opens and creates ICE documents from its own checkpoints and journals,
so `docs.join()` — which would introduce a second bootstrap authority — never
runs. But presence entered ONLY through `join({presence})`: the separately
exported `attachPresence(world, …)` creates a real session the facade seam never
sees, so `docs.presence()` stays undefined and every registered ephemeral
behavior stays dormant (PRC4-E13 pinned all seven controls). Document bytes and
live presence are two independent coeffects; this release gives the second one
its own facade door.

### Added

- **`docs.attachPresence(opts): () => void`** — attach facade presence to an
  ALREADY-live document. Requires `docs.current()` (refuses doc-less; refuses a
  duplicate live attachment), creates the session with the existing public
  `attachPresence(world, opts)`, installs the presence publish + remote-cursor
  systems, and exposes the session through `docs.presence()` — the same seam the
  behavior runtime forwards, so a registered ephemeral behavior leaves dormancy
  on the next publish step (one facet, `init` once; pinned). Transport stays the
  caller's: wire `presence().wire.apply(bytes)` inbound and
  `presence().onOutbound(send)` outbound — the standing `PresenceSession`
  contract. Returns an idempotent, IDENTITY-BOUND inverse: it detaches THIS
  attachment — leave tombstones flush through still-subscribed outbound before
  the wiring dies (best-effort per subscriber: one that THROWS forfeits its own
  delivery and those peers fall back to TTL expiry — `PresenceOpts.onFault`
  observes it) — and cannot touch a replacement; `docs.close()` and engine
  disposal run the same teardown automatically. Reattach mints a fresh peer and
  behavior DEFAULTS (a stale value does not survive the detach; pinned).
  `join({presence})` now rides the same internal acquisition and keeps its
  combined document/presence framing.

### Fixed

- **Detaching presence on a still-open document no longer strands ghost remote
  cursors.** `installPresence`'s uninstall removed the remote-cursor derive
  system but not its pooled `CursorVisual` entities — the reaper that would have
  collected them is the system the uninstall just removed. The join path never
  saw the strand because `docs.close()` follows presence teardown with an
  in-place world reset; I18's inverse detaches while the document keeps running,
  which is exactly where a ghost cursor would freeze on canvas. Uninstall now
  reaps the pool (between frames, like every teardown here).
- **Presence systems no longer trip strata's access advisories on a facade
  engine.** The remote-cursor system registers into `present`, not `derive`:
  installed late into `derive` it co-wrote `Position` after the interaction
  stack's readers and co-writers (`cull`, `selectionChrome`), and both advisory
  classes fired on every presence-attached facade engine in dev — row-disjoint
  in truth (cursor entities are the system's own pool), but the
  read-before-write advisory has no attestation opt-out. `present` is also the
  honest phase: cursor visuals are presentation derivation with no in-tick
  consumers — reflectors read them post-notify, same frame either way.
  (design-003 §7's `derive` language covers the LOCAL L4 cursor; remote cursors
  were never phase-pinned.)

### The pre-publish adversarial review (2026-08-16)

Same protocol as 0.7.0 — independent reviewers over the diff, every finding
execution-confirmed against main before fixing, every fix mutation-probed. Four
lifecycle findings and one artifact-wide one, all fixed in this release:

- **A throwing `onOutbound` subscriber during the leave flush aborted every
  teardown path** — inverse, `docs.close()`, engine dispose — leaving a live
  engine behind a "completed" dispose and permanently stranding the presence
  binding (its `detached` flag latched before the throw; the keepalive/throttle
  timers and the wasm store leaked unreclaimably). The canonical subscriber is
  `ws.send`, which throws on a CLOSING socket — exactly the teardown moment;
  the join sugar never saw it because its only subscriber is joinDoc's own
  guarded send. Fixed at three layers, each pinned: per-subscriber fault
  isolation in the fan-out (one bad transport no longer starves later
  subscribers or the binding's timer callbacks), leave contained inside
  `detach()` and the reset-heal microtask, and `releasePresence` clearing its
  fields first then containing both halves — teardown never throws.
- **A same-gap detach→reattach delivered the new peer's `init` before the old
  peer's `dispose`, and the corpse's `ctx.write` landed on the fresh peer** —
  resolving `localPeer` live, the departed instance's farewell value was
  broadcast to every remote as current and never recomputed. Two complementary
  fixes: `writeFacet` refuses when the running hook's instance is not the
  current peer (`hookEntity`, set around every hook call), and `ensureFacet`
  defers the new mint one publish while a prior peer's instance awaits
  departure — dispose-before-init across a swap without touching the
  documented per-deliver hook order; one publish of activation latency in
  exactly that case.
- **A rejected `docs.join` stranded the presence session it acquired** on a
  doc-less engine: live seam, active ephemeral behaviors publishing into a room
  joinDoc had already unsubscribed, and no inverse the caller ever received.
  The join path releases presence on rejection when it still owns the flow;
  supersede semantics unchanged.
- **The inverse could burn itself on a failed teardown** — folded into the
  first fix: `releasePresence` never throws and clears state first, so the
  idempotency latch can no longer strand a live session behind a spent inverse.
- **The published artifact's types were broken on six of seven entry points —
  in every release since 0.2.0.** `tsc` preserves path-mapped specifiers in
  declaration emit, so the shipped d.ts imported unpublished `@ice/*`
  packages: TS2307 for `skipLibCheck: false` consumers, and silent `any`
  across those seams for the `skipLibCheck: true` default — vibe-field
  included. The build now rewrites all specifiers to relative paths as its
  last step and FAILS if any quoted `@ice/*` specifier survives
  (`packages/ice/scripts/fix-dts-specifiers.mjs`); all seven entries verified
  to typecheck standalone under `skipLibCheck: false`. The same sweep found —
  and fixed upstream, in strata 0.13.0 — dangling `LoroDoc`/
  `ObserverEntityRecord` references in strata's own shipped d.ts.

The consolidated second round added three refinements: `remoteCursors` now
attests `orderIndependent: [Position]` (its writes are its own pool's rows —
and suppression of strata's double-writer advisory is conjunctive over ALL
co-writers, so an un-attested engine system would make the warning
unsilenceable for a `present`-phase userland behavior that attests correctly);
presence faults became host-routable via `PresenceOpts.onFault`
(`"outbound" | "leave" | "heal"` — every fault stays contained; this is
observability, never control flow; default remains `console.error`), which
`docs.attachPresence` hosts get with no extra plumbing since they already pass
`PresenceOpts`; and the tombstone-flush wording above was qualified to
best-effort-per-subscriber everywhere it appears. One documented-scope
correction: the "zero access advisories" claim holds for the presence+facade
suites this release touched — the behavior suites' deliberate derive-phase
`Position` co-writers still trip the same two advisory shapes, and durable
behaviors are derive-only so they cannot take the phase-move escape; that
generic ordering/attestation question is recorded as an open post-0.8.0 item
in the implementation plan, not papered over.

### Upstream

- **strata petition 11 filed + landed same day** (strata 0.13.0, unpublished at
  this cut): `world.inImmediateProjectionUnsafeContext` is public API. ICE's
  `withdrawFacet` keeps its typed cast until the pin bump retires it — the cast
  compiles and behaves identically against 0.12.0 and 0.13.0
  (`docs/petitions/petition-11-projection-unsafe-context.md`).
- **strata 0.13.0 also carries the d.ts fixes this review surfaced** (dangling
  `LoroDoc` in the durable/ephemeral entries, `ObserverEntityRecord` dropped
  from tools by a prose `@internal` in a banner comment) plus its own
  build-step resolution guard.

## [0.7.0] — 2026-08-16

**The behavior host contract — petitions I16 + I17.** ICE 0.6.0 shipped
`defineBehavior` and its first real embedder (VibeField's plugin runtime,
PRC-4) immediately proved the framework runs but cannot be GOVERNED by a host
that activates plugin code once per window while creating one engine per
document — and that an ephemeral facet outlives its producer. The gaps were
routing, composition, and one store-lifetime seam, not a new scheduler; every
one was pinned red against the installed 0.6.0 artifact before this release
made it green.

### Added

- **`engine.behaviors.register(B, {orderKey?, ledger?})`** — host policy at the
  one place a host touches a behavior. The keyed lane runs in lexical order
  BEFORE every unkeyed registration (ties and unkeyed keep registration order),
  and both compiled pipeline systems and publish-slot hooks obey the same
  order, so execution no longer depends on parallel plugin activation timing or
  disable/re-enable history. Reordering reinstalls EXECUTION only: node state —
  collectors, instances, guests, data — stays put, and `init` does not re-run
  on unaffected behaviors. `ledger` seeds the driven guest's breaker state, so
  a suspension survives the engine generation that recorded it; changes keep
  streaming out the existing `guests.onLedgerChange` (no second mechanism). An
  empty `orderKey` throws rather than silently sorting first.
- **`createCanvasEngine({ onGuestFault?, onGuestNotice?, onBehaviorFault?,
  onBehaviorLog? })`** — the facade finally forwards the routes that already
  existed underneath it (`EngineOpts` for the guest pair, the behavior
  runtime's own `onFault`/`onLog` for the behavior pair, hook + entity
  provenance preserved). Before this, behavior faults defaulted to
  `console.error` through the only construction path hosts use — and a
  quarantined instance in a derived behavior means part of the document
  silently stops updating, which reads to a user as a broken document.
- **`describeBehavior(B)`** — the canonical, JSON-safe, process-independent
  projection of a behavior declaration: id, store, derived flags, version,
  phase, budget, tick visibility, schema field order with serial prop specs,
  classified reads, write component names, migration sources, and hook presence
  in lifecycle order. No validators, no function identity, no generated
  component ids. Downstream build tools and runtimes compare manifest truth
  against THIS instead of reimplementing ICE's definition identity.
- **Thenable hook returns are faults.** Every `init`/`update`/`changed`/`tick`/
  `dispose` return value is checked at the call boundary: a thenable gets a
  catch observer (a later rejection cannot become unhandled), an attributed
  behavior fault, and — unlike an ordinary single-instance throw, which stays
  quarantined to its instance — a direct guest strike, because an async hook is
  a definition bug every instance will repeat. `dispose` thenables are detected
  and attributed but still swallowed: teardown must not stop teardown. The
  Promise body itself cannot be cancelled; the guarantee is honest detection,
  attribution, quarantine, and suspension — never preemption.

- **Ephemeral facets withdraw when their producer stops (petition I17).** An
  ephemeral behavior's facet is LIVE PUBLICATION — the local peer telling every
  remote peer "this value is current" — so it is now reversed on every edge
  where execution stops: unregister/disposal, guest suspension, and singleton
  quarantine (the edge a host could never cover itself: a singleton's throws
  cannot span instances, so quarantine emits no guest-ledger transition to
  watch). The removal rides the PRESENCE writer, never `world.removeComponent`,
  so remote projections get tombstone truth instead of a TTL wait. Resume
  remints defaults for a value-suspended behavior; a QUARANTINED one stays
  withdrawn until a fresh registration — the quarantine memo lives on the node
  precisely because withdrawal makes the instance depart, and an
  instance-keyed memo would re-mint into an infinite quarantine/remint
  oscillation that never strikes the guest. Presence-less and mid-reset edges
  are quiet no-ops.

### Fixed

- `GuestSpec.phase`'s comment no longer predicts a widening that M13 declined —
  pipeline cadence is reached through `guests.addDriven`, and the publish-only
  value is the settled shape, not a placeholder.

### The pre-publish adversarial review (2026-08-16)

An independent review pass ran against the release candidate before publish;
six findings, all fixed in this release, three of them in the candidate's own
new code:

- **Unregistering from inside a hook is exception-safe again.** Facet
  withdrawal is a STRUCTURAL ephemeral op, illegal mid-tick — the naive call
  threw out of the remover mid-teardown and stranded the node: orphan
  published facet, leaked guest, name permanently unregistrable. Withdrawal
  now DEFERS to the publish slot (the step where eph structural ops are the
  designed legality) whenever the world is mid-tick or mid-walk, and never
  throws (failures route to `onBehaviorFault` as `"withdraw"`). Deferred
  withdrawals flush BEFORE the publish passes, so an
  unregister-then-re-register lands old-facet-out before new-facet-in.
- **Publish behaviors ride ONE stable engine hook the runtime owns.**
  Per-node `onPublish` hooks meant reorder churn invalidated the engine's
  frame snapshot mid-pass — `register()` called from inside a publish hook
  silently cost every not-yet-run publish behavior its whole slot that frame.
  Reorder now touches only the runtime's own ordered list; the engine hook
  never moves.
- **Appending never reorders.** `reorderExecution` reinstalls only the SUFFIX
  that must run after an out-of-order keyed insert; every unkeyed
  registration and every ascending-key registration is a plain append, so
  0.6.0's interleaving with host systems registered between behaviors is
  preserved exactly, and registration cost returns to baseline. The ordering
  contract, stated: behaviors order among THEMSELVES by the keyed lane;
  position relative to host systems is registration order, disturbed only by
  an out-of-order insert — and then only for the suffix.
- **Strikes are bounded per frame.** A thenable hook across N instances
  struck the guest N times in one frame — writing an instance-population
  count into the cumulative `strikes` number hosts PERSIST across engine
  generations (500 instances = 500 strikes, measured). One strike per frame
  per reason now (attribution stays per-instance via `onBehaviorFault`), and
  `guest.fault` is a no-op once suspended, so a runaway pass the breaker
  cannot preempt stops inflating the ledger and spamming its subscribers.
- **`describeBehavior` describes what RUNS.** Reads/writes validation is
  dev-guard-gated, so a production build accepts (and runs) a behavior whose
  unregistered read `partitionReads` silently drops — and `describeBehavior`
  crashed on it. Unclassifiable entries are now skipped to mirror the
  runtime; dev-guard validation still names the authoring error loudly.
- **`BehaviorStatus.quarantined`.** Withdrawal makes a quarantined ephemeral
  singleton DEPART, so `failed` read 0 and the quarantine was invisible —
  indistinguishable from dormant. The node-level flag is now on `list()`.

## [0.6.0] — 2026-08-15

**`defineBehavior` — ICE's second product surface.** The userland API is now a
triad: `defineWidget` gives a widget a FACE, `defineBehavior` gives it LOGIC AND
STATE, `defineTool` gives the canvas INPUT POLICY. Design-009, built on the
0.5.0 guest runtime rather than beside it.

### Added

- **`defineBehavior(name, spec)`** — one named declaration carrying a data
  schema, a REQUIRED store class, and lifecycle hooks the engine runs on a
  curated phase set. `store:` routes everything — where data lives, who sees
  it, what survives, which write vocabulary the hooks receive, at which
  cadence, and how attachment works:

  | `store` | data is | syncs | undo | writes with | phases |
  |---|---|---|---|---|---|
  | `durable` | document truth | every peer; offline-merge | yes (see `derived`) | `ctx.commit` only | `derive` |
  | `runtime` | a session-local rider | no | no | `ctx.write`/`ctx.set`/`ctx.attach` | `simulate`·`derive`·`present`·`publish` |
  | `ephemeral` | THIS peer's presence facet — a SINGLETON on the local peer | live peers; TTL | no | `ctx.write(patch)` + `ctx.peers()` | `publish` |

  The three hook contexts are three TYPES, not one with optional members: a
  durable behavior cannot see `ctx.write` in autocomplete, so "store routes
  everything" is a property of the object rather than a doc claim.
- **Hooks** — `init` · `update` (own data changed, by ANY writer, including a
  remote peer and undo) · `changed` (the reads set moved; once per behavior per
  frame, not per instance) · `tick` (per instance, opt-in) · `dispose`. Change
  delivery rides strata's real change detection, so every behavior is
  collaboration-native with zero author code. The instance list is a SNAPSHOT:
  a hook that attaches or detaches affects the NEXT frame.
- **`derived: true`** bundles three protections that only make sense together —
  output commits forced non-undoable (⌘Z must never un-derive), a DIFFER that
  drops every write already equal to the projection (zero remaining ops opens
  NO transaction), and claim-scoped delivery SUPPRESSION that goes quiet under
  a live gesture and coalesces into one delivery against settled truth.
  Equality is strata's own `valueEquals` — a hand-rolled one drifts on exactly
  the cells reconcile considers settled.
- **`engine.behaviors`** — `attach`/`detach`/`has`/`read`/`list`. Durable
  attachment is deliberately absent: it is a document op and goes through
  `tx.attach` so it syncs and undoes.
- **`defineWidget({ behaviors })`** — pre-attachment, split by store class like
  everything else: durable rides the spawn transaction, runtime is stamped at
  PROJECTION by the equip pass (the only path that also equips a widget
  arriving from a peer or restored from a file), ephemeral is refused.
- **`createBehaviorHarness(B)`** — ships WITH the framework. `claim(e)` fakes a
  gesture (suppression is what authors get wrong); `pair()` gives a second
  engine on one document (convergence bugs are invisible on one peer by
  definition); `commits` records what reached the store, which is how you tell
  "the differ dropped it" from "it never ran".
- **`useBehavior(world, entity, behavior)`** in `@ice/react` — live behavior
  data, `p.json` parsed, read-only by construction.
- **`p.entityKey()`** — the only legal cross-entity reference in durable data.
- **Behavior schema evolution** — `engine.behavior.<name>.<v>` markers with
  their OWN gate compare and the absent-is-not-newer rule. Behaviors ship in
  plugins, so "no local counterpart" is the ordinary state of a shared
  document; folding them into the pack compare would read-only a document
  because a plugin is missing. Behavior version state NEVER affects a document's
  verdict, and a test holds that.
- **`GuardedTxOpts.meta`** — per-commit provenance in-CRDT (strata petition 9).
  Every `ctx.commit` stamps `{behavior, label}`.
- **`guests.addDriven`** — the breaker detached from the scheduler, so behaviors
  running as pipeline systems still share one ledger, one doctor row and one
  frame-wide seam with every hosted guest.

### Behavior worth knowing

- **The stamping tax.** A behavior compiles to up to TWO systems: delivery
  (carrying every declared write, durable targets included) and, only if it
  ticks, a tick system carrying its own component ONLY. strata blanket-stamps a
  ran system's declared writes whether or not it wrote, so a ticking system
  with broad writes would wake every downstream observer every frame. Declare
  minimally.
- **`reads:` is a published surface.** The curated list is a stability promise;
  reading engine internals works but dev-warns. One-tick markers are cleared by
  the publish slot, so ephemeral behaviors can never see them.
- **Registration order is data-flow order.** If B derives from A and A is
  registered first, B sees A's writes the same frame; the other way, next
  frame. The framework will not order for you — devtools shows the order.
- **An ordered relation in `reads:` costs O(instances) per frame.** Sibling
  order never reaches a change collector, so it is polled, and the watch set is
  instances ∪ their parents. Declare one only when you navigate it.
- Scale posture: designed for ≤~2k ticking instances. Beyond that the idiom is
  ONE behavior on a carrier entity iterating its members.

### Fixed

- **The `coarse: false` attestation is now enforced.** It has been an
  engine-wide promise since M6 with nothing holding it; a raw `batch.col()`
  write to a behavior-read component would silently stop every behavior reading
  it from ever waking.

## [0.5.0] — 2026-08-15 · a git release point, NOT published to npm

**Install 0.6.0 for everything below.** The split existed so this half could
ship if the behavior framework slipped; it did not, and 0.6.0 landed the same
day, so the registry goes 0.4.0 → 0.6.0. The commit remains a genuine release
point — its tree contains no `behavior/` — which is why the entry stays rather
than being folded upward.

Two downstream petitions from VibeField, each carrying real bug fixes the field
wants regardless of what they were asked for: the **guest runtime** (I14) and
**animation-integrated writes** (I15). Cut on its own rather than folded into
0.6.0 because its value does not depend on the behavior framework — the
standing fixes below have been live bugs for weeks.

### Added

- **`engine.guests`** — a NAMED slot in the frame contract for work the engine
  did not write (`setFrameInfo → sync → tick → GUESTS → publish → notify →
  reflect`). Guests run before publish so derived state has settled when
  presence I/O reads it, and before notify so the same frame reflects them.
  Three properties the engine owes anything it hosts there: fault ISOLATION (a
  throwing guest never kills the loop, its neighbours or the frame — engine
  systems and publish hooks keep propagating loudly by design), SNAPSHOT
  iteration (a guest that adds or removes guests mid-run skips nobody), and a
  CIRCUIT BREAKER named honestly — a main-thread body cannot be preempted, so
  what the breaker guarantees is that no guest hurts the canvas TWICE
  sustained. The ledger is HOST-INJECTABLE: an engine is per-doc downstream, so
  a registry-local one would reset on every doc switch and hand chronic
  offenders a fresh probation forever. `guests.list()`, per-guest devtools
  lanes, and `EngineOpts.onGuestFault`/`onGuestNotice` — a suspended derived
  guest is a product event a host must be able to route, not a log line.
- **`GuardedTx.move(entity, to, {animateMs})`** — capture, durable final and
  glide in ONE commit, one undo entry, no double-write. Already-tweening
  entities RETARGET rather than restart; `Grab`-held ones are skipped; and
  `animateMs: 0` on an in-flight glide ENDS it (write-then-remove, so the stale
  tween cannot fight the snap it just committed). `ops.arrange` is now a
  pass-through over it — the recipe lives in the primitive it seeded.

### Fixed

- **A throwing publish hook no longer kills the canvas.** `@ice/dom`'s rAF loop
  rescheduled only AFTER `step()`, so one throw anywhere in publish stopped the
  loop permanently — no frames, no recovery, no message. Fixing it also closed
  a latent resurrection in the other direction: a `stop()` called from inside
  the step is re-checked after the body, so the loop cannot outlive its own
  stopper.
- **Self-removing publish hooks and reflectors no longer skip their
  neighbours.** Both loops iterated live arrays, so a splice during iteration
  shifted the next entry past the index.
- **Devtools' "reflect" lane reports for the first time.** It read a phase name
  that has never existed. `FrameTelemetry` gained `reflectMicros` and
  `reflectorMicros`, which are the real source.
- **Undo mid-glide no longer strands a cell permanently.** A glide holds the
  runtime cell away from the document; if the durable value then changed by any
  path other than the move, the tween landed on the stale target, strata's
  `(own, value)` branch advanced the baseline alone and banked NOTHING, and the
  cell was left diverged with an empty held-cell ledger — never reconciling,
  and poisoned against every later remote write. Two chokepoints close it:
  post-seal in `guardedTransaction` (a Position written by any other path
  retargets the tween) and post-history in the facade (undo does not pass
  through the tx path at all).
- `tweenStart` is reaped for entities that die mid-tween, rather than only on
  landing.

### Added, minor

- `makeChurnGuard` is on the barrel — the drain-in-runIf idiom every derived
  consumer outside core would otherwise hand-roll.

## [0.4.0] — 2026-08-09

Three downstream petitions from VibeField land at once: the **focus model**
(design-007 — petitions I1/I4, widget keyboard exclusivity + the wheel cede)
and the **prefab rename migration** (design-008 — petition I5). Both were
adversarially reviewed post-landing; the fixes are folded in below.

### Added

- **Widget keyboard exclusivity — `interaction.keyboard: "shared" |
  "exclusive"`** (+ `keyboardEscape: "release" | "widget"`). While a node
  inside a claiming widget holds browser focus, the engine keymap and the
  adapter's Space pan modifier stand down — keys flow to the widget's own
  handlers. The dom-widgets reflector marks claiming hosts
  `data-canvas-keyboard` (+ `tabindex="-1"`), a capture-phase focus driver
  makes click-anywhere acquire focus (declare a proxy with
  `data-canvas-focus`; natively-focusable content is left to the browser),
  and Escape is the engine-reserved release gesture — blur first, gesture
  cancel on the next unclaimed press — unless the widget declares
  `keyboardEscape: "widget"` (vim-grade terminals). Programmatic focus rides
  the view: `InfiniteCanvasHandle.focus.focusWidget/blurFocus`
  (`attachWidgetFocus` for imperative hosts). The widget input contract is
  three gates, in order: `defaultPrevented` ("preventDefault = handled by
  content" — zero-declaration widgets are covered), the claim standdown
  (before the editable gate, so editable focus proxies keep the Escape
  release), then the unchanged 4-class editable guard. Undeclared widgets
  behave byte-identically.
- **Wheel cede for scrollable widget content.** A plain wheel over a
  scroller-with-room inside a claim / `[data-canvas-interactive]` / editable
  subtree scrolls natively; at the scroll bounds it falls through to canvas
  pan/zoom (the nested-scroll feel — and scroll-chaining can never reach the
  page). ctrl-wheel / trackpad pinch is ALWAYS the canvas's zoom, claimed
  content or not. The ceded fact still lands, flagged with a one-tick
  `WheelHandled` that parks BOTH wheel consumers — recognizer spawn and the
  live recognizer's feed — so a wheel gesture inside its silence window never
  pans from ceded deltas, while a same-tick canvas down is untouched.
- **`keymapOverrides` on `<InfiniteCanvas>`** — the keymap's override surface,
  plumbed through the facade at last. Conditional dispatch belongs inside
  `run()` (read engine state there); the capture-phase `stopPropagation`
  folklore is retired — widgetlab's C-key workaround is deleted as the proof.
  An override bound to Space warns at attach: the adapter owns Space
  (design-003 §4.4) and such an entry is unreachable by construction.
- **Prefab rename migration — `renamedFrom: [{ type, atVersion? }]` on
  `defineWidget`.** Docs written under a prior type id fold in-band, retiring
  offline byte surgery. The declaration registers same-shaped LEGACY group
  components under the old names (projection is name-registry-driven, so old
  cells read like any other value); the version gate stops bricking
  pre-rename docs readOnly and gates them "migrate" instead, with
  `engine.renamed.<old>` tombstones marking dead markers forever (meta has no
  delete); the open-path runner folds under the single-writer law and stamps
  a carried `engine.pack.<new>.<oldV>` so `migrate` version chains compose on
  the new names; and an observer-armed zombie sweep on every writable session
  converges stale pre-rename deliveries — late old-shape entities fold fully
  (chain-folded from `atVersion`), resurrected old cells resolve NEW-WINS.
  Envelope headers self-heal at the next save. No strata changes were needed.

### Fixed

- **Space types into widget fields again.** The adapter preventDefaulted
  Space unconditionally as the pan modifier, eating it inside a widget's own
  `<textarea>`/`<input>` unless the widget stopPropagation'd its keydown.
  Space handling is now ownership-aware: it types in editables, cedes pan
  semantics (while still suppressing page-scroll) under a keyboard claim, and
  pans over canvas as ever.

### Breaking, narrowly

Same class as 0.3.0's `Engine.frame`: engine-constructed types gained required
members, so only hand-rolled implementations are affected — consumers that
merely read them need no change. `WidgetType` gained `keyboard`/
`keyboardEscape`; `DocVersionReport` gained `renamedInDoc`;
`InfiniteCanvasHandle` gained `focus`.

## [0.3.0] — 2026-08-04

One feature: **the frame gate** — the frozen-world mode design-005 §4 named as a
separate concept when stage holds landed in July, and deliberately left unbuilt
until something needed it. Full-window chrome (a control-room overlay that
covers the canvas outright) needed it: a stage hold quiets the compositor but
the engine keeps ticking at display rate for pixels nobody can see.

### Added

- **`engine.frame` / `ce.frame` — freeze the engine, not just its rendering.**
  `frame.freeze(name)` takes a refcounted NAMED freeze and returns an
  idempotent thaw, exactly like `stage.background(name)`. While one is held the
  host loop stops calling `step` entirely: no systems, no publish, no notify,
  no reflectors — and no scheduled rAF, because a stopped engine should leave
  the browser nothing queued. `FrameMode.freezeHolds` mirrors the count into
  the world for inspection; `frame.holds()` names the holders.

  **Which one to reach for**: `stage.background` for chrome that RECEDES the
  canvas (a menu panel over a live board — undo, collab and tweens must still
  land visibly behind it); `frame.freeze` for chrome that COVERS it. A freeze
  under a partial overlay will read as broken, because the canvas becomes a
  photograph until thaw. Stage holds are unchanged and did not stretch.

- **The settle protocol** — `frame.settleWhile(name, busy)`. A freeze does not
  park on the spot; it walks the loop until every registered reporter is quiet
  and then takes one further step, so the frozen image is whole rather than
  half-drawn. `<GLViews>` registers pending first-paints and mid-flight lift
  eases; the facade registers the mid-gesture read. Bounded by `SETTLE_CAP`
  (120 frames) with a dev warning naming whoever wedged it: a bad reporter
  makes a freeze park late, never never.

- **`useFrameFreeze(engine, active, name)`** in `@vibecook/ice/react` — the
  `useStageHold` shape, where the effect cleanup is the thaw, so an overlay
  that unmounts or crashes can never wedge the engine parked.

- **`isMidGesture` / `anyGestureNonTerminal`** are exported from core now. The
  predicate autosave used privately to defer a save (so it never captures a
  half-applied interaction) is the same one the settle needs; one definition,
  so the two cannot drift.

### Behavior worth knowing

- A freeze **cancels active gestures** at the transition. A parked loop never
  reaches `JustEnded`, so a gesture frozen mid-flight would hold runtime edits
  that never commit.
- A thaw **drops whatever input queued while parked**. Adapters never stop
  enqueuing; those facts describe a canvas nobody could interact with and carry
  a `tMs` that is now minutes stale. Same posture as the adapter's window-blur
  cancel (design-003 §8).
- **Remote edits keep landing in the document while frozen** — they simply
  reach the WORLD on thaw. Autosave is event-driven end to end
  (`subscribeOutbound` on each sealed local commit, `subscribeRemote` after
  each `applyRemote`, no polling), so a frozen engine cannot lose a document.
- **Widget-owned animation is outside the gate.** A widget's own CSS animation
  or playing media keeps running; the engine freezes engine-driven pixels.
- Resume rides the existing 64 ms `dt` clamp, so an hour parked advances tweens
  by one ordinary frame instead of teleporting them to their end.

### Breaking

- `Engine` gained a required `frame` member. Constructed engines
  (`createEngine` / `createCanvasEngine`) get it for free and hosts need no
  change — `startRafLoop(engine)` keeps its exact signature and reads the gate
  off the engine it was already handed. Only a hand-rolled `Engine`
  implementation would need updating.

## [0.2.0] — 2026-07-25

Everything since 0.1.0 (2026-07-12): 79 commits spanning M8 (node editor,
containers, nested canvas), M9 (presence, bootstrap, migrations), and M10 (ops
catalog, devtools, docs). Documents written by 0.1.0 migrate on open — see
**Breaking** below.

### Breaking

- **Sibling order replaces scalar z — document schema 2.** `ChildOf` is now an
  ORDERED relation: a frame's children ARE its paint/pick order, converging
  collaboratively through strata's movable-list semantics instead of scalar-z
  arithmetic. `ops.reorder(ids, "top" | "bottom")` is unchanged at the surface;
  what went away underneath is `StackZ` arithmetic, `Grab.z` restore, and the
  `topZ()` scans.

  Migration is automatic and needs no application code: the envelope version
  gate reports `migrate`, and the facade runs `runMigrations` at open — one
  `{undoable: false}` transaction that mints the board root and re-links every
  durable widget in `(z asc, entityKey asc)` order. It is absolute, idempotent,
  and convergent (same document → same sequence), so concurrent migrators agree
  and user undo history survives.

  Forward compatibility is graceful, not fatal: the legacy `StackZ` cells are
  deliberately KEPT, so a 0.1.0 build opening a migrated document still opens it
  read-only and still paints in the right order. Live collaboration on an ordered
  document does require every peer on 0.2.0.

- **Peer requirements**: `@vibecook/strata-ecs` 0.11.0 and `loro-crdt` >= 1.13.8.

### Added

- **`@vibecook/ice/ground` — a new entry point.** The P0 stratum collapses to ONE
  WebGPU canvas (three's `WebGPURenderer` + TSL, automatic WebGL2 fallback)
  hosting the dot grid, wires, and snap-guide passes behind a shared pass
  registry. React takes it as an opaque factory — `<InfiniteCanvas ground={ground(...)}>`
  — so the import walls hold; imperative shells register `layer.reflector`.
- **Node editor**: ports materialized on demand, wires as edge entities with
  endpoint cascade, and a connect tool with preview continuity. Culled endpoints
  still draw.
- **Nested canvas + portal-zoom navigation** (design-006 T1): `ops.enterContainer` /
  `exitContainer` fly the camera along a portal-continuous log-zoom path with a
  closed-form spring, `exitTo` composes multi-level portals from current rects, and
  GL islands go cold for the duration of a flight.
- **Widget tray — insert-by-drag**: a draft ghost the drop adopts, deferred spawn,
  and a morphing bottom toolbar.
- **Widget previews**: a `defineWidget` preview contract, `<WidgetPreview>`, and
  runtime GL preview capture through headless islands.
- **`ops.arrange` — desktop-style Clean Up**: a kernel packer with Blueprint-style
  wire-aware layout, dense packing, bystander obstacles, crossing refinement, and
  band-wrapped chains; commits then glides. Free-slot placement on consume.
- **Comment widget**: a UE-Blueprint comment box (`C`) that claims members by
  spatial sweep, stacks under them, and files into folders as a group.
- **Selection chrome v2**: in-card rounded rings, a lift-wrapping union box on the
  P4 DOM plane, SDF rings at the ground stratum, and pooled snap guides.
- **Cursor halo**: a hover-time `OverInteractive` fact driving a ring → dot morph.
- **Per-widget `Opacity`**: one durable cell, reflected on both the DOM and GL planes.
- **`docs.presence()`**: the inspection seam that lets facade apps wire the devtools
  presence panel — swaps with the document lifecycle, never a sync path.
- **`offerBase`**: re-offer a live session's base after a lossy-transport outage —
  peers re-adopt and Loro dedupes, with no teardown, world reset, or UI flash.
- **Bounded incremental autosave journals**: `storage.append` extends a checkpoint
  with the exact outbound Loro update; `put` replaces and compacts. Falls back to a
  full checkpoint when an append is not acknowledged.
- **Devtools rebuilt** on strata's first-party tools: one draggable dock hosting all
  panels, plus a GL metrics panel (renderer census, virtual-texture/LOD/cull).
- **GL frame profiling**: `<GLViews onFrameStats>` with `stats-gl` GPU timing.
- **Electron example** (`apps/widgetlab-desktop`): an IPC room switchboard with an
  optional truffle/tsnet mesh — serverless multi-window and multi-machine collab.

### Performance

Measured 2026-07-15 on an Apple M1 Max against strata 0.7.0; the bench source in
`packages/core/bench/` is the source of truth and `docs/benchmarks.md` records the
full output.

- **Idle frames stopped scaling with the board.** `activeMembership`, `breakpoint`,
  `cull`, and `widgetMount` all became delta-driven behind real `runIf` churn gates
  (strata 0.7.0 `ChangeCollector`), and `spatialSync` is O(delta) with an
  allocation-free sweep. Idle cost at 100k entities fell from **25.1 ms to 872 µs**
  (flat) and **25.6 ms to 890 µs** (nested); nested-10k is 106 µs.
- **Pan frames skip `breakpoint` entirely** — 1 run per 450 frames, against every
  frame before the gate.
- **GL idle-duty package**: animation rate cap, paint-DPR ceiling, backbuffer AA off.

### Fixed

- Three adversarial review sweeps (10, 7, and 18 findings) hardening the doc-join
  lifecycle, GL click pairing, autosave truth, migration atomicity, FBO accounting,
  read-only truth, transport failure paths, and presence reset.
- **The equip-lag Active flash**: fresh container content anchored to the root for one
  frame and was mass-Visible-tagged, leaving zombies mounted forever — 6,440 phantom
  mounts on a 10k seed, plus polluted archetypes that defeated chunk-level tag
  filtering. Membership now answers container-ness from the widget registry during the
  equip-lag window.
- **Gesture windows measure the clamped engine clock**, not wall time — real clicks
  select again under a throttled or headless rAF.
- **GL composite renders in the engine flush** (reflect-phase advance) — pan no longer
  lags the DOM planes; the advance clock is seconds, and stagger-deferred islands bank
  their `dt`.
- Nav-tick zombies and cross-frame scope leaks (folder ghosts); nav ops own a
  synchronous visibility cut, so no squeezed-scene flash.
- Test rigs that claimed to arm strata's write enforcement but observed nothing — an
  observe-less reflector never arms it, so the assertions were inert.

### Docs

- `docs/benchmarks.md` — per-milestone measured baselines, including the numbers that
  came out badly.
- `docs/strata-petitions.md` + `docs/petitions/` — eight upstream petitions, all landed
  (strata 0.3.0–0.9.0), each recording the engine migration that retired its workaround.
- `docs/api-reference.md` — the curated published surface.

## [0.1.0] — 2026-07-12

First publish: kernel math, the frame contract, the L0–L4 interaction stack, durable
documents with per-gesture undo, the DOM widget runtime, GL islands, and the
`createCanvasEngine` facade.
