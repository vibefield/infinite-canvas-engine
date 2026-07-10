import { defineConfig } from "vitest/config";

// The FBO pool, resource registry, and composite material are pure three
// resources — Three's WebGLRenderTarget / ShaderMaterial construct headlessly
// without a GL context or DOM, so these unit tests run under the plain node
// environment (no happy-dom needed, unlike @ice/dom / @ice/react).
export default defineConfig({
  test: { environment: "node" },
});
