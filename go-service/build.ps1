# Build script for production

$ErrorActionPreference = "Stop"

Write-Host "Building iPAGet Go Service for current platform..." -ForegroundColor Green

# Ensure all paths are resolved relative to this script's directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinariesDir = Join-Path $ScriptDir "..\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null

# Build current platform only; Go auto-detects OS/ARCH
$env:CGO_ENABLED = "0"

# Detect Windows via environment variable in PowerShell
if ($env:OS -eq "Windows_NT") {
    $out = Join-Path $BinariesDir "ipaget-service.exe"
} else {
    $out = Join-Path $BinariesDir "ipaget-service"
}

Write-Host "Building to $out" -ForegroundColor Cyan

# Build from the go-service directory
Push-Location $ScriptDir
go build -ldflags="-s -w" -o $out .
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
    Write-Host "Go build failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Build complete! Binaries are in: $BinariesDir" -ForegroundColor Green
Write-Host ""
Get-ChildItem $BinariesDir -Filter "ipaget-service*"
