// THE ONE EDITOR's face and its LEASE (design-015 §6.1, D3t-c; design-016 §5): the desk has one focused editor — the
// platform's textarea in screen space, the note's DOM half (desk/host/editor.ts) — and a kind whose objects take text
// borrows it through a lease (the desk calendar: a day selected, a line written). The kit's since K4a, so a borrower names
// no other kind's folder; K8 turns the lease into a service any kind can take. Types only: the DOM stays in desk/host.

import type { Entity } from "@ice/core";

/**
 * A BORROWER of the ONE editor (D3t-c — the desk calendar: a day selected, a line written). While lent, the textarea's value, keys,
 * caret and blur are the lease's, and it says where the textarea stands; a note taking the editor, a blur, or `release` ends it.
 */
export interface EditorLease {
  /** The value the textarea holds now ("" while nothing is being written). */
  value(): string;
  /** The platform's value after an input event. */
  input(value: string): void;
  /** A key the lease takes: true — handled (the editor prevents its default, so the keymap stands down). */
  keydown(ev: KeyboardEvent): boolean;
  /** The caret moved (a selection change): its index. */
  caret(index: number): void;
  /** Where the textarea stands (container px, unturned) and the size its text is laid at — null keeps it where it was. */
  place(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly fontPx: number } | null;
  /** 1 s without input (never mid-IME): a session's end; the focus stays. */
  idle(): void;
  /** The lease is over (a blur, a note taking the editor, `release`). */
  ended(): void;
}

export interface NoteEditor {
  readonly element: HTMLTextAreaElement;
  /** Lend the editor to a borrower (D3t-c): a note being written ends first; the textarea takes focus. */
  lend(lease: EditorLease): void;
  /** End the lease (only `lease`'s, when named). */
  release(lease?: EditorLease): void;
  /** The borrower holding the editor, if any. */
  lease(): EditorLease | undefined;
  /** Put the editor on note `e`, the caret before glyph `index` (the end by default). False for a still or a non-note. */
  focus(e: Entity, index?: number): boolean;
  /** End the writing: the session committed, the claim lifted, the editor hidden. */
  blur(): void;
  editing(): Entity | undefined;
  /** After each draw: follow the camera; notice a delete, a nav cut, a write from elsewhere. */
  follow(): void;
  /** Where the editor's box stands on screen (container px): its centre, size and turn — null while hidden. */
  placement(): { readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly angle: number } | null;
  dispose(): void;
}
