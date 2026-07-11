/**
 * The widget barrel — every card module exports its WidgetType; importing the
 * barrel runs the defineWidget side effects. The App registers `WIDGETS` with
 * createCanvasEngine. Ports land here (tasks 63/64): DOM — Clock, Battery,
 * Calendar, Weather, Stocks, Fitness, Photos, TodoList, DebugResizable;
 * GL — MatteSphere, Crystal, TorusKnot, FloatingCube, GoldKnot, Shapes,
 * OrbitCube; container — CardContainer (task 65).
 */
import type { WidgetType } from "@ice/core";

export const WIDGETS: WidgetType[] = [];
