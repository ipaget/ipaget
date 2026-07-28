#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/go-service"

if ! command -v go >/dev/null 2>&1; then
    echo "error: go is not installed" >&2
    exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "error: pnpm is not installed" >&2
    exit 1
fi

echo "Starting backend (Go + Air) in: $ROOT_DIR/go-service"
exec pnpm dev
