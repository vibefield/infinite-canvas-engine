# @vibecook/ice

**ICE — infinite canvas engine.** Figma-grade infinite-canvas UX as a framework — THE DESK:
every object under the camera drawn by one WebGPU renderer from a CRDT-synced ECS world, the
DOM in screen space. `defineObject` turns a GPU object kind into a canvas citizen — selectable,
movable, resizable, snappable, nested in mini mats, synced over CRDT, undoable per gesture.

Built on [`@vibecook/strata-ecs`](https://www.npmjs.com/package/@vibecook/strata-ecs):
an archetype ECS with reactivity and opt-in Loro-CRDT durable + presence layers.

**Docs:** <https://vibefield.github.io/infinite-canvas-engine/> ·
**Source:** <https://github.com/vibefield/infinite-canvas-engine>

> **0.14.0 (design-015 D5b, 2026-09-26) breaks:** the DOM/R3F widget hybrid is deleted — no `three`,
> no `@react-three/fiber`, no presentation profiles, no React widget faces. `<InfiniteCanvas>` is
> `<Desk>`; `defineWidget`'s `surface`/`component`/`chrome`/`animated`/`preview`/`instancePreview`/
> `sizeMode` are refused; the entries `./r3f`, `./r3f/webgpu`, `./ground*` are gone and
> `./desk`, `./desk/engine`, `./desk/objects` are new. The full list is the changelog's
> `### Removed`. (The published 0.11.0 still describes the old surface.)

```sh
pnpm add @vibecook/ice react react-dom     # react/react-dom are optional peers
```

```tsx
import { createCanvasEngine } from "@vibecook/ice";
import { deskLayer, inkRaster, penFaces } from "@vibecook/ice/desk";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskTheme } from "@vibecook/ice/desk/objects";
import { Desk, EngineProvider } from "@vibecook/ice/react";
import { createRoot } from "react-dom/client";

// The desk's preset: the six objects, the desk's select tool (a bare-mat drag pans, shift draws the
// marquee), a plain wheel zooming about the pointer, the scale-free zoom and the zoom-through.
const engine = createCanvasEngine(DESK_ENGINE);
engine.docs.create(); // a local-first document
engine.ops.spawnWidget("desk.note", { x: 120, y: 120, props: { text: "Write something…" } });

// The desk is an OPAQUE layer factory: the renderer, its kinds, the theme, the text raster.
const layer = deskLayer({
  theme: deskTheme("light"), palette: deskPalette("light"),   // the shipped default palette — or your own tokens
  objects: [...DESK_OBJECTS], docs: engine.docs,
  text: inkRaster({ faces: penFaces({ caveat: caveatUrl, "caveat-bold": caveatBoldUrl, kalam: kalamUrl }) }),   // YOUR URLs for the hands' fonts (Caveat, Kalam — OFL; apps/desk/assets/fonts)
});

createRoot(document.getElementById("root")).render(
  <EngineProvider engine={engine}>
    <Desk engine={engine} layer={layer} />   {/* mounts the desk, the adapters, the keymap */}
  </EngineProvider>,
);
```

Everything above ships working out of the box: click/shift-click selection, the
vellum marquee, drag with snap guides drawn as lasers, resize grips, wheel zoom
about the pointer and bare-mat pan, mini mats you fly into and out of, a note you
write on in place, pick-up into the hand, per-gesture undo, gesture-aware autosave,
and live presence when you `docs.join()` a room.

## Entry points

| Import | Contents |
| --- | --- |
| `@vibecook/ice` | The headless engine: `createCanvasEngine`, `defineWidget`, `defineTool`, `definePrefab`, the props DSL `p`, the doc kit, presence, and the full ECS vocabulary. |
| `@vibecook/ice/desk` | The desk: `deskLayer`, the kind contract (`defineObject`, `ObjectKind`, `KindProgram`), the text raster, the theme, the renderer (`Ground`) — no kind of its own. |
| `@vibecook/ice/desk/engine` | The raw-WebGPU engine: the device (`acquire`, `adopt`), the `Surface` type (the swap chain itself is `surface()` in `/desk`), shader composition (`compose`, `compile`), pipelines and bind groups, render targets (`Target`, `beginPass`, `readback`), `defineStruct`. No pass ships here — the passes are the desk's. |
| `@vibecook/ice/desk/objects` | The six reference object kinds: note · mini mat · notebook · whiteboard · calendar · photo (`DESK_OBJECTS`) — each its world half, its pass, its WGSL and its DOM half (the note's editor, the calendar's input), the kinds' registry (`DESK_KINDS`), the preset (`DESK_ENGINE`) and the default palette; built on `/desk`, `/desk/kit` and `/desk/engine` alone, exactly as a plugin kind is. |
| `@vibecook/ice/desk/kit` | The render kit a kind is written against: the slot's view and its mat (`MatPass`), the lamp and its light, the shared WGSL by name (`kitWgsl`), a container's inside, the host services a kind is lent (text, print, blobs), the one physics every object shares. |
| `@vibecook/ice/react` | `<Desk>`, `<EngineProvider>`, hooks (`useCommit`, `useWidgetProps`, `useSelected`, `useUndoStatus`, `usePresencePeers`, …), `attachKeymap`, `<SelectionMenu>`. |
| `@vibecook/ice/dom` | Screen space only: the canvas host, the pointer adapter, the rAF loop, input ownership, the cursors, `createDeskHost` — for custom shells without React. |
| `@vibecook/ice/devtools` | `attachDevtools(engine)` — strata's observer + profiler in one draggable dock, and the desk's GPU slot (fed by `/desk`'s `handle.profiler()`). |
| `@vibecook/ice/kernel` | Pure math: coordinates, spatial index, snap, wire geometry, the flight maths. Zero dependencies beyond `rbush`. |

React and `react-dom` are **optional** peer dependencies — the core, desk and dom
entries are React-free; `three` is imported nowhere.

## Limits

Measured, not estimated. The bench source in `packages/core/bench/` is the source
of truth; [`docs/benchmarks.md`](https://github.com/vibefield/infinite-canvas-engine/blob/main/docs/benchmarks.md)
records the full output (Apple M1 Max, 2026-07-15; the sections measured on the deleted
hybrid are marked historical).

**Collaboration is the tightest ceiling — plan shared boards around ~3,000
objects.** A local-only document scales to ~100k, but a collaboratively-edited one
is bounded by how fast a peer applies an incoming edit, which still scales with
document size: roughly **3,000 objects for an actively-editing peer**, **~40,000
for a receive-only one**. Partition large shared boards into containers.

**Scale through containers, not flat boards.** Idle frames no longer scale with the
board (872 µs at 100k entities). Camera gestures still can: nested boards stay cheap
(276–460 µs at 10k, 2.6–4.4 ms at 100k), but a **flat, all-active 100k board costs
40–64 ms per gesture frame** — the honest O(N) ceiling, since nothing can be skipped
when everything is active. Containers let active-scoped queries skip whole chunks.

**Opening a big document is a one-time cost**: full-document projection at attach is
~0.3–0.5 s at 10k rows, ~3.2–3.9 s at 100k. Envelope ≈ 100 B/row.

**Deliberately out of scope** — each has a named extension seam rather than a hidden
TODO: a general layout engine (beyond `ops.arrange`), rich text, comments/threads,
and permissions. strata has no authority model, so multi-user trust is the
application's to own.

**The substrate is pre-1.0**: `@vibecook/strata-ecs` minor versions may break APIs.

[Changelog](https://github.com/vibefield/infinite-canvas-engine/blob/main/CHANGELOG.md)
· MIT © James Yong
