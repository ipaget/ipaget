# iPAGet

**An App Store downloader and IPA manager**

**[中文 README / Chinese README](README.zh-CN.md)**

[![build](https://github.com/ipaget/ipaget/actions/workflows/build.yml/badge.svg)](https://github.com/ipaget/ipaget/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/tag/ipaget/ipaget?sort=semver&label=release)](https://github.com/ipaget/ipaget/releases)
[![downloads](https://img.shields.io/github/downloads/ipaget/ipaget/total)](https://github.com/ipaget/ipaget/releases)
[![license](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2ea44f)](#download)
[![stars](https://img.shields.io/github/stars/ipaget/ipaget)](https://github.com/ipaget/ipaget)
[![LINUX DO](https://img.shields.io/badge/LINUX%20DO-community-1f6feb)](https://linux.do)

[Download](#download) · [Features](#features) · [Screenshots](#screenshots) · [Build from source](#build-from-source)

iPAGet is a desktop app for downloading, saving and managing iPhone and iPad apps on Windows,
macOS and Linux.

Download App Store apps as IPA files, choose an older release from the version history, or connect
a device to download the same build it has installed. Keep the packages locally for later
reinstallation.

The app also includes device app management, an IPA editor, certificate management and re-signing.

---

## Download

Download a build for your system from [Releases](https://github.com/ipaget/ipaget/releases/latest).
The formats listed for each system are alternative ways to install or run the app; choose one.

| System | Recommended | Alternatives |
| --- | --- | --- |
| Windows 10/11, 64-bit | `iPAGet_<version>_windows-x64.msi` | `iPAGet_<version>_windows-x64-setup.exe` (NSIS installer), `iPAGet_<version>_windows-x64-portable.exe` |
| Windows 10/11, 32-bit | `iPAGet_<version>_windows-x86.msi` | `iPAGet_<version>_windows-x86-setup.exe`, `iPAGet_<version>_windows-x86-portable.exe` |
| macOS, Apple Silicon / Intel | `iPAGet_<version>_macos-universal.dmg` | `iPAGet_<version>_macos-universal.app.zip` (only when the DMG is missing) |
| Linux, x86_64 | `iPAGet_<version>_linux-amd64.AppImage` | `iPAGet_<version>_linux-amd64-portable` |

On Windows, `.msi` and `-setup.exe` are installers; `-portable.exe` runs without installation.
The macOS Universal build supports both Apple Silicon and Intel.

Installation notes:

- **macOS** builds are not signed or notarized. On first launch use **right-click → Open**, or run
  `xattr -dr com.apple.quarantine /Applications/iPAGet.app`.
- **Windows** builds are unsigned and may trigger SmartScreen. After checking that the file came
  from this repository's Release, choose **More info → Run anyway**.
- **Linux** AppImage: `chmod +x iPAGet_<version>_linux-amd64.AppImage` and run it. It is built on
  Ubuntu 24.04, so it needs glibc 2.39 or newer (Ubuntu 24.04+, Debian 13+, Fedora 40+).

---

## Features

### Downloads and versions

- Search by App Store region and view charts, app details and release notes.
- Download the latest release or select a specific version from the version history.
- Read an installed app's App Store build identifier and download that same build. This downloads
  a copy from Apple; it does not extract the installed package from the device.
- Use multiple Apple Accounts, track download progress and speed, and manage downloaded or imported
  IPAs in the local library.

### Device app management

- View device information, installed apps and their storage use.
- Install IPAs, uninstall apps and transfer files through the app containers that iOS makes accessible.

### IPA inspection and editing

- Inspect bundle identifiers, versions and build numbers, minimum OS requirements, provisioning
  profiles, entitlements, frameworks and encryption status.
- Change an app's display name, icon and `Info.plist`, then export the modified IPA.
- Edit property lists as a tree or as XML, with support for XML and binary Plist formats.

### Certificates and signing

- Import an existing certificate or request a signing certificate through an Apple developer account.
- Sign or re-sign an IPA with a certificate and provisioning profile.

---

## Screenshots

| App Store search | Local library |
| :-: | :-: |
| ![App Store search](docs/images/en/app-store-search.png) | ![App library](docs/images/en/app-library.png) |
| Search by region and browse charts | Manage local IPAs and install or delete them in bulk |
| **App details** | **Version history** |
| ![App detail](docs/images/en/app-detail.png) | ![Version history](docs/images/en/version-history.png) |
| View app information and release notes | Choose an older version to download |
| **Installed apps** | **Device information** |
| ![Devices](docs/images/en/devices.png) | ![Device details](docs/images/en/device-details.png) |
| View, install and uninstall apps | View OS and hardware details; identifiers are redacted |
| **Certificates** | **IPA installation** |
| ![Signing](docs/images/en/signing.png) | ![Install IPA](docs/images/en/install-ipa.png) |
| Manage developer and self-signed certificates | Select a device and signing options |
| **IPA editor** | **Plist editor** |
| ![IPA editor](docs/images/en/editor.png) | ![Plist editor](docs/images/en/plist-editor.png) |
| Change the app name, icon and configuration | Inspect and edit property lists |

---

## Getting started

1. **Download an app:** Sign in with an Apple Account and complete two-factor authentication.
   Search for an app, then download the latest release or choose a version from its history.
2. **Manage IPAs:** Open the library to view downloaded packages, or import an existing IPA to
   inspect or edit it.
3. **Connect a device:** Attach an iPhone or iPad over USB, unlock it and accept **Trust This Computer**.
   Open the device page to manage apps or install an IPA.

Downloading an IPA does not require a connected device. Inspecting local IPAs and using basic
device features does not require an Apple Account. Configure a proxy in **Settings** if needed.

### Limitations

- **Older builds are not guaranteed to remain available.** Version lists and downloads depend on
  what Apple still serves and what your account is authorized to download. Matching an installed
  version also requires usable version metadata from the app.
- **An IPA is not a universally installable package.** App Store downloads remain subject to
  account authorization and DRM; re-signing does not remove DRM. Installation and execution also
  depend on OS compatibility, certificates and provisioning profiles.
- **No jailbreak is required, but iOS access restrictions still apply.** File browsing is limited
  to the containers exposed by iOS and the app, not every app's complete data.
- **App Store downloads are requested directly from Apple.** Developer account authentication may
  use the Anisette service selected in Settings. Use a service you trust.

---

## Build from source

Prerequisites: **Node 20+** with **pnpm 9**, **Rust** (stable), **Go 1.25+**, and the
[Tauri system dependencies](https://v2.tauri.app/start/prerequisites/) for your platform
(WebKitGTK 4.1 and `libwebkit2gtk-4.1-dev` on Linux, Xcode command line tools on macOS,
MSVC build tools on Windows).

```bash
git clone https://github.com/ipaget/ipaget.git
cd ipaget
git submodule update --init go-service/vendors/go-ios   # required: replace target of go.mod
pnpm install
pnpm tauri:dev                                          # Vite + Tauri, Go service hot-reloads
```

`pnpm tauri:dev` runs the desktop app against the Vite dev server and lets the Rust shell start the
Go service (through `air`, so Go changes reload without restarting the window). A dev supervisor
keeps the Vite server alive when the app restarts from the in-app debug tools.

Build installers locally:

```bash
pnpm tauri build        # runs scripts/prebuild.mjs: frontend + Go service, then bundles
```

Checks:

```bash
cd go-service && go test ./internal/... && go build ./...
npx tsc --noEmit
node --experimental-strip-types --test scripts/subtitle-scheduler.test.mjs
```

Linux build dependencies (the set used by CI):

```bash
sudo apt-get install -y libgtk-3-dev libayatana-appindicator3-dev libwebkit2gtk-4.1-dev \
  patchelf librsvg2-dev desktop-file-utils appstream libpipewire-0.3-dev libdbus-1-dev \
  libxcb1-dev libxcb-randr0-dev libxcb-shm0-dev libxcb-xfixes0-dev libxcb-shape0-dev \
  libxrandr-dev libgbm-dev libdrm-dev libwayland-dev libxkbcommon-dev libegl1-mesa-dev \
  libxdo-dev libssl-dev pkg-config
```

---

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | React UI: pages, components, stores and `zh` / `en` locales |
| `src-tauri/` | Tauri shell: window and startup handling, file system and desktop commands, bundling |
| `go-service/` | Go service: App Store access, device communication, IPA parsing, signing, log streaming |

The UI and the service talk over a local HTTP API plus a WebSocket for logs; the service is bundled
inside the app, so there is nothing else to install.

---

## License

iPAGet is released under **CC BY-NC-SA 4.0** — see [LICENSE](LICENSE). You may use, modify and share
it for non-commercial purposes, provided you give attribution and keep derivative works under the
same license. Commercial use is not permitted by this license.

---

## Acknowledgements

iPAGet builds on the work of others:

- [ipatool](https://github.com/majd/ipatool) — App Store authentication and download protocol
- [go-ios](https://github.com/danielpaulus/go-ios) — device communication over usbmux and lockdown
- [Tauri](https://v2.tauri.app/), [React](https://react.dev/) and [Vite](https://vite.dev/) — the desktop shell and interface

This project is discussed in, and acknowledges, the [LINUX DO](https://linux.do) community.

Apple, App Store, iPhone and iPad are trademarks of Apple Inc. This project is not affiliated with
Apple.
