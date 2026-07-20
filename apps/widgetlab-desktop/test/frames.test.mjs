import { describe, expect, it } from "vitest";
import { chunk, createChunker, decodeFrame, encodeFrame } from "../src/frames.mjs";

describe("encodeFrame / decodeFrame", () => {
  it("round-trips a header with a payload", () => {
    const header = { room: "abc", kind: "durable" };
    const payload = Buffer.from("hello world");
    const frame = encodeFrame(header, payload);
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded.header).toEqual(header);
    expect(Buffer.from(decoded.payload).equals(payload)).toBe(true);
  });

  it("round-trips a header with no payload", () => {
    const header = { room: "abc", kind: "ephemeral" };
    const frame = encodeFrame(header);
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded.header).toEqual(header);
    expect(decoded.payload).toBeUndefined();
  });

  it("returns null on a too-short buffer", () => {
    expect(decodeFrame(Buffer.from([1, 2]))).toBeNull();
  });

  it("returns null on a headerLen that overruns the buffer", () => {
    const frame = Buffer.allocUnsafe(4);
    frame.writeUInt32LE(1000, 0);
    expect(decodeFrame(frame)).toBeNull();
  });

  it("returns null on malformed JSON in the header", () => {
    const headerBytes = Buffer.from("{not json", "utf8");
    const frame = Buffer.allocUnsafe(4 + headerBytes.length);
    frame.writeUInt32LE(headerBytes.length, 0);
    headerBytes.copy(frame, 4);
    expect(decodeFrame(frame)).toBeNull();
  });

  it("returns null when the header decodes to a non-object", () => {
    const headerBytes = Buffer.from(JSON.stringify("just a string"), "utf8");
    const frame = Buffer.allocUnsafe(4 + headerBytes.length);
    frame.writeUInt32LE(headerBytes.length, 0);
    headerBytes.copy(frame, 4);
    expect(decodeFrame(frame)).toBeNull();
  });
});

describe("createChunker", () => {
  it("reassembles frames split across arbitrary chunk boundaries", () => {
    const frames = [
      encodeFrame({ room: "a", kind: "durable" }, Buffer.from("one")),
      encodeFrame({ room: "b", kind: "snapshot" }, Buffer.from("two-payload")),
      encodeFrame({ room: "c", kind: "ephemeral" }),
    ];
    const wrapped = Buffer.concat(frames.map(chunk));

    const received = [];
    const pump = createChunker(
      (frame) => received.push(decodeFrame(frame)),
      (why) => {
        throw new Error(`unexpected violation: ${why}`);
      },
    );

    // Feed the whole multi-frame buffer in fixed 7-byte slices — chunk boundaries land mid-header,
    // mid-length-prefix, and mid-payload across the three frames.
    for (let i = 0; i < wrapped.length; i += 7) {
      pump(wrapped.subarray(i, i + 7));
    }

    expect(received).toHaveLength(3);
    expect(received[0].header).toEqual({ room: "a", kind: "durable" });
    expect(Buffer.from(received[0].payload).toString()).toBe("one");
    expect(received[1].header).toEqual({ room: "b", kind: "snapshot" });
    expect(Buffer.from(received[1].payload).toString()).toBe("two-payload");
    expect(received[2].header).toEqual({ room: "c", kind: "ephemeral" });
    expect(received[2].payload).toBeUndefined();
  });

  it("fires onViolation on an oversize frame length", () => {
    const violations = [];
    const pump = createChunker(
      () => {
        throw new Error("unexpected frame");
      },
      (why) => violations.push(why),
      100, // maxFrameBytes
    );

    const oversized = Buffer.allocUnsafe(4);
    oversized.writeUInt32LE(1000, 0);
    pump(oversized);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/exceeds/);
  });

  it("round-trips chunk() wrapping through the chunker", () => {
    const frame = encodeFrame({ room: "x", kind: "durable" }, Buffer.from("payload-bytes"));
    const wrapped = chunk(frame);

    const received = [];
    const pump = createChunker(
      (f) => received.push(f),
      (why) => {
        throw new Error(`unexpected violation: ${why}`);
      },
    );
    pump(wrapped);

    expect(received).toHaveLength(1);
    expect(Buffer.compare(received[0], frame)).toBe(0);
  });
});
