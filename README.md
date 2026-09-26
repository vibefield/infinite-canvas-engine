# ICE — infinite canvas engine

A universal infinite-canvas framework — Figma/Freeform-grade interaction,
real-time collaboration, and THE DESK: every object under the camera drawn by
one WebGPU renderer from a CRDT-synced ECS world, the DOM in screen space.
`defineObject` turns a GPU object kind into a canvas citizen: selectable,
movable, resizable, nested in mini mats, synced over CRDT, undoable per gesture.

Built on [`@vibecook/strata-ecs`](https://www.npmjs.com/package/@vibecook/strata-ecs):
an archetype ECS with reactivity and opt-in Loro-CRDT durable + ephemeral
(presence) layers.

**npm** [`@vibecook/ice`](https://www.npmjs.com/package/@vibecook/ice) ·
**docs** <https://vibefield.github.io/infinite-canvas-engine/> ·
MIT license

> **design-015 — the desk (2026-09-25/26).** ICE 0.14.0 (the `[Unreleased]` section of the
> changelog; the release cut is pending) deleted the DOM/R3F widget hybrid: no `three`, no
> presentation profiles, no React widget faces, one app. `<InfiniteCanvas>` became `<Desk>`; a
> widget's face is its `object` kind. The published 0.11.0 and the 0.13.0 git release point still
> describe the old surface — the break list, export by export, is `CHANGELOG.md › ### Removed`.

```sh
pnpm add @vibecook/ice react react-dom   # react/react-dom are optional peers
```

```tsx
import { createCanvasEngine } from "@vibecook/ice";
import { deskLayer, penFaces, inkRaster } from "@vibecook/ice/desk";
import { DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import { Desk, EngineProvider } from "@vibecook/ice/react";
import { deskPalette, deskTheme } from "./palette";   // the app's theme + palette (apps/desk/src/palette.ts is the model)

// The engine knows the desk's object kinds — the note, the mini mat, the notebook,
// the whiteboard, the calendar, the photo print — as widget types.
const engine = createCanvasEngine({ widgets: [...DESK_OBJECTS] });
engine.docs.create();                     // local-first document; .open()/.join() for load/collab

// The desk arrives as an OPAQUE layer factory: the renderer, its kinds, the theme,
// the text raster the notes are written with, the document the typing commits into.
const layer = deskLayer({
  theme: deskTheme("light"), palette: deskPalette("light"),
  objects: [...DESK_OBJECTS], docs: engine.docs,
  text: inkRaster({ faces: penFaces({ caveat: caveatUrl, "caveat-bold": caveatBoldUrl, kalam: kalamUrl }) }),   // the hands' fonts by URL (apps/desk/assets/fonts)
});

root.render(
  <EngineProvider engine={engine}>
    <Desk engine={engine} layer={layer} />   {/* memoize `layer`: a new identity re-boots the mount */}
  </EngineProvider>,
);
engine.ops.spawnWidget("desk.note", { x: 120, y: 120, props: { text: "hello" } });
```

`apps/desk/src/App.tsx` is the worked example (the keys, the selection menu, the
room, the dev panel); `defineObject` (`@vibecook/ice/desk`) is how a new kind
joins: a program that draws its records, a CPU mirror that answers "what is
under this point", and the behaviours that change it (design-015 §5).

## Entry points

One npm package, eight entry points (the repo develops them as workspace
packages; `packages/ice` bundles them for publish):

| Entry | Contents | May import |
|---|---|---|
| `@vibecook/ice/kernel` | Pure math: coordinates (THE one Y-flip), snap, spatial index, bezier/anchors, the design-006 flight, easings, layout | `rbush` only |
| `@vibecook/ice` | The engine: ECS catalog, frame contract, interaction stack, the widget compiler (`defineWidget` with the `object` binding), the cull, node graph, nested canvas, doc kit, presence, bootstrap, migrations, `createCanvasEngine` facade | strata-ecs, kernel, loro-crdt |
| `@vibecook/ice/dom` | SCREEN SPACE ONLY: the canvas host, the pointer adapter (L0's producer), the rAF loop, input ownership + the editor's focus, OS + remote cursors, `createDeskHost` (the vanilla mount) | core, kernel |
| `@vibecook/ice/desk` | The desk: one WebGPU renderer drawing every object from the world — the cutting mat, `deskLayer`, `defineObject`, the kind registry, the one focused editor, the text raster, the theme | core, kernel; **nobody imports desk but apps** |
| `@vibecook/ice/desk/engine` | The raw-WebGPU engine alone (device, surface, passes) | — |
| `@vibecook/ice/desk/objects` | The six reference object kinds' world halves: note · mini mat · notebook · whiteboard · calendar · photo | core, kernel |
| `@vibecook/ice/react` | `<Desk>`, `EngineProvider`, hooks (`useCommit`, `useWidgetProps`, `useSelected`, `useTool`, `useUndoStatus`, `usePresencePeers`), keymap, the screen-space selection menu and held bar | dom, core, kernel + react/react-dom |
| `@vibecook/ice/devtools` | `attachDevtools(engine)` — strata's observer + profiler in one dock | core only; **nobody imports devtools** |

Import walls are dependency-cruiser-enforced and CI-fatal; **`three` is
imported nowhere** (`no-three`).

## The architecture in six sentences

1. **Everything is world state.** Pointers, gestures, recognizers, selection,
   camera, ports — all entities/resources in one ECS; there are no closure
   FSMs and no singletons, so devtools and collab see everything.
2. **One frame contract.** `engine.step(now)` = sync → tick (11 fixed phases)
   → publish (presence I/O) → notify (reactivity) → reflect (the ONLY
   DOM/GPU writers). Systems never touch output; reflectors never write ECS.
3. **Sovereignty is per-entity, decided at spawn.** Durable entities live in
   the CRDT document; runtime entities die with the session; ephemeral ones
   ride presence. Components stay pure — the spawn path is the class.
4. **Gestures are divergence.** A drag writes runtime cells live under a
   claim; release commits ONE transaction (one undo step). A remote edit to
   the same cell mid-gesture simply wins or loses at commit — divergence is
   the signal, not an error.
5. **Widgets are prefabs; their faces are kinds.** `defineWidget` compiles props
   into conflict-group components on a durable prefab; the desk renderer draws
   every object from the world in ONE pass, from the kind bound to its type;
   `Visible`/`Culled` is the renderer's working set; a quiet desk submits nothing.
6. **Tools are configuration.** A tool parameterizes recognizer spawn, drag
   routing, gates, and cursor — it adds no code paths. Custom behaviors
   register systems through the same extension slot the built-ins use.

## Quick tour

```ts
// --- ops: every app-handler write path (design-005 §4) ---
engine.ops.spawnWidget("desk.note", { x, y, props });   // one tx ({undoable:false} for seeds)
engine.ops.deleteSelection();                   // cascade: children + wires
engine.ops.duplicateSelection();                // +16/+16 twins, one undo step
engine.ops.reorder(ids, "top");                 // sibling order (ordered ChildOf)
engine.ops.zoomToFit();
engine.ops.setTool("connect");                  // cancels active gestures first
engine.ops.open(entity);                        // pick an openable object up into the hand (design-015 §8)
engine.docs.undo();                             // per-gesture; restores selection

// --- documents (local-first; collab is a posture, not a mode) ---
const session = engine.docs.create();
const bytes = session.exportEnvelope();          // versioned ICE1 envelope
engine.docs.open(bytes);                         // gate: ok | readOnly | migrate | reject
engine.docs.autosave(storage);                   // debounced, gesture-deferred, quarantining

// --- collab: the app moves bytes, the engine owns the protocol ---
import { webSocketByteChannel } from "@vibecook/ice";
await engine.docs.join(webSocketByteChannel(ws), {
  presence: { name: "James", color: "#4f8ef7" },  // cursors + selection summaries
});                                               // ⇒ { role: "seeder" | "joiner", session, leave }
// role === "seeder" ⇒ this peer arrived first — seed the board via ops({undoable:false})

// --- node editor (opt-in per widget) ---
defineWidget({ …, ports: [{ id: "out", side: "e", accepts: ["number"] }] });
// connect tool: drag port → port creates a durable wire (widget + port IDs —
// port entities are runtime-on-demand; panning with the select tool spawns zero).

// --- nested canvas: the mini mat is the container ---
engine.ops.enterContainer(mat);                  // the design-006 flight; camera memory + index rebuild
```

Run the showcase: `pnpm --filter desk dev` (`?room=x` shares a desk between two
tabs over BroadcastChannel; `&relay=ws://localhost:9301` after `pnpm relay`
shares it between machines; the backtick opens the dev panel).

## Limits

Measured, not estimated. The bench source in `packages/core/bench/` is the
source of truth; [`docs/benchmarks.md`](docs/benchmarks.md) records the full
output (Apple M1 Max, 2026-07-15; the sections measured on the deleted hybrid
are marked historical there).

**Collaboration is the tightest ceiling — plan shared boards around ~3,000
objects.** A local-only document scales to ~100k, but a collaboratively-edited
one is bounded by how fast a peer applies an incoming edit, which still scales
with document size: roughly **3,000 objects for an actively-editing peer**,
**~40,000 for a receive-only one**. Partition large shared boards into containers.

**Scale through containers, not flat boards.** Idle frames no longer scale with
the board (872 µs at 100k entities, down from 25 ms before the churn gates).
Camera gestures still can: nested boards stay cheap (276–460 µs at 10k,
2.6–4.4 ms at 100k), but a **flat, all-active 100k board costs 40–64 ms per
gesture frame** — the honest O(N) ceiling, since nothing can be skipped when
everything is active. Containers let active-scoped queries skip whole chunks.
The desk's own performance gates (idle-zero submits, an O(1) pan over 1,000
objects, 120 fps) are design-015 §11.4 — measured at D6, after the deletion.

**Opening a big document is a one-time cost**: full-document projection at
attach is ~0.3–0.5 s at 10k rows, ~3.2–3.9 s at 100k. Envelope ≈ 100 B/row.

**Deliberately out of scope** — each has a named extension seam rather than a
hidden TODO: a general layout engine (beyond `ops.arrange`), rich text (the
note's text is one durable string cell, design-015 D-D13), comments/threads,
and permissions. strata has no authority model, so multi-user trust is the
application's to own.

**Not yet on the desk**: the string between objects (a wires pass — no desk
kind declares a port yet), a peer's nav frame in presence, the §11.4
performance gates (D6).

**The substrate is pre-1.0**: `@vibecook/strata-ecs` minor versions may break
APIs, and this repo tracks them closely (eight releases absorbed to date).

## Development

```sh
pnpm install
pnpm run ci            # typecheck + lint + tests + import walls + gen:check — the merge gate
pnpm run gate:landing  # the pixel gate: the desk's Dawn oracle → the apps/desk build → its twelve rigs → pack:audit
```

`ci` is the merge gate; `gate:landing` is required at every landing and is kept out
of `ci` because its oracle needs Dawn (design-013 D-C4.11, design-015 D1). The rigs
drive headless Chrome against the oracle's bytes (`rig:parity`: maxΔ 0 per scene).

- Design docs: the reviewed decision record lives in `draft/` (local branch);
  `docs/implementation-plan.md` tracks milestones M0–M20 with exit criteria.
- Every counterintuitive behavior is a cited decision — check the design
  docs before "fixing" it (ports on-demand, sibling order, OS cursor, …).
- Improvement asks against strata-ecs are petitions: `docs/strata-petitions.md`.
- Release notes: [`CHANGELOG.md`](CHANGELOG.md).

## Status

**On npm: 0.11.0.** 0.12.0 and 0.13.0 are git release points, not published;
0.14.0 — the desk — is `[Unreleased]` in the changelog, its version bump and
publish being the release cut. Documents written by 0.1.0 migrate automatically
on open (schema 2 — ordered `ChildOf` replaces scalar z); a 0.1.0 build opening
a migrated document still gets a correct read-only view.

Engine v1 is complete (kernel math, the engine spine, the interaction stack,
durable documents + per-gesture undo, the node editor, nested canvas, presence +
bootstrap + migrations, the facade, devtools); the behavior framework train
(M11–M16), the magnet grid (M17), the compositor and the ground port (M18–M19)
followed; M20 — the desk — replaced the DOM/GL presentation whole (design-015).
The scope fence holds: no layout engine, no rich-text, no comments, no
permissions — each exclusion has a named seam instead.
