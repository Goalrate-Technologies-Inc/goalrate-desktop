import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Tauri expects a fixed port for development
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Prevent vite from obscuring rust errors
  clearScreen: false,
  server: {
    host: host || false,
    port: 5174, // Different from web app (5173)
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // Tauri specific build settings
  build: {
    // Tauri supports es2021
    target: process.env.TAURI_ENV_PLATFORM === "windows"
      ? "chrome105"
      : "safari14",
    // Don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined
          }
          if (id.includes("@tauri-apps")) {
            return "tauri"
          }
          if (id.includes("react") || id.includes("scheduler")) {
            return "react"
          }
          if (id.includes("@radix-ui")) {
            return "radix"
          }
          if (id.includes("@dnd-kit")) {
            return "dnd"
          }
          if (id.includes("tiptap") || id.includes("prosemirror")) {
            return "editor"
          }
          return undefined
        },
      },
    },
  },
  // Env prefix for Tauri
  envPrefix: ["VITE_", "TAURI_ENV_*"],
})
