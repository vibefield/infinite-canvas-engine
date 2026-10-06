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

## Its still (petition I30)

The first third-party still through the published door: `test/still.ts` lays three dials (classic in UTC, the station dial with its
24-hour ring in +09:00, the graphite without seconds in −05:00) through `createStill` (`@vibecook/ice/desk`) — a world of the
clock's own, staged by `engine.ops.spawnWidget`, each dial's hands stood at the oracle's hour by `pinAsset({ at })` — and
`test/still.dawn.test.ts` draws it on Dawn (the `webgpu` package, `acquire` from `@vibecook/ice/desk/engine`) by day and by night and
holds each still to `test/still.golden.json` (its size and the sha-256 of its RGBA), counts each dial's face against the bare mat,
and reads the device's memory ledger back at zero. `pnpm --filter @ice-examples/desk-clock still` runs it (each still lands in
`results/<name>.png`); `STILL_BLESS=1` re-blesses — a deliberate event. It is not part of `test` (CI runs no Dawn): `gate:landing`
runs it right after the oracle, and `dts:check` compiles `test/still.ts` against the umbrella's built declarations — beside
`test/held.types.ts` (petition I36), the names a host reads off the selection anchor (`HeldAnchor`, `HeldSlot`, `HeldGlyph`).

## The fault fixture (petition I24)

`src/broken.ts` is the clock broken ON PURPOSE, the ways a plugin's kind breaks — what ICE's containment per kind is held to:
`brokenClockKind({ wgsl?, recordFrom?, hit?, name? })` (its WGSL names `BROKEN_WGSL_TOKEN`, which nothing declares — the compiler
refuses it; its `record` throws from the `recordFrom`th call on; its `hit` throws), and two objects of their own beside the clock —
`DeskClockBroken` (refused at create: the desk boots without its kind and draws its objects as the missing face, `status().faults`
naming it) and `DeskClockFaulty` (its record throws from its third frame: three strikes and the desk quarantines it, said once) —
`BROKEN_CLOCK_OBJECTS`. ICE's units register it, the oracle draws a refused one (`fault-missing-z1`), `rig:clock` boots
`rig.html?plugins&broken`, and VibeField's playground v2 registers it as its fault fixture (DK-7). `test/broken.test.ts` holds it
to breaking exactly as it says.
