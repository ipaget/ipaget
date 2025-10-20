# Development Environment Setup Script for Windows

$ErrorActionPreference = "Stop"

Write-Host "Setting up iPAGet development environment..." -ForegroundColor Green
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Cyan
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found. Please install from https://nodejs.org/" -ForegroundColor Red
    exit 1
} else {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js $nodeVersion installed" -ForegroundColor Green
}

# Check pnpm
Write-Host "Checking pnpm..." -ForegroundColor Cyan
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
} else {
    $pnpmVersion = pnpm --version
    Write-Host "[OK] pnpm $pnpmVersion installed" -ForegroundColor Green
}

# Check Rust
Write-Host "Checking Rust..." -ForegroundColor Cyan
if (!(Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust not found. Please install from https://rustup.rs/" -ForegroundColor Red
    exit 1
} else {
    $rustVersion = rustc --version
    Write-Host "[OK] $rustVersion installed" -ForegroundColor Green
}

# Check Go
Write-Host "Checking Go..." -ForegroundColor Cyan
if (!(Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Go not found. Please install from https://go.dev/dl/" -ForegroundColor Red
    exit 1
} else {
    $goVersion = go version
    Write-Host "[OK] $goVersion installed" -ForegroundColor Green
}

# Note: Air will be run via 'go run' - no installation needed
Write-Host "[OK] Air will be used via 'go run' (no installation required)" -ForegroundColor Green

# Install frontend dependencies
Write-Host ""
Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
pnpm install
Write-Host "[OK] Frontend dependencies installed" -ForegroundColor Green

# Install Go dependencies
Write-Host ""
Write-Host "Installing Go dependencies..." -ForegroundColor Cyan
Push-Location go-service
go mod tidy
go mod download
Pop-Location
Write-Host "[OK] Go dependencies installed" -ForegroundColor Green

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "[OK] Setup complete!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Write-Host "To start development server, run:" -ForegroundColor Yellow
Write-Host "  .\start-dev.ps1" -ForegroundColor Cyan
Write-Host ""

