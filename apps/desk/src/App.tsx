// The DESK (design-015; D2a-world): React 19 over `createCanvasEngine`, the mat and its objects drawn
// FROM THE WORLD by `deskLayer()` mounted through `<Desk layer={…}>` (D5b — `<InfiniteCanvas>` became
// `<Desk>` by deletion, plan D-D0.6; the desk draws its own selection, D4a's marks). Keys:
// `w` sticks a note at the pointer, `m` lays a mini mat, ⌫ deletes, ⌘Z/⇧⌘Z undo and redo (the core
// keymap), `d` toggles the theme and pins it (until then the OS leads), `u` the rulers (K1), `a` slides the pegboard tray
// in and out (K3, design-017). The generated plates and a
// runtime glyph atlas feed the mat at boot (K1: the atlas re-rendered at every change of the device's ratio or the rulers' text
// size); `window.__desk` (api.ts) is the rigs' door. D4a: the desk
// draws its marks on the GPU and the ONE screen-space selection menu rides the layer's anchor
// (`<SelectionMenu>`), with ICE's acts and the app's own stub "Send" first (it logs — VibeField's is real).
// D5a: the backtick opens the DEV PANEL (panel/ — the prototype's tweak panel), its params projected into the layer.
// K2: `~` (⇧`) opens the DEVTOOLS DOCK (devtools.ts) — strata's profiler, the desk's GPU, the observer; the layer keeps a GPU memory ledger for it.

import type { Entity } from "@ice/core";
import { Active, PointerWorld, LocalPointer, Pointer, Camera, heldEntity, Position, PrefabId, Size, Viewport, defineQuery, defineTickSystem, selectedEntities } from "@ice/core";
import { deskLayer, type DeskLayerHandle } from "@ice/desk";
import { bookAngle } from "@ice/objects";
import { BOARD_TYPE, CALENDAR_TYPE, DESK_OBJECTS, MINIMAT_TYPE, NOTE_TYPE, NOTEBOOK_TYPE, VINYL_ACT } from "@ice/objects";
import { CLOCK_SECONDS_ACT, CLOCK_TYPE } from "@ice-examples/desk-clock";
import type { ThemeName } from "@ice/desk";
import { defaultSelectionActions, Desk, type KeymapEntry, type LayerFactory, nudgeSelection, type SelectionAction, SelectionMenu, type SelectionMenuSource } from "@ice/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { installDeskApi, type DeskApi } from "./api";
import { deskBlobs } from "./blobs";
import { createProfilerDock, type ProfilerDock } from "./devtools";
import { installPictureDrop } from "./paste";
import { createDeskEngine, deskRoom, joinDeskRoom } from "./desk";
import { disposeOnLeave } from "./lifetime";
import { type DevPanel, installDevPanel } from "./panel/panel";
import { DESK_GRID, defaultParams } from "./panel/params";
import { deskText } from "./faces";
import { productPlates } from "./fixtures";
import { deskScale, glyphFeed } from "./glyphs";
import { deskPalette, deskTheme, osTheme } from "./palette";
import { spawnAll } from "./scene";

const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);
/** The frame's objects, for Tab's walk (D4b). */
const objectsQ = defineQuery([Position, Size, PrefabId, Active]);

/** The app's own act, first in the bar (*Marks on the Mat*: "Send to agent first, because it is the one act only this desk has") — a stub here: it logs, and the rigs read `__desk.sent`. */
const SEND: SelectionAction = {
  id: "send", place: "lead", text: true, glyph: "agents", keys: "⌘↩",
  label: (s) => (s.count > 1 ? `Send ${s.count} to agent` : "Send to agent"),
  run: (_engine, s) => { console.info(`[desk] send ${s.count} to an agent (a stub — VibeField's picker is real)`); window.__desk?.sent.push(s.count); },
};
const MENU_ACTIONS: readonly SelectionAction[] = [SEND, ...defaultSelectionActions()];
/** The mat's lattice cell at zoom 1, world units — the desk's ⇧ nudge (*Marks on the Mat*: "⇧ arrows nudge 20, one lattice cell"). */
const LATTICE_CELL = 20;

function fail(e: unknown): void {
  const el = document.getElementById("fail");
  if (el === null) return;
  el.textContent = e instanceof Error ? (e.stack ?? e.message) : String(e);
  el.hidden = false;
}

/** The theme in force: the OS's unless pinned by `d` or a scene; every change re-projects the palette into the layer (through `themeOf` — the dev panel's colours and night, once touched). */
function createThemeControl(handle: () => DeskLayerHandle | null, themeOf: (name: ThemeName) => ReturnType<typeof deskTheme> = deskTheme) {
  let name: ThemeName = osTheme();
  let pinned = false;
  const apply = (): void => {
    document.documentElement.dataset.theme = name;
    handle()?.setTheme(themeOf(name), deskPalette(name));
  };
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  mq?.addEventListener("change", (e) => { if (!pinned) { name = e.matches ? "dark" : "light"; apply(); } });
  return {
    name: () => name,
    set(next: ThemeName, pin: boolean) { name = next; if (pin) pinned = true; apply(); },
    toggle() { name = name === "dark" ? "light" : "dark"; pinned = true; apply(); },
    apply,
  };
}

export function App(): ReactElement {
  const [engine] = useState(() => createDeskEngine());
  const handleRef = useRef<DeskLayerHandle | null>(null);
  const apiRef = useRef<DeskApi | null>(null);
  const panelRef = useRef<DevPanel | null>(null);
  const dockRef = useRef<ProfilerDock | null>(null);
  const [params] = useState(() => defaultParams());
  const themeRef = useRef(createThemeControl(() => handleRef.current, (name) => panelRef.current?.themeOf(name, deskTheme(name)) ?? deskTheme(name)));
  const matSerial = useRef(1);
  const [menuSource, setMenuSource] = useState<SelectionMenuSource | null>(null);

  // The layer factory — memoised: a new identity would re-boot the canvas mount. The wrapper keeps the handle for the app.
  const layer = useMemo<LayerFactory>(() => {
    // D2c: the app's hand (its faces, the text raster) and the document a note's typing session commits into; K1: the product's
    // grid — the rulers printed on the root (the engine's default leaves them off; a host prints them, RULER.md §5)
    const factory = deskLayer({ theme: deskTheme(themeRef.current.name()), palette: deskPalette(themeRef.current.name()), objects: [...DESK_OBJECTS], name: "desk/compose", text: deskText(), docs: engine.docs, blobs: deskBlobs, springs: params.motion, grid: DESK_GRID, gpuLedger: true });
    return (ctx) => { const h = factory(ctx); handleRef.current = h; return h; };
  }, [engine, params]);

  // The keymap is bound once per engine: its entries close over the engine (state, stable) and two refs, and read the world live.
  const keys = useMemo<KeymapEntry[]>(() => {
    const { world } = engine;
    /** Where a new object goes: under the pointer once it has been seen, else the view's centre (the prototype's `placeWorld`). */
    const placeWorld = (): { x: number; y: number } => {
      let at: { x: number; y: number } | null = null;
      world.query(mouseQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") { const w = world.read(p, PointerWorld); at = { x: w.x, y: w.y }; } } });
      if (at !== null) return at;
      const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
      const vp = world.getResource(Viewport) ?? { w: 0, h: 0 };
      return { x: cam.x + vp.w / (2 * cam.zoom), y: cam.y + vp.h / (2 * cam.zoom) };
    };
    const stick = (type: string, props: Record<string, unknown>): void => {
      const widget = engine.catalog.widget(type);
      if (widget === undefined) return;
      const at = placeWorld();
      const [e] = spawnAll(engine, [{ type, cx: at.x, cy: at.y, w: widget.defaultSize.w, h: widget.defaultSize.h, props }], true);
      engine.ops.setSelection([e as Entity], "replace");
    };
    /** Tab (D4b): the next object of the frame in reading order after the one selected (the first with none, or several); ⇧Tab the one before. */
    const tabSelection = (dir: 1 | -1): void => {
      if (heldEntity(world) !== undefined) return;
      const all: { e: Entity; x: number; y: number }[] = [];
      world.query(objectsQ).each((b) => { for (const r of b) { const e = b.entity(r); const p = world.read(e, Position); all.push({ e, x: p.x, y: p.y }); } });
      if (all.length === 0) return;
      all.sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
      const sel = selectedEntities(world);
      const at = sel.length === 1 ? all.findIndex((o) => o.e === sel[0]) : -1;
      const next = all[(at + dir + all.length) % all.length];
      if (next !== undefined) engine.ops.setSelection([next.e], "replace");
    };
    return [
      { key: "w", run: () => stick(NOTE_TYPE, { seed: (Math.random() * 0x7fffffff) | 0 }) },
      { key: "m", run: () => stick(MINIMAT_TYPE, { name: `Mat ${matSerial.current++}` }) },
      // D3w: `W` lays a whiteboard (BOARD.md — its capped marker black, bullet)
      { key: "w", shift: true, run: () => stick(BOARD_TYPE, {}) },
      // …`b` a notebook (NOTEBOOK.md — its seed its hand and its turn on the mat, never set down quite square)
      { key: "b", run: () => { const seed = (Math.random() * 1000) | 0; stick(NOTEBOOK_TYPE, { seed, angle: bookAngle(seed) }); } },
      // …`C` a desk calendar showing this month (CALENDAR.md — the host's clock), its week from Monday
      { key: "c", shift: true, run: () => { const d = new Date(); stick(CALENDAR_TYPE, { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` }); } },
      // K8b: `c` sets a DESK CLOCK down (examples/desk-clock — a plugin kind in its own package, registered beside the six: desk.ts
      // `DESK_PLUGINS`); on a page that registered none (a rig's reference desk) the key finds no type and does nothing
      { key: "c", run: () => stick(CLOCK_TYPE, {}) },
      // …and `s` flips the selected clocks' seconds hand — the clock's OWN menu act (`defineObject({ menu })`), run through the engine
      { key: "s", run: () => { engine.ops.runMenuAction(CLOCK_SECONDS_ACT); } },
      { key: "d", run: () => themeRef.current.toggle() },
      // K3: `a` ("add") slides the pegboard tray in and out (design-017 — widgetlab's `B` is the notebook's here)
      { key: "a", run: () => { handleRef.current?.tray.toggle(); } },
      // `t` (MINIMAT.md §2): the mini mat's own act (K8a — `defineObject({ menu })`), run on the selected mats through the engine
      { key: "t", run: () => { engine.ops.runMenuAction(VINYL_ACT); } },
      // K1: `u` prints the rulers or not (the ground demo's key) — through the dev panel's params, so the panel's row and the
      // browser's saved desk agree with it; like every letter here, never while typing (the keymap's editable gate)
      { key: "u", run: () => panelRef.current?.tweak((p) => { p.ruler.on = !p.ruler.on; }) },
      // D5a: the backtick opens and closes the dev panel (screen-space DOM, the prototype's tweak panel)
      { key: "`", run: () => panelRef.current?.toggle() },
      // K2: ⇧` — the devtools dock, the GPU profiler armed while it is open
      { key: "~", shift: true, run: () => dockRef.current?.toggle() },
      // D4b: Tab walks the desk's objects in reading order (top to bottom, left to right) — the keyboard's way to a notebook, which ⏎
      // then picks up and Esc lands with the selection back; ⇧Tab walks back. Nothing while something is in hand (the bar's Tab is D3t's).
      { key: "Tab", run: () => tabSelection(1) },
      { key: "Tab", shift: true, run: () => tabSelection(-1) },
      // ⇧ arrows nudge one lattice cell (Marks on the Mat's keys, D4a) — the engine's default ⇧ step is 10; a taped object never moves
      ...([["ArrowLeft", -1, 0], ["ArrowRight", 1, 0], ["ArrowUp", 0, -1], ["ArrowDown", 0, 1]] as const).map(([key, dx, dy]): KeymapEntry => ({ key, shift: true, run: (e) => nudgeSelection(e, dx * LATTICE_CELL, dy * LATTICE_CELL) })),
    ];
  }, [engine]);

  // The engine lives as long as the app is mounted — disposed a task after a real unmount, never by StrictMode's
  // development double-mount check, which re-runs <Desk> against the SAME engine (lifetime.ts)
  const [lifetime] = useState(() => disposeOnLeave(() => engine.dispose()));
  useEffect(() => {
    lifetime.enter();
    return () => lifetime.leave();
  }, [lifetime]);
  // …and it joins its room ONCE (K9): the mount StrictMode discards and the one that follows await the same join — a second
  // join superseded the first, whose rejection became the fail screen
  const joined = useRef<ReturnType<typeof joinDeskRoom> | null>(null);

  return (
    <Desk
      engine={engine}
      layer={layer}
      keymapOverrides={keys}
      style={{ position: "absolute", inset: 0 }}
      onReady={() => {
        const handle = handleRef.current;
        if (handle === null) { fail("the desk layer did not mount"); return; }
        // K9: what this mount starts, the cleanup it returns ends — the mount StrictMode discards (in development) must leave no
        // paste listener, no join and no wait on its dead layer behind it
        let cancelled = false;
        setMenuSource(handle.selection);
        // K1: the rulers' glyph atlas, kept to the ratio the desk draws at (the viewport's) and the panel's text size (glyphs.ts) —
        // nothing until the ground is here
        const glyphs = glyphFeed({ ready: () => handle.available(), scale: () => deskScale(engine.world.getResource(Viewport)?.dpr ?? 1), size: () => params.ruler.text.size, upload: (a) => handle.setGlyphs(a.bytes, a.meta) });
        // D5a: the dev panel first — a saved desk is projected before the first frame (a desk in a room keeps nothing)
        panelRef.current = installDevPanel({ engine, handle, params, theme: themeRef.current, storageKey: deskRoom() === undefined ? "ice-desk-panel" : undefined });
        themeRef.current.apply();
        dockRef.current = createProfilerDock(engine, handle);
        const api = installDeskApi(engine, handle, themeRef.current, panelRef.current, glyphs, dockRef.current);
        apiRef.current = api;
        const undoDrop = installPictureDrop(engine, handle, fail);   // D3w: a pasted or dropped picture is a print
        // the product's plates and a runtime glyph atlas the moment the ground is here
        const feed = async (): Promise<void> => {
          joined.current ??= joinDeskRoom(engine);
          await joined.current;   // D2c: `?room=` joins the room's document first
          if (cancelled) return;
          const plates = await productPlates();
          while (!cancelled && !handle.available()) { if (handle.status().state === "failed") throw new Error(handle.status().message); await new Promise((r) => requestAnimationFrame(r)); }
          if (cancelled) return;
          handle.setPlate("c", plates.c);
          handle.setPlate("b", plates.b);
          glyphs.refresh();
          // …and again whenever the viewport's ratio moves — the host re-syncs it before any step it moved in (@ice/dom
          // `createDeskHost`: another display, the browser's zoom, an emulated ratio — none resizes) — or the panel's text size:
          // a tick gated on either, so nothing runs while they stand. (A mount StrictMode discards never gets here: it is cancelled.)
          engine.engine.addSystems("simulate", defineTickSystem(() => { glyphs.refresh(); }, { name: "desk.glyphs", runIf: () => glyphs.stale() }));
          api.state.ready = true;
        };
        feed().catch((e: unknown) => { if (!cancelled) fail(e); });
        return () => { cancelled = true; undoDrop(); };
      }}
    >
      {menuSource !== null ? <SelectionMenu source={menuSource} actions={MENU_ACTIONS} /> : null}
    </Desk>
  );
}
