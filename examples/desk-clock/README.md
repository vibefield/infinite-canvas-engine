# @ice-examples/desk-clock

A desk kind that is **not ICE's** (design-016 K8b): an analogue desk clock written the way a VibeField plugin kind is — in its
own package, importing ICE only through the umbrella's **published** entries (`@vibecook/ice`, `@vibecook/ice/desk`,
`@vibecook/ice/desk/kit`, `@vibecook/ice/desk/engine`). `test/imports.test.ts` and the dependency-cruiser rule
`examples-import-only-the-published-entries` fail on anything else, and `pnpm --filter @ice-examples/desk-clock dts:check` (the
last step of `gate:landing`, after `pack:audit` builds the umbrella) compiles it against the umbrella's BUILT `.d.ts` with
`skipLibCheck: false` and holds every name it imports to a declaration there. It is never published.

| seam | what the clock declares |
|---|---|
| its own WGSL | `src/shaders.ts` — the case, the dial's printing (Roman numerals and a stroke font of its own), faceted hands with their shadows, the glass's glint, the lume; lit by the kit's light (`kitWgsl(["view", "portal", "sdf", "light"])`) by day and night |
| its pass | `src/pass.ts` — instanced, a persistent record store, the slot's one view block bound, never written |
| durable props | `style` · `ring24` · `seconds` · `zone` (one group, one transaction per change) — the time itself is the host's clock (flux) |
| a registered wake | `src/local.ts` — `due` is the wall clock's next second (or minute) a drawn clock needs; nothing is polled |
| a tray entry | a clock on a hook (`tray`), showing the shop's 10:10:30 |
| a menu act | `desk-clock.seconds` (`defineObject({ menu })`), its own glyph |
| an opening | picked up, its held tools set it (seconds, 24-hour ring, zone ±1 h, the next dial), each glyph its own (`{ path }`) |
| a word in hand | `open.readout` (petition I22): the time its hands show — "10:08:42", to the minute without its seconds hand, 24-hour on its ring (`clockWord`) — on the selection's anchor as `held.readout` |
| a container's chip | a disc of its dial in the paper finish (`chip`) — it provides `CONTAINABLE` |
| its pick | its round face (`hit`) — the rect's corners are not the clock's |

An app registers it beside the reference kinds:

```ts
import { DESK_CLOCK_OBJECTS } from "@ice-examples/desk-clock";
const engine = createCanvasEngine({ ...DESK_ENGINE, widgets: [...DESK_ENGINE.widgets, ...DESK_CLOCK_OBJECTS] });
```

A still pins its time through the handle's generic door: `handle.pinAsset(entity, { at: epochMs })`.
