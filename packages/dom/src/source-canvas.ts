/**
 * L1 — the DOM interaction layer's SOURCE CANVAS (design-012 §5).
 *
 * One `<canvas layoutsubtree>` whose IMMEDIATE children are the composited
 * widget hosts. They are never conventionally painted; they ARE the
 * hit-testing, focus, caret, selection, IME and accessibility truth, and they
 * are what HiC copies pixels from.
 *
 * Necessarily a DIFFERENT canvas from L0's: rendering contexts are exclusive
 * per canvas, and HiC requires the drawn elements to be children of the canvas
 * they are drawn from.
 *
 * ── Why this file names no HiC symbol ──────────────────────────────────────
 * `@ice/dom` may import `@ice/core` and nothing else; the HiC adapter lives in
 * `@ice/ground`, which nobody may import. Both walls hold at once through
 * INJECTION: the app hands this factory the three adapter functions it needs
 * (the same shape the atlas allocator uses for its effects). `layoutsubtree`,
 * `paint` and `changedElements` are spelled in the adapter, once, and this
 * layer stays testable with a fake seam and no Electron.
 *
 * ── The 2D context ────────────────────────────────────────────────────────
 * Acquired deliberately. Every measurement in `hic-bench` was taken on a
 * source canvas that had a 2D context, so that is the configuration the direct
 * copy is PROVEN in; whether it also works on a context-less canvas is simply
 * untested, and L1 is not the place to find out.
 *
 * ── THE BACKING STORE IS LOAD-BEARING ─────────────────────────────────────
 * MEASURED 2026-08-31 (`scripts/hic-paint-record.mjs`, four arms, one variable
 * each). `copyElementImageToTexture` fails with
 * `InvalidStateError: No cached paint record for element` for a host that lies
 * outside the canvas's BITMAP, and silently copies a partial card for one that
 * straddles its edge — 684 ink px of an expected 23,988 in the probe, which is
 * a copy that neither throws nor validates as an error.
 *
 * So the bitmap must cover the CSS box at device resolution: it is the region
 * in which element paint records are cached, not merely somewhere to draw. An
 * earlier revision of this file left it at the default 300×150 on the
 * reasoning that an undrawn canvas needs no pixels, and that reasoning was
 * wrong — it is what made the whole S2 board composite blank.
 *
 * `requestPaint()` does NOT substitute for it: the pump-only arm raised its
 * paint event and still copied the same partial sliver.
 *
 * The memory question this reopens is honest and unmeasured: a dpr-2
 * full-screen bitmap declares ~21 MB. That is NOT the 126.7 MB that
 * `hic-bench` §6 attributed to the prototype's 2D atlas canvas, which was
 * being rasterised into every frame; this one is never drawn into. But
 * "declared" is not "committed", and nobody has put `vmmap` on it.
 */

/**
 * The HiC seam, injected. `@ice/ground`'s adapter satisfies it exactly:
 * `{ markAsSourceCanvas, onPaint, changedElements }`.
 */
export interface SourceCanvasEffects {
  /** Mark the canvas so its immediate children lay out, hit-test, and stay unpainted. */
  markAsSourceCanvas(canvas: HTMLCanvasElement): void;
  /** Subscribe to the canvas's paint events. Returns an unsubscriber. */
  onPaint(canvas: HTMLCanvasElement, handler: (event: Event) => void): () => void;
  /** The elements a paint event says changed. */
  changedElements(event: Event): readonly Element[];
}

export interface SourceCanvasOptions {
  /**
   * Initial bitmap size. Omitted ⇒ measured once from the container at
   * construction (one layout read at boot, like `createCanvasHost`'s own).
   * Never measured during a flush — reflectors may not read layout.
   */
  size?: { readonly width: number; readonly height: number; readonly dpr: number };
  /**
   * Called with the composited hosts a paint event named — the per-slot dirty
   * signal that makes the ~100× upload path possible (441 KB / 0.21 ms against
   * 43.5 MB / 7.9 ms), and the reason no full-board path exists.
   *
   * Also called with an EMPTY list for a paint event that named nothing, which
   * is how a transform write-back announces itself (2 events/frame while the
   * camera moves — §4.2's guard, characterised at S3).
   */
  onDirty?(hosts: readonly Element[], event: Event): void;
}

export interface SourceCanvas {
  /** The L1 canvas. Composited hosts are appended here, and NOWHERE deeper. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Resize the bitmap to a CSS box at `dpr`. Call on every viewport change:
   * a host outside the bitmap has no paint record and cannot be copied at all
   * (see the header). No-op at an unchanged size — resizing a canvas clears
   * it and invalidates its records.
   */
  resize(cssWidth: number, cssHeight: number, dpr: number): boolean;
  /** Paint events seen since construction (the idle-floor instrument). */
  paintEvents(): number;
  dispose(): void;
}

/**
 * L1 sits ABOVE L0 and below the overlay, and it paints nothing — so it must
 * not occlude the ground canvas visually while still receiving hits for its
 * children. `pointer-events: none` on the canvas itself with `auto` restored
 * per host would break `layoutsubtree`'s whole point, so the canvas keeps
 * pointer events and simply has no pixels of its own.
 */
const CANVAS_STYLE: Readonly<Record<string, string>> = {
  position: "absolute",
  left: "0",
  top: "0",
  width: "100%",
  height: "100%",
  // Above the content/lifted planes; the P4 chrome + P5 cursor overlay still
  // stack above this by DOM order.
  zIndex: "3",
  // The canvas draws nothing; only its children matter.
  background: "transparent",
};

export function createSourceCanvas(
  container: HTMLElement,
  effects: SourceCanvasEffects,
  options: SourceCanvasOptions = {},
): SourceCanvas {
  const doc = container.ownerDocument;
  const canvas = doc.createElement("canvas");
  Object.assign(canvas.style, CANVAS_STYLE);
  canvas.setAttribute("data-ice-source-canvas", "");
  effects.markAsSourceCanvas(canvas);
  // See the header: the proven configuration. The result is intentionally
  // unused — nothing is ever drawn through it.
  canvas.getContext("2d");
  container.appendChild(canvas);

  /** Size the bitmap so every host's paint record is inside it (the header). */
  const resize = (cssWidth: number, cssHeight: number, dpr: number): boolean => {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    // A no-op resize is not free: assigning width/height CLEARS the canvas and
    // drops the paint records with it.
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  };

  const initial = options.size;
  if (initial !== undefined) {
    resize(initial.width, initial.height, initial.dpr);
  } else {
    // One layout read, at boot, after the canvas is in the document.
    const view = doc.defaultView;
    resize(canvas.clientWidth, canvas.clientHeight, view?.devicePixelRatio ?? 1);
  }

  let paintEvents = 0;
  const offPaint = effects.onPaint(canvas, (event) => {
    paintEvents++;
    if (options.onDirty === undefined) return;
    // Only IMMEDIATE children are addressable by the copy, so a changed
    // descendant is reported as its host. Anything outside this canvas is not
    // ours and is dropped.
    const hosts: Element[] = [];
    const seen = new Set<Element>();
    for (const el of effects.changedElements(event)) {
      let node: Element | null = el;
      while (node !== null && node.parentElement !== canvas) node = node.parentElement;
      if (node !== null && !seen.has(node)) {
        seen.add(node);
        hosts.push(node);
      }
    }
    options.onDirty(hosts, event);
  });

  return {
    canvas,
    resize,
    paintEvents: () => paintEvents,
    dispose() {
      offPaint();
      canvas.remove();
    },
  };
}
