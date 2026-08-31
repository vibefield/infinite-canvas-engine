/**
 * WebGPU's usage/stage flag namespaces, resolved safely.
 *
 * `GPUBufferUsage`, `GPUTextureUsage` and `GPUShaderStage` are runtime GLOBALS,
 * not types — present in a browser or Electron renderer with WebGPU, absent in
 * Node. `@webgpu/types` declares them, so naming them typechecks everywhere and
 * then throws `ReferenceError` the moment a headless test imports the module
 * that used one, even though that test never intended to touch a real device.
 *
 * The compositor's headless tests deliberately drive it with a fake device, so
 * the module must be IMPORTABLE without WebGPU. These read the real namespaces
 * where they exist and fall back to the specification's own values otherwise —
 * which are fixed by the spec's IDL constants, not implementation details.
 */

interface BufferUsageFlags {
  readonly MAP_READ: number;
  readonly MAP_WRITE: number;
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly INDEX: number;
  readonly VERTEX: number;
  readonly UNIFORM: number;
  readonly STORAGE: number;
  readonly INDIRECT: number;
  readonly QUERY_RESOLVE: number;
}

interface TextureUsageFlags {
  readonly COPY_SRC: number;
  readonly COPY_DST: number;
  readonly TEXTURE_BINDING: number;
  readonly STORAGE_BINDING: number;
  readonly RENDER_ATTACHMENT: number;
}

interface ShaderStageFlags {
  readonly VERTEX: number;
  readonly FRAGMENT: number;
  readonly COMPUTE: number;
}

interface FlagHost {
  GPUBufferUsage?: BufferUsageFlags;
  GPUTextureUsage?: TextureUsageFlags;
  GPUShaderStage?: ShaderStageFlags;
}

const host = globalThis as unknown as FlagHost;

export const BufferUsage: BufferUsageFlags = host.GPUBufferUsage ?? {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

export const TextureUsage: TextureUsageFlags = host.GPUTextureUsage ?? {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

export const ShaderStage: ShaderStageFlags = host.GPUShaderStage ?? {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};
