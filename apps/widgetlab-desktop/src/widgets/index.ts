/**
 * The widget barrel — importing it runs every defineWidget side effect; the
 * App registers `WIDGETS` with createCanvasEngine. 21 types: 8 iOS DOM cards +
 * DebugResizable (dom.ts), 7 GL island cards (gl.ts), the CardContainer
 * folder, 3 wire-able node cards (nodes.tsx — signal/filter/scope), and the
 * CommentCard (UE-Blueprint comment; spatial sweep, no provides). All cards
 * advertise `provides: ["widget"]`; the container accepts ["widget"]
 * (drop-to-consume + nested canvas ride the engine).
 */
import { CardContainer } from "./CardContainer";
import { CommentCard } from "./CommentCard";
import { DOM_WIDGETS } from "./dom";
import { GL_WIDGETS } from "./gl";
import { NODE_WIDGETS } from "./nodes";
import type { WidgetType } from "@ice/core";

export const WIDGETS: WidgetType[] = [...DOM_WIDGETS, ...GL_WIDGETS, CardContainer, ...NODE_WIDGETS, CommentCard];

export { CardContainer, CARD_CONTAINER_SIZE } from "./CardContainer";
export { CommentCard } from "./CommentCard";
export { CardShell } from "./CardShell";
export * from "./dom";
export * from "./gl";
export * from "./nodes";
