/**
 * `FloatingCubeWidget` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/FloatingCubeWidget.tsx`).
 *
 * v1 preset: `medium` (329×155). v1 `withCard: false` — rendered WITHOUT card
 * chrome (no background gradient). v3 GL islands have no implicit chrome, so
 * this matches the v1 look directly.
 *
 * Continuous float + spin. v1 `useWidgetAnimation` + `useFrame` →
 * `useIslandFrame`: v1's `dt` (seconds) becomes `dtMs / 1000`, and the two
 * `state.clock.elapsedTime`-driven terms (tilt + vertical bob) accumulate a
 * local elapsed clock. Scene JSX (lights, drei `RoundedBox`, standard
 * material) is verbatim; size comes from the live `Size`.
 */
import { Size, defineWidget, p } from "@ice/core";
import { bakedPreview } from "./baked-preview";
import { type WidgetComponentProps, useWidgetProps, useWorldComponent } from "@ice/react";
import { useIslandFrame } from "@ice/r3f";
import { GlLiftGroup } from "./GlLiftGroup";
import { RoundedBox } from "@react-three/drei";
import { type ReactElement, useRef } from "react";
import type { Group } from "three";

/** v1 `medium` preset. */
export const SIZE = { w: 329, h: 155 } as const;

type CubeProps = { color: string };

function CubeView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<CubeProps>(world, entity, "floating-cube-widget");
  const sz = useWorldComponent(world, entity, Size);
  const groupRef = useRef<Group>(null);
  const elapsed = useRef(0);

  const color = props?.color ?? "#E8523B";
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const g = groupRef.current;
    if (g === null) return;
    const dt = dtMs / 1000;
    elapsed.current += dt;
    g.rotation.y += dt * 0.25;
    g.rotation.x = Math.sin(elapsed.current * 0.4) * 0.18;
    g.position.y = Math.sin(elapsed.current * 0.8) * 3;
  });

  const light = size * 1.8;
  const cubeSize = size * 0.42;

  return (
    <GlLiftGroup world={world} entity={entity}>
      <pointLight
        position={[size * 0.5, size * 0.5, size * 0.8]}
        intensity={200}
        distance={light}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.4, size * 0.2, size * 0.3]}
        intensity={80}
        distance={light}
        decay={1.6}
        color="#FFD4A3"
      />
      <ambientLight intensity={0.3} />
      <group ref={groupRef}>
        <RoundedBox args={[cubeSize, cubeSize, cubeSize]} radius={cubeSize * 0.12} smoothness={4}>
          <meshStandardMaterial color={color} roughness={0.55} metalness={0.1} />
        </RoundedBox>
      </group>
    </GlLiftGroup>
  );
}

export const FloatingCubeWidget = defineWidget({
  type: "floating-cube-widget",
  props: { color: p.string({ default: "#E8523B" }) },
  surface: "gl",
  // Baked-snapshot preview (P1 escape hatch) — P2 replaces with live r3f capture.
  preview: bakedPreview("floating-cube-widget"),
  animated: true,
  component: CubeView,
  sizeMode: "fixed",
  defaultSize: { w: SIZE.w, h: SIZE.h },
  minSize: { w: 200, h: 120 },
  interaction: { solid: true, dragOn: "press", selectable: true, movable: true, snap: "both" },
  provides: ["widget"], // drop-to-consume advertisement — CardContainer accepts ["widget"]
});
