// The DESK (design-015; D2a-world): React 19 over `createCanvasEngine`, the mat and its objects drawn
// FROM THE WORLD by `deskLayer()` mounted through `<InfiniteCanvas … chrome={false}>` (plan D-D0.6 —
// the one react change is that prop: the desk draws its own selection; D4a draws the marks). Keys:
// `w` sticks a note at the pointer, `m` lays a mini mat, ⌫ deletes, ⌘Z/⇧⌘Z undo and redo (the core
// keymap), `d` toggles the theme and pins it (until then the OS leads). The generated plates and a
// runtime glyph atlas feed the mat at boot; `window.__desk` (api.ts) is the rigs' door. D4a: the desk
// draws its marks on the GPU and the ONE screen-space selection menu rides the layer's anchor
// (`<SelectionMenu>`), with ICE's acts and the app's own stub "Send" first (it logs — VibeField's is real).

import type { Entity } from "@ice/core";
import { PointerWorld, LocalPointer, Pointer, Camera, PrefabId, Viewport, defineQuery, selectedEntities } from "@ice/core";
import type { DeskLayerHandle } from "@ice/desk/host";
import { deskLayer } from "@ice/desk/host";
import { MINIMAT_TYPE, MiniMat, NOTE_TYPE, Note, VINYLS, type VinylName } from "@ice/desk/objects";
import type { ThemeName } from "@ice/desk/theme";
import { defaultSelectionActions, type GroundLayerFactory, InfiniteCanvas, type KeymapEntry, nudgeSelection, type SelectionAction, SelectionMenu, type SelectionMenuSource } from "@ice/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { installDeskApi, type DeskApi } from "./api";
import { createDeskEngine, joinDeskRoom } from "./desk";
import { deskText } from "./faces";
import { productPlates } from "./fixtures";
import { makeGlyphAtlas } from "./glyphs";
import { deskPalette, deskTheme, osTheme } from "./palette";
import { spawnAll } from "./scene";

const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);

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

/** The theme in force: the OS's unless pinned by `d` or a scene; every change re-projects the palette into the layer. */
function createThemeControl(handle: () => DeskLayerHandle | null) {
  let name: ThemeName = osTheme();
  let pinned = false;
  const apply = (): void => {
    document.documentElement.dataset.theme = name;
    handle()?.setTheme(deskTheme(name), deskPalette(name));
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
  const themeRef = useRef(createThemeControl(() => handleRef.current));
  const matSerial = useRef(1);
  const [menuSource, setMenuSource] = useState<SelectionMenuSource | null>(null);

  // The layer factory — memoised: a new identity would re-boot the canvas mount. The wrapper keeps the handle for the app.
  const layer = useMemo<GroundLayerFactory>(() => {
    // D2c: the app's hand (its faces, the text raster) and the document a note's typing session commits into
    const factory = deskLayer({ theme: deskTheme(themeRef.current.name()), palette: deskPalette(themeRef.current.name()), objects: [Note, MiniMat], name: "desk/compose", text: deskText(), docs: engine.docs });
    return (ctx) => { const h = factory(ctx); handleRef.current = h; return h; };
  }, [engine]);

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
    /** `t` (MINIMAT.md §2): the selected mini mats' vinyl cycles sage → slate → charcoal; the inside's mat is the same vinyl, so it follows. */
    const cycleVinyl = (): void => {
      for (const e of selectedEntities(world)) {
        const id = world.get(e, PrefabId)?.id;
        if (id !== MINIMAT_TYPE) continue;
        const cur = (world.get(e, MiniMat.groups[0]?.component as never) as { vinyl?: string } | undefined)?.vinyl ?? VINYLS[0];
        const next = VINYLS[(VINYLS.indexOf(cur as VinylName) + 1) % VINYLS.length] ?? VINYLS[0];
        engine.ops.setWidgetProps(e, { vinyl: next });
      }
    };
    return [
      { key: "w", run: () => stick(NOTE_TYPE, { seed: (Math.random() * 0x7fffffff) | 0 }) },
      { key: "m", run: () => stick(MINIMAT_TYPE, { name: `Mat ${matSerial.current++}` }) },
      { key: "d", run: () => themeRef.current.toggle() },
      { key: "t", run: cycleVinyl },
      // ⇧ arrows nudge one lattice cell (Marks on the Mat's keys, D4a) — the engine's default ⇧ step is 10; a taped object never moves
      ...([["ArrowLeft", -1, 0], ["ArrowRight", 1, 0], ["ArrowUp", 0, -1], ["ArrowDown", 0, 1]] as const).map(([key, dx, dy]): KeymapEntry => ({ key, shift: true, run: (e) => nudgeSelection(e, dx * LATTICE_CELL, dy * LATTICE_CELL) })),
    ];
  }, [engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  return (
    <InfiniteCanvas
      engine={engine}
      ground={layer}
      chrome={false}
      keymapOverrides={keys}
      style={{ position: "absolute", inset: 0 }}
      onReady={() => {
        const handle = handleRef.current;
        if (handle === null) { fail("the desk layer did not mount"); return; }
        setMenuSource(handle.selection);
        themeRef.current.apply();
        const api = installDeskApi(engine, handle, themeRef.current);
        apiRef.current = api;
        // the product's plates and a runtime glyph atlas the moment the ground is here
        const feed = async (): Promise<void> => {
          await joinDeskRoom(engine);   // D2c: `?room=` joins the room's document first
          const plates = await productPlates();
          while (!handle.available()) { if (handle.status().state === "failed") throw new Error(handle.status().message); await new Promise((r) => requestAnimationFrame(r)); }
          handle.setPlate("c", plates.c);
          handle.setPlate("b", plates.b);
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const atlas = makeGlyphAtlas(10, dpr);
          handle.setGlyphs(atlas.bytes, atlas.meta);
          api.state.ready = true;
        };
        feed().catch(fail);
      }}
    >
      {menuSource !== null ? <SelectionMenu source={menuSource} actions={MENU_ACTIONS} /> : null}
    </InfiniteCanvas>
  );
}
