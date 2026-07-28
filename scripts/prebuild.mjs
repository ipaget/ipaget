import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isWindows = process.platform === 'win32';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    shell: false,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runScript(scriptName) {
  const npmExec = process.env.npm_execpath;
  if (npmExec) {
    const nodeCmd = isWindows ? 'node.exe' : 'node';
    run(nodeCmd, [npmExec, 'run', scriptName]);
    return;
  }
  const candidates = [
    ['pnpm', ['run', scriptName]],
    ['npm', ['run', scriptName]],
    ['yarn', ['run', scriptName]],
  ];
  let lastStatus = 1;
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, shell: false });
    if (r.status === 0) return;
    lastStatus = r.status ?? 1;
  }
  process.exit(lastStatus);
}

// 1) Frontend build (vite)
runScript('build');

// 2) Build Go service for current platform
if (isWindows) {
  run('powershell', ['-File', 'go-service/build.ps1']);
} else {
  run('bash', ['go-service/build.sh']);
}


