/**
 * The sRGB and MSAA gotchas as NAMED regression tests (design-012 §9 S5 exit:
 * "sRGB/MSAA gotchas as named tests").
 *
 * Both are gotchas rather than bugs because both fail SILENTLY and plausibly:
 * a missed sRGB re-encode renders a washed-out board that looks like a design
 * choice, and a compatibility device renders aliased islands that look like a
 * low-end GPU. Neither throws, neither warns, and neither is visible in a
 * screenshot unless you already know to look. So each gets a test that asks the
 * question the way the shader will have to ask it.
 *
 * The fakes here mirror three 0.185.1's real backend record — see
 * `src/webgpu-backend.ts` for the file:line citations that shape them. What is
 * NOT faked is the logic under test: these functions are the entire mechanism
 * by which a format reaches ground's re-encode guard.
 */
import {
  backendTexture,
  backendTextureIsSrgb,
  backendTextureRecord,
} from "@ice/core";
import { describe, expect, it } from "vitest";
import {
  backendDevice,
  hasWebGpuBackend,
  islandFormat,
  islandIsMultisampled,
  islandIsSrgb,
  islandTexture,
  type BackendTextureRecord,
} from "../src/webgpu-backend";

/** A stand-in for three's `WebGPUBackend`, keyed the way `backend.get` is. */
function fakeRenderer(
  records: Map<object, BackendTextureRecord>,
  device?: object,
): { backend: { device?: GPUDevice; get(o: object): BackendTextureRecord | undefined } } {
  return {
    backend: {
      ...(device === undefined ? {} : { device: device as GPUDevice }),
      get: (o: object) => records.get(o),
    },
  };
}

const texture = (): object => ({ id: "rt.texture" });
const gpuTexture = (): GPUTexture => ({ label: "gpu" }) as unknown as GPUTexture;

describe("the sRGB law: the guard reads the ACTUAL format, never the request", () => {
  // design-012 §4: "island targets are `-srgb`, the swap chain is not —
  // re-encode in WGSL guarded by the target's ACTUAL GPU format."
  it("reports srgb for the format three really creates an SRGBColorSpace target with", () => {
    const rt = texture();
    const records = new Map<object, BackendTextureRecord>([
      [rt, { texture: gpuTexture(), textureDescriptorGPU: { format: "rgba8unorm-srgb" } as GPUTextureDescriptor }],
    ]);
    const renderer = fakeRenderer(records);
    expect(islandFormat(renderer, rt)).toBe("rgba8unorm-srgb");
    expect(islandIsSrgb(renderer, rt)).toBe(true);
  });

  it("reports NOT srgb for a linear format, so the shader does not double-encode", () => {
    const rt = texture();
    const records = new Map<object, BackendTextureRecord>([
      [rt, { texture: gpuTexture(), textureDescriptorGPU: { format: "rgba8unorm" } as GPUTextureDescriptor }],
    ]);
    expect(islandIsSrgb(fakeRenderer(records), rt)).toBe(false);
  });

  // The guard is on the SUFFIX because that is what WebGPU actually promises:
  // any `-srgb` view decodes on sample. bgra8unorm-srgb is the same story as
  // rgba8unorm-srgb, and a guard that named one format by hand would miss it.
  it("recognises every -srgb format, not just the one three happens to pick today", () => {
    for (const format of ["bgra8unorm-srgb", "rgba8unorm-srgb"] as const) {
      const rt = texture();
      const records = new Map<object, BackendTextureRecord>([
        [rt, { textureDescriptorGPU: { format } as GPUTextureDescriptor }],
      ]);
      expect(islandIsSrgb(fakeRenderer(records), rt)).toBe(true);
    }
    for (const format of ["bgra8unorm", "rgba16float"] as const) {
      const rt = texture();
      const records = new Map<object, BackendTextureRecord>([
        [rt, { textureDescriptorGPU: { format } as GPUTextureDescriptor }],
      ]);
      expect(islandIsSrgb(fakeRenderer(records), rt)).toBe(false);
    }
  });

  // Reading before the first paint is NORMAL — three allocates lazily — so the
  // honest answer is "nothing to sample", which pairs with texture() being
  // undefined. Guessing `true` here would tell the shader to re-encode pixels
  // that do not exist.
  it("answers false, not undefined-shaped garbage, before three has allocated", () => {
    const rt = texture();
    const renderer = fakeRenderer(new Map());
    expect(islandTexture(renderer, rt)).toBeUndefined();
    expect(islandFormat(renderer, rt)).toBeUndefined();
    expect(islandIsSrgb(renderer, rt)).toBe(false);
  });
});

describe("the MSAA trap: ask the GPU, do not trust the request", () => {
  // three's own adapter asks for `featureLevel: 'compatibility'`
  // (WebGPUBackend.js:213); such a device lacks core-features-and-limits, and
  // three then force-sets `renderer._samples = 0` (:254-258). Every island
  // target we asked for at samples:4 silently becomes single-sample. The only
  // honest witness is the separate msaaTexture the backend allocates.
  it("sees MSAA when the backend really allocated a multisample surface", () => {
    const rt = texture();
    const records = new Map<object, BackendTextureRecord>([
      [rt, { texture: gpuTexture(), msaaTexture: gpuTexture() }],
    ]);
    expect(islandIsMultisampled(fakeRenderer(records), rt)).toBe(true);
  });

  it("sees NO MSAA when three silently dropped it (compatibilityMode)", () => {
    const rt = texture();
    // The exact shape of the trap: the target exists, renders fine, and is
    // single-sample. `samples: 4` was requested and quietly ignored.
    const records = new Map<object, BackendTextureRecord>([[rt, { texture: gpuTexture() }]]);
    expect(islandIsMultisampled(fakeRenderer(records), rt)).toBe(false);
  });

  // WebGPUUtils.js:127-128 sets primarySamples = 1 for a multisampled target,
  // so `record.texture` is the SINGLE-SAMPLE resolve image and
  // WebGPUBackend.js:672-688 names it as the pass's resolveTarget. Binding the
  // msaaTexture instead would be a validation error every composite.
  it("returns the RESOLVED texture, never the multisampled attachment", () => {
    const rt = texture();
    const resolved = gpuTexture();
    const multisampled = gpuTexture();
    const records = new Map<object, BackendTextureRecord>([
      [rt, { texture: resolved, msaaTexture: multisampled }],
    ]);
    expect(islandTexture(fakeRenderer(records), rt)).toBe(resolved);
    expect(islandTexture(fakeRenderer(records), rt)).not.toBe(multisampled);
  });
});

describe("backend probes", () => {
  it("recognises a WebGPU backend and rejects a WebGL renderer", () => {
    expect(hasWebGpuBackend(fakeRenderer(new Map()))).toBe(true);
    // A WebGL renderer has no `backend` at all — this is the check that keeps a
    // composited mount from publishing sources that can never resolve.
    expect(hasWebGpuBackend({ domElement: {} })).toBe(false);
    expect(hasWebGpuBackend(undefined)).toBe(false);
    expect(hasWebGpuBackend(null)).toBe(false);
  });

  it("reports the device three actually ended up on (adoption is checked by identity)", () => {
    const device = { label: "app-owned" };
    expect(backendDevice(fakeRenderer(new Map(), device))).toBe(device);
    expect(backendDevice(fakeRenderer(new Map()))).toBeUndefined();
  });
});

describe("the convergence with core (S8's naming-pass ruling)", () => {
  /**
   * From S6b to S8 there were TWO copies of the unsupported read — this
   * package's and core's — and the whole justification for quarantining it was
   * "one file changes when three moves the record", which two copies make
   * false. They are now one: these probes are ISLAND VOCABULARY over core's
   * reader.
   *
   * This is a fence against RE-FORKING rather than a test of today's
   * delegation, which is true by construction. If someone re-implements a
   * record read here and it drifts — a different optional-chaining depth, a
   * format compared case-sensitively, a `msaaTexture` check that treats null
   * differently — this reds where nothing else would.
   */
  it("agrees with core's reader on every record shape, field for field", () => {
    const cases: Array<[string, BackendTextureRecord | undefined]> = [
      [
        "srgb + msaa",
        {
          texture: gpuTexture(),
          msaaTexture: gpuTexture(),
          textureDescriptorGPU: { format: "rgba8unorm-srgb" } as GPUTextureDescriptor,
        },
      ],
      [
        "linear, resolved only",
        { texture: gpuTexture(), textureDescriptorGPU: { format: "bgra8unorm" } as GPUTextureDescriptor },
      ],
      ["allocated, no descriptor yet", { texture: gpuTexture() }],
      ["record exists, nothing allocated", {}],
      ["no record at all", undefined],
    ];
    for (const [name, record] of cases) {
      const rt = texture();
      const records = new Map<object, BackendTextureRecord>();
      if (record !== undefined) records.set(rt, record);
      const renderer = fakeRenderer(records);
      expect(islandTexture(renderer, rt), name).toBe(backendTexture(renderer, rt));
      expect(islandIsSrgb(renderer, rt), name).toBe(backendTextureIsSrgb(renderer, rt));
      expect(islandFormat(renderer, rt), name).toBe(
        backendTextureRecord(renderer, rt)?.textureDescriptorGPU?.format,
      );
    }
  });
});
