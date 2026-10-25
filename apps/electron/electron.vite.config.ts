import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      reportCompressedSize: false,
      target: "node20"
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(rootDir, "src/shared")
      }
    }
  },
  preload: {
    build: {
      reportCompressedSize: false,
      target: "node20"
    },
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve(rootDir, "src/shared")
      }
    }
  },
  renderer: {
    build: {
      reportCompressedSize: false,
      target: "chrome128"
    },
    resolve: {
      alias: {
        "@shared": resolve(rootDir, "src/shared"),
        "@renderer": resolve(rootDir, "src/renderer/src")
      }
    },
    plugins: [react()]
  }
});
