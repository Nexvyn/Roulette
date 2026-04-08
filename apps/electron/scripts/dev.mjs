import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const cliPath = resolve(projectRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");
const configFile = resolve(projectRoot, "electron.vite.config.ts");

const child = spawn(process.execPath, [cliPath, "dev", "--config", configFile], {
  cwd: projectRoot,
  stdio: "inherit",
  env: {
    ...process.env
  }
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to start electron-vite dev server.");
  console.error(error);
  process.exit(1);
});
