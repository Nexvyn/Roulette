import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PortContextMenuPayload } from "@shared/contracts";
import { PortStore } from "./services/portStore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL ?? "";
const isDev = devServerUrl.length > 0;
const launchHidden = process.argv.includes("--hidden");
const localAppData = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.env.TEMP ?? process.cwd();
const userDataPath = path.join(localAppData, "Lyra");
const rendererHtmlPath = path.join(__dirname, "../renderer/index.html");
const WINDOW_WIDTH = 340;
const WINDOW_HEIGHT = 380;
const WINDOW_MARGIN = 12;

app.setName("Lyra");
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disk-cache-dir", path.join(userDataPath, "Cache"));

if (isDev) {
  app.commandLine.appendSwitch("disable-http-cache");
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const store = new PortStore();

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

app.on("second-instance", () => {
  if (mainWindow) {
    positionWindowNearTray();
    mainWindow.show();
    mainWindow.focus();
  }
});

async function loadRenderer(window: BrowserWindow) {
  if (isDev) {
    await window.loadURL(devServerUrl);
    return;
  }

  if (!fs.existsSync(rendererHtmlPath)) {
    throw new Error(`Renderer build output is missing: ${rendererHtmlPath}`);
  }

  await window.loadFile(rendererHtmlPath);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_WIDTH,
    minHeight: 80,
    maxWidth: WINDOW_WIDTH,
    maxHeight: 600,
    show: false,
    center: true,
    frame: false,
    title: "Lyra",
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    transparent: process.platform === "darwin",
    backgroundMaterial: process.platform === "win32" ? "acrylic" : "auto",
    vibrancy: process.platform === "darwin" ? "menu" : undefined,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  if (isDev) {
    await session.defaultSession.clearCache();
    await mainWindow.webContents.session.clearCache();
  }

  mainWindow.setAlwaysOnTop(true, process.platform === "darwin" ? "floating" : "pop-up-menu");

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("blur", () => {
    if (process.platform === "darwin" && !isQuitting) {
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await loadRenderer(mainWindow);

  if (!launchHidden && process.platform === "darwin") {
    positionWindowNearTray();
    mainWindow.show();
  }
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Lyra");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", () => {
    void toggleWindow();
  });
  tray.on("right-click", () => {
    tray?.popUpContextMenu(buildTrayMenu());
  });
}

function buildTrayMenu() {
  const visible = mainWindow?.isVisible() ?? false;
  return Menu.buildFromTemplate([
    {
      label: visible ? "Hide Lyra" : "Show Lyra",
      click: () => {
        void toggleWindow();
      }
    },
    {
      label: "Refresh",
      click: () => {
        void store.scanNow();
      }
    },
    {
      label: store.getSettings().launchAtLogin ? "Disable Launch at Login" : "Enable Launch at Login",
      click: () => {
        void store.toggleLaunchAtLogin(!store.getSettings().launchAtLogin);
      }
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

async function toggleWindow() {
  if (!mainWindow) {
    await createWindow();
  }

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    tray?.setContextMenu(buildTrayMenu());
    return;
  }

  positionWindowNearTray();
  mainWindow.show();
  mainWindow.focus();
  tray?.setContextMenu(buildTrayMenu());
}

function positionWindowNearTray() {
  if (!mainWindow) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const workArea = display.workArea;
  const trayBounds = tray?.getBounds();
  const anchor = resolveTrayAnchor(workArea, trayBounds);
  const winH = mainWindow.getBounds().height;

  let x = workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN;
  let y = workArea.y + WINDOW_MARGIN;

  if (anchor) {
    if (anchor.edge === "top") {
      x = anchor.x - Math.round(WINDOW_WIDTH / 2);
      y = anchor.y + WINDOW_MARGIN;
    } else if (anchor.edge === "bottom") {
      x = anchor.x - Math.round(WINDOW_WIDTH / 2);
      y = anchor.y - winH - WINDOW_MARGIN;
    } else if (anchor.edge === "left") {
      x = anchor.x + WINDOW_MARGIN;
      y = anchor.y - Math.round(winH / 2);
    } else {
      x = anchor.x - WINDOW_WIDTH - WINDOW_MARGIN;
      y = anchor.y - Math.round(winH / 2);
    }
  } else if (process.platform !== "darwin") {
    y = workArea.y + workArea.height - winH - WINDOW_MARGIN;
  }

  x = clamp(x, workArea.x + WINDOW_MARGIN, workArea.x + workArea.width - WINDOW_WIDTH - WINDOW_MARGIN);
  y = clamp(y, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - winH - WINDOW_MARGIN);
  mainWindow.setPosition(x, y, false);
}

function resolveTrayAnchor(
  workArea: Electron.Rectangle,
  trayBounds: Electron.Rectangle | undefined
): { x: number; y: number; edge: "top" | "bottom" | "left" | "right" } | null {
  if (!trayBounds || trayBounds.width <= 0 || trayBounds.height <= 0) {
    return null;
  }

  const centerX = trayBounds.x + Math.round(trayBounds.width / 2);
  const centerY = trayBounds.y + Math.round(trayBounds.height / 2);
  const distances = {
    top: Math.abs(centerY - workArea.y),
    bottom: Math.abs(workArea.y + workArea.height - centerY),
    left: Math.abs(centerX - workArea.x),
    right: Math.abs(workArea.x + workArea.width - centerX)
  };

  const edge = (Object.entries(distances).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "top") as
    | "top"
    | "bottom"
    | "left"
    | "right";

  if (edge === "top") {
    return { x: centerX, y: trayBounds.y + trayBounds.height, edge };
  }

  if (edge === "bottom") {
    return { x: centerX, y: trayBounds.y, edge };
  }

  if (edge === "left") {
    return { x: trayBounds.x + trayBounds.width, y: centerY, edge };
  }

  return { x: trayBounds.x, y: centerY, edge: "right" };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r="8" fill="#d22f27"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function wireIpc() {
  ipcMain.handle("state:get", () => store.getState());
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("scan:now", async () => {
    await store.scanNow();
  });
  ipcMain.handle("ports:kill", async (_event, payload: { port: number; pid: number }) => {
    await store.killPort(payload.port, payload.pid);
  });
  ipcMain.handle("ports:killAll", async () => {
    await store.killAll();
  });
  ipcMain.handle("ports:rename", async (_event, payload: { port: number; name: string }) => {
    store.renamePort(payload.port, payload.name);
  });
  ipcMain.handle("ports:rename:reset", async (_event, port: number) => {
    store.resetPortName(port);
  });
  ipcMain.handle("ports:pin", async (_event, payload: { port: number; pinned: boolean }) => {
    store.setPinned(payload.port, payload.pinned);
  });
  ipcMain.handle("ports:open", async (_event, port: number) => {
    await store.openPort(port);
  });
  ipcMain.handle("clipboard:url", (_event, url: string) => {
    store.copyUrl(url);
  });
  ipcMain.handle("clipboard:port", (_event, port: number) => {
    store.copyPort(port);
  });
  ipcMain.handle("settings:update", (_event, patch) => {
    return store.updateSettings(patch);
  });
  ipcMain.handle("settings:launchAtLogin", async (_event, enabled: boolean) => {
    return store.toggleLaunchAtLogin(enabled);
  });
  ipcMain.handle("app:quit", () => {
    app.quit();
  });
  ipcMain.on("window:resize", (_event, height: number) => {
    if (!mainWindow) {
      return;
    }
    const clamped = Math.max(80, Math.min(Math.ceil(height), 600));
    const [, current] = mainWindow.getContentSize();
    if (Math.abs(current - clamped) < 2) {
      return;
    }
    mainWindow.setContentSize(WINDOW_WIDTH, clamped);
    if (mainWindow.isVisible()) {
      positionWindowNearTray();
    }
  });
  ipcMain.handle("ports:menu", (_event, payload: PortContextMenuPayload) => {
    const menu = Menu.buildFromTemplate([
      {
        label: payload.pinned ? "Unpin" : "Pin to Top",
        click: () => store.setPinned(payload.port, !payload.pinned)
      },
      { type: "separator" },
      {
        label: "Copy URL",
        click: () => store.copyUrl(payload.url)
      },
      {
        label: "Copy Port",
        click: () => store.copyPort(payload.port)
      },
      { type: "separator" },
      {
        label: "Open in Browser",
        click: () => {
          void store.openPort(payload.port);
        }
      },
      { type: "separator" },
      {
        label: "Kill Server",
        click: () => {
          void store.killPort(payload.port, payload.pid);
        }
      }
    ]);
    menu.popup({
      window: mainWindow ?? undefined
    });
  });

  store.on("state", (state) => {
    mainWindow?.webContents.send("state:changed", state);
    tray?.setToolTip(state.entries.length ? `Lyra (${state.entries.length})` : "Lyra");
    tray?.setContextMenu(buildTrayMenu());
  });
}

app.whenReady().then(async () => {
  try {
    await createWindow();
    createTray();
    wireIpc();
    store.start();
  } catch (error) {
    console.error("[app:start-failed]", error);
    app.quit();
  }
});

app.on("activate", async () => {
  try {
    await toggleWindow();
  } catch (error) {
    console.error("[app:activate-failed]", error);
  }
});

app.on("window-all-closed", () => {
  // Tray-only app: keep the process resident until Quit is chosen.
});

app.on("before-quit", () => {
  isQuitting = true;
  store.stop();
});

