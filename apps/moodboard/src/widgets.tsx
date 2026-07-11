/**
 * The moodboard's two widget types — defined the way a THIRD-PARTY consumer
 * would: `defineWidget` from `@ice/core`, views built on the `@ice/react`
 * hooks. Nothing here reaches past a published package root.
 *
 *  - `sticky`: an editable note. `text` (string) + `color` (enum) live in the
 *    one generated "props" group. The view reads them with `useWidgetProps`
 *    and edits them through `useCommit` — the SANCTIONED durable-write seam
 *    (one guarded transaction per edit, absolute whole-group writes). No store
 *    context of our own.
 *  - `swatch`: a fixed colour chip. `color` is a free-form hex string; the chip
 *    is display-only (fixed square).
 *
 * Sizes are FIXED (no measure wiring) to keep the sample minimal; the draw tool
 * still creates a sticky from its drag rect, and a click-sized draw falls back
 * to `defaultSize`.
 */
import { defineWidget, p, type WidgetGroup } from "@ice/core";
import {
  useCommit,
  useSelected,
  useWidgetProps,
  type WidgetComponentProps,
} from "@ice/react";
import { useState, type CSSProperties, type ReactElement } from "react";

// --- sticky ------------------------------------------------------------------

export type StickyColor = "lemon" | "sky" | "mint" | "rose" | "lilac";
const STICKY_COLORS: readonly StickyColor[] = ["lemon", "sky", "mint", "rose", "lilac"];
const STICKY_BG: Record<StickyColor, string> = {
  lemon: "#fef3bd",
  sky: "#cfe8ff",
  mint: "#cdf0dd",
  rose: "#ffd6e4",
  lilac: "#e5dcff",
};

type StickyProps = {
  readonly text: string;
  readonly color: StickyColor;
};

function StickyView({ entity, world }: WidgetComponentProps): ReactElement {
  const commit = useCommit();
  const props = useWidgetProps<StickyProps>(world, entity, "sticky");
  const selected = useSelected(world, entity);

  const text = props?.text ?? "";
  const color: StickyColor = props?.color ?? "lemon";
  const [draft, setDraft] = useState<string | null>(null);

  // One guarded transaction, whole "props" group written absolutely.
  const save = (next: Partial<StickyProps>): void => {
    commit((tx) =>
      tx.edit(entity).set(stickyPropsGroup.component, { text, color, ...next } as never),
    );
  };

  const commitText = (value: string): void => {
    setDraft(null);
    if (value !== text) save({ text: value });
  };

  return (
    <div data-sticky data-selected={selected ? "true" : "false"} style={stickyStyle(color, selected)}>
      <textarea
        data-sticky-text
        value={draft ?? text}
        placeholder="Type a note…"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commitText(e.currentTarget.value)}
        style={TEXTAREA_STYLE}
      />
      <div
        data-canvas-interactive
        data-sticky-colors
        onPointerDown={(e) => e.stopPropagation()}
        style={COLORS_ROW_STYLE}
      >
        {STICKY_COLORS.map((c) => (
          <button
            key={c}
            data-color={c}
            type="button"
            aria-label={c}
            onClick={() => save({ color: c })}
            style={dotStyle(c, c === color)}
          />
        ))}
      </div>
    </div>
  );
}

export const Sticky = defineWidget({
  type: "sticky",
  props: {
    text: p.string({ default: "New note" }),
    color: p.enum(STICKY_COLORS, { default: "lemon" }),
  },
  surface: "dom",
  component: StickyView,
  sizeMode: "fixed",
  defaultSize: { w: 180, h: 180 },
  minSize: { w: 90, h: 90 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
});

const stickyPropsGroup = groupNamed(Sticky.groups, "props");

// --- swatch ------------------------------------------------------------------

type SwatchProps = {
  readonly color: string;
};

function SwatchView({ entity, world }: WidgetComponentProps): ReactElement {
  const props = useWidgetProps<SwatchProps>(world, entity, "swatch");
  const selected = useSelected(world, entity);
  const color = props?.color ?? "#5aa0e6";
  return (
    <div data-swatch data-selected={selected ? "true" : "false"} style={swatchStyle(color, selected)}>
      <span data-swatch-label style={SWATCH_LABEL_STYLE}>
        {color}
      </span>
    </div>
  );
}

export const Swatch = defineWidget({
  type: "swatch",
  props: { color: p.string({ default: "#5aa0e6" }) },
  surface: "dom",
  component: SwatchView,
  sizeMode: "fixed",
  defaultSize: { w: 72, h: 72 },
  minSize: { w: 40, h: 40 },
  interaction: { selectable: true, movable: true, resizable: false, snap: "both" },
});

// --- shared helpers ----------------------------------------------------------

/** A widget type's generated group component by name (throws if absent). */
function groupNamed(groups: readonly WidgetGroup[], name: string): WidgetGroup {
  const g = groups.find((x) => x.name === name);
  if (g === undefined) throw new Error(`moodboard: widget group "${name}" not found`);
  return g;
}

// --- styles (flat inline; each view fills its world-sized host element) ------

function stickyStyle(color: StickyColor, selected: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px",
    borderRadius: "6px",
    background: STICKY_BG[color],
    color: "#232323",
    fontSize: "13px",
    boxShadow: selected
      ? "0 0 0 2px #4a90d9, 0 6px 16px rgba(0,0,0,0.22)"
      : "0 3px 10px rgba(0,0,0,0.18)",
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };
}

const TEXTAREA_STYLE: CSSProperties = {
  flex: "1 1 auto",
  resize: "none",
  border: "none",
  outline: "none",
  background: "transparent",
  font: "inherit",
  lineHeight: 1.35,
  color: "inherit",
};

const COLORS_ROW_STYLE: CSSProperties = { display: "flex", gap: "6px", paddingTop: "2px" };

function dotStyle(c: StickyColor, active: boolean): CSSProperties {
  return {
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: STICKY_BG[c],
    border: active ? "2px solid #232323" : "1px solid rgba(0,0,0,0.28)",
    cursor: "pointer",
    padding: 0,
  };
}

function swatchStyle(color: string, selected: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    borderRadius: "8px",
    background: color,
    boxShadow: selected ? "0 0 0 2px #4a90d9" : "0 2px 6px rgba(0,0,0,0.2)",
    cursor: "grab",
    userSelect: "none",
  };
}

const SWATCH_LABEL_STYLE: CSSProperties = {
  fontSize: "9px",
  fontFamily: "ui-monospace, monospace",
  color: "rgba(0,0,0,0.55)",
  padding: "2px",
};
