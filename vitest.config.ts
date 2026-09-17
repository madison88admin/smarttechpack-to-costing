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
    exclude: ["tests/e2e", "node_modules/**"],
    // Fails a unit test that reaches the live network, so an upstream outage or a
    // slow ERP can never decide our suite's colour (see tests/setup/network-guard.ts).
    setupFiles: ["./tests/setup/network-guard.ts"]
  }
});
