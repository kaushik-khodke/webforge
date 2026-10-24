import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, "frontend"),
  envDir: projectRoot,
  server: { port: 3000, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: resolve(projectRoot, "dist"), emptyOutDir: true },
});
