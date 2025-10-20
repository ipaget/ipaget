#!/bin/bash

set -e

echo "Building iPAGet Go Service for production..."

BINARIES_DIR="../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Windows x64
echo "Building for Windows x64..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BINARIES_DIR/ipaget-service-x86_64-pc-windows-msvc.exe" .

# macOS Intel
echo "Building for macOS Intel..."
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BINARIES_DIR/ipaget-service-x86_64-apple-darwin" .

# macOS Apple Silicon
echo "Building for macOS Apple Silicon..."
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BINARIES_DIR/ipaget-service-aarch64-apple-darwin" .

# Linux x64
echo "Building for Linux x64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "$BINARIES_DIR/ipaget-service-x86_64-unknown-linux-gnu" .

echo ""
echo "Build complete! Binaries are in: $BINARIES_DIR"
echo ""
ls -lh "$BINARIES_DIR"/ipaget-service-*

