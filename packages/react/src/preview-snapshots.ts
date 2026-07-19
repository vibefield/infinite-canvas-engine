/**
 * The GL preview snapshot store (design-005 §2 preview contract, P2 —
 * 2026-07-19). react stays three-free by LAW, so the capture pipeline lives
 * in @ice/r3f and meets `<WidgetPreview>` HERE, at a dumb data seam: a
 * module-level map of widget type → captured image, with subscription so an
 * open palette re-renders the moment a capture lands.
 *
 * `PreviewImage` accepts a canvas alongside ImageBitmap so tests (and any
 * app-side prebuilt-cache policy — the P3 seam) can inject without a GPU.
 */
export type PreviewImage = ImageBitmap | HTMLCanvasElement;

const images = new Map<string, PreviewImage>();
const listeners = new Set<() => void>();

export function setPreviewSnapshot(type: string, image: PreviewImage): void {
  images.set(type, image);
  for (const l of listeners) l();
}

export function getPreviewSnapshot(type: string): PreviewImage | undefined {
  return images.get(type);
}

export function hasPreviewSnapshot(type: string): boolean {
  return images.has(type);
}

export function subscribePreviewSnapshots(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** TEST-ONLY wipe (not on the barrel). */
export function __resetPreviewSnapshotsForTests(): void {
  images.clear();
}
