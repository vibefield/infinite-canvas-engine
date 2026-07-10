/**
 * The `NoteCard` widget — gl-board's DOM-surface widget (design-005 §2
 * defineWidget; design-004 §2 host pipeline; design-002 §8 widget-event
 * contract). A deliberately small sibling of card-board's TodoCard: a title
 * `<input>` + a body `<textarea>`, both NATIVE interactives, so the L0 adapter
 * marks their `pointerdown` `surfaceHandled` and typing never starts a canvas
 * drag — while the card body stays grab-to-move. Edits commit as ONE
 * `store.transaction` writing the whole `content` group (design-001 §5.2).
 *
 * The durable store reaches this view through {@link StoreContext} — the same
 * provider the app root wraps around the GL `<Canvas>`, so DOM and GL widgets
 * share one commit path.
 */
import { defineWidget, p } from "@ice/core";
import { useSelected, useWidgetProps, type WidgetComponentProps } from "@ice/react";
import { type CSSProperties, type ReactElement, useCallback, useContext, useState } from "react";
import { StoreContext } from "./store-context";

type NoteContent = { title: string; body: string };

function NoteCardView({ entity, world }: WidgetComponentProps): ReactElement {
  const store = useContext(StoreContext);
  const content = useWidgetProps<NoteContent>(world, entity, "note-card", "content");
  const selected = useSelected(world, entity);

  // Local (session) draft state — survives cull/re-enter while kept mounted.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState<string | null>(null);

  const title = content?.title ?? "";
  const body = content?.body ?? "";

  const commit = useCallback(
    (next: NoteContent) => {
      if (store === null) return;
      store.transaction((tx) => {
        tx.edit(entity).set(contentGroup.component, next as never);
      });
    },
    [store, entity],
  );

  // Both fields commit on blur / Enter (never per keystroke); read the live value.
  const commitTitle = (value: string): void => {
    setTitleDraft(null);
    if (value !== title) commit({ title: value, body });
  };
  const commitBody = (value: string): void => {
    setBodyDraft(null);
    if (value !== body) commit({ title, body: value });
  };

  return (
    <div data-note data-selected={selected ? "true" : "false"} style={cardStyle(selected)}>
      <input
        data-note-title
        value={titleDraft ?? title}
        placeholder="Untitled"
        onChange={(e) => setTitleDraft(e.currentTarget.value)}
        onBlur={(e) => commitTitle(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitTitle(e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
        style={TITLE_STYLE}
      />
      <textarea
        data-note-body
        value={bodyDraft ?? body}
        placeholder="Write a note…"
        onChange={(e) => setBodyDraft(e.currentTarget.value)}
        onBlur={(e) => commitBody(e.currentTarget.value)}
        style={BODY_STYLE}
      />
    </div>
  );
}

// --- the widget definition (durable prefab, one "content" group) ---

export const NoteCard = defineWidget({
  type: "note-card",
  props: {
    title: p.string({ default: "Note" }),
    body: p.string({ default: "" }),
  },
  groups: { content: ["title", "body"] },
  surface: "dom",
  component: NoteCardView,
  sizeMode: "fixed",
  defaultSize: { w: 220, h: 150 },
  minSize: { w: 150, h: 100 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "both" },
});

const contentGroup = NoteCard.groups.find((g) => g.name === "content") as (typeof NoteCard.groups)[number];

// --- styles (flat inline; the card fills its world-sized host content element) ---

function cardStyle(selected: boolean): CSSProperties {
  return {
    boxSizing: "border-box",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "10px",
    borderRadius: "10px",
    background: "#fbfaf4",
    color: "#242424",
    fontSize: "13px",
    boxShadow: selected ? "0 0 0 2px #4a90d9, 0 4px 14px rgba(0,0,0,0.25)" : "0 2px 8px rgba(0,0,0,0.22)",
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };
}

const TITLE_STYLE: CSSProperties = {
  flex: "0 0 auto",
  minWidth: 0,
  font: "inherit",
  fontWeight: 600,
  border: "none",
  borderBottom: "1px solid rgba(0,0,0,0.12)",
  background: "transparent",
  padding: "2px 0",
  outline: "none",
};

const BODY_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  resize: "none",
  font: "inherit",
  border: "none",
  background: "transparent",
  padding: "2px 0",
  outline: "none",
};
