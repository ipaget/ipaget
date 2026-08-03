#!/bin/bash

set -e

echo "Building iPAGet Go Service for current platform..."

# Resolve directories relative to this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Build current platform only; Go auto-detects OS/ARCH
export CGO_ENABLED=0

OUT="$BINARIES_DIR/ipaget-service"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    OUT="$BINARIES_DIR/ipaget-service.exe"
    ;;
esac

echo "Building to $OUT"
pushd "$SCRIPT_DIR" >/dev/null
go build -ldflags="-s -w" -o "$OUT" .
popd >/dev/null

echo ""
echo "Build complete! Binaries are in: $BINARIES_DIR"
echo ""
ls -lh "$BINARIES_DIR"/ipaget-service*

