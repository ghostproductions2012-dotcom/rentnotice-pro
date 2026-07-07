import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone Vitest config — vite.config.ts requires PORT/BASE_PATH env vars
// that are only present in the dev workflow, so tests use this file instead.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
