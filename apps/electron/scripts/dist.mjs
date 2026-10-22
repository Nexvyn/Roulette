import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const electronViteCli = resolve(projectRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");
const electronBuilderCli = resolve(projectRoot, "node_modules", "electron-builder", "cli.js");
const builderArgs = process.argv.slice(2);
const distDir = resolve(projectRoot, "dist");

async function runNodeScript(scriptPath, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
      env: {
        ...process.env
      }
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${scriptPath} exited with code ${code ?? "unknown"}`));
    });

    child.on("error", rejectPromise);
  });
}

try {
  await runNodeScript(electronViteCli, ["build"]);
  await runNodeScript(electronBuilderCli, [...builderArgs, "--publish", "never"]);
  await cleanupArtifacts(builderArgs);
} catch (error) {
  console.error("Packaging failed.");
  console.error(error);
  process.exit(1);
}

async function cleanupArtifacts(args) {
  const shouldCleanWinArtifacts = args.includes("--win") || args.length === 0;
  if (!shouldCleanWinArtifacts) {
    return;
  }

  await Promise.allSettled([
    rm(resolve(distDir, "builder-debug.yml"), { force: true }),
    rm(resolve(distDir, "win-unpacked"), { recursive: true, force: true }),
    rm(resolve(distDir, "Roulette-0.1.0-win-x64.exe.blockmap"), { force: true })
  ]);
}
