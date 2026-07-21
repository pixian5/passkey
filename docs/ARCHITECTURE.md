# Pass 架构宪章（简版）

> 目标：共享内核 + 分端 UI。先统一规则，再扩平台。

## 1. 分层

| 层 | 职责 | 允许 | 禁止 |
|----|------|------|------|
| **Core（Rust `pass_core`）** | 合并、同步语义、领域规则、（逐步）存储/加密 | 改 merge / 契约 / FFI | UI、系统填充 API |
| **UI** | 展示与交互 | 调 Core / 本地导航 | 重写 merge、墓碑、别名规则 |
| **Adapter** | 钥匙串、生物识别、AutoFill、托盘 | 平台 API 胶水 | 业务判定 |
| **Extension** | 网页识别与填充 UI | 调同源 merge（WASM/对拍） | 私自改同步语义 |
| **Sync Server** | 存快照、ETag/CAS、鉴权 | 哑存储 | 业务合并 |

## 2. 权威

1. **运行时合并权威**：`pass_merge::v2`（经 `pass-core-ffi` / 将来 WASM）。
2. 过渡期若仍有 Swift/JS 实现，必须与 Rust **黄金向量对拍**；冲突以 Rust 为准。
3. 同步契约：`pass.sync.bundle.v2` / `pass.data.v2`。

## 3. 端优先级

1. macOS App（主端，已有）
2. 浏览器扩展
3. Win + Linux（**一套**桌面壳）
4. iOS / Android 原生 App
5. 系统自动填充（移动 / 桌面 Provider）

## 4. 禁止事项

- 新端再写第三套 merge / 同步 safety。
- 用 UniApp 等做主 vault。
- 桌面新端必须接 `pass_merge::v2`，禁止平行 merge。
- 同步服务器做字段级合并。
- 并行维护多套桌面业务原型（演示工程归档，只留一个桌面产品壳）。

## 5. 当前阶段（逐步执行）

| 步 | 状态 | 内容 |
|----|------|------|
| P0 定规矩 | 完成 | 职责与禁止清单 |
| P1 macOS→Rust merge | 完成 | 默认同步合并调 FFI，可回退；null bool 兼容 |
| P2 Core 变厚 | 完成（本阶段） | 别名并集、域名/UUID、CSV 导出进 Core；macOS/Tauri 已接 |
| P3 扩展同源 | 完成（本阶段） | merge parity 入 CI；JS alias 模块 + 测试；扩展 test:core-parity |
| P4 桌面壳 | 进行中 | **双壳**：macOS=SwiftUI 主端；Win/macOS/Linux=codex-tauri（自建同步已接 Core） |
| P4b 桌面同步 | 基本完成 | codex-tauri 自建同步+应用锁；管道冒烟通过；GUI 对拍见 scripts/desktop_sync_checklist.md |
| P5 移动 | 延后 | 本阶段只做桌面；Android demo 保留不扩展 |

## 6. 回退开关

- 环境变量 `PASS_USE_SWIFT_MERGE=1`：macOS 强制使用旧 Swift 合并（仅排障）。
- 默认：优先 Rust FFI；加载/调用失败时回退 Swift 并记日志。
