import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = args[0] === "dev" ? "tauri-dev.mjs" : null;
const commandArgs = script ? [] : args;
const command = script
  ? [process.execPath, path.join(projectRoot, "scripts", script)]
  : [process.platform === "win32" ? "pnpm.cmd" : "pnpm", "exec", "tauri", ...commandArgs];

const child = spawn(command[0], command.slice(1), {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
  shell: !script && process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});

child.on("error", (error) => {
  console.error(`Failed to start Tauri: ${error.message}`);
  process.exit(1);
});
