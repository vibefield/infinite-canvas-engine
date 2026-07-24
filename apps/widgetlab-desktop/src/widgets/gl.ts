/**
 * GL (R3F) widget barrel — the 7 gl-surface cards ported from the v1 playground
 * (task 64). Importing this module runs each `defineWidget` side effect
 * (registration). The app-level barrel (`./index.ts`, lead-owned) re-exports
 * `GL_WIDGETS` alongside the DOM cards; nothing here edits `index.ts`.
 */
import type { WidgetType } from "@ice/core";
import { CrystalWidget } from "./CrystalWidget";
import { FloatingCubeWidget } from "./FloatingCubeWidget";
import { GoldKnotCard } from "./GoldKnotCard";
import { MatteSphereCard } from "./MatteSphereCard";
import { OrbitCubeCard } from "./OrbitCubeCard";
import { ShapesCard } from "./ShapesCard";
import { TorusKnotCard } from "./TorusKnotCard";

export const GL_WIDGETS: WidgetType[] = [
  MatteSphereCard,
  CrystalWidget,
  TorusKnotCard,
  FloatingCubeWidget,
  GoldKnotCard,
  ShapesCard,
  OrbitCubeCard,
];
