import { app, BrowserWindow, Tray, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PortStore } from "./services/portStore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_WIDTH  = 340;
const WINDOW_HEIGHT = 380;

app.setName("Lyra");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const store = new PortStore();

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
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, "../../resources/icon.png"));
  tray.setToolTip("Lyra");
  tray.on("click", () => mainWindow?.show());
}

app.whenReady().then(async () => {
  await createWindow();
  createTray();
  store.start();
});