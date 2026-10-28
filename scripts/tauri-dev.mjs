import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredPort = Number(process.env.IPAGET_DEV_PORT || 1420);

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = createNetServer();
      server.once("error", (error) => {
        server.close();
        if (error.code === "EADDRINUSE") {
          tryPort(port + 1);
          return;
        }
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };

    tryPort(startPort);
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForPortFree(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await isPortFree(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite port ${port} did not become available after restart`);
}

const frontendPort = await findAvailablePort(preferredPort);
const config = JSON.stringify({
  build: {
    beforeDevCommand: `pnpm exec vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
    devUrl: `http://127.0.0.1:${frontendPort}`,
  },
});
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : pnpmCommand;
const args = pnpmCli
  ? [pnpmCli, "exec", "tauri", "dev", "--config", config]
  : ["exec", "tauri", "dev", "--config", config];
const restartToken = randomBytes(32).toString("hex");
let restartRequested = false;
let child;

const controlServer = createHttpServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/restart") {
    response.writeHead(404).end();
    return;
  }

  if (request.headers["x-ipaget-dev-token"] !== restartToken) {
    response.writeHead(403).end();
    return;
  }

  if (restartRequested) {
    response.writeHead(409).end();
    return;
  }

  restartRequested = true;
  response.writeHead(202, { "content-type": "application/json" });
  response.end(JSON.stringify({ accepted: true }));
});

await new Promise((resolve, reject) => {
  controlServer.once("error", reject);
  controlServer.listen(0, "127.0.0.1", resolve);
});

const controlAddress = controlServer.address();
if (!controlAddress || typeof controlAddress === "string") {
  throw new Error("Failed to open the development restart control server");
}

async function handleChildExit(exitedChild, code, signal) {
  if (child !== exitedChild) return;

  if (restartRequested) {
    restartRequested = false;
    try {
      await waitForPortFree(frontendPort);
      startTauri();
    } catch (error) {
      console.error(`Failed to restart Tauri: ${error.message}`);
      controlServer.close(() => process.exit(1));
    }
    return;
  }

  controlServer.close(() => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}

function startTauri() {
  const nextChild = spawn(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      IPAGET_DEV_RESTART_URL: `http://127.0.0.1:${controlAddress.port}/restart`,
      IPAGET_DEV_RESTART_TOKEN: restartToken,
    },
    shell: !pnpmCli && process.platform === "win32",
  });
  child = nextChild;

  nextChild.on("exit", (code, signal) => {
    void handleChildExit(nextChild, code, signal);
  });

  nextChild.on("error", (error) => {
    console.error(`Failed to start Tauri: ${error.message}`);
    controlServer.close(() => process.exit(1));
  });
}

startTauri();
