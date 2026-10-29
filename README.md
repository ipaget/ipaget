# iPAGet

**Your iOS apps and devices, from your desktop — Windows, macOS and Linux.**

[![build](https://github.com/ipaget/ipaget/actions/workflows/build.yml/badge.svg)](https://github.com/ipaget/ipaget/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/tag/ipaget/ipaget?sort=semver&label=release)](https://github.com/ipaget/ipaget/releases)
[![commits](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ipaget/ipaget/pulls)
<!-- Once the release is published, the download counter works and can replace the commits badge:
[![downloads](https://img.shields.io/github/downloads/ipaget/ipaget/total)](https://github.com/ipaget/ipaget/releases) -->
[![license](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2ea44f)](#download)
[![stars](https://img.shields.io/github/stars/ipaget/ipaget)](https://github.com/ipaget/ipaget)
[![issues](https://img.shields.io/github/issues/ipaget/ipaget)](https://github.com/ipaget/ipaget/issues)
[![last commit](https://img.shields.io/github/last-commit/ipaget/ipaget)](https://github.com/ipaget/ipaget/commits/master)

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[中文说明 / Chinese README](README.zh-CN.md)

iPAGet keeps the apps on your iPhone and iPad in one window: search the App Store, download a
specific build, install it on a connected device, and re-sign it with your own certificate.
It runs entirely on your computer and talks to Apple directly — no account data passes through
any third-party service.

---

## Screenshots

| | |
| :-: | :-: |
| ![App Store search](docs/images/app-store-search.svg) | ![App library and downloads](docs/images/app-library.svg) |
| Search any App Store region, with top charts and app details | Downloaded IPA files, with progress and transfer speed |
| ![Device manager](docs/images/device-manager.svg) | ![Version history](docs/images/version-history.svg) |
| Installed apps, sizes, device details and file browsing | Full version history — pick the build you need |
| ![Certificate and signing](docs/images/signing.svg) | ![IPA and plist editor](docs/images/ipa-plist-editor.svg) |
| Certificates from your developer account, then sign or re-sign | Inspect bundle metadata and edit plists in a tree view |

> The images above are placeholders. Drop real screenshots into `docs/images/` using the same
> file names (for example `docs/images/app-store-search.png`) and update the links in this
> section. The hero image is `docs/images/hero.svg` (recommended size 1600 × 520).

---

## Download

Grab the file for your system from the [latest release](https://github.com/ipaget/ipaget/releases).
Windows and Linux file names contain the version, for example `iPAGet_1.0.0_x64_en-US.msi`.

| System | Recommended | Alternatives |
| --- | --- | --- |
| Windows 10/11, 64-bit | `iPAGet_<version>_x64_en-US.msi` | `..._x64-setup.exe` (NSIS), `iPAGet_windows-x64_portable.exe` |
| Windows 10/11, 32-bit | `iPAGet_<version>_x86_en-US.msi` | `..._x86-setup.exe`, `iPAGet_windows-x86_portable.exe` |
| macOS, any Mac | `universal-macOS-Universal.dmg` | `iPAGet_<version>_aarch64.dmg` (Apple silicon), `iPAGet_<version>_x64.dmg` (Intel), `macos-arm64.app.zip`, `macos-x64.app.zip` |
| Linux, 64-bit | `iPAGet_<version>_amd64.AppImage` | `iPAGet_linux-amd64-portable` |

Install notes:

- **macOS** builds are not signed or notarized. On first launch use **right-click → Open**, or run
  `xattr -dr com.apple.quarantine /Applications/iPAGet.app`.
- **Windows** may show a SmartScreen warning for the same reason: choose **More info → Run anyway**.
- **Linux** AppImage: `chmod +x iPAGet_<version>_amd64.AppImage` and run it. It is built on
  Ubuntu 24.04, so it needs glibc 2.39 or newer (Ubuntu 24.04+, Debian 13+, Fedora 40+).

---

## What you can do

### App Store

- Search any storefront (US, CN, JP, GB, and more) with top charts, subtitles, ratings and genres.
- Open an app's full detail page, or jump straight to its IPA download.
- Browse the complete **version history** and download the build you actually want — including the
  build currently installed on a connected device, matched by its App Store build identifier.
- Keep several Apple Accounts side by side; signed-in sessions are cached so you are not asked for a
  verification code again on every launch.
- Track downloads with progress, transferred size and speed, and keep the resulting IPAs in an
  app library.

### Devices

- See connected devices with model, iOS version, storage, battery and connection details.
- List the installed apps, including their sizes and shared app-group data.
- Read the App Store identifiers stored in an installed app, then download that exact version.
- Install an IPA, uninstall apps, and browse an app's file container to pull or push files.

### IPAs

- Inspect a package before installing it: bundle identifier, version and build, minimum iOS version,
  supported devices, embedded provisioning profile, entitlements, dylibs and frameworks, and
  whether the binary is encrypted.
- Edit `Info.plist` and other property lists in a tree view or as raw XML.

### Signing

- Manage certificates from your Apple developer account — free or paid — including generating a
  signing request and issuing a new certificate, or importing one you already have.
- Sign or re-sign an IPA with a certificate and provisioning profile, ready to install on your device.
- Credentials and keys stay in your operating system keychain; the app stores no server-side data.

---

## Requirements

- An Apple Account for anything that touches the App Store. Device-only features (installed app list,
  file browsing, installing an IPA you already have) do not need one.
- A trusted, paired iOS device connected over USB. Accept **Trust This Computer** on the device.
- iOS 17 and newer devices need an usbmux tunnel for some operations, which requires administrator
  rights: on Windows copy `wintun.dll` next to the app, on macOS and Linux run the app with `sudo`.
- An optional HTTP proxy can be set in **Settings**; it applies to App Store requests without
  restarting the app.

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
| `docs/images/` | Screenshots used by this README |
| `scripts/` | Dev runner, dev-restart supervisor and the release pre-build step |
| `ref/` | Reference sources read while implementing protocols — not part of the build |

The UI and the service talk over a local HTTP API plus a WebSocket for logs; the service is bundled
inside the app, so there is nothing else to install.

---

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| A verification code is requested again after signing in | The session was cleared or expired. Check **Debug → Sign-in session** to see what is stored, or clear it and sign in again. |
| Device is not listed | Reconnect the cable, accept **Trust This Computer**, unlock the device, and make sure the Apple USB drivers are installed on Windows. |
| Installing or browsing fails on iOS 17+ | Start the tunnel with administrator rights (`wintun.dll` on Windows, `sudo` on macOS/Linux). |
| Version history takes about a minute the first time | The App Store needs a signed download-authorization handshake before it lists builds; results are cached for an hour, and the dialog has a refresh button. |
| Downloads fail with connection errors | An unreachable proxy in **Settings** blocks App Store requests. Clear it or point it at a working proxy. |
| macOS refuses to open the app | Right-click → **Open**, or remove the quarantine attribute as shown above. |

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
- The projects collected under `ref/`, which were read while implementing the protocols above

Apple, App Store, iPhone and iPad are trademarks of Apple Inc. This project is not affiliated with
Apple.
