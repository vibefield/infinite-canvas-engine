/**
 * `GoldKnotCard` — GL (R3F) card ported from the v1 playground
 * (`apps/playground/src/widgets/GoldKnotCard.tsx`).
 *
 * v1 preset: `large` (329×345). v1 `withCard: true` (card chrome), background
 * `linear-gradient(135deg, #4A2814 0%, #2A0E12 60%, #14080C 100%)`. v3 GL
 * islands have no implicit chrome — the lead decides chrome at integration.
 *
 * Continuous spin + tilt. v1 `useWidgetAnimation` + `useFrame` →
 * `useIslandFrame` (`dt` seconds → `dtMs / 1000`; the tilt term accumulates a
 * local elapsed clock in place of `state.clock.elapsedTime`).
 *
 * LIGHTING ADAPTATION (no v3 equivalent for v1's IBL): the v1 card carried
 * only an `ambientLight` and relied on the InfiniteCanvas r3fRoot's shared
 * environment map (propagated to every widget scene by the v1 Compositor) to
 * light a fully-metallic (`metalness: 1`) surface. v3 islands are private
 * scenes with NO shared environment, so a metal knot lit by ambient alone
 * renders nearly black. The MATERIAL is ported verbatim (metalness/roughness/
 * clearcoat/envMapIntensity unchanged); the ambient is kept; and a two-point
 * "studio" rig is ADDED so the metal shows specular highlights. It will still
 * read darker/less reflective than v1 until an island `<Environment>`/IBL
 * exists. Flagged in the port report.
 */
import { Size, defineWidget, p } from "@ice/core";
import { type WidgetComponentProps, useWidgetProps, useWorldComponent } from "@ice/react";
import { useIslandFrame } from "@ice/r3f";
import { type ReactElement, useRef } from "react";
import type { Mesh } from "three";

/** v1 `large` preset. */
export const SIZE = { w: 329, h: 345 } as const;

type GoldKnotMetal = "gold" | "chrome" | "copper";
type GoldKnotProps = { metal: GoldKnotMetal };

const METALS: Record<GoldKnotMetal, { color: string; roughness: number }> = {
  gold: { color: "#F5CE6E", roughness: 0.12 },
  chrome: { color: "#E8E8EE", roughness: 0.05 },
  copper: { color: "#D97B46", roughness: 0.18 },
};

function GoldKnotView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<GoldKnotProps>(world, entity, "gold-knot-card");
  const sz = useWorldComponent(world, entity, Size);
  const meshRef = useRef<Mesh>(null);
  const elapsed = useRef(0);

  const metal = METALS[props?.metal ?? "gold"];
  const width = sz?.w ?? SIZE.w;
  const height = sz?.h ?? SIZE.h;
  const size = Math.min(width, height);

  useIslandFrame((dtMs) => {
    const m = meshRef.current;
    if (m === null) return;
    const dt = dtMs / 1000;
    elapsed.current += dt;
    m.rotation.y += dt * 0.4;
    m.rotation.x = Math.sin(elapsed.current * 0.5) * 0.2;
  });

  const light = size * 2.2;

  return (
    <group>
      {/* v1 lit this scene from the canvas-root IBL environment; v3 islands
          have no shared env, so an explicit rig replaces it (see module note). */}
      <ambientLight intensity={0.15} />
      <pointLight
        position={[size * 0.5, size * 0.5, size * 0.7]}
        intensity={240}
        distance={light}
        decay={1.4}
        color="#FFFFFF"
      />
      <pointLight
        position={[-size * 0.5, -size * 0.3, size * 0.5]}
        intensity={120}
        distance={light}
        decay={1.6}
        color="#FFE7C2"
      />
      <mesh ref={meshRef} position={[0, 0, 6]}>
        <torusKnotGeometry args={[size * 0.18, size * 0.055, 220, 40]} />
        <meshPhysicalMaterial
          color={metal.color}
          roughness={metal.roughness}
          metalness={1}
          clearcoat={0.8}
          clearcoatRoughness={0.05}
          envMapIntensity={1.4}
        />
      </mesh>
    </group>
  );
}

export const GoldKnotCard = defineWidget({
  type: "gold-knot-card",
  props: { metal: p.enum(["gold", "chrome", "copper"], { default: "gold" }) },
  surface: "gl",
  animated: true,
  component: GoldKnotView,
  sizeMode: "fixed",
  defaultSize: { w: SIZE.w, h: SIZE.h },
  minSize: { w: 240, h: 200 },
  interaction: { selectable: true, movable: true },
  provides: ["widget"], // drop-to-consume advertisement — CardContainer accepts ["widget"]
});
