const { app, BrowserWindow, shell } = require("electron");
const { spawn, execSync } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 23337);
const PROJECT_ROOT = path.join(__dirname, "..");
const APP_URL = `http://127.0.0.1:${PORT}/`;
const isDev = process.env.WRITING_AGENT_ELECTRON_DEV === "1";

/** @type {import('child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let cleaningUp = false;

function getPidsOnPort(port) {
  const pids = new Set();

  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr ":${port} " | findstr "LISTENING"`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid) && pid !== "0") {
          pids.add(Number(pid));
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const line of out.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (pid > 0) pids.add(pid);
      }
    }
  } catch {
    /* no listeners */
  }

  return [...pids];
}

function killPidTree(pid) {
  if (!pid || pid <= 0) return;

  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* already exited */
  }
}

function killPortListeners(port) {
  for (const pid of getPidsOnPort(port)) {
    killPidTree(pid);
  }
}

function waitForServer(maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const tryOnce = () => {
      const req = http.get(`${APP_URL}api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          scheduleRetry();
        }
      });
      req.on("error", scheduleRetry);
      req.setTimeout(2000, () => {
        req.destroy();
        scheduleRetry();
      });
    };

    const scheduleRetry = () => {
      attempts += 1;
      if (attempts >= maxAttempts) {
        reject(new Error(`后端未在 ${PORT} 端口就绪`));
        return;
      }
      setTimeout(tryOnce, 500);
    };

    tryOnce();
  });
}

function startServer() {
  const isWin = process.platform === "win32";
  serverProcess = spawn(isWin ? "npm.cmd" : "npm", ["run", "web"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
    shell: isWin,
  });

  serverProcess.on("error", (err) => {
    console.error("[electron] 启动后端失败:", err);
  });
}

function killServer() {
  if (cleaningUp) return;
  cleaningUp = true;

  const pid = serverProcess?.pid;
  serverProcess = null;

  if (pid) {
    killPidTree(pid);
  }

  killPortListeners(PORT);
}

function registerCleanupHandlers() {
  const cleanup = () => {
    killServer();
    if (process.platform !== "darwin") {
      app.quit();
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function registerDevToolsShortcuts(win) {
  win.webContents.on("before-input-event", (_event, input) => {
    const f12 = input.key === "F12";
    const ctrlShiftI =
      input.control && input.shift && input.key.toLowerCase() === "i";
    if (f12 || ctrlShiftI) {
      win.webContents.toggleDevTools();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "Writing Agent",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  registerDevToolsShortcuts(mainWindow);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    killServer();
  });
}

app.whenReady().then(async () => {
  registerCleanupHandlers();
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error("[electron]", err instanceof Error ? err.message : err);
    killServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  killServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  killServer();
});

app.on("will-quit", () => {
  killServer();
});

app.on("activate", async () => {
  if (mainWindow === null && serverProcess) {
    try {
      await waitForServer(10);
      createWindow();
    } catch {
      /* server gone */
    }
  }
});
