/**
 * Baked-snapshot previews for GL widgets (design-005 §2 preview contract,
 * 2026-07-19): declared on each GL def as its `preview` — the P1 escape
 * hatch (a DOM component) carrying the REAL captured look until the P2 r3f
 * snapshot pipeline exists. Engine-free by contract: just themed <img>s over
 * the gradient silhouette (which also covers a not-yet-baked type).
 *
 * Assets come from `scripts/bake-tray-previews.mjs` (both themes, 2×);
 * re-run it whenever a GL card's look changes.
 */
import type { ComponentType, ReactElement, SyntheticEvent } from "react";
import { CARD_RADIUS } from "./CardShell";
import { previewBackground } from "./preview";

const hideBroken = (e: SyntheticEvent<HTMLImageElement>): void => {
  e.currentTarget.style.display = "none"; // not baked yet → the gradient shows
};

export function bakedPreview(type: string): ComponentType {
  return function BakedPreview(): ReactElement {
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: CARD_RADIUS,
          overflow: "hidden",
          background: previewBackground(type, "gl"),
          boxShadow: "inset 0 0 0 1px rgba(127, 127, 127, 0.22)",
        }}
      >
        <img
          src={`/tray-previews/${type}.light.png`}
          alt=""
          draggable={false}
          onError={hideBroken}
          className="absolute inset-0 h-full w-full object-cover dark:hidden"
        />
        <img
          src={`/tray-previews/${type}.dark.png`}
          alt=""
          draggable={false}
          onError={hideBroken}
          className="absolute inset-0 hidden h-full w-full object-cover dark:block"
        />
      </div>
    );
  };
}
