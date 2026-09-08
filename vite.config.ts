import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  build: {
    // The audio worklet must be a real file: it is loaded by URL with
    // audioWorklet.addModule, and a small asset would otherwise be inlined
    // as a data: URL, which not every WebView accepts for worklet modules.
    assetsInlineLimit: (file) => (file.endsWith(".worklet.js") ? false : undefined),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
      // 4. this project lives in a OneDrive folder, where native file events
      //    are unreliable: edits were silently missed and stale modules served.
      //    Polling is slower but never misses a write.
      usePolling: true,
      interval: 300,
    },
  },
}));
