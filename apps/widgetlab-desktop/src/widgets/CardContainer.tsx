/**
 * CardContainer — the v1 folder (RFC-004 Phase 5) on v3 container semantics,
 * re-skinned 2026-07-17 to the design-006 mock's folder (James: "make the
 * container widget look like that"): a dark surface card whose body is a
 * live PREVIEW PORTAL — dot-grid backdrop + minis of the actual children,
 * mapped through the SAME affine the portal-zoom transition uses (fit of the
 * child frame's arrival view onto the portal rect), so entering reads as
 * diving into the picture you were already looking at — and a 36px bottom
 * bar: accent folder icon, name, count pill. Minis are true card silhouettes
 * (2026-07-17, James): CARD_RADIUS scaled by the same affine, and each mini
 * wears its card's REAL background via preview.ts (single source of truth).
 *
 * `container.accepts: ["widget"]` arms drop-to-consume + nested canvas, and
 * the folder now ALSO carries `provides: ["widget"]` (2026-07-17): folders
 * are widgets too, so a folder drops into a folder — nesting was already
 * fully supported engine-side (membership walks the ChildOf chain), only the
 * missing Provides blocked the match. Double-click (or Enter/Space) descends
 * via ops.enterContainer. Its child picture is the Container SDK's bounded,
 * demand-driven semantic preview; hidden folders own no timer or observer.
 *
 * size: large (329×345).
 */
import {
  FIT_DEFAULTS,
  defineContainer,
  p,
  type Entity,
  type FramePreviewSnapshot,
  type World,
} from "@ice/core";
import { useCanvasEngine, useFramePreview, useOps, useWidgetProps } from "@ice/react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from "react";
import { CARD_RADIUS, CardShell } from "./CardShell";
import { FOLDER_BG, previewBackground } from "./preview";
import { WhiteboardCanvas } from "../whiteboard-canvas";

export const CARD_CONTAINER_SIZE = { w: 329, h: 345 };

/** Mock constants (design-006 artifact): portal inset + bottom bar height. */
const FOLDER_PAD = 10;
const FOLDER_BAR = 36;
/** The preview portal rect in card-local px (fixed size — sizeMode "fixed"). */
const PORTAL = {
  x: FOLDER_PAD,
  y: FOLDER_PAD,
  w: CARD_CONTAINER_SIZE.w - FOLDER_PAD * 2,
  h: CARD_CONTAINER_SIZE.h - FOLDER_PAD - FOLDER_BAR,
};

type Mini = { key: string; x: number; y: number; w: number; h: number; bg: string };

/** Aspect-FIT affine mapping rect R onto rect K, centers aligned (mock fitAffine). */
function fitAffine(
  R: { x: number; y: number; w: number; h: number },
  K: { x: number; y: number; w: number; h: number },
): { s: number; ox: number; oy: number } {
  const s = Math.min(K.w / R.w, K.h / R.h);
  return { s, ox: K.x + K.w / 2 - (R.x + R.w / 2) * s, oy: K.y + K.h / 2 - (R.y + R.h / 2) * s };
}

/**
 * Mini placement = the transition's own map: zoom-to-fit arrival camera over
 * the children (pad 80, zoom clamped like resolveArrivalCamera), that view
 * rect fit onto the portal — pixel-continuous with the enter flight. Falls
 * back to a plain bbox fit when no Viewport exists (headless/tests).
 */
function miniRects(
  snapshot: FramePreviewSnapshot,
  background: (type: string) => string,
): Array<Mini & { left: number; top: number; width: number; height: number; radius: number }> {
  const minis: Mini[] = snapshot.children.map((child) => ({
    key: child.key,
    x: child.rect.x,
    y: child.rect.y,
    w: child.rect.width,
    h: child.rect.height,
    bg: background(child.widgetType),
  }));
  if (minis.length === 0) return [];
  const { bounds, resolvedView: camera, viewport } = snapshot;
  let R: { x: number; y: number; w: number; h: number };
  if (viewport.width > 0 && viewport.height > 0) {
    R = {
      x: camera.x,
      y: camera.y,
      w: viewport.width / camera.zoom,
      h: viewport.height / camera.zoom,
    };
  } else {
    R = {
      x: bounds.x - FIT_DEFAULTS.pad,
      y: bounds.y - FIT_DEFAULTS.pad,
      w: Math.max(1, bounds.width + FIT_DEFAULTS.pad * 2),
      h: Math.max(1, bounds.height + FIT_DEFAULTS.pad * 2),
    };
  }
  const portalWidth = snapshot.portal.width > 0 ? snapshot.portal.width : PORTAL.w;
  const portalHeight = snapshot.portal.height > 0 ? snapshot.portal.height : PORTAL.h;
  const M = fitAffine(R, { x: 0, y: 0, w: portalWidth, h: portalHeight });
  // Same silhouette as the card: the 22px corner scaled by the SAME affine.
  const radius = CARD_RADIUS * M.s;
  return minis.map((c) => ({
    ...c,
    left: M.ox + c.x * M.s,
    top: M.oy + c.y * M.s,
    width: c.w * M.s,
    height: c.h * M.s,
    radius,
  }));
}

function CardContainerView({ entity, world }: { entity: Entity; world: World }): ReactElement {
  const props = useWidgetProps<{ title: string; accent: string }>(world, entity, "card-container");
  const ops = useOps();
  const engine = useCanvasEngine();
  const snapshot = useFramePreview(entity);

  const title = props?.title ?? "Folder";
  const accent = props?.accent ?? "#7B96FF";
  const enterFolder = (): void => ops.enterContainer(entity);
  const onDoubleClick = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    enterFolder();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      enterFolder();
    }
  };
  const placed = miniRects(snapshot, (type) => {
    const def = engine.catalog.widget(type);
    return previewBackground(type, def?.surface);
  });

  // v1 note kept: a <div role="button"> rather than <button> — a real button
  // would be treated as a widget-internal control and make the whole surface
  // non-draggable; role + tabIndex + onKeyDown keep keyboard a11y.
  return (
    <CardShell world={world} entity={entity} background={FOLDER_BG}>
      {/* biome-ignore lint/a11y/useSemanticElements: drag-surface; see comment above */}
      <div
        role="button"
        tabIndex={0}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        style={{
          position: "relative",
          height: "100%",
          width: "100%",
          color: "#EAEAF4",
          fontFamily: "-apple-system, system-ui, sans-serif",
          // The mock's 1px hairline (--line) — inset so the shell's clip keeps it.
          boxShadow: "inset 0 0 0 1px rgba(160, 165, 210, 0.14)",
          borderRadius: "inherit",
        }}
        title={`Double-click to open ${title}`}
      >
        {/* Preview portal: dot-grid backdrop + live minis of the children. */}
        <div
          style={{
            position: "absolute",
            left: PORTAL.x,
            top: PORTAL.y,
            width: PORTAL.w,
            height: PORTAL.h,
            overflow: "hidden",
            borderRadius: 7,
            background: "radial-gradient(rgba(150,158,210,0.12) 1px, transparent 1px) 0 0 / 14px 14px, #14141F",
          }}
        >
          {placed.map((c) => (
            <div
              key={c.key}
              style={{
                position: "absolute",
                left: c.left,
                top: c.top,
                width: c.width,
                height: c.height,
                borderRadius: c.radius,
                background: c.bg,
                // Faint hairline + lift so dark gradients read on the dark grid.
                boxShadow: "inset 0 0 0 1px rgba(235, 240, 255, 0.10), 0 2px 6px rgba(0, 0, 0, 0.40)",
              }}
            />
          ))}
          {placed.length === 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                color: "#8B8BA6",
              }}
            >
              Empty — drop cards in
            </div>
          )}
        </div>

        {/* Bottom bar: accent folder icon · name · count pill (mock .bar). */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: FOLDER_BAR,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            boxSizing: "border-box",
          }}
        >
          <svg width="14" height="12" viewBox="0 0 14 12" fill="none" aria-hidden="true" style={{ flex: "none" }}>
            <path
              d="M1 3.2C1 2.1 1.9 1.2 3 1.2h2.4l1.4 1.6H11c1.1 0 2 .9 2 2v4C13 9.9 12.1 10.8 11 10.8H3c-1.1 0-2-.9-2-2V3.2Z"
              fill={accent}
            />
          </svg>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</span>
          <span
            style={{
              marginLeft: "auto",
              minWidth: 24,
              height: 17,
              padding: "0 6px",
              borderRadius: 99,
              background: `${accent}29`,
              color: accent,
              fontSize: 10.5,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
            }}
          >
            {snapshot.totalChildren}
          </span>
        </div>
      </div>
    </CardShell>
  );
}

export const CardContainer = defineContainer({
  type: "card-container",
  canvas: WhiteboardCanvas,
  surface: "dom",
  props: {
    title: p.string({ default: "Folder" }),
    accent: p.string({ default: "#7B96FF" }),
  },
  component: CardContainerView,
  sizeMode: "fixed",
  defaultSize: { w: CARD_CONTAINER_SIZE.w, h: CARD_CONTAINER_SIZE.h },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both", dragOn: "press" },
  // Folders are widgets too (2026-07-17): without container.provides a folder
  // can never match another folder's accepts — folder-in-folder was silently
  // impossible. (For containers, Provides reads container.provides; the
  // top-level `provides` field is the LEAF path — define-widget.ts:292.)
  drop: { accepts: ["widget"] },
  provides: ["widget"],
  portal: { top: FOLDER_PAD, right: FOLDER_PAD, bottom: FOLDER_BAR, left: FOLDER_PAD },
});
