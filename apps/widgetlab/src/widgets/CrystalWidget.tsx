/**
 * `CrystalWidget` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/CrystalWidget.tsx`).
 *
 * v1 preset: `small` (155×155). v1 `withCard: false` — rendered WITHOUT card
 * chrome (no background gradient). v3 GL islands have no implicit chrome, so
 * this matches the v1 look directly.
 *
 * Continuous animation. v1 `useWidgetAnimation(entityId, true)` +
 * `useFrame` → v3 `useIslandFrame` (the only path that drives island repaints;
 * plain useFrame in a portal can't be attributed to an island). Two required
 * adaptations to the frame math: (a) `useIslandFrame` hands back `dtMs`
 * (milliseconds), whereas v1's useFrame `dt` was seconds — converted via
 * `dtMs / 1000`; (b) there is no `state.clock`, so the idle-bob's elapsed time
 * is accumulated locally. Scene JSX (lights, icosahedron, physical material)
 * is verbatim; size comes from the live `Size` instead of render props.
 */
import { Size, defineWidget, p } from "@ice/core";
import { type WidgetComponentProps, useWidgetProps, useWorldComponent } from "@ice/react";
import { useIslandFrame } from "@ice/r3f";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

/** v1 `small` preset. */
export const SIZE = { w: 155, h: 155 } as const;

type CrystalProps = { tint: string };

function CrystalView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<CrystalProps>(world, entity, "crystal-widget");
  const sz = useWorldComponent(world, entity, Size);
  const meshRef = useRef<Mesh>(null);
  const elapsed = useRef(0);

  const tint = props?.tint ?? "#9AE5FF";
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const m = meshRef.current;
    if (m === null) return;
    const dt = dtMs / 1000;
    elapsed.current += dt;
    m.rotation.y += dt * 0.4;
    m.rotation.x += dt * 0.15;
    // Gentle idle bob.
    m.position.y = Math.sin(elapsed.current * 0.8) * 2;
  });

  const lightDistance = size * 2;

  return (
    <group>
      <pointLight
        position={[size * 0.3, size * 0.4, size * 0.6]}
        intensity={180}
        distance={lightDistance}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.3, -size * 0.3, size * 0.3]}
        intensity={80}
        distance={lightDistance}
        decay={1.6}
        color="#CBDFFF"
      />
      <ambientLight intensity={0.4} />
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[size * 0.3, 0]} />
        <meshPhysicalMaterial
          color={tint}
          roughness={0.08}
          transmission={0.85}
          thickness={1.2}
          ior={1.45}
          clearcoat={1}
          clearcoatRoughness={0.05}
          attenuationDistance={2.5}
          attenuationColor={tint}
        />
      </mesh>
    </group>
  );
}

export const CrystalWidget = defineWidget({
  type: "crystal-widget",
  props: { tint: p.string({ default: "#9AE5FF" }) },
  surface: "gl",
  animated: true,
  component: CrystalView,
  sizeMode: "fixed",
  defaultSize: { w: SIZE.w, h: SIZE.h },
  minSize: { w: 120, h: 120 },
  interaction: { solid: true, dragOn: "longPress", selectable: true, movable: true },
  provides: ["widget"], // drop-to-consume advertisement — CardContainer accepts ["widget"]
});
