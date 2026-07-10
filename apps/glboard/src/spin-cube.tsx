/**
 * The `spin-cube` widget — gl-board's GL-surface widget, the M7 demo's proof
 * that a `defineWidget({ surface: "gl" })` island renders into the virtual-
 * texture compositor AND takes pointer input on its internals (design-004
 * §3 animation contract, §4 router GL path).
 *
 * Island-local space (kernel convention, Law 13): origin CENTER, Y-up, world
 * units — a 200×200 widget spans x,y ∈ [-100, 100]. The camera/frustum is
 * written by the frame pass from the live `Size`; content just fills that box.
 *
 * Two M7 exits meet here:
 *  - ANIMATION: the cube spins only while `props.spinning`. Repaints are driven
 *    by `useIslandFrame` — which holds the island's animation signal (turns it
 *    Hot) FOR AS LONG AS IT IS SUBSCRIBED. A ref that early-returns would keep
 *    the island Hot forever (still repainting every frame, just not rotating).
 *    So spinning is gated at the MOUNT level: `{spinning && <Spinner/>}`. When
 *    the prop flips false the Spinner unmounts, `useIslandFrame` unsubscribes,
 *    the anim ref drops, and the island parks — zero repaints until the next
 *    invalidation.
 *  - INTERACTIVE INTERNALS: `onPointerDown` on the cube mesh `stopPropagation()`s
 *    (claims the tap so no canvas drag starts) and toggles `spinning` via a
 *    durable `store.transaction` — the SAME commit path as the DOM `NoteCard`,
 *    reached through {@link StoreContext} (bridged into the Canvas by R3F v9).
 *    The backdrop ring carries NO handler, so the rest of the widget surface
 *    stays canvas-draggable: grab the card anywhere but the cube to move it.
 */
import { defineWidget, p } from "@ice/core";
import { useSelected, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { useIslandFrame } from "@ice/r3f";
import { type ReactElement, type RefObject, useCallback, useContext, useRef } from "react";
import type { Mesh } from "three";
import { StoreContext } from "./store-context";

type SpinProps = { color: string; spinning: boolean };

/**
 * Mounted only while spinning — subscribing IS the "keep the island Hot" signal
 * (see the module note). `dtMs` is real elapsed ms on each paint (design-004 §3).
 */
function Spinner({ meshRef }: { meshRef: RefObject<Mesh | null> }): null {
  useIslandFrame((dt) => {
    const m = meshRef.current;
    if (m === null) return;
    m.rotation.y += dt * 0.001;
    m.rotation.x += dt * 0.0004;
  });
  return null;
}

function SpinCubeView({ entity, world }: WidgetComponentProps): ReactElement {
  const store = useContext(StoreContext);
  const props = useWidgetProps<SpinProps>(world, entity, "spin-cube", "props");
  const selected = useSelected(world, entity);
  const meshRef = useRef<Mesh>(null);

  const color = props?.color ?? "#4f8ef7";
  const spinning = props?.spinning ?? true;

  // The GL router dispatches an IslandPointerEvent here (design-004 §4); we only
  // need stopPropagation() to CLAIM the tap. Param typed structurally so it also
  // satisfies the R3F `<mesh onPointerDown>` slot (a ThreeEvent).
  const toggleSpin = useCallback(
    (ev: { stopPropagation: () => void }) => {
      ev.stopPropagation();
      if (store === null) return;
      store.transaction((tx) => {
        // Whole-group write of the "spin-cube:props" component (color + spinning).
        tx.edit(entity).set(propsGroup.component, { color, spinning: !spinning } as never);
      });
    },
    [store, entity, color, spinning],
  );

  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[40, 70, 140]} intensity={1.15} />

      {/* Backdrop ring — NO handler, so this part of the surface stays draggable.
          Inner radius (74) clears the cube's ±60 footprint: no overlap, so the
          gap between cube edge and ring is draggable too. */}
      <mesh position={[0, 0, -20]}>
        <ringGeometry args={[74, 96, 48]} />
        <meshBasicMaterial color={selected ? "#ffd24a" : "#243049"} transparent opacity={0.9} />
      </mesh>

      {/* The interactive cube — tap to toggle spin. */}
      <mesh ref={meshRef} onPointerDown={toggleSpin}>
        <boxGeometry args={[120, 120, 120]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.45} />
      </mesh>

      {spinning && <Spinner meshRef={meshRef} />}
    </>
  );
}

// --- the widget definition (GL surface; NOT `animated` — spin is opt-in) ---

export const SpinCube = defineWidget({
  type: "spin-cube",
  props: {
    color: p.string({ default: "#4f8ef7" }),
    spinning: p.boolean({ default: true }),
  },
  surface: "gl",
  animated: false, // repaints come from useIslandFrame while spinning, not always-on
  component: SpinCubeView,
  sizeMode: "fixed",
  defaultSize: { w: 200, h: 200 },
  minSize: { w: 120, h: 120 },
  interaction: { selectable: true, movable: true },
});

const propsGroup = SpinCube.groups.find((g) => g.name === "props") as (typeof SpinCube.groups)[number];
