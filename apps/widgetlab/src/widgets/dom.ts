/**
 * The DOM-widget barrel (task 63). Importing it runs each module's
 * `defineWidget` side effect (registration) and collects the WidgetTypes for
 * the app to hand to `createCanvasEngine`. Card sizes are NOT part of
 * `defineWidget` — each module exports its v1 iOS preset (`*_SIZE`) and the app
 * seeds `Size` at spawn. `DebugResizable` is the freeform resize surface (no
 * preset; `interaction.resizable`).
 */
import type { WidgetType } from "@ice/core";
import { BatteryCard } from "./BatteryCard";
import { CalendarCard } from "./CalendarCard";
import { ClockCard } from "./ClockCard";
import { DebugResizable } from "./DebugResizable";
import { FitnessCard } from "./FitnessCard";
import { PhotosCard } from "./PhotosCard";
import { StocksCard } from "./StocksCard";
import { TodoListCard } from "./TodoListCard";
import { WeatherCard } from "./WeatherCard";

export const DOM_WIDGETS: WidgetType[] = [
  ClockCard,
  BatteryCard,
  CalendarCard,
  WeatherCard,
  StocksCard,
  FitnessCard,
  PhotosCard,
  TodoListCard,
  DebugResizable,
];
