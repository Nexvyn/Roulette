import { app, BrowserWindow, ipcMain, Tray, Menu, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PortStore } from "./services/portStore";
import { getSettings, updateSettings } from "./services/settings";
import { setLaunchAtLogin } from "./services/autoLaunch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_WIDTH  = 340;
const WINDOW_HEIGHT = 380;
const WINDOW_MARGIN = 12;
const localAppData  = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.cwd();
const userDataPath  = path.join(localAppData, "Lyra");

app.setName("Lyra");
app.setPath("userData", userDataPath);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const store = new PortStore();

if (!app.requestSingleInstanceLock()) { app.exit(0); }

app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    title: "Lyra",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: process.platform === "darwin",
    backgroundMaterial: process.platform === "win32" ? "acrylic" : "auto",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  }
}

function createTray() {
  tray = new Tray(path.join(__dirname, "../../resources/icon.png"));
  tray.setToolTip("Lyra");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Lyra", click: () => mainWindow?.show() },
    { label: "Quit", click: () => { app.exit(0); } }
  ]));
  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else mainWindow?.show();
  });
}

function wireIpc() {
  ipcMain.handle("state:get",     () => store.getState());
  ipcMain.handle("settings:get",  () => getSettings());
  ipcMain.handle("scan:now",      () => store.scanNow());
  ipcMain.handle("ports:kill",    (_e, port: number) => store.killPort(port));
  ipcMain.handle("ports:killAll", () => store.killAll());
  ipcMain.handle("ports:rename",  (_e, p: { port: number; name: string }) => store.renamePort(p.port, p.name));
  ipcMain.handle("ports:pin",     (_e, p: { port: number; pinned: boolean }) => store.pinPort(p.port, p.pinned));
  ipcMain.handle("settings:update", (_e, patch) => updateSettings(patch));
  ipcMain.handle("settings:launchAtLogin", (_e, val: boolean) => setLaunchAtLogin(val));
  ipcMain.handle("app:quit", () => app.exit(0));
  store.on("state", s => mainWindow?.webContents.send("state:changed", s));
}

app.whenReady().then(async () => {
  await createWindow();
  createTray();
  wireIpc();
  store.start(getSettings().refreshIntervalSeconds);
});