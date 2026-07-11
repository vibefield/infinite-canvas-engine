/**
 * The widget barrel — importing it runs every defineWidget side effect; the
 * App registers `WIDGETS` with createCanvasEngine. 17 types: 8 iOS DOM cards +
 * DebugResizable (dom.ts), 7 GL island cards (gl.ts), and the CardContainer
 * folder. All cards advertise `provides: ["widget"]`; the container accepts
 * ["widget"] (drop-to-consume + nested canvas ride the engine).
 */
import { CardContainer } from "./CardContainer";
import { DOM_WIDGETS } from "./dom";
import { GL_WIDGETS } from "./gl";
import type { WidgetType } from "@ice/core";

export const WIDGETS: WidgetType[] = [...DOM_WIDGETS, ...GL_WIDGETS, CardContainer];

export { CardContainer, CARD_CONTAINER_SIZE } from "./CardContainer";
export { CardShell } from "./CardShell";
export * from "./dom";
export * from "./gl";
