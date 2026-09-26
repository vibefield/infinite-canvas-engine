// The desk's BYTE STORE (design-015 D-D12; D3w) — the app provides it, the desk names blobs by hash: every
// print's picture is here, content-addressed, for the life of the page (the reference in-memory store). The
// layer reads it (a print met → its picture), a paste or a drop writes it, a scene puts its fixture in it.
import { createMemoryBlobStore } from "@ice/desk/kinds";

export const deskBlobs = createMemoryBlobStore();
