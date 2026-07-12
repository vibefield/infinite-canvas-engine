# ICE — infinite canvas engine

A universal infinite-canvas framework — Figma/Freeform-grade interaction,
real-time collaboration, and a `defineWidget` primitive that turns any React
(or R3F) component into a canvas citizen: selectable, movable, resizable,
wired into a node graph, synced over CRDT, undoable per gesture.

Built on [`@vibecook/strata-ecs`](https://www.npmjs.com/package/@vibecook/strata-ecs):
an archetype ECS with reactivity and opt-in Loro-CRDT durable + ephemeral
(presence) layers.

**npm** [`@vibecook/ice`](https://www.npmjs.com/package/@vibecook/ice) ·
**docs** <https://jamesyong-42.github.io/infinite-canvas-engine/> ·
MIT license

```sh
pnpm add @vibecook/ice react react-dom   # react/react-dom are optional peers
```

```tsx
import { createCanvasEngine, defineWidget, p } from "@vibecook/ice";
import { EngineProvider, InfiniteCanvas, useCommit, useWidgetProps } from "@vibecook/ice/react";

const Sticky = defineWidget({
  type: "sticky",
  surface: "dom",
  props: { text: p.string({ default: "…" }), color: p.enum(["lemon", "mint", "rose"]) },
  component: StickyView,          // a plain React component
  interaction: { resizable: true },
});

function StickyView({ entity, world }) {
  const props = useWidgetProps(world, entity, "sticky");
  const commit = useCommit();     // the sanctioned write path: one tx = one undo step
  return <textarea value={props.text} onChange={(e) =>
    commit((tx) => tx.edit(entity).set(Sticky.groups[0].component, { ...props, text: e.target.value }))
  } />;
}

const engine = createCanvasEngine({ widgets: [Sticky] });
engine.docs.create();             // local-first document; .open()/.join() for load/collab

root.render(
  <EngineProvider engine={engine}>
    <InfiniteCanvas engine={engine} />
  </EngineProvider>,
);
```

## Entry points

One npm package, six entry points (the repo develops them as workspace
packages; `packages/ice` bundles them for publish):

| Entry | Contents | May import |
|---|---|---|
| `@vibecook/ice/kernel` | Pure math: coordinates (THE one Y-flip), snap, spatial index, bezier/anchors, zoom bands, eviction | `rbush` only |
| `@vibecook/ice` | The engine: ECS catalog, frame contract, interaction stack, widget runtime, node graph, nested canvas, doc kit, presence, bootstrap, migrations, `createCanvasEngine` facade | strata-ecs, kernel, loro-crdt |
| `@vibecook/ice/dom` | DOM planes + reflectors (grid, widgets, wires, chrome, cursors), pointer/measure adapters | core, kernel |
| `@vibecook/ice/react` | `<InfiniteCanvas>`, `EngineProvider`, hooks (`useCommit`, `useWidgetProps`, `useSelected`, `useTool`, `useUndoStatus`, `usePresencePeers`), keymap | dom, core, kernel + react/react-dom |
| `@vibecook/ice/r3f` | GL widget islands + virtual-texture compositor, GL pointer router | react + three/@react-three/fiber peers |
| `@vibecook/ice/devtools` | `attachDevtools(engine)` — pointers/recognizers, planes, sovereignty, loop tabs | core only; **nobody imports devtools** |

Import walls are dependency-cruiser-enforced and CI-fatal.

## The architecture in six sentences

1. **Everything is world state.** Pointers, gestures, recognizers, selection,
   camera, ports — all entities/resources in one ECS; there are no closure
   FSMs and no singletons, so devtools and collab see everything.
2. **One frame contract.** `engine.step(now)` = sync → tick (11 fixed phases)
   → publish (presence I/O) → notify (reactivity) → reflect (the ONLY
   DOM/GL writers). Systems never touch output; reflectors never write ECS.
3. **Sovereignty is per-entity, decided at spawn.** Durable entities live in
   the CRDT document; runtime entities die with the session; ephemeral ones
   ride presence. Components stay pure — the spawn path is the class.
4. **Gestures are divergence.** A drag writes runtime cells live under a
   claim; release commits ONE transaction (one undo step). A remote edit to
   the same cell mid-gesture simply wins or loses at commit — divergence is
   the signal, not an error.
5. **Widgets are prefabs.** `defineWidget` compiles props into conflict-group
   components on a durable prefab; views are React portals from one root
   (DOM) or compositor islands (GL); cull ≠ unmount; hidden trees freeze.
6. **Tools are configuration.** A tool parameterizes recognizer spawn, drag
   routing, gates, and cursor — it adds no code paths. Custom behaviors
   register systems through the same extension slot the built-ins use.

## Quick tour

```ts
// --- ops: every app-handler write path (design-005 §4) ---
engine.ops.spawnWidget("sticky", { at: … });   // one tx
engine.ops.deleteSelection();                   // cascade: children + wires
engine.ops.duplicateSelection();                // +16/+16 twins, one undo step
engine.ops.reorder(ids, "top");                 // fractional StackZ
engine.ops.zoomToFit();
engine.ops.setTool("connect");                  // cancels active gestures first
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
  seed: (s) => …,                                  // ran only by the first peer
});

// --- node editor (opt-in per widget) ---
defineWidget({ …, ports: [{ id: "out", side: "e", accepts: ["number"] }] });
// connect tool: drag port → port creates a durable wire (widget + port IDs —
// port entities are runtime-on-demand; panning with the select tool spawns zero).

// --- nested canvas ---
defineWidget({ …, container: { accepts: ["node"] } });
engine.ops.enterContainer(frame);                // camera memory + index rebuild
```

Run the demos: `pnpm --filter graybox|cardboard|glboard|nodeboard|moodboard dev`
(nodeboard/moodboard support `?room=x&relay=ws://localhost:9301` after `pnpm relay`).

## Development

```sh
pnpm install
pnpm run ci        # typecheck + lint + tests (~440) + import walls — the merge gate
```

- Design docs: the reviewed decision record lives in `draft/` (local branch);
  `docs/implementation-plan.md` tracks milestones M0–M10 with exit criteria.
- Every counterintuitive behavior is a cited decision — check the design
  docs before "fixing" it (ports on-demand, stratified z, OS cursor, …).
- Improvement asks against strata-ecs are petitions: `docs/strata-petitions.md`.

## Status

Engine v1 is complete: kernel math, the engine spine, the interaction stack,
durable documents + per-gesture undo, the DOM widget runtime, GL islands, the
node editor, nested canvas, presence + bootstrap + migrations, the facade, and
devtools. The scope fence holds: no layout engine, no rich-text, no comments,
no permissions — each exclusion has a named seam instead.
