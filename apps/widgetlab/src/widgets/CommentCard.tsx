/**
 * CommentCard — the UE-Blueprint comment box (2026-07-18, James: "select
 * multiple widget and hit C key, a comment widget will appear and wrap the
 * selected widgets"). Semi-transparent tinted body + tinted header bar with
 * an inline-editable title; the accent color is random per spawn (palette
 * lives in App.tsx, curated to the lab's card accents).
 *
 * NOT a container: folders reparent children into a nested frame — comment
 * membership is SPATIAL. `interaction.sweepContained` makes a move claim on
 * the comment also claim every widget fully inside its bounds (engine
 * l3-claim sweep), so the group drags as one, and dragging a member out is
 * nothing at all — it just stops being inside. The C handler spawns the
 * comment at the BOTTOM of the stack (spawn z), so members render on top and
 * picking hits them first; pressing the tinted body (or header) grabs the
 * comment itself.
 *
 * Title editing rides the widget-event contract: the header shows a SPAN
 * (drag surface — a full-width input would make the whole header
 * un-draggable, since native interactives auto-opt-out, design-002 §8);
 * DOUBLE-CLICK swaps in a focused <input> (the UE rename gesture). The edit
 * commits ONE setWidgetProps tx on blur/Enter — per-keystroke transactions
 * would shred the undo stack.
 */
import { Selected, defineWidget, p, type Entity, type World } from "@ice/core";
import { useOps, useWidgetProps } from "@ice/react";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { CARD_RADIUS } from "./CardShell";

const HEADER = 44;

function CommentView({ entity, world }: { entity: Entity; world: World }): ReactElement {
  const props = useWidgetProps<{ title: string; color: string }>(world, entity, "comment-card");
  const ops = useOps();
  const title = props?.title ?? "Comment";
  const color = props?.color ?? "#6366F1";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setSelected(world.hasTag(entity, Selected)), 80);
    return () => clearInterval(id);
  }, [world, entity]);

  const commit = (): void => {
    const next = draft.trim();
    if (next !== "" && next !== title) ops.setWidgetProps(entity, { title: next });
    setEditing(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") (event.target as HTMLInputElement).blur();
    if (event.key === "Escape") {
      setDraft(title); // discard — blur commits the unchanged title
      (event.target as HTMLInputElement).blur();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: CARD_RADIUS,
        // Tint + hairline: the body must stay see-through — the comment sits
        // BEHIND its members and the dot grid should read through it.
        background: `${color}1F`,
        boxShadow: `inset 0 0 0 1.5px ${color}${selected ? "E6" : "66"}`,
        transition: "box-shadow 120ms ease",
        fontFamily: "-apple-system, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: HEADER,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          boxSizing: "border-box",
          borderRadius: `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0`,
          background: `${color}33`,
        }}
      >
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: rename mode IS the focus intent (UE dblclick-rename)
            autoFocus
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color,
            }}
            aria-label="Comment title"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation(); // rename, not an engine gesture
              setDraft(title);
              setEditing(true);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 13.5,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color,
              userSelect: "none",
            }}
            title="Double-click to rename"
            data-comment-title
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

export const CommentCard = defineWidget({
  type: "comment-card",
  surface: "dom",
  props: {
    title: p.string({ default: "Comment" }),
    color: p.string({ default: "#6366F1" }),
  },
  component: CommentView,
  defaultSize: { w: 400, h: 300 },
  // No `provides`: a comment never matches a folder's accepts, so sweeping a
  // group ACROSS a folder can't consume it — release is always a plain move.
  interaction: {
    selectable: true,
    movable: true,
    resizable: true,
    snap: "target",
    dragOn: "press",
    sweepContained: true,
  },
});
