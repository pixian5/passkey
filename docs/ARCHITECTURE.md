# Pass 架构宪章（简版）

> 目标：共享内核 + 分端 UI。先统一规则，再扩平台。“共享”是架构方向；当前 Chrome 仍使用 JS 对拍实现，排序/历史/快照仍有适配层逻辑，详见当前实现基准。

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

1. Tauri / Docker Web / Chrome Web 扩展统一管理面
2. 浏览器填充、WebAuthn 与 macOS AutoFill/Credential Exchange 系统集成
3. iOS / Android 原生 App 与系统 Credential Provider
4. 旧 SwiftUI 客户端及 Firefox/Safari 平台壳仅作系统能力与迁移参考

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
| P4 桌面壳 | 完成 | Win/macOS/Linux 统一为 `codex-tauri`；Docker Web 与 Chrome Web 扩展复用同一管理 UI |
| P4b 桌面同步 | 完成 | Tauri/Web/扩展均接自建服务器与 WebDAV；Chrome 由后台统一调度多来源；命令矩阵与合并对拍进入测试门禁 |
| P5 移动 | 延后 | 本阶段只做桌面；Android demo 保留不扩展 |

## 6. 回退开关

- 环境变量 `PASS_USE_SWIFT_MERGE=1`：macOS 强制使用旧 Swift 合并（仅排障）。
- 默认：优先 Rust FFI；加载/调用失败时回退 Swift 并记日志。

## 7. CI 的干净环境原则

- JS↔Rust 合并对拍前必须显式构建 `pass-merge-cli`，不得依赖开发机遗留的 `target/` 二进制。
- FFI 验证须加载当前平台的原生库：macOS 验证打包会使用的 `.dylib`，Linux CI 直接验证 `.so`。
- Tauri 的 Rust 检查前必须生成 `frontendDist`；CI 先安装桌面前端依赖并执行 `prepare:dist`。
- 服务器部署必须分离源码目录与安装目录；健康失败时恢复实际安装文件、systemd 单元和部署前数据库，不能只切换 Git HEAD。

## Local write durability

See [local-write-durability-and-history-consistency-zh.md](./local-write-durability-and-history-consistency-zh.md) for multi-collection transactions, save-failure rollback, undo no-op filtering, vault fsync, and sync-server version history rules introduced in 1.1.1.
