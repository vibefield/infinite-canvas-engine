import { defineConfig } from "vite";

// Plain-TS demo (no framework plugin). The @ice/* workspace packages resolve
// through their package.json `exports` to source, so vite bundles them directly.
export default defineConfig({
  server: { open: false },
});
