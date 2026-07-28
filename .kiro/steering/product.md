# Product Overview

iPAGet is a desktop application for iOS app management and sideloading. It provides a comprehensive solution for:

- **Device Management**: Connect and manage iOS devices via USB, view device information, and handle device pairing/trust
- **App Store Integration**: Search, browse, and download apps from the Apple App Store using ipatool integration
- **App Installation**: Install IPA files to connected iOS devices with signing support
- **Certificate Management**: Import and manage both P12 certificates and free signing certificates for app signing
- **IPA Editing**: Parse, inspect, and modify IPA files including entitlements, Info.plist, and embedded resources
- **App Library**: Manage downloaded IPAs with version history tracking

## Key Features

- Multi-device support with automatic device detection
- Apple ID authentication with 2FA support
- Free signing and developer certificate support
- Real-time task progress tracking via WebSocket
- File association support for .ipa files
- Internationalization (English and Chinese)
- Cross-platform (Windows, macOS, Linux)

## Architecture

The application uses a hybrid architecture:
- **Frontend**: React + TypeScript + Tauri (desktop UI)
- **Backend**: Go service providing iOS device communication and App Store API integration
- **Communication**: REST API + WebSocket for real-time updates
