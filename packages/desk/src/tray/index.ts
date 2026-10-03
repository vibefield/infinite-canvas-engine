// The pegboard tray (design-017; K3) — its pure halves for a host and a rig: the drawer's geometry and curve, the lattice's CPU
// mirror (the cell of a point, the carry), the flux's pins and state, what the pass laid. (The pass itself, its frame inputs and its
// shader set ride ground.ts's exports; the handle's door is host/layer.ts's `DeskTrayDoor`.)
export { band, DRAWER, type DrawerRect, drawerRect, drawerSize, scrollRange, slideEase, type TrayOptions } from "./drawer";
export { carry, cellOf, holeCentre, holeSdf, PEG, type PegCell, type PegPoint, pointAt, punched } from "./lattice";
export type { TrayFacts, TrayFluxState, TrayPin } from "./flux";
export type { TrayLaid } from "./pass";
