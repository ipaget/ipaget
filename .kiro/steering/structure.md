# Project Structure

## Root Directory

```
ipaget/
├── src/                    # React frontend source
├── src-tauri/              # Tauri (Rust) backend
├── go-service/             # Go backend service
├── public/                 # Static assets
├── scripts/                # Build and utility scripts
├── ref/                    # Reference implementations (submodules)
├── dist/                   # Frontend build output
├── node_modules/           # Node dependencies
└── device-info-exports/    # Device information exports (development/testing)
```

## Frontend Structure (`src/`)

```
src/
├── components/             # React components
│   ├── *Dialog.tsx        # Modal dialogs (Login, Error, Confirm, etc.)
│   ├── *View.tsx          # Complex view components (Entitlements, Properties, etc.)
│   ├── TitleBar.tsx       # Custom window title bar
│   ├── MainLayout.tsx     # Main app layout wrapper
│   └── Toast.tsx          # Toast notifications
├── pages/                 # Route pages
│   ├── SearchPage.tsx     # App Store search
│   ├── DevicesPage.tsx    # Device management
│   ├── AppLibraryPage.tsx # Downloaded IPAs
│   ├── SigningPage.tsx    # Certificate management
│   ├── EditorPage.tsx     # IPA editor
│   ├── SettingsPage.tsx   # App settings
│   └── DebugPage.tsx      # Debug window
├── store/                 # Zustand state stores
│   ├── accountStore.ts    # Apple ID authentication
│   ├── deviceStore.ts     # Device management state
│   ├── certificateStore.ts # Certificate management
│   ├── ipaStore.ts        # IPA file management
│   ├── downloadStore.ts   # Download tracking
│   ├── taskStore.ts       # Task progress tracking
│   ├── errorStore.ts      # Error handling
│   └── toastStore.ts      # Toast notifications
├── lib/                   # Utility libraries
│   ├── goService.ts       # Go service API client
│   ├── deviceModelMap.ts  # Device model mappings
│   ├── deviceColorMap.ts  # Device color mappings
│   └── entitlementsParser.ts # Entitlements parsing
├── hooks/                 # Custom React hooks
│   ├── useDropZone.ts     # Drag & drop functionality
│   └── useTask.ts         # Task management hook
├── locales/               # i18n translations
│   ├── en.json            # English translations
│   └── zh.json            # Chinese translations
├── App.tsx                # Main app component
├── main.tsx               # React entry point
├── i18n.ts                # i18n configuration
└── styles.css             # Global styles (Tailwind)
```

## Tauri Backend (`src-tauri/`)

```
src-tauri/
├── src/
│   ├── commands/          # Tauri command handlers
│   ├── main.rs            # Rust entry point
│   ├── config.rs          # App configuration
│   ├── models.rs          # Data models
│   ├── state.rs           # App state management
│   └── file_watcher.rs    # File system watcher
├── capabilities/          # Tauri permissions
├── icons/                 # App icons (all platforms)
├── binaries/              # Bundled binaries (Go service)
├── Cargo.toml             # Rust dependencies
└── tauri.conf.json        # Tauri configuration
```

## Go Service (`go-service/`)

```
go-service/
├── cmd/                   # Command-line tools
│   ├── ipalogin/          # Apple ID login CLI
│   └── ipasign/           # IPA signing CLI
├── internal/              # Internal packages
│   ├── app/               # App installation service
│   ├── certifi/           # Certificate management
│   │   ├── service.go     # Certificate service
│   │   ├── devportal.go   # Apple Developer Portal API
│   │   └── types.go       # Certificate types
│   ├── cgbipng/           # PNG optimization (CgBI format)
│   ├── device/            # Device management
│   ├── ipa/               # IPA parsing and manipulation
│   ├── sign/              # Code signing
│   ├── store/             # App Store API (ipatool wrapper)
│   ├── websocket/         # WebSocket hub
│   ├── logger/            # Logging utilities
│   ├── logbuffer/         # Log buffering
│   └── models/            # Shared data models
├── vendors/               # Vendored dependencies
│   ├── go-ios/            # Custom go-ios fork
│   └── ipatool/           # Custom ipatool fork
├── tmp/                   # Air hot reload temp files
├── main.go                # Go service entry point
├── go.mod                 # Go dependencies
└── .air.toml              # Air configuration
```

## Key Patterns

### State Management
- Each feature has its own Zustand store in `src/store/`
- Stores use `createWithEqualityFn` for optimized re-renders
- State is kept minimal and derived values are computed in components

### Component Organization
- **Pages**: Top-level route components in `src/pages/`
- **Dialogs**: Modal components with `*Dialog.tsx` naming
- **Views**: Complex sub-components with `*View.tsx` naming
- **Shared**: Reusable UI components in `src/components/`

### API Communication
- Frontend → Tauri: `invoke()` from `@tauri-apps/api/core`
- Frontend → Go Service: REST API via `goService.ts` client
- Real-time updates: WebSocket connection to Go service
- Task progress: WebSocket events with `task_progress` type

### Go Service Architecture
- **Handlers**: HTTP handlers in `main.go` (handle* functions)
- **Services**: Business logic in `internal/*/service.go`
- **Models**: Shared types in `internal/models/`
- **WebSocket Hub**: Broadcast pattern for real-time events

### File Naming Conventions
- React components: PascalCase (e.g., `DeviceDetailsDialog.tsx`)
- Stores: camelCase with "Store" suffix (e.g., `deviceStore.ts`)
- Go files: snake_case (e.g., `device_service.go`)
- Go packages: lowercase single word (e.g., `device`, `certifi`)

### Import Patterns
- Absolute imports not configured (no `@/` alias in use)
- Relative imports used throughout frontend
- Go uses internal packages with full module path

### Configuration Storage
- **Windows**: `%APPDATA%\iPAGet`
- **macOS**: `~/Library/Application Support/iPAGet`
- **Linux**: `~/.config/iPAGet`

### Reference Code
The `ref/` directory contains reference implementations and submodules:
- `altstore/` - AltStore reference
- `feather/` - Feather reference
- `sidestore/` - SideStore reference
- `pymobiledevice3/` - Python iOS device library
- `zsign/` - Code signing reference
- Other iOS-related tools and libraries

These are for reference only and not part of the build process.
