import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    ssr: "src/entry-server.tsx",
    outDir: path.resolve(import.meta.dirname, "dist/server"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        format: "esm",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
