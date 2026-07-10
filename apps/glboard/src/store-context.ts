/**
 * The demo-local durable-store context, shared by BOTH widget kinds (the DOM
 * `NoteCard` and the GL `spin-cube`). Same pattern as card-board's
 * `CardStoreContext`: the app root wraps the widget layer in a provider carrying
 * `session.store`, and each widget reads it to commit prop edits as one durable,
 * undoable, relayed `store.transaction`.
 *
 * The one wrinkle vs card-board: the provider must sit ABOVE both the DOM
 * `WidgetRoot` AND the GL `<Canvas>`. React context reaches the GL islands
 * because @react-three/fiber v9 bridges the outer (DOM-tree) React context into
 * the Canvas's own reconciler (its-fine `FiberProvider`/`Bridge`), and the
 * island's `createPortal(scene)` preserves context within that tree — so
 * `useContext(StoreContext)` resolves inside `spin-cube`'s R3F content.
 */
import type { DocSession } from "@ice/core";
import { createContext } from "react";

/** The durable store, provided by the app root; null in a bare render (no commits). */
export const StoreContext = createContext<DocSession["store"] | null>(null);
