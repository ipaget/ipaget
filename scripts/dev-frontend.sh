#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm is not installed" >&2
    exit 1
fi

echo "Starting frontend (Vite) in: $ROOT_DIR"
exec pnpm dev
