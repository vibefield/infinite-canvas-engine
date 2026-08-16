# @vibecook/ice

**ICE — infinite canvas engine.** Figma-grade infinite-canvas UX as a framework:
`defineWidget` turns React (or React-Three-Fiber) components into canvas
citizens — selectable, movable, resizable, snappable, wired into node graphs,
synced over CRDT, undoable per gesture.

Built on [`@vibecook/strata-ecs`](https://www.npmjs.com/package/@vibecook/strata-ecs):
an archetype ECS with reactivity and opt-in Loro-CRDT durable + presence layers.

**Docs:** <https://vibefield.github.io/infinite-canvas-engine/> ·
**Source:** <https://github.com/vibefield/infinite-canvas-engine>

```sh
pnpm add @vibecook/ice react react-dom     # react/react-dom are optional peers
```

```tsx
import { createCanvasEngine, defineWidget, p } from "@vibecook/ice";
import { EngineProvider, InfiniteCanvas, attachKeymap, useCommit, useWidgetProps } from "@vibecook/ice/react";
import { createRoot } from "react-dom/client";

const Sticky = defineWidget({
  type: "sticky",
  surface: "dom",
  props: { text: p.string({ default: "Write something…" }) },
  component: StickyView,
  defaultSize: { w: 220, h: 160 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
});

function StickyView({ entity, world }) {
  const props = useWidgetProps(world, entity, "sticky");
  const commit = useCommit(); // one commit call = one undo step, synced to every peer
  return (
    <textarea
      value={props.text}
      onChange={(e) => commit((tx) => tx.edit(entity).set(Sticky.groups[0].component, { text: e.target.value }))}
    />
  );
}

const engine = createCanvasEngine({ widgets: [Sticky] });
engine.docs.create(); // a local-first document
engine.ops.spawnWidget("sticky", { x: 120, y: 120 });
attachKeymap(engine); // ⌫ · ⌘Z · ⌘D · ⌘A · Esc · arrows · v/h/c

createRoot(document.getElementById("root")).render(
  <EngineProvider engine={engine}>
    <InfiniteCanvas engine={engine} />
  </EngineProvider>,
);
```

Everything above ships working out of the box: click/shift-click selection,
marquee, drag with snap guides, eight resize handles, wheel pan + anchored
zoom, containers with consume/fly-back, a node editor (ports + wires),
per-gesture undo, gesture-aware autosave, and live presence when you
`docs.join()` a room.

## Entry points

| Import | Contents |
| --- | --- |
| `@vibecook/ice` | The headless engine: `createCanvasEngine`, `defineWidget`, `defineTool`, `definePrefab`, the props DSL `p`, the doc kit, presence, and the full ECS vocabulary. |
| `@vibecook/ice/react` | `<InfiniteCanvas>`, `<EngineProvider>`, hooks (`useCommit`, `useWidgetProps`, `useSelected`, `useUndoStatus`, `usePresencePeers`, …), `attachKeymap`. |
| `@vibecook/ice/r3f` | GL widget islands + virtual-texture compositor, `<GLViews>`, `useIslandFrame`, the GL pointer router. Peers: `three`, `@react-three/fiber`. |
| `@vibecook/ice/dom` | DOM planes, adapters, and reflectors — for custom shells without React. |
| `@vibecook/ice/ground` | The P0 ground stratum as one WebGPU canvas (grid, wires, snap guides) with automatic WebGL2 fallback. Passed to `<InfiniteCanvas ground={…}>`. Peer: `three`. |
| `@vibecook/ice/devtools` | `attachDevtools(engine)` — live pointers/gestures, planes, sovereignty, and loop tabs. |
| `@vibecook/ice/kernel` | Pure math: coordinates, spatial index, snap, wire geometry, zoom bands. Zero dependencies beyond `rbush`. |

React, `react-dom`, `three`, and `@react-three/fiber` are **optional** peer
dependencies — install only what your surfaces use. The core entry is fully
headless.

## Limits

Measured, not estimated. The bench source in `packages/core/bench/` is the source
of truth; [`docs/benchmarks.md`](https://github.com/vibefield/infinite-canvas-engine/blob/main/docs/benchmarks.md)
records the full output (Apple M1 Max, 2026-07-15).

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

**Not yet built**: an engine-level focus model for widget keyboard exclusivity and
wheel/scroll opt-out. Native form controls already work — the keymap ignores
keystrokes targeting an `input`, `textarea`, `select`, or `contenteditable` — but a
widget wanting arrow keys or its own scrolling has no engine contract yet.

**The substrate is pre-1.0**: `@vibecook/strata-ecs` minor versions may break APIs.

[Changelog](https://github.com/vibefield/infinite-canvas-engine/blob/main/CHANGELOG.md)
· MIT © James Yong
