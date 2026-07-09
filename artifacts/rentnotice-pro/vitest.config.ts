import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone Vitest config — vite.config.ts requires PORT/BASE_PATH env vars
// that are only present in the dev workflow, so tests use this file instead.
export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      // pdfjs' modern build needs browser-only JS features; Node tests must
      // use the legacy build. Bare "pdfjs-dist" only — worker ?url untouched.
      {
        find: /^pdfjs-dist$/,
        replacement: path.resolve(
          __dirname,
          "node_modules/pdfjs-dist/legacy/build/pdf.mjs",
        ),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
