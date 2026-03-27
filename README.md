# pass

跨平台密码管理器 Monorepo。支持 macOS、Windows、Linux（Ubuntu）、iOS、Android 客户端，以及 Chrome / Firefox / Safari 浏览器扩展，核心数据与同步逻辑由一套 Rust 库共享。

> 完整设计文档见 [`docs/`](docs/README.md)。

---

## 目录

- [项目架构](#项目架构)
- [模块总览](#模块总览)
- [核心库（Rust）](#核心库rust)
- [当前实现状态](#当前实现状态)
- [本地验证](#本地验证)
- [Windows 客户端技术选型分析](#windows-客户端技术选型分析)
- [Ubuntu 客户端技术选型分析](#ubuntu-客户端技术选型分析)
- [方案综合对比与推荐](#方案综合对比与推荐)

---

## 项目架构

```
pass/
├── core/
│   └── pass_core/          # Rust workspace（共享核心库）
│       └── crates/
│           ├── domain/     # 数据模型与规则
│           ├── merge/      # op log + HLC + 冲突合并
│           ├── storage/    # SQLite/SQLCipher 迁移与适配
│           ├── transport/  # 同步协议编解码
│           ├── csvio/      # CSV 导入导出
│           └── ffi/        # C ABI / UniFFI bindings
├── apps/
│   ├── app_macos/          # macOS 原生应用（SwiftUI）✅ 可运行
│   ├── app_flutter/        # 五端共享 UI（Flutter）🚧 规划中
│   ├── copilot-Claude-flutter/ # Flutter 桌面端（Win/Ubuntu/macOS）✅ 可构建
│   ├── copilot-53-flutter/ # Flutter 桌面端（Win/Ubuntu/macOS）✅ 可构建
│   ├── codex-tauri/        # Tauri 2 桌面端（Win/Ubuntu/macOS）✅ 初始化
│   ├── copilot-53-tauri/   # Tauri 2 桌面端（Win/Ubuntu/macOS）✅ 可构建
│   ├── extension_chrome/   # Chrome 扩展（MV3）✅ 可构建
│   ├── extension_firefox/  # Firefox 扩展
│   ├── extension_safari/   # Safari 扩展（Swift + Web Extension）
│   ├── extension_shared/   # 扩展共享代码（popup/background/content）
│   ├── sync_agent_desktop/ # 桌面本地同步代理 🚧 规划中
│   └── sync_server_ubuntu/ # Ubuntu 自建同步服务（Python）✅ 可部署
└── docs/                   # 详细设计文档（中文）
```

### 分层说明

| 层级 | 职责 | 技术 |
|------|------|------|
| **Shared Core** | 数据模型、加密、op log、合并引擎、CSV | Rust |
| **Shared UI** | 跨平台页面与交互状态 | Flutter（规划）|
| **Platform Adapter** | 密钥库、生物识别、自动填充、系统托盘 | 各平台原生 |
| **Sync Layer** | 局域网配对、加密通道、增量同步 | 桌面代理 + Python 服务 |
| **Browser Extension** | 网页域名识别、自动填充 UI | Chrome MV3 / WebExtension |

---

## 模块总览

| 模块 | 路径 | 状态 | 说明 |
|------|------|------|------|
| macOS 应用 | [`apps/app_macos`](apps/app_macos/README.md) | ✅ 可运行 | SwiftUI，支持账号管理、CSV 导出、回收站 |
| Flutter 应用 | [`apps/app_flutter`](apps/app_flutter/README.md) | 🚧 规划中 | 五端（iOS/Android/Win/macOS/Linux）共享 UI |
| Copilot Claude Flutter 桌面应用 | [`apps/copilot-Claude-flutter`](apps/copilot-Claude-flutter/README.md) | ✅ 可构建 | Windows / Ubuntu / macOS 统一 Flutter 桌面工程 |
| Copilot 53 Flutter 桌面应用 | [`apps/copilot-53-flutter`](apps/copilot-53-flutter/README.md) | ✅ 可构建 | Windows / Ubuntu / macOS 统一 Flutter 桌面工程 |
| Tauri 桌面应用 | [`apps/codex-tauri`](apps/codex-tauri/README.md) | ✅ 可构建 | Windows / Ubuntu / macOS 三端基础骨架 |
| Copilot 53 Tauri 桌面应用 | [`apps/copilot-53-tauri`](apps/copilot-53-tauri/README.md) | ✅ 可构建 | Windows / Ubuntu / macOS 三端基础骨架 |
| Chrome 扩展 | [`apps/extension_chrome`](apps/extension_chrome/README.md) | ✅ 可构建 | MV3，自动填充 + 同步触发 |
| Firefox 扩展 | [`apps/extension_firefox`](apps/extension_firefox/README.md) | ✅ 可构建 | WebExtension |
| Safari 扩展 | [`apps/extension_safari`](apps/extension_safari/README.md) | ✅ 可构建 | Swift + Web Extension |
| 扩展共享代码 | [`apps/extension_shared`](apps/extension_shared/README.md) | ✅ 共享 | popup/background/content/options |
| 桌面同步代理 | [`apps/sync_agent_desktop`](apps/sync_agent_desktop/README.md) | 🚧 规划中 | 局域网配对与同步 |
| Ubuntu 同步服务 | [`apps/sync_server_ubuntu`](apps/sync_server_ubuntu/README.md) | ✅ 可部署 | Python，单文件，零依赖 |
| Rust 核心库 | [`core/pass_core`](core/pass_core/README.md) | ✅ 初始化 | 6 个 crate，含 FFI |

---

## 核心库（Rust）

位于 [`core/pass_core`](core/pass_core/README.md)，Cargo workspace 结构：

| Crate | 职责 |
|-------|------|
| `pass-domain` | 数据模型原语（`Operation`、`TimeRange`、`HybridLogicalClock`）|
| `pass-merge` | 合并比较器与删除冲突解析 |
| `pass-storage` | SQLite 内嵌迁移文件 |
| `pass-transport` | 同步协议契约结构体 |
| `pass-csvio` | CSV 站点归一化工具 |
| `pass-core-ffi` | 最小 C ABI 导出（供各端 FFI 调用）|

共享 JS 模块：
- `core/pass_core/js/sync_merge_core.js`：浏览器扩展侧合并/冲突内核

---

## 当前实现状态

- ✅ **设计文档**：[`docs/`](docs/README.md) 覆盖架构、协议、数据模型、同步策略
- ✅ **Rust Core workspace**：6 个 crate，已初始化
- ✅ **macOS 原生应用**（SwiftUI）：账号 CRUD、域名别名、回收站、CSV 导出、SQLite WAL
- ✅ **Copilot Claude Flutter 桌面应用**（Windows/Ubuntu/macOS）：桌面录入与列表演示工程
- ✅ **Tauri 桌面应用**（Windows/Ubuntu/macOS）：设备名、账号 CRUD、域名别名同步、回收站、演示数据、CSV 导出
- ✅ **Chrome 扩展**：MV3，自动填充、popup、options、background
- ✅ **Firefox / Safari 扩展**：基于共享代码构建
- ✅ **Ubuntu 同步服务**：Python 单文件，GET/PUT `/v1/sync/payload`，SQLite，Bearer Token 认证
- 🚧 **Flutter 五端应用**：规划中，待接入 Rust FFI
- 🚧 **桌面同步代理**：规划中，待实现配对与局域网同步

---

## 本地验证

```bash
# 1. Rust Core 单元测试
cd core/pass_core
cargo test

# 2. macOS 应用构建
cd apps/app_macos
swift build

# 3. Chrome 扩展语法检查
cd apps/extension_shared
node --check background.js
node --check popup.js
node --check options.js

# 4. Ubuntu 同步服务
cd apps/sync_server_ubuntu
python3 pass_sync_server.py
```

---

## Windows 客户端技术选型分析

> 背景：项目核心已使用 Rust，macOS 端使用 SwiftUI，浏览器扩展使用 JS。
> Windows 客户端需要接入共享 Rust Core（通过 FFI），并与桌面同步代理协作。

### 方案 W1：Flutter（推荐默认方案）

**技术栈**：Flutter + Dart + Rust FFI（通过 `flutter_rust_bridge`）

**架构**：
```
Flutter UI (Dart)
    ↓ flutter_rust_bridge
pass-core-ffi (Rust C ABI)
    ↓
pass-domain / pass-merge / pass-storage / pass-transport
```

**优势**：
- 一套代码覆盖 Windows / macOS / Linux / iOS / Android，与项目已有 `app_flutter` 规划完全契合
- `flutter_rust_bridge` 生态成熟，可直接调用 Rust Core FFI，无需重写业务逻辑
- Flutter 在 Windows 上产出原生 Win32/ANGLE 渲染的 `.exe`，无 WebView 依赖
- Google 官方维护，社区活跃，桌面端渐趋稳定
- 安全存储：通过 Platform Channel 调用 DPAPI（用户作用域密钥）+ Windows Hello
- 系统托盘：`tray_manager` 插件，开机启动：`launch_at_startup` 插件

**劣势**：
- Flutter Windows 桌面成熟度略低于移动端（部分 plugin 生态尚不完整）
- 与 Windows 原生控件（WinUI 3）视觉差异明显，需自定义主题
- Dart 学习曲线对纯后端/Rust 团队有一定成本

**适用场景**：团队优先交付速度，希望移动 + 桌面共用同一套 UI 代码库。

---

### 方案 W2：Tauri（轻量 Rust 原生方案）

**技术栈**：Tauri 2 + Web 前端（React / Vue / Svelte）+ Rust 后端

**架构**：
```
Web UI (React/Vue/Svelte in WebView2)
    ↓ Tauri IPC（invoke/event）
Tauri Rust 后端
    ↓ 直接调用（同进程 Rust 代码）
pass-domain / pass-merge / pass-storage / pass-transport
```

**优势**：
- Rust 后端与 Rust Core **完全同语言**，无 FFI 桥接摩擦，可直接 `use pass_domain::...`
- WebView2（Edge Chromium）前端技术栈与浏览器扩展共享 HTML/CSS/JS 代码习惯
- 安装包极小（~8 MB），无捆绑运行时
- 安全模型优秀：前端 JS 无法直接访问文件系统，必须经 Rust 后端
- 安全存储：Tauri 内置 `tauri-plugin-keystore`（Windows DPAPI / macOS Keychain）
- Windows Hello：可通过 Rust 调用 Windows Hello API

**劣势**：
- 依赖 WebView2（Win10+ 内置，Win7 需额外安装）；渲染一致性弱于 Flutter
- 前端框架与浏览器扩展共享度有限（扩展用 MV3 background，Tauri 是独立进程）
- Tauri 2 仍在快速迭代，部分 plugin API 稳定性待验证

**适用场景**：团队有 Web 前端能力 + Rust 后端能力，希望极致轻量且安全。

---

### 方案 W3：WinUI 3 / C#（原生 Windows 方案）

**技术栈**：WinUI 3 + C# + P/Invoke 或 CsWin32 调用 Rust FFI

**架构**：
```
WinUI 3 (XAML / C#)
    ↓ P/Invoke / CsWin32
pass-core-ffi.dll (Rust C ABI)
    ↓
pass-domain / pass-merge / pass-storage / pass-transport
```

**优势**：
- 完全符合 Windows 11 设计语言（Fluent Design），系统集成最深
- Windows Hello / DPAPI / WinRT 密钥库原生 API 调用无摩擦
- MSIX 打包、Windows Store 发布、单例锁、开机启动一流支持
- C# 生态成熟，企业级 Windows 开发人力充足

**劣势**：
- 仅支持 Windows，无法复用到 macOS/Linux/移动端
- 需要维护独立的 Windows 专属代码库，与 Flutter/Tauri 路线完全割裂
- P/Invoke 跨语言边界调试复杂，Rust FFI 导出必须保持 C ABI 稳定
- WinUI 3 仍有若干已知 bug（截止 2026 年仍在活跃修复）

**适用场景**：目标受众以企业/政务 Windows 用户为主，优先系统级体验，团队有 C# 能力。

---

### 方案 W4：Electron（快速验证方案）

**技术栈**：Electron + Node.js + Web 前端 + Node native addon（napi-rs）调用 Rust

**架构**：
```
Web UI (HTML/CSS/JS - 可复用扩展代码)
    ↓ IPC
Node.js main process
    ↓ napi-rs native addon
pass-core-ffi (Rust)
```

**优势**：
- 可大量复用浏览器扩展的 UI 代码（popup.js / options.js / content.js 逻辑）
- 跨平台（Windows/macOS/Linux），开发体验一致
- 生态极其成熟（VSCode、Slack、Notion 均基于此）

**劣势**：
- **安装包极大**（>100 MB，捆绑完整 Chromium）
- 内存占用高（通常 200-400 MB）
- 安全模型较弱，需严格配置 CSP 与 contextIsolation
- 密码管理器对安全性要求极高，Electron 进程间隔离相对较弱

**适用场景**：快速原型验证、团队仅有 Web 能力时的过渡方案；**不推荐作为正式发布版本**。

---

## Ubuntu 客户端技术选型分析

> Ubuntu（Linux）客户端需处理：libsecret（GNOME Keyring / KWallet）安全存储、Wayland/X11 兼容、AppImage/deb 打包、systemd 服务集成（同步代理）。

### 方案 U1：Flutter（与 Windows 同一代码库，推荐）

**技术栈**：Flutter + Dart + Rust FFI（`flutter_rust_bridge`）

**架构**：与方案 W1 完全相同，Linux 平台自动适配

**优势**：
- **与 Windows 方案 W1 共用同一套代码**，零额外 UI 开发成本
- Flutter Linux 使用 GTK 3 渲染，与主流发行版兼容
- 安全存储：Platform Channel 调用 `libsecret` API
- 系统托盘：`tray_manager`（Linux 下使用 AppIndicator/StatusNotifier）
- 打包：`flutter build linux` 产出自包含目录，可封装为 AppImage 或 deb

**劣势**：
- Flutter Linux 桌面成熟度在三个平台中最低，部分 plugin 缺乏 Linux 实现
- GTK 渲染在 Wayland 下偶有兼容问题（需测试 XWayland fallback）
- 系统级 GNOME/KDE 集成（如 GNOME Shell 扩展）无法通过 Flutter 实现

**适用场景**：希望 Windows + Linux 共用一套代码，快速覆盖桌面两平台。

---

### 方案 U2：Tauri（轻量 Rust 原生，推荐备选）

**技术栈**：Tauri 2 + Web 前端 + Rust 后端

**架构**：与方案 W2 完全相同，Linux 平台自动适配（WebKitGTK）

**优势**：
- Rust 后端与 Rust Core 同语言，直接集成，无 FFI 开销
- Linux 上使用 WebKitGTK 渲染，Wayland/X11 均支持
- 安全存储：`tauri-plugin-keystore` 在 Linux 下调用 `libsecret`
- AppImage / deb / rpm 打包由 Tauri bundler 一键生成
- 安装包极小（~3-5 MB，不计 WebKitGTK 系统库）

**劣势**：
- WebKitGTK 版本差异（Ubuntu 20.04 vs 22.04 vs 24.04）可能影响渲染一致性
- 前端 JS 生态与服务端 Rust 之间的 IPC 边界需要仔细设计
- 对于密码管理器，WebView 攻击面需严格限制（CSP + 禁止加载外部资源）

**适用场景**：团队有 Rust 能力，希望极致轻量且安全，愿意为 Linux 做针对性测试。

---

### 方案 U3：GTK 4 + libadwaita（原生 GNOME 方案）

**技术栈**：GTK 4 + libadwaita + Rust（`gtk4-rs` crate）

**架构**：
```
GTK 4 / libadwaita UI (Rust)
    ↓ 直接调用（同进程）
pass-domain / pass-merge / pass-storage / pass-transport
```

**优势**：
- 完全原生 GNOME 体验，与 GNOME Shell 集成最深
- `gtk4-rs` 是 Rust 绑定，与 Rust Core **完全同语言**，无 FFI
- libsecret、GnomeKeyring、polkit 集成一流
- 打包为 Flatpak 可进入 GNOME Software / Flathub，触达最广 Linux 用户
- Wayland 原生支持（GTK 4 默认 Wayland 后端）

**劣势**：
- 仅支持 Linux（且 GNOME 桌面体验最佳，KDE 下需额外适配）
- GTK 4 API 复杂度高，`gtk4-rs` 部分 API 仍在迭代
- 无法与 Windows 方案共用 UI 代码

**适用场景**：目标用户为 Linux 桌面高级用户（开发者、开源社区），追求系统级集成与 Flatpak 分发。

---

### 方案 U4：命令行 + Sync Server（服务器/无头场景）

**技术栈**：Rust CLI（`clap` crate）+ Ubuntu systemd 服务 + 现有 Python 同步服务

**架构**：
```
CLI (Rust clap) / Python sync server
    ↓
pass-domain / pass-merge / pass-storage / pass-transport
```

**优势**：
- 对于 Ubuntu **服务器/NAS/无头** 场景，无需 GUI
- 现有 `sync_server_ubuntu`（Python）已可部署，只需增加 CLI 管理工具
- Rust CLI 与 Core 完全同语言，编译为单一静态二进制
- systemd 集成、cron 定时同步、shell 脚本自动化全部原生支持

**劣势**：
- 无 GUI，普通用户体验差
- 需要额外开发 Web UI 或 TUI（`ratatui`）才能给非技术用户使用

**适用场景**：Ubuntu 服务器部署（自建同步后端）、开发者/系统管理员使用场景。

---

## 方案综合对比与推荐

### Windows vs Ubuntu 技术方案对比表

| 维度 | W1 Flutter | W2 Tauri | W3 WinUI 3 | W4 Electron | U1 Flutter | U2 Tauri | U3 GTK 4 | U4 CLI |
|------|-----------|---------|-----------|------------|-----------|---------|---------|-------|
| **代码复用** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ |
| **原生体验** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **安全性** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **包体大小** | ~20 MB | ~8 MB | ~15 MB | >100 MB | ~25 MB | ~5 MB | ~10 MB | ~5 MB |
| **Rust Core 集成** | FFI 桥 | 直接调用 | P/Invoke | napi-rs | FFI 桥 | 直接调用 | 直接调用 | 直接调用 |
| **交付速度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Linux 桌面生态** | — | — | — | — | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **跨平台度** | Win+macOS+Linux+移动 | Win+macOS+Linux | 仅 Windows | Win+macOS+Linux | Win+macOS+Linux+移动 | Win+macOS+Linux | 仅 Linux | Linux+macOS |

### 推荐组合

#### 🥇 首选：Flutter（W1 + U1）— 最快覆盖 Windows + Linux + 移动端

与项目现有 `apps/app_flutter` 规划完全一致。一套代码库，通过 `flutter_rust_bridge` 接入 Rust Core FFI，Flutter 官方支持 Windows / Linux 桌面目标。

```
适合：团队规模小、优先快速上线、希望移动与桌面共用一套 UI
风险：Flutter Linux 桌面成熟度需持续关注 plugin 覆盖情况
```

#### 🥈 备选：Tauri（W2 + U2）— Rust Core 无摩擦集成 + 极致安全轻量

Rust 后端直接引用 `pass_core` crate，Web 前端可借鉴浏览器扩展的 HTML/CSS 结构。对于密码管理器这类安全敏感应用，Tauri 的进程隔离模型更优。

```
适合：团队 Rust 能力强、对安全要求极高、可接受 Web UI 风格
风险：Tauri 2 仍在快速迭代，需关注 API 稳定性
```

#### 🥉 特定场景：GTK 4（U3）+ WinUI 3（W3）— 原生体验优先

若目标受众是 Linux 开源社区用户（GTK/Flatpak）或企业级 Windows 用户（WinUI 3），可考虑分别为两平台独立开发原生应用，共享 Rust Core，UI 各自实现。

```
适合：有足够团队分工、长期维护意愿、追求系统级原生集成
风险：维护两套 UI 代码库，开发成本显著增加
```

#### ⛔ 不推荐：Electron（W4）

Electron 安装包过大（>100 MB），内存占用高，且安全隔离模型不适合密码管理器这类需要严格保护密钥材料的应用场景。

---

*详细技术规范请参考 [`docs/cross-platform-architecture-zh.md`](docs/cross-platform-architecture-zh.md)*
