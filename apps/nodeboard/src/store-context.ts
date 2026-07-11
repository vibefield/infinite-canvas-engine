/**
 * The demo-local React contexts every node view reads.
 *
 * `StoreContext` carries `session.store` (same pattern as glboard/cardboard): a
 * node commits prop edits — e.g. math-node's value bump — as one durable,
 * undoable, relayed `store.transaction`.
 *
 * `NavContext` carries the nested-canvas ops so a `group-node` view can enter
 * itself on double-click without the app threading a callback prop through the
 * widget runtime's portal layer.
 */
import type { DocSession, Entity } from "@ice/core";
import { createContext } from "react";

/** The durable store, provided by the app root; null in a bare render (no commits). */
export const StoreContext = createContext<DocSession["store"] | null>(null);

export interface NavApi {
  enter(container: Entity): void;
  exit(): void;
}

/** Nested-canvas ops for container views (double-click to enter). */
export const NavContext = createContext<NavApi | null>(null);
