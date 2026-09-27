// (The kit's since K4a, design-016 §5 — moved from photo/blobs.ts: a host service the contract names, `KindHost.blobs`.)
//
// A print's BYTES (design-015 D-D12; D3w): a picture is not a durable cell — strata has no bytes field,
// and a photo is megabytes — so a print's durable props name its picture by the HASH of its bytes
// (`blob`), and the bytes live in a store the APP provides: content-addressed, `put` answering the
// hash, `get` the bytes and their media type. The desk never keeps bytes itself: the photo kind's
// world half (kinds/photo.ts) asks the store for a print's blob the first time it meets the print,
// decodes it — raw RGBA (the committed fixture, `RGBA_TYPE`) by itself, anything else through the
// host's decoder (desk/host: `createImageBitmap`, the one DOM touch) — and makes the pass's
// `Picture` (D-D3r-a.2: the picture handle is the pass's; its lifetime is the world half's).
//
// `createMemoryBlobStore` is the reference store — a Map in memory, what apps/desk hands the layer —
// and `hashBytes` the name every store must give: SHA-256, lowercase hex, over the bytes alone.

/** A blob as the store holds it: its bytes and its media type (`image/png`, `RGBA_TYPE`, …). */
export interface StoredBlob {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly type: string;
}

/** The app's content-addressed byte store (D-D12): the desk names a blob by its hash; keeping the bytes is the app's. */
export interface BlobStore {
  /** Keep `bytes` (idempotent by content); resolves to their hash — the name a print's `blob` prop carries. */
  put(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<string>;
  /** The blob under a hash, or undefined when the store has none (a peer's picture not arrived yet, a hash from another desk). */
  get(hash: string): Promise<StoredBlob | undefined>;
}

/** A picture ready for the pass: raw RGBA rows, or a source the device copies from (a browser's `ImageBitmap`) — closed once uploaded. */
export type DecodedPicture =
  | { readonly kind: "rgba"; readonly bytes: Uint8Array<ArrayBuffer>; readonly width: number; readonly height: number }
  | { readonly kind: "source"; readonly source: unknown; readonly width: number; readonly height: number; close?(): void };

/** The host's decoder for an encoded blob, scaled so its long side is at most `max` texels; undefined when it cannot. */
export type PictureDecoder = (blob: StoredBlob, max: number) => Promise<DecodedPicture | undefined>;

/** Raw RGBA8 rows, row-major, no header — the one media type the desk decodes itself (its size is the print's `width` × `height`). */
export const RGBA_TYPE = "image/x-ice-rgba";

/** The name a blob goes by: SHA-256 over its bytes, lowercase hex. */
export async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The reference store: every blob in a Map, for the life of the page. */
export function createMemoryBlobStore(): BlobStore & { size(): number } {
  const blobs = new Map<string, StoredBlob>();
  return {
    async put(bytes, type) {
      const hash = await hashBytes(bytes);
      if (!blobs.has(hash)) blobs.set(hash, { bytes: bytes.slice(), type });
      return hash;
    },
    async get(hash) { return blobs.get(hash); },
    size: () => blobs.size,
  };
}
