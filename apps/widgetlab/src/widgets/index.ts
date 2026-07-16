/**
 * The widget barrel — importing it runs every defineWidget side effect; the
 * App registers `WIDGETS` with createCanvasEngine. 20 types: 8 iOS DOM cards +
 * DebugResizable (dom.ts), 7 GL island cards (gl.ts), the CardContainer
 * folder, and 3 wire-able node cards (nodes.tsx — signal/filter/scope). All
 * cards advertise `provides: ["widget"]`; the container accepts ["widget"]
 * (drop-to-consume + nested canvas ride the engine).
 */
import { CardContainer } from "./CardContainer";
import { DOM_WIDGETS } from "./dom";
import { GL_WIDGETS } from "./gl";
import { NODE_WIDGETS } from "./nodes";
import type { WidgetType } from "@ice/core";

export const WIDGETS: WidgetType[] = [...DOM_WIDGETS, ...GL_WIDGETS, CardContainer, ...NODE_WIDGETS];

export { CardContainer, CARD_CONTAINER_SIZE } from "./CardContainer";
export { CardShell } from "./CardShell";
export * from "./dom";
export * from "./gl";
export * from "./nodes";
