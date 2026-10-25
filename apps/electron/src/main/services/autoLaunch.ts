import { app } from "electron";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const LINUX_AUTOSTART_DIR = path.join(os.homedir(), ".config", "autostart");
const LINUX_AUTOSTART_FILE = path.join(LINUX_AUTOSTART_DIR, "roulette.desktop");
const HIDDEN_ARG = "--hidden";

export async function setLaunchAtLogin(enabled: boolean): Promise<boolean> {
  if (process.platform === "linux") {
    await setLinuxAutoLaunch(enabled);
    return getLaunchAtLogin();
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
    args: [HIDDEN_ARG]
  });
  return getLaunchAtLogin();
}

export function getLaunchAtLogin(): boolean {
  if (process.platform === "linux") {
    return existsSync(LINUX_AUTOSTART_FILE);
  }

  return app.getLoginItemSettings({
    path: app.getPath("exe"),
    args: [HIDDEN_ARG]
  }).openAtLogin;
}

async function setLinuxAutoLaunch(enabled: boolean): Promise<void> {
  if (enabled) {
    await fs.mkdir(LINUX_AUTOSTART_DIR, { recursive: true });
    await fs.writeFile(
      LINUX_AUTOSTART_FILE,
      `[Desktop Entry]
Type=Application
Version=1.0
Name=Roulette
Comment=Monitor and control local dev servers
Exec="${process.execPath}" ${HIDDEN_ARG}
TryExec=${process.execPath}
Terminal=false
X-GNOME-Autostart-enabled=true
StartupNotify=false
`,
      "utf8"
    );
    return;
  }

  await fs.rm(LINUX_AUTOSTART_FILE, { force: true });
}
