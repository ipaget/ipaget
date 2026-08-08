# Technology Stack

## Frontend

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **Desktop Framework**: Tauri 2.0 (Rust-based)
- **Styling**: TailwindCSS 3 with custom animations
- **State Management**: Zustand 4
- **Routing**: React Router 6
- **UI Components**: 
  - Headless UI (dialogs, menus)
  - Radix UI (tooltips)
  - Lucide React (icons)
  - Framer Motion (animations)
  - CodeMirror (code editing)
- **Internationalization**: i18next with browser language detection
- **HTTP Client**: Tauri API (fetch wrapper)

## Backend (Go Service)

- **Language**: Go 1.24
- **Web Framework**: Gin (HTTP router and middleware)
- **WebSocket**: Gorilla WebSocket
- **Database**: SQLite with GORM
- **iOS Communication**: go-ios (vendored, custom fork)
- **App Store API**: ipatool v2 (vendored, custom fork)
- **Logging**: zerolog
- **Hot Reload**: Air (development only)

## Tauri Backend (Rust)

- **Version**: Tauri 2.0
- **Plugins**: shell, dialog, fs, notification, process, log
- **Features**: Custom protocol, tray icon, file associations

## Development Tools

- **Package Manager**: pnpm (workspace support)
- **TypeScript**: 5.3+ with strict mode
- **Linting**: ESLint (implicit)
- **Go Modules**: Vendored dependencies for go-ios and ipatool

## Common Commands

### Frontend Development
```bash
# Install dependencies
pnpm install

# Start Vite dev server (frontend only)
pnpm dev

# Start Tauri in dev mode (requires Go service running separately)
pnpm tauri dev

# Build for production
pnpm build
pnpm tauri build
```

### Backend Development
```bash
# Start Go service with hot reload (from go-service directory)
cd go-service
pnpm dev
# or
go run github.com/air-verse/air@v1.62.0

# Build Go service
go build -o ./tmp/main main.go

# Run with verbose logging
go run main.go -v

# Custom port/host
go run main.go -port 8080 -host 0.0.0.0
```

### Full Stack Development
```bash
# Terminal 1: Start Go service
cd go-service && pnpm dev

# Terminal 2: Start Tauri dev mode
pnpm tauri dev
```

### Build Scripts
```bash
# Windows build script (PowerShell)
.\go-service\build.ps1

# Unix build script
./go-service/build.sh

# Pre-build script (runs before Tauri build)
node scripts/prebuild.mjs
```

## Configuration Files

- `tauri.conf.json` - Tauri app configuration
- `vite.config.ts` - Vite bundler configuration
- `tailwind.config.js` - TailwindCSS theme and plugins
- `tsconfig.json` - TypeScript compiler options
- `go.mod` - Go dependencies with replace directives
- `.air.toml` - Air hot reload configuration
- `pnpm-workspace.yaml` - pnpm workspace configuration

## Port Configuration

- **Frontend Dev Server**: 1420 (Vite)
- **Go Service**: 8765 (default, configurable via -port flag or PORT env var)
- **Production**: Random available port (20000-60000 range) if 8765 is occupied

## Environment Variables

- `DEBUG=true` - Enable verbose logging in Go service
- `PORT` - Override default Go service port
- `HOST` - Override default Go service host (default: 127.0.0.1)
- `CONFIG_DIR` - Override config directory location
