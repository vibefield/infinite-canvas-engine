/**
 * The `TodoCard` widget — the card-board demo's one widget type, proving the
 * M6 widget stack end to end (design-005 §2 defineWidget; design-004 §2 host
 * pipeline; design-002 §8 the pinned widget-event contract).
 *
 * Data model (conflict groups → one component each):
 *  - `content` group: `title` (string) + `items` (a `p.json` list of {text,done})
 *  - `style`   group: `color` (enum)
 * Edits commit as ONE `session.store.transaction` writing the whole group value
 * (design-001 §5.2 conflict-coarse granularity) — durable, undoable, relayed.
 *
 * The view demonstrates every boundary of the widget-event contract:
 *  - the title `<input>` and the "add item" `<button>` are NATIVE interactives:
 *    the L0 adapter marks their `pointerdown` `surfaceHandled`, so typing/clicking
 *    never starts a canvas drag (the recognizer skips) — no per-widget event code;
 *  - the color row is an explicit `[data-canvas-interactive]` region that ALSO
 *    `stopPropagation()`s its own pointerdown: the content-boundary demo — the
 *    event never even reaches the canvas surface;
 *  - `useSelected` drives a selection ring; `useWidgetProps` re-renders on doc
 *    edits (Tier-3) and FREEZES while the host is culled-but-kept-mounted.
 *
 * The store reaches the view through {@link CardStoreContext} (React context
 * flows through `createPortal`, so the app root's provider wraps every card).
 * `sizeMode: "auto-height"` — the host measures the card's content box
 * (measure-adapter → measureQueue → `MeasuredSize`) and the effective size
 * drives geometry/cull/breakpoint; `defaultSize` is the pre-measure fallback.
 */
import {
  type DocSession,
  type Entity,
  type World,
  defineWidget,
  p,
} from "@ice/core";
import { useBreakpoint, useSelected, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactElement } from "react";

export type TodoItem = { text: string; done: boolean };
export type ColorName = "yellow" | "blue" | "green" | "pink";

/** The durable store, provided by the app root; null in a bare render (no commits). */
export const CardStoreContext = createContext<DocSession["store"] | null>(null);

const COLORS: readonly ColorName[] = ["yellow", "blue", "green", "pink"];
const SWATCH: Record<ColorName, string> = {
  yellow: "#f4d03f",
  blue: "#5aa0e6",
  green: "#5cb85c",
  pink: "#e668a8",
};
const CARD_BG: Record<ColorName, string> = {
  yellow: "#fdf6d8",
  blue: "#dceafb",
  green: "#dff3df",
  pink: "#fbdcec",
};

function TodoCardView({ entity, world }: WidgetComponentProps): ReactElement {
  const store = useContext(CardStoreContext);
  const content = useWidgetProps<{ title: string; items: TodoItem[] }>(world, entity, "todo-card", "content");
  const style = useWidgetProps<{ color: ColorName }>(world, entity, "todo-card", "style");
  const selected = useSelected(world, entity);
  const tier = useBreakpoint(world, entity);

  // Local (session) UI state — must survive cull/re-enter while kept mounted.
  const [draft, setDraft] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const committedTitle = content?.title ?? "";
  const items = content?.items ?? [];
  const color: ColorName = style?.color ?? "yellow";

  const commitContent = useCallback(
    (next: { title: string; items: TodoItem[] }) => {
      if (store === null) return;
      store.transaction((tx) => {
        // Whole-group write: the "todo-card:content" component (title + json items).
        tx.edit(entity).set(contentGroup.component, {
          title: next.title,
          items: JSON.stringify(next.items),
        } as never);
      });
    },
    [store, entity],
  );

  const commitColor = useCallback(
    (c: ColorName) => {
      if (store === null) return;
      store.transaction((tx) => {
        tx.edit(entity).set(styleGroup.component, { color: c } as never);
      });
    },
    [store, entity],
  );

  // Title commits on blur / Enter (never per keystroke); reads the live DOM value.
  const commitTitle = (value: string): void => {
    setDraft(null);
    if (value !== committedTitle) commitContent({ title: value, items });
  };

  const addItem = (): void =>
    commitContent({ title: committedTitle, items: [...items, { text: `Item ${items.length + 1}`, done: false }] });
  const toggleItem = (i: number): void =>
    commitContent({ title: committedTitle, items: items.map((it, j) => (j === i ? { ...it, done: !it.done } : it)) });

  return (
    <div data-card data-tier={tier} data-collapsed={collapsed ? "true" : "false"} style={cardStyle(color, selected)}>
      <header style={HEADER_STYLE}>
        <input
          data-card-title
          value={draft ?? committedTitle}
          placeholder="Untitled"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => commitTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitTitle(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          style={TITLE_STYLE}
        />
        <button
          data-collapse
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "expand" : "collapse"}
          style={ICON_BTN_STYLE}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </header>

      {!collapsed && (
        <ul data-card-items style={LIST_STYLE}>
          {items.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are positional; the doc has no per-item id yet.
            <li key={i} style={ITEM_STYLE}>
              <label style={LABEL_STYLE}>
                <input type="checkbox" checked={it.done} onChange={() => toggleItem(i)} />
                <span style={it.done ? DONE_TEXT_STYLE : undefined}>{it.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <button data-add type="button" onClick={addItem} style={ADD_BTN_STYLE}>
        + add item
      </button>

      {/* The content boundary: an explicit interactive region that both carries
          [data-canvas-interactive] AND stops its own pointerdown — the canvas
          never sees it (design-002 §8). */}
      <div
        data-canvas-interactive
        data-card-colors
        onPointerDown={(e) => e.stopPropagation()}
        style={COLORS_ROW_STYLE}
      >
        {COLORS.map((c) => (
          <button
            key={c}
            data-color={c}
            type="button"
            onClick={() => commitColor(c)}
            aria-label={c}
            style={swatchStyle(c, c === color)}
          />
        ))}
      </div>
    </div>
  );
}

// --- the widget definition (registers the prefab, groups, capability tags) ---

export const TodoCard = defineWidget({
  type: "todo-card",
  props: {
    title: p.string({ default: "Todo" }),
    items: p.json(p.array(p.object({ text: { kind: "string" }, done: { kind: "boolean" } })), { default: [] }),
    color: p.enum(COLORS, { default: "yellow" }),
  },
  groups: { content: ["title", "items"], style: ["color"] },
  surface: "dom",
  component: TodoCardView,
  sizeMode: "auto-height", // host measures the content box → MeasuredSize (design-004 §2)
  defaultSize: { w: 220, h: 180 }, // pre-measure fallback (effective size until the first sample)
  minSize: { w: 140, h: 90 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
});

const contentGroup = TodoCard.groups.find((g) => g.name === "content") as (typeof TodoCard.groups)[number];
const styleGroup = TodoCard.groups.find((g) => g.name === "style") as (typeof TodoCard.groups)[number];

// --- styles (flat inline; the card fills its world-sized host content element) ---

function cardStyle(color: ColorName, selected: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px",
    borderRadius: "10px",
    background: CARD_BG[color],
    color: "#222",
    fontSize: "13px",
    boxShadow: selected ? "0 0 0 2px #4a90d9, 0 4px 14px rgba(0,0,0,0.18)" : "0 2px 8px rgba(0,0,0,0.14)",
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };
}

const HEADER_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "4px" };
const TITLE_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  font: "inherit",
  fontWeight: 600,
  border: "none",
  background: "transparent",
  padding: "2px 0",
  outline: "none",
};
const ICON_BTN_STYLE: CSSProperties = {
  font: "inherit",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "0 4px",
};
const LIST_STYLE: CSSProperties = { listStyle: "none", margin: 0, padding: 0, overflowY: "auto", flex: "1 1 auto" };
const ITEM_STYLE: CSSProperties = { padding: "1px 0" };
const LABEL_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" };
const DONE_TEXT_STYLE: CSSProperties = { textDecoration: "line-through", opacity: 0.55 };
const ADD_BTN_STYLE: CSSProperties = {
  alignSelf: "flex-start",
  font: "inherit",
  fontSize: "12px",
  border: "1px dashed rgba(0,0,0,0.3)",
  background: "transparent",
  borderRadius: "6px",
  padding: "2px 8px",
  cursor: "pointer",
};
const COLORS_ROW_STYLE: CSSProperties = { display: "flex", gap: "6px", paddingTop: "2px" };

function swatchStyle(c: ColorName, active: boolean): CSSProperties {
  return {
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: SWATCH[c],
    border: active ? "2px solid #222" : "1px solid rgba(0,0,0,0.25)",
    cursor: "pointer",
    padding: 0,
  };
}
