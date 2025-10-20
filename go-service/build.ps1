# Build script for production

$ErrorActionPreference = "Stop"

Write-Host "Building iPAGet Go Service for production..." -ForegroundColor Green

$BinariesDir = "../src-tauri/binaries"
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null

# Windows x64
Write-Host "Building for Windows x64..." -ForegroundColor Cyan
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o "$BinariesDir/ipaget-service-x86_64-pc-windows-msvc.exe" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build for Windows x64" -ForegroundColor Red
    exit 1
}

# macOS Intel
Write-Host "Building for macOS Intel..." -ForegroundColor Cyan
$env:GOOS = "darwin"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o "$BinariesDir/ipaget-service-x86_64-apple-darwin" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build for macOS Intel" -ForegroundColor Red
    exit 1
}

# macOS Apple Silicon
Write-Host "Building for macOS Apple Silicon..." -ForegroundColor Cyan
$env:GOOS = "darwin"
$env:GOARCH = "arm64"
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o "$BinariesDir/ipaget-service-aarch64-apple-darwin" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build for macOS Apple Silicon" -ForegroundColor Red
    exit 1
}

# Linux x64
Write-Host "Building for Linux x64..." -ForegroundColor Cyan
$env:GOOS = "linux"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -ldflags="-s -w" -o "$BinariesDir/ipaget-service-x86_64-unknown-linux-gnu" .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build for Linux x64" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Build complete! Binaries are in: $BinariesDir" -ForegroundColor Green
Write-Host ""
Get-ChildItem $BinariesDir -Filter "ipaget-service-*"
