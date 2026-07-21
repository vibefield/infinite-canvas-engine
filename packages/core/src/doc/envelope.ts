/**
 * The file envelope — the engine-owned at-rest format (design-001 §6.5,
 * design-005 §6.2).
 *
 * A document at rest is NEVER raw Loro bytes: it is an engine-versioned frame
 * read BEFORE any import, so the version gate and the autosave quarantine have
 * a hook point that cannot brick boot. Layout (little-endian):
 *
 *   bytes 0..3   magic "ICE1"
 *   byte  4      envelope version (1)
 *   bytes 5..8   u32 header length
 *   ...          header JSON: { engineSchema, prefabVersions, savedAt? }
 *   ...          payload: Loro snapshot bytes (opaque here)
 *
 * WHERE bytes go (fs/IndexedDB/cloud) is app-owned; WHAT they are is this file.
 */

export const ENVELOPE_MAGIC = "ICE1";
export const ENVELOPE_VERSION = 1;
export const MAX_ENVELOPE_HEADER_BYTES = 1024 * 1024;

/** The document-format version this build writes (gate compares against it). */
export const ENGINE_SCHEMA_VERSION = 2; // 2 = ordered relations (petition 8): board-root + ChildOf sibling sequences

export interface EnvelopeHeader {
  readonly engineSchema: number;
  /** Per-prefab pack versions at save time ({ [prefabId]: version }). */
  readonly prefabVersions: Readonly<Record<string, number>>;
  /** App-supplied wall-clock ms (the engine never reads a clock). */
  readonly savedAt?: number;
}

export class EnvelopeError extends Error {
  constructor(
    message: string,
    readonly reason: "magic" | "version" | "truncated" | "header",
  ) {
    super(`ice: envelope — ${message}`);
    this.name = "EnvelopeError";
  }
}

export function encodeEnvelope(header: EnvelopeHeader, payload: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + 1 + 4 + headerBytes.length + payload.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(ENVELOPE_MAGIC), 0);
  out[4] = ENVELOPE_VERSION;
  view.setUint32(5, headerBytes.length, true);
  out.set(headerBytes, 9);
  out.set(payload, 9 + headerBytes.length);
  return out;
}

export function decodeEnvelope(bytes: Uint8Array): { header: EnvelopeHeader; payload: Uint8Array } {
  if (bytes.length < 9) throw new EnvelopeError("too short to hold a frame", "truncated");
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== ENVELOPE_MAGIC) throw new EnvelopeError(`bad magic "${magic}"`, "magic");
  const version = bytes[4];
  if (version !== ENVELOPE_VERSION) {
    throw new EnvelopeError(`unknown envelope version ${version}`, "version");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(5, true);
  if (headerLen > MAX_ENVELOPE_HEADER_BYTES) {
    throw new EnvelopeError(`header exceeds ${MAX_ENVELOPE_HEADER_BYTES} bytes`, "header");
  }
  if (9 + headerLen > bytes.length) throw new EnvelopeError("header overruns the frame", "truncated");
  let header: EnvelopeHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + headerLen))) as EnvelopeHeader;
  } catch {
    throw new EnvelopeError("header is not valid JSON", "header");
  }
  if (
    !Number.isSafeInteger(header.engineSchema) ||
    header.engineSchema < 1 ||
    header.prefabVersions === null ||
    Array.isArray(header.prefabVersions) ||
    typeof header.prefabVersions !== "object" ||
    (header.savedAt !== undefined &&
      (!Number.isSafeInteger(header.savedAt) || header.savedAt < 0))
  ) {
    throw new EnvelopeError("header is missing required fields", "header");
  }
  for (const [id, version] of Object.entries(header.prefabVersions)) {
    if (id.length === 0 || !Number.isSafeInteger(version) || version < 1) {
      throw new EnvelopeError("header carries an invalid prefab version", "header");
    }
  }
  return { header, payload: bytes.subarray(9 + headerLen) };
}
