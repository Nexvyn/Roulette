import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      minify: "esbuild",
      reportCompressedSize: false,
      target: "node20"
    },
    esbuild: {
      drop: ["console", "debugger"],
      legalComments: "none"
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
      minify: "esbuild",
      reportCompressedSize: false,
      target: "node20"
    },
    esbuild: {
      drop: ["console", "debugger"],
      legalComments: "none"
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
      minify: "esbuild",
      reportCompressedSize: false,
      target: "chrome128"
    },
    esbuild: {
      drop: ["console", "debugger"],
      legalComments: "none"
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
