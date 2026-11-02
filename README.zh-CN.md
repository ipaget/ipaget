# iPAGet

**不用 Mac，也能把 App Store 的应用下到电脑、再装回手机。**

[![build](https://github.com/ipaget/ipaget/actions/workflows/build.yml/badge.svg)](https://github.com/ipaget/ipaget/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/tag/ipaget/ipaget?sort=semver&label=release)](https://github.com/ipaget/ipaget/releases)
[![commits](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ipaget/ipaget/pulls)
<!-- 发布 Release 后下载计数徽章才有效，可替换上面的 commits 徽章：
[![downloads](https://img.shields.io/github/downloads/ipaget/ipaget/total)](https://github.com/ipaget/ipaget/releases) -->
[![license](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2ea44f)](#下载)
[![stars](https://img.shields.io/github/stars/ipaget/ipaget)](https://github.com/ipaget/ipaget)
[![issues](https://img.shields.io/github/issues/ipaget/ipaget)](https://github.com/ipaget/ipaget/issues)
[![last commit](https://img.shields.io/github/last-commit/ipaget/ipaget)](https://github.com/ipaget/ipaget/commits/master)

[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English README](README.md)

App Store 只给你最新版，也只让你装在手机上。想留一份旧版本、想看看包里到底是什么、
想换掉应用图标、想用自己的证书再签一次，都得另找工具，而且大多数只跑在 macOS 上。

iPAGet 把它们收进一个桌面应用：按地区搜商店、下 IPA（包括你指定的历史版本）、连上手机
装回去或卸载、改包、重新签名。Windows、macOS、Linux 都有安装包，不需要越狱。

账号、两步验证、证书私钥都留在本机，请求由电脑直接发往 Apple，中间没有第三方服务器。

---

## 界面截图

| | |
| :-: | :-: |
| ![App Store 搜索](docs/images/zh/app-store-search.png) | ![应用库](docs/images/zh/app-library.png) |
| 换个商店地区就能搜，榜单、评分、体积都在列表里 | 下好的 IPA 放在这儿，能批量装，也能删 |
| ![应用详情](docs/images/zh/app-detail.png) | ![版本历史](docs/images/zh/version-history.png) |
| 应用详情和更新说明，直接下当前版或翻历史 | 一个应用的全部构建版本，想装哪版选哪版 |
| ![设备](docs/images/zh/devices.png) | ![设备详情](docs/images/zh/device-details.png) |
| 手机连上就能看到已装应用，搜索、卸载、装 IPA 都在这 | 机型、基带、SIM、硬件一屏看完（图里设备标识已隐去） |
| ![签名](docs/images/zh/signing.png) | ![安装 IPA](docs/images/zh/install-ipa.png) |
| 开发者账号签发的证书，和自己签的证书都在这里 | 装之前先选证书和目标设备 |
| ![编辑器](docs/images/zh/editor.png) | ![Plist 编辑器](docs/images/zh/plist-editor.png) |
| 改名字、换图标、开关能力，然后导出或直接重签 | Info.plist 可以按树改，也可以直接写 XML |

---

## 下载

去 [最新发布](https://github.com/ipaget/ipaget/releases) 挑对应系统的文件就行。文件名开头就是平台，
例如 `iPAGet_1.0.0_windows-x64.msi`，每个系统下一个就够。

| 系统 | 推荐 | 其他选择 |
| --- | --- | --- |
| Windows 10/11 64 位 | `iPAGet_<版本>_windows-x64.msi` | `iPAGet_<版本>_windows-x64-setup.exe`（NSIS 安装包）、`iPAGet_<版本>_windows-x64-portable.exe` |
| Windows 10/11 32 位 | `iPAGet_<版本>_windows-x86.msi` | `iPAGet_<版本>_windows-x86-setup.exe`、`iPAGet_<版本>_windows-x86-portable.exe` |
| macOS（任意机型） | `iPAGet_<版本>_macos-universal.dmg` | `iPAGet_<版本>_macos-universal.app.zip`（仅在 DMG 缺失时使用） |
| Linux 64 位 | `iPAGet_<版本>_linux-amd64.AppImage` | `iPAGet_<版本>_linux-amd64-portable` |

装的时候会遇到这些提示：

- **macOS** 版本未做签名与公证。首次打开请 **右键 → 打开**，或执行
  `xattr -dr com.apple.quarantine /Applications/iPAGet.app`。
- **Windows** 同样会提示 SmartScreen，选择 **更多信息 → 仍要运行** 即可。
- **Linux** 的 AppImage 需要先 `chmod +x iPAGet_<版本>_linux-amd64.AppImage` 再运行。它在
  Ubuntu 24.04 上构建，需要 glibc 2.39 或更高版本（Ubuntu 24.04+、Debian 13+、Fedora 40+）。

---

## 能做什么

### 浏览与下载

- 按商店地区搜应用（美国、中国、日本、英国……），看榜单、副标题、评分和分类，也可以从详情
  页直接跳到下载。
- 下载前能看到完整的**版本历史**，挑任意一个构建版本下回来，包括手机现在装着的那一版：按
  App Store 的构建标识匹配，不靠版本号猜。
- 同时登几个 Apple 账号，登录状态会缓存，不用每次启动都重新输一次验证码。
- 下载时显示进度、已传大小和速度，下好的 IPA 进应用库统一管。

### 设备

- 连上设备就能看到机型、系统版本、存储、电池和连接方式。
- 列出手机上已装的应用和它们占的空间，读得到应用里记录的 App Store 标识，据此下载同一个版本。
- 装 IPA、卸应用、翻应用的文件目录，能往里传也能往外取。

### 改包

- 装之前先看清楚：包标识、版本与构建号、最低系统版本、支持的设备、内嵌描述文件、授权项、
  动态库与框架，以及可执行文件有没有加密。
- `Info.plist` 这类属性列表，可以用树视图改，也可以直接写 XML。

### 签名

- 用 Apple 开发者账号（免费账号也行）签发一张新证书，或者导入手上已有的证书。
- 拿证书和描述文件给 IPA 签名、重签，签完直接装。
- 私钥留在系统钥匙串里，应用不往任何服务器上传数据。

---

## 用之前要知道的

- 跟 App Store 有关的功能都要登录 Apple 账号；只动本机的事（看已装应用、翻文件、装现成的
  IPA）不用登录。
- 只能下你账号拥有过的应用；免费应用也要先在商店里点过一次「获取」，否则会提示缺少授权。
- 需要一台用 USB 连着、并且在手机上点过「信任」的 iOS 设备。
- iOS 17 以上的部分操作要走 usbmux 隧道，得给管理员权限：Windows 把 `wintun.dll` 放进应用
  目录，macOS 和 Linux 用 `sudo` 启动。
- 走代理的话在 **设置** 里填，填完立刻生效，不用重启。

---

## 从源码构建

需要 **Node 20+** 与 **pnpm 9**、**Rust**（stable）、**Go 1.25+**，以及所在平台的
[Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)（Linux 需 WebKitGTK 4.1 与
`libwebkit2gtk-4.1-dev`，macOS 需 Xcode 命令行工具，Windows 需 MSVC 构建工具）。

```bash
git clone https://github.com/ipaget/ipaget.git
cd ipaget
git submodule update --init go-service/vendors/go-ios   # go.mod 的替换目录，必需
pnpm install
pnpm tauri:dev                                          # Vite + Tauri，Go 服务热重载
```

`pnpm tauri:dev` 会启动 Vite 开发服务器与桌面窗口，Go 服务由 Rust 侧通过 `air` 启动，改动
Go 代码无需重启窗口。开发用的守护脚本会在应用自重启时保持 Vite 不中断。

本地打包：

```bash
pnpm tauri build        # 先执行 scripts/prebuild.mjs（前端 + Go 服务），再生成安装包
```

自检命令：

```bash
cd go-service && go test ./internal/... && go build ./...
npx tsc --noEmit
node --experimental-strip-types --test scripts/subtitle-scheduler.test.mjs
```

Linux 构建依赖（与 CI 使用的一致）：

```bash
sudo apt-get install -y libgtk-3-dev libayatana-appindicator3-dev libwebkit2gtk-4.1-dev \
  patchelf librsvg2-dev desktop-file-utils appstream libpipewire-0.3-dev libdbus-1-dev \
  libxcb1-dev libxcb-randr0-dev libxcb-shm0-dev libxcb-xfixes0-dev libxcb-shape0-dev \
  libxrandr-dev libgbm-dev libdrm-dev libwayland-dev libxkbcommon-dev libegl1-mesa-dev \
  libxdo-dev libssl-dev pkg-config
```

---

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `src/` | React 界面：页面、组件、状态管理与 `zh` / `en` 文案 |
| `src-tauri/` | Tauri 外壳：窗口与启动流程、文件系统与桌面命令、打包配置 |
| `go-service/` | Go 服务：App Store 访问、设备通信、IPA 解析、签名、日志推送 |
| `docs/images/zh` | 中文 README 使用的截图 |
| `docs/images/en` | 英文 README 使用的截图 |
| `scripts/` | 开发运行器、开发重启守护与发布前构建脚本 |
| `ref/` | 实现协议时参考的源码，不参与构建 |

界面与服务之间通过本机 HTTP 接口通信，日志走 WebSocket；服务随应用一起分发，无需额外安装。

---

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 登录后仍反复要求验证码 | 会话被清除或已过期。打开 **调试 → 登录会话** 查看已保存内容，必要时清除后重新登录。 |
| 找不到设备 | 重新插拔数据线、在设备上选择“信任此电脑”并解锁；Windows 上确认已安装 Apple 的 USB 驱动。 |
| iOS 17+ 安装或浏览失败 | 以管理员权限启动隧道（Windows 需要 `wintun.dll`，macOS/Linux 需要 `sudo`）。 |
| 首次查询版本历史要等约一分钟 | App Store 需要先完成带签名的下载授权握手才能列出构建版本；结果会缓存一小时，对话框内可手动刷新。 |
| 下载报连接错误 | **设置** 中的代理不可达会阻断 App Store 请求，清除或换用可用代理。 |
| macOS 无法打开应用 | 按上文右键 **打开**，或移除隔离属性。 |

---

## 许可证

本项目采用 **CC BY-NC-SA 4.0**，详见 [LICENSE](LICENSE)。允许非商业用途的使用、修改与
分发，但必须保留署名，且衍生作品需采用相同许可证。该许可证不允许商业用途。

---

## 致谢

iPAGet 建立在以下项目之上：

- [ipatool](https://github.com/majd/ipatool) —— App Store 登录与下载协议
- [go-ios](https://github.com/danielpaulus/go-ios) —— 通过 usbmux 与 lockdown 与设备通信
- [Tauri](https://v2.tauri.app/)、[React](https://react.dev/) 与 [Vite](https://vite.dev/) —— 桌面外壳与界面
- `ref/` 下的参考项目，实现协议时用于比对

Apple、App Store、iPhone、iPad 是 Apple Inc. 的商标，本项目与 Apple 无隶属关系。
