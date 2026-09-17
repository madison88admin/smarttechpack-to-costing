import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Components are compiled by Next with the automatic JSX runtime; tests that
  // render them (react-dom/server) must use the same one, otherwise every JSX
  // element in src/ throws "React is not defined".
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "node",
    exclude: ["tests/e2e", "node_modules/**"]
  }
});
