/**
 * The HTML-in-Canvas adapter — THE ONLY module in this repo allowed to name a
 * HiC symbol (design-012 §8 gate 1 + §8 gate 6, plan §4.1).
 *
 * HiC is a Chromium ORIGIN TRIAL (M148–M154, extended) whose API has already
 * been renamed once (`placeElement` → `drawElementImage`). Every call site
 * outside this file would be a separate place to fix when it renames again, or
 * dies. So: `drawElementImage`, `copyElementImageToTexture`, `requestPaint`,
 * `getElementTransform`, the `paint` event and the `layoutsubtree` attribute
 * appear HERE and nowhere else. Consumers see capability booleans and ordinary
 * functions.
 *
 * RECEIVER-BOUND CALLS. Every entry point below invokes the method THROUGH its
 * owner (`queue.copyElementImageToTexture(...)`, never a hoisted reference).
 * These are native methods with an internal receiver check: pulling
 * `copyElementImageToTexture` off the queue and calling it bare throws
 * "Illegal invocation". Where a reference must be held, it is `.call(owner, …)`.
 *
 * TYPES. `@webgpu/types` and TypeScript's DOM lib describe neither the origin
 * trial's additions nor the `layoutsubtree` attribute, so the narrow structural
 * interfaces they need are declared here — deliberately minimal, and the only
 * copy in the tree.
 */

// --- the trial surface, structurally (nothing else may name these) ----------

/** `CanvasRenderingContext2D.drawElementImage(element, x, y)` → placement matrix. */
interface HicContext2D {
  drawElementImage?: (element: Element, x: number, y: number) => DOMMatrix | undefined;
}

/** `HTMLCanvasElement` additions: the paint pump and the transform reader. */
interface HicCanvas {
  requestPaint?: () => void;
  getElementTransform?: (element: Element) => DOMMatrix | undefined;
}

/**
 * `GPUQueue.copyElementImageToTexture(source, destination)` — ARITY 2.
 *
 * The shape below is the one the GATE ZERO probe recovered by walking the
 * validation errors on this app's pinned Chromium 150 (2026-08-31,
 * `apps/widgetlab-desktop/scripts/hic-copy-gate.mjs`), matching the Chromium
 * 152 evidence in `hic-bench` FINDINGS §4. It is NOT the WebGPU
 * `copyExternalImageToTexture` shape, which is the trap this interface exists
 * to stop anyone falling into twice: the destination is a wrapper dictionary
 * carrying a `destination` member, and the copy takes no third size argument.
 *
 * `origin` belongs INSIDE the inner texel-copy dictionary. It validates at the
 * outer level too, but WebIDL silently ignores unknown dictionary members, so
 * an outer `origin` is accepted and DISCARDED — every slot would then be
 * written at (0,0). Proven by pixels, not by the absence of a validation
 * error: gate zero landed a copy in the targeted quadrant (61,440 px) with
 * zero ink in the other three.
 */
interface HicQueue {
  copyElementImageToTexture?: (
    source: { source: Element },
    destination: { destination: { texture: GPUTexture; origin?: GPUOrigin3D } },
  ) => void;
}

// --- capability probe -------------------------------------------------------

/**
 * What the host actually offers. Reported in full so a refusal screen can say
 * WHICH capability is missing rather than "unsupported" (design-012 §11 Q2:
 * a loud, honest boot-time refusal).
 */
export interface HicCapabilities {
  readonly webgpu: boolean;
  /** Functionally probed: a `layoutsubtree` canvas LAYS OUT its children. */
  readonly layoutSubtree: boolean;
  readonly requestPaint: boolean;
  readonly drawElementImage: boolean;
  readonly copyElementImageToTexture: boolean;
  /** Present-untested (design-012 §8 gotcha 6) — reported, never required. */
  readonly getElementTransform: boolean;
}

export interface HicProbeResult {
  readonly capabilities: HicCapabilities;
  /** True when every capability the composited profile REQUIRES is present. */
  readonly supported: boolean;
  /** Names of the required-but-absent capabilities; empty when supported. */
  readonly missing: readonly string[];
}

/**
 * The capability set the composited profile requires, per design-012 §3: the
 * host "must feature-detect in the renderer (`drawElementImage` +
 * `requestPaint` + `copyElementImageToTexture`), never assume" — plus WebGPU,
 * which the whole profile is built on.
 *
 * `layoutSubtree` is deliberately NOT required: it is a content attribute with
 * no guaranteed IDL reflection, so the probe measures it behaviourally and
 * reports it, but a false reading must not refuse a host whose three trial
 * METHODS are all live. `getElementTransform` is reported for the same reason
 * (§8 gotcha 6 records it as present-untested).
 */
const REQUIRED: readonly (keyof HicCapabilities)[] = [
  "webgpu",
  "requestPaint",
  "drawElementImage",
  "copyElementImageToTexture",
];

/**
 * Does a `layoutsubtree` canvas lay its children out?
 *
 * A plain `<canvas>`'s children are FALLBACK content: never laid out, so they
 * measure 0×0. Under the trial the immediate children participate in layout
 * (and hit-testing, and a11y) while staying unpainted — a nonzero rect on a
 * sized child is therefore a real discriminator, where sniffing an attribute
 * that every browser happily accepts is not.
 *
 * Costs one forced layout, once, at boot. Cleans up unconditionally.
 */
function probeLayoutSubtree(doc: Document): boolean {
  const body = doc.body;
  if (body === null) return false;
  const canvas = doc.createElement("canvas");
  try {
    canvas.setAttribute("layoutsubtree", "");
    // Out of the way and out of the paint path, but still IN layout — a
    // `display:none` host would measure 0×0 under every browser and prove
    // nothing.
    canvas.style.position = "absolute";
    canvas.style.left = "-10000px";
    canvas.style.top = "0";
    canvas.style.width = "200px";
    canvas.style.height = "200px";
    canvas.style.pointerEvents = "none";
    const child = doc.createElement("div");
    child.style.width = "64px";
    child.style.height = "32px";
    canvas.appendChild(child);
    body.appendChild(canvas);
    const rect = child.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  } catch {
    return false;
  } finally {
    canvas.remove();
  }
}

/**
 * Run the capability probe. Pure read (plus the one throwaway element above) —
 * safe to call before anything else boots, which is the point: the composited
 * build refuses at boot rather than half-rendering.
 *
 * Re-run this on EVERY Electron/Chromium bump; it is the artifact design-012
 * §3 makes an EL8-class pin note.
 */
export function probeHic(doc: Document = globalThis.document): HicProbeResult {
  const win = doc?.defaultView ?? undefined;
  const nav = (win ?? globalThis).navigator as { gpu?: unknown } | undefined;

  let ctx2d: HicContext2D | null = null;
  try {
    ctx2d = doc.createElement("canvas").getContext("2d") as unknown as HicContext2D | null;
  } catch {
    ctx2d = null;
  }
  const canvasProto = (win?.HTMLCanvasElement ?? globalThis.HTMLCanvasElement)?.prototype as
    | HicCanvas
    | undefined;
  const queueCtor = (win ?? globalThis) as { GPUQueue?: { prototype?: HicQueue } };
  const queueProto = queueCtor.GPUQueue?.prototype;

  const capabilities: HicCapabilities = {
    webgpu: nav?.gpu != null,
    layoutSubtree: probeLayoutSubtree(doc),
    requestPaint: typeof canvasProto?.requestPaint === "function",
    drawElementImage: typeof ctx2d?.drawElementImage === "function",
    copyElementImageToTexture: typeof queueProto?.copyElementImageToTexture === "function",
    getElementTransform: typeof canvasProto?.getElementTransform === "function",
  };

  const missing = REQUIRED.filter((k) => capabilities[k] !== true);
  return { capabilities, supported: missing.length === 0, missing };
}

/** One-line human summary for a refusal screen / preflight log. */
export function describeHicProbe(probe: HicProbeResult): string {
  if (probe.supported) return "HTML-in-Canvas available";
  return `HTML-in-Canvas unavailable — missing: ${probe.missing.join(", ")}`;
}

// --- the L1 source canvas ---------------------------------------------------

/**
 * Mark a canvas as the L1 SOURCE canvas (design-012 §5). The attribute is
 * spelled once, here. Immediate children then participate in layout,
 * hit-testing and a11y without being painted to the page.
 */
export function markAsSourceCanvas(canvas: HTMLCanvasElement): void {
  canvas.setAttribute("layoutsubtree", "");
}

// --- receiver-bound calls ---------------------------------------------------

/**
 * Ask the host to schedule a paint for this source canvas.
 *
 * Mostly a boot/one-shot verb: DOM mutations inside the subtree SELF-SCHEDULE
 * paint events (hic-bench: 14/14, ~1.7 ms), so polling this is exactly the
 * app-side change tracking design-012 decision 4 rejects.
 */
export function requestPaint(canvas: HTMLCanvasElement): boolean {
  const c = canvas as unknown as HicCanvas;
  if (typeof c.requestPaint !== "function") return false;
  // Receiver-bound: called THROUGH the owner, never a hoisted reference.
  c.requestPaint();
  return true;
}

/**
 * Subscribe to the source canvas's paint events. Returns an unsubscriber.
 *
 * `addEventListener`, not the `onpaint` property: the property form is ONE
 * handler, and an engine that assigns it silently disconnects whatever the app
 * (or a second consumer) installed — the same clobber class as three assigning
 * `device.onuncapturederror` (design-012 §1.2 gotcha).
 */
export function onPaint(canvas: HTMLCanvasElement, handler: (event: Event) => void): () => void {
  canvas.addEventListener("paint", handler);
  return () => canvas.removeEventListener("paint", handler);
}

/**
 * The elements this paint event says changed, filtered to those the caller
 * knows about. Exact on Chromium 152 (hic-bench: 7/7 mutation shapes name the
 * right cards) — this is the ~100× dirty-upload path (441 KB / 0.21 ms vs
 * 43.5 MB / 7.9 ms), and the reason no full-board code path exists.
 */
export function changedElements(event: Event): readonly Element[] {
  const list = (event as { changedElements?: unknown }).changedElements;
  if (list == null) return [];
  try {
    return Array.from(list as Iterable<Element>);
  } catch {
    return [];
  }
}

/**
 * Copy one element's pixels straight into a GPUTexture (design-012 decision 3
 * — the route that deletes the 2D atlas canvas, which WAS the memory: 126.7 MB
 * at n=100). `origin` addresses a slot inside the paged atlas (Q3).
 *
 * Receiver-bound BY CONSTRUCTION: called as `queue.copyElementImageToTexture(…)`.
 * Hoisting this method off the queue and calling it bare throws "Illegal
 * invocation" — the lesson this whole module exists to hold in one place.
 *
 * `element` MUST be an immediate child of the `layoutsubtree` source canvas.
 * A deeper descendant is refused outright ("Only immediate children of the
 * <canvas> element can be passed to copyElementImageToTexture()"), which is
 * why the L1 layer parents composited hosts directly under the canvas rather
 * than nesting them in a plane div.
 *
 * The copy takes NO explicit extent: it writes the element's own device-pixel
 * size at `origin`. The caller therefore owes the atlas a slot allocated at
 * that same size — the dom source layer re-allocates (which re-slots on a size
 * change) before every copy, because a slot smaller than its element would
 * bleed across the 2 px gutter into a neighbour's pixels.
 *
 * Returns false when the host lacks the method, so callers degrade rather than
 * throw; a composited build should never reach here (the boot probe refused).
 */
export function copyElementToTexture(
  queue: GPUQueue,
  element: Element,
  texture: GPUTexture,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): boolean {
  const q = queue as unknown as HicQueue;
  if (typeof q.copyElementImageToTexture !== "function") return false;
  q.copyElementImageToTexture(
    { source: element },
    // `origin` INSIDE `destination` — see the HicQueue note: the outer
    // position validates and is then ignored.
    { destination: { texture, origin: { x: origin.x, y: origin.y, z: 0 } } },
  );
  return true;
}

/**
 * The 2D route: draw an element into a 2D context, returning the placement
 * matrix the caller writes back onto the element (design-012 §5 law 1 — inside
 * a `layoutsubtree` canvas the transform REPLACES layout, so a write-back is an
 * absolute placement, never a delta).
 *
 * Kept beside the direct copy as the diagnostic/probe path; the compositor's
 * dom sources use {@link copyElementToTexture} (identical pixels — 0/451,584
 * bytes differ — without the atlas canvas).
 */
export function drawElementImage(
  ctx: CanvasRenderingContext2D,
  element: Element,
  x: number,
  y: number,
): DOMMatrix | undefined {
  const c = ctx as unknown as HicContext2D;
  if (typeof c.drawElementImage !== "function") return undefined;
  return c.drawElementImage(element, x, y);
}

/** The host's current placement matrix for an element, when it exposes one. */
export function getElementTransform(
  canvas: HTMLCanvasElement,
  element: Element,
): DOMMatrix | undefined {
  const c = canvas as unknown as HicCanvas;
  if (typeof c.getElementTransform !== "function") return undefined;
  return c.getElementTransform(element);
}
