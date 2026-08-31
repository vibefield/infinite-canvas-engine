/**
 * The WebGPU renderer leg (design-012 S5) as its own subpath, mirroring
 * `@ice/r3f`'s `./webgpu`: importing it pulls `three/webgpu`, which must never
 * ride along with the plain `./r3f` entry.
 */
export * from "../../r3f/src/webgpu/index";
