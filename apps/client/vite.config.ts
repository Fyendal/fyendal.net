import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The card catalog is intentionally isolated and highly compressible
    // static game data (~2.7 MB raw, ~330 KB gzip), not application code.
    chunkSizeWarningLimit: 3_000,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
