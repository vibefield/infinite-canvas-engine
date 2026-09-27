// A picture PASTED or DROPPED onto the desk becomes a print (PHOTO.md §3; D3w): its bytes into the app's
// BlobStore (the hash is the print's `blob`), its size from one decode (the host's `decodePicture`, EXIF
// honoured, the long side ≤ PICTURE_MAX), the print spawned in ONE undoable transaction where it lands — under
// the pointer for a paste (the view's centre if the pointer was never seen), where the drop fell for a drop, a
// few units apart for several, each turned a few degrees as a hand leaves it — and told to ARRIVE (it falls from
// the law's height onto its place and fades in: flux, no second transaction). The desk's keys and pointer path
// stay core's; these are the document's own paste and drop events, bubbling, never capture-phase.
import { Camera, type CanvasEngine, defineQuery, type Entity, LocalPointer, Pointer, PointerWorld, Viewport } from "@ice/core";
import { decodePicture, type DeskLayerHandle } from "@ice/desk";
import { printRect, type Prints } from "@ice/desk";
import { PHOTO_TYPE } from "@ice/objects";
import { deskBlobs } from "./blobs";
import { spawnAll } from "./scene";

const mouseQ = defineQuery([Pointer, LocalPointer, PointerWorld]);
const PICTURE_MAX = 4096;

/** Where a new object goes: under the mouse once it has been seen, else the view's centre (the prototype's `placeWorld`). */
export function placeWorld(engine: CanvasEngine): { x: number; y: number } {
  const { world } = engine;
  let at: { x: number; y: number } | null = null;
  world.query(mouseQ).each((b) => { for (const r of b) { const p = b.entity(r); if (world.read(p, Pointer).device === "mouse") { const w = world.read(p, PointerWorld); at = { x: w.x, y: w.y }; } } });
  if (at !== null) return at;
  const cam = world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
  const vp = world.getResource(Viewport) ?? { w: 0, h: 0 };
  return { x: cam.x + vp.w / (2 * cam.zoom), y: cam.y + vp.h / (2 * cam.zoom) };
}

/** Lay one picture as a print at `at`: stored, sized, spawned (one undo step), arriving. Resolves to the print, or undefined when it cannot be decoded. */
export async function layPicture(engine: CanvasEngine, handle: DeskLayerHandle, file: Blob, at: { readonly x: number; readonly y: number }, k = 0): Promise<Entity | undefined> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = await decodePicture({ bytes, type: file.type }, PICTURE_MAX);
  if (decoded === undefined) return undefined;
  const { width, height } = decoded;
  if (decoded.kind === "source") decoded.close?.();
  const blob = await deskBlobs.put(bytes, file.type);
  const r = printRect(at.x + k * 34, at.y + k * 26, width, height);
  const angle = ((Math.random() * 2 - 1) * 6 * Math.PI) / 180;
  const [e] = spawnAll(engine, [{ type: PHOTO_TYPE, cx: r.cx, cy: r.cy, w: r.w, h: r.h, props: { blob, width, height, angle } }], true);
  if (e === undefined) return undefined;
  (handle.local("photo") as Prints | undefined)?.arrive(e);
  return e;
}

/** The document's paste and drop, as prints. Returns the undo. */
export function installPictureDrop(engine: CanvasEngine, handle: DeskLayerHandle, fail: (e: unknown) => void): () => void {
  const images = (files: readonly (File | null)[]): File[] => files.filter((f): f is File => f?.type.startsWith("image/") === true);
  const onPaste = (e: ClipboardEvent): void => {
    const files = images([...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()));
    if (files.length === 0) return;
    e.preventDefault();
    const at = placeWorld(engine);
    files.forEach((f, k) => { layPicture(engine, handle, f, at, k).catch(fail); });
  };
  const onDragOver = (e: DragEvent): void => { if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } };
  const onDrop = (e: DragEvent): void => {
    const files = images([...(e.dataTransfer?.files ?? [])]);
    if (files.length === 0) return;
    e.preventDefault();
    const cam = engine.world.getResource(Camera) ?? { x: 0, y: 0, zoom: 1 };
    const at = { x: cam.x + e.clientX / cam.zoom, y: cam.y + e.clientY / cam.zoom };
    files.forEach((f, k) => { layPicture(engine, handle, f, at, k).catch(fail); });
  };
  document.addEventListener("paste", onPaste);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("drop", onDrop);
  return () => { document.removeEventListener("paste", onPaste); document.removeEventListener("dragover", onDragOver); document.removeEventListener("drop", onDrop); };
}
