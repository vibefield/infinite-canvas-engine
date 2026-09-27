// The host's PICTURE DECODER (D3w; photo/blobs.ts `PictureDecoder`) — the one image decode in the desk,
// and so a host file (design-015 §3's `desk-dom-free` wall): an encoded blob (a pasted or dropped PNG,
// JPEG, WebP…) through `createImageBitmap`, its EXIF orientation honoured and its long side scaled to
// at most `max` texels (PICTURE_MAX, 4096) — the prototype's photo lab's `addBlob`, verbatim. The
// photo pass copies the bitmap to a texture (`pictureFrom`), then it is closed. Raw RGBA never comes
// here: the photo kind makes those pictures itself.

import type { DecodedPicture, PictureDecoder } from "../kit/blobs";

export const decodePicture: PictureDecoder = async (blob, max): Promise<DecodedPicture | undefined> => {
  if (typeof createImageBitmap !== "function") return undefined;
  const file = new Blob([blob.bytes], { type: blob.type });
  const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  let { width, height } = probe;
  let bmp = probe;
  const s = Math.min(1, max / Math.max(width, height));
  if (s < 1) {
    width = Math.max(1, Math.round(width * s));
    height = Math.max(1, Math.round(height * s));
    bmp = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
    probe.close();
  }
  return { kind: "source", source: bmp, width, height, close: () => bmp.close() };
};
