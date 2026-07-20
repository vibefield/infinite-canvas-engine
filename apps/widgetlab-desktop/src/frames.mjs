/**
 * Mesh frame codec — the hub-to-hub wire format for widgetlab-desktop's mesh.
 *
 * One frame = `u32 LE headerLen | header JSON | payload bytes`, with `room` added so mesh links can
 * multiplex every room over one connection (a browser window's socket is already room-scoped so its
 * frames never carry one). The payload stays OPAQUE: the mesh layer reads ONLY the addressing header,
 * never the payload bytes — the ICE renderer frames stay opaque payloads.
 *
 * On a QUIC stream, frames are chunked as `u32 LE frameLen | frame …` (streams are byte pipes; UDP
 * datagrams carry exactly one un-chunked frame — boundaries are the datagram's own).
 */

/** header = { room, kind } — `lane` marks a stream's first frame; `hb` the UDP heartbeat. */
export function encodeFrame(header, payload) {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const frame = Buffer.allocUnsafe(4 + headerBytes.length + (payload?.length ?? 0));
  frame.writeUInt32LE(headerBytes.length, 0);
  headerBytes.copy(frame, 4);
  if (payload && payload.length > 0) Buffer.from(payload).copy(frame, 4 + headerBytes.length);
  return frame;
}

/** Decode one frame; returns { header, payload } or null on any malformed input (peer-controlled). */
export function decodeFrame(buf) {
  try {
    if (buf.length < 4) return null;
    const headerLen = buf.readUInt32LE(0);
    if (4 + headerLen > buf.length) return null;
    const header = JSON.parse(buf.subarray(4, 4 + headerLen).toString("utf8"));
    if (header === null || typeof header !== "object") return null;
    const payload = buf.length > 4 + headerLen ? buf.subarray(4 + headerLen) : undefined;
    return { header, payload };
  } catch {
    return null;
  }
}

/**
 * Incremental chunker for a QUIC stream: feed arbitrary byte chunks, get whole frames out.
 * A frame length above `maxFrameBytes` is a protocol violation (or corruption) — the stream owner
 * must tear the LINK down, exactly like the WT transport closes on torn framing.
 */
export function createChunker(onFrame, onViolation, maxFrameBytes = 64 * 1024 * 1024) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 4) return;
      const frameLen = pending.readUInt32LE(0);
      if (frameLen > maxFrameBytes) {
        onViolation(`frame length ${frameLen} exceeds ${maxFrameBytes}`);
        return;
      }
      if (pending.length < 4 + frameLen) return;
      const frame = pending.subarray(4, 4 + frameLen);
      pending = pending.subarray(4 + frameLen);
      onFrame(frame);
    }
  };
}

/** Wrap a frame for a QUIC stream write ([u32 LE frameLen][frame]). */
export function chunk(frame) {
  const out = Buffer.allocUnsafe(4 + frame.length);
  out.writeUInt32LE(frame.length, 0);
  frame.copy(out, 4);
  return out;
}
