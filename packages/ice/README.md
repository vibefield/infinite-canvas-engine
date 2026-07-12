# @vibecook/ice

**ICE — infinite canvas engine.** Figma-grade infinite-canvas UX as a framework:
`defineWidget` turns React (or React-Three-Fiber) components into canvas
citizens — selectable, movable, resizable, snappable, wired into node graphs,
synced over CRDT, undoable per gesture.

Built on [`@vibecook/strata-ecs`](https://www.npmjs.com/package/@vibecook/strata-ecs):
an archetype ECS with reactivity and opt-in Loro-CRDT durable + presence layers.

**Docs:** <https://jamesyong-42.github.io/infinite-canvas-engine/> ·
**Source:** <https://github.com/jamesyong-42/infinite-canvas-engine>

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
engine.ops.spawnWidget("sticky", { at: { x: 120, y: 120 } });
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
| `@vibecook/ice/devtools` | `attachDevtools(engine)` — live pointers/gestures, planes, sovereignty, and loop tabs. |
| `@vibecook/ice/kernel` | Pure math: coordinates, spatial index, snap, wire geometry, zoom bands. Zero dependencies beyond `rbush`. |

React, `react-dom`, `three`, and `@react-three/fiber` are **optional** peer
dependencies — install only what your surfaces use. The core entry is fully
headless.

MIT © James Yong
