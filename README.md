# pass

跨平台密码管理器 Monorepo。当前主管理面是 **Tauri 桌面**、**Docker Web** 和 **Chrome Web 扩展**：三端复用同一管理 UI 源码和 V2 同步契约，但存储、锁、系统能力和少数返回结构仍按平台适配。Rust `pass_core` 是合并权威；Chrome 的 JS 合并实现必须通过黄金向量与 Rust 对拍。

> 当前事实入口：[`docs/current-app-extension-implementation-reference-zh.md`](docs/current-app-extension-implementation-reference-zh.md)。逐项文档索引见 [`文档索引.md`](文档索引.md)，分类阅读导航见 [`docs/README.md`](docs/README.md)。

## 当前开发进度

版本 `2.1.4`。本轮完成**Web 表现层模块化解耦（文件夹去重、删除影响计算与补偿队列调度纯算法抽离）**：
1. **文件夹去重与删除影响计算解耦（[`dedup.js`](apps/codex-tauri/src/dedup.js)）**：新增 `formatDedupGroupSummary` 去重卡片摘要、`dedupAccountLabel` 极值标识，以及 `calculateFolderDeletionImpact` 纯内存计算文件夹删除对活动与回收站账号的影响并输出安全提示，消除直接 DOM 耦合。
2. **同步补偿队列调度与状态格式化解耦（[`sync_outbox_scheduler.js`](apps/codex-tauri/src/sync_outbox_scheduler.js)）**：收敛 `syncOutboxSourceLabel`、`formatOutboxModeLabel`、`formatAutoSyncStatus`、`summarizeOutboxQueue` 与 `calculateNextOutboxRetryDelay`（支持锁定与运行互斥、退避时延和边界截断）。
3. **同构单测与多端分发闭环**：新增 [`apps/extension_shared/tests/dedup.test.mjs`](apps/extension_shared/tests/dedup.test.mjs) 并扩充调度器与 UI 工具单测，扩展层纯原生单测扩增至 264 项全绿通过；更新 `prepare-dist.mjs` 与 `sync-web-ui.mjs` 保持三端零构建同步。

此前里程碑回顾：**2.1.1 Web 表现层实体排序与列表位移解耦**（扩充 `vault_filters.js`，Node 单测 254 用例）；**2.1.0 Web 表现层同步预览与差异裁决比对解耦**（剥离 `sync_preview.js`，Node 单测 249 用例）；**2.0.9 本地存储 Revision 乐观并发锁与三端 CAS 契约对齐**（Tauri SQLite、Pass Web 与扩展统一 `businessRevision` 递增与 `LOCAL_CHANGED` 守卫）；**2.0.8 Web 表现层模态弹窗与异步确认框解耦**（剥离 `dialog.js` 与 `ModalEscapeHandler`，Node 单测 240 用例）；**2.0.7 Web 表现层响应式 Store 与选择模型拆分**（剥离 `store.js` 与 `SelectionModel`，Node 单测 234 用例）；**2.0.6 Web 表现层工具集与过滤逻辑拆分**（剥离 `ui_utils.js` 与 `vault_filters.js`，Node 单测 228 用例）；**2.0.5 Web 表现层算法解耦**（剥离 `totp.js`，RFC 6238 与 Protobuf 单测闭环）；**2.0.4 Web 界面通信切面解耦与深色模式**（新建 `adapter.js` 抽象 PassClientAdapter，72 命令契约 100% 保持；引入深浅自适应变量）；**2.0.3 双端并发 CAS 混沌测试与 WebDAV ETag 防御**；**2.0.2 / 2.0.1 零警告与门禁加固**；**2.0.0 核心库 Clippy 零警告**。

详细进度：[`docs/20261108-0500-当前开发进度-antigravity.md`](docs/20261108-0500-当前开发进度-antigravity.md)

## 下一步待实现

推进 Web 表现层模块化收尾（导入导出与保密库去重逻辑解耦）、推进 WASM 合并引擎落地以废除双轨实现（Phase 4，待用户授权安装目标）、Android 凭据管理提供者健全（Phase 6）、Safari 扩展原团队证书签名与独立发布。现有“密钥留空即明文、不额外确认”策略保持不变。

详细计划：[`docs/20261108-0500-下一步待实现-antigravity.md`](docs/20261108-0500-下一步待实现-antigravity.md)

## 当前入口

| 入口 | 路径 | 当前角色 | 主要限制 |
| --- | --- | --- | --- |
| Tauri 桌面 | [`apps/codex-tauri`](apps/codex-tauri/README.md) | Windows / macOS / Linux 统一桌面壳，主力管理 UI | Touch ID 仅 macOS；多进程同数据目录写入无文件级 revision/CAS |
| Docker Web | [`apps/pass-web`](apps/pass-web/README.md) | 无 GUI / Ubuntu / Docker 浏览器管理面 | 单用户 vault；同一数据目录只允许一个写实例 |
| Chrome Web 扩展 | [`apps/extension_chrome_web`](apps/extension_chrome_web/README.md) | 正式 Chrome MV3 扩展，含管理页、自动填充、WebAuthn 和后台同步 | 不提供系统指纹解锁；SSH 创建服务只保存草稿 |
| 扩展共享层 | [`apps/extension_shared`](apps/extension_shared/README.md) | popup、content script、background、WebAuthn、Firefox/Safari 共享源码 | 改源码后必须重新构建并刷新平台壳层 |
| Rust Core | [`core/pass_core`](core/pass_core/README.md) | V2 合并、领域类型、CSV、同步契约与 FFI | `pass-storage` 仍是候选规范化 DDL，主端未执行 |
| 自建同步服务 | [`apps/sync_server_ubuntu`](apps/sync_server_ubuntu/README.md) | Ubuntu Python 同步服务，提供 V2 state/version/audit/restore API | 服务端只存快照和版本，不做业务合并 |
| macOS 平台模块 | [`apps/app_macos`](apps/app_macos/README.md) | AutoFill、Credential Exchange、旧 SwiftUI 与迁移参考 | 不再作为跨桌面主端 |
| Firefox / Safari 壳 | [`apps/extension_firefox`](apps/extension_firefox/README.md)、[`apps/extension_safari`](apps/extension_safari/README.md) | 基于共享扩展代码的浏览器壳层 | 未纳入三端命令矩阵，不能宣称与 Chrome 管理能力等价 |
| Android Provider | [`apps/android_credential_provider`](apps/android_credential_provider/README.md) | Android 14+ Credential Manager Provider 骨架 | 真实 vault 解锁、密码结果和 Passkey 结果未完成 |

## 目录结构

```text
pass/
├── core/pass_core/                # Rust workspace：domain / merge / csvio / transport / storage / ffi
├── apps/codex-tauri/              # Tauri 2 桌面主端
├── apps/pass-web/                 # Docker / Ubuntu Web 端
├── apps/extension_chrome_web/     # 正式 Chrome 扩展壳层与生成产物
├── apps/extension_shared/         # 扩展共享源码与构建脚本
├── apps/extension_firefox/        # Firefox 壳层
├── apps/extension_safari/         # Safari Web Extension + host app
├── apps/app_macos/                # macOS 系统能力和旧 SwiftUI 参考
├── apps/android_credential_provider/
├── apps/sync_server_ubuntu/       # 生产自建同步服务
├── apps/sync_server_local/        # macOS 本地开发启动脚本
├── docs/                          # 当前事实、契约、历史设计和审计记录
└── scripts/                       # 版本、构建、测试、审计和同步脚本
```

## 版本与构建

仓库根目录 [`VERSION`](VERSION) 是唯一版本来源。每轮完成修改后执行：

```bash
python3 ~/.codex/skills/pixian-dev-workflow/scripts/bump_version.py --root .
node scripts/version.mjs check
```

`scripts/version.mjs check` 会检查包清单、Cargo、Xcode、Android、扩展 manifest、文档当前版本和内嵌同步服务器副本。版本号按 base-10 进位：`1.6.9 -> 1.7.0`。

共享 UI 与扩展构建关系：

- Tauri/Docker Web/Chrome 管理页源码在 `apps/codex-tauri/src`；`npm run prepare:dist` 生成 Tauri/Docker Web 资源并同步 Chrome 管理页文件。
- 扩展 popup/content/background/WebAuthn 源码在 `apps/extension_shared`；`npm run build` 生成共享 `dist/`。
- Chrome 正式扩展加载 `apps/extension_chrome_web`；运行 `./scripts/build-extension-chrome-web.sh` 将共享扩展 bundle、图标和管理页刷新到该目录。

## 本地验证

首选根级检查：

```bash
bash scripts/test_all.sh
```

默认检查版本、扩展 JS、Python 单测、Rust workspace、命令矩阵和 Markdown 链接。Docker 与 Android 套件需要显式开启：

```bash
bash scripts/test_all.sh --docker
bash scripts/test_all.sh --android
```

常用分模块命令：

```bash
node scripts/version.mjs check
cd apps/extension_shared && npm test && npm run build
./scripts/build-extension-chrome-web.sh

TASK_CARGO_TARGET_DIR="$(mktemp -d)"
cd core/pass_core
CARGO_TARGET_DIR="$TASK_CARGO_TARGET_DIR" cargo test --workspace --locked
CARGO_TARGET_DIR="$TASK_CARGO_TARGET_DIR" cargo build -p pass-merge --bin pass-merge-cli --locked
CARGO_TARGET_DIR="$TASK_CARGO_TARGET_DIR" node js/check_merge_parity.mjs
```

本机是 macOS；Ubuntu 服务部署、systemd、Docker 运行时和 Android SDK/JDK 验证不要与本机安装方式混用。Python 优先项目内 `.venv`。

## 文档地图

| 目的 | 文档 |
| --- | --- |
| 当前事实和能力边界 | [`docs/current-app-extension-implementation-reference-zh.md`](docs/current-app-extension-implementation-reference-zh.md) |
| 文档索引和阅读规则 | [`docs/README.md`](docs/README.md) |
| 架构边界 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、[`docs/cross-platform-architecture-zh.md`](docs/cross-platform-architecture-zh.md) |
| 三端命令、数据和同步契约 | [`docs/three-surface-unification-zh.md`](docs/three-surface-unification-zh.md)、[`docs/three-surface-command-matrix-zh.md`](docs/three-surface-command-matrix-zh.md)、[`docs/sync-protocol-v2.md`](docs/sync-protocol-v2.md) |
| 扩展网页内浮窗 | [`docs/browser-extension-in-page-prompts-zh.md`](docs/browser-extension-in-page-prompts-zh.md) |
| Web/Docker 运行和发布 | [`docs/pass-web-docker-development-zh.md`](docs/pass-web-docker-development-zh.md)、[`apps/pass-web/README.md`](apps/pass-web/README.md) |
| 历史设计和路线图 | [`docs/password-manager-design-zh.md`](docs/password-manager-design-zh.md)、[`docs/dev-roadmap-a-c-j-g-zh.md`](docs/dev-roadmap-a-c-j-g-zh.md)、[`docs/implementation-spec-full-zh.md`](docs/implementation-spec-full-zh.md) |

历史/蓝图文档保留用于追溯，不可反向推导为当前能力。改功能前先读“当前事实 → 契约 → 专题文档 → 历史材料”。

## 不要误解的边界

- Chrome WebDAV 已接入后台统一调度；不要再把 Chrome 写成未接入 WebDAV。
- Firefox、Safari、Android 和旧 SwiftUI 不是三端管理面等价实现。
- Chrome 内容脚本的账号选择和保存/更新确认浮窗使用 closed Shadow DOM + manual Popover，支持拖动；保存/更新确认不会自动消失。
- Docker Web 是单用户、单写实例 vault，不是多用户服务。
- WebDAV 只有 ETag/If-Match，没有自建服务器的版本列表、审计和恢复接口。
- 软件 Passkey 私钥可同步，不等价于硬件认证器不可导出的安全属性。

## 贡献与提交

本项目按 `$pixian-dev-workflow` 收尾：验证成功、版本 +0.0.1、更新 `.gitignore` / 文档、中文 commit、推送到 `pixian5/passkey`。不要提交私密凭据、SSH key、`.env`、本地数据库、浏览器测试 profile 或构建缓存。
