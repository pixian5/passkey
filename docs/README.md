# 文档索引

> 阅读规则：先分清文档性质。**当前事实**可以直接指导修改；**当前契约**必须与代码门禁一起看；**运行手册**用于部署/排障；**历史/蓝图**只说明过去决策或未来方向，不能据此宣称功能已经存在。

## 建议阅读顺序

1. [架构宪章](ARCHITECTURE.md)
2. [当前实现与设计决策基准](current-app-extension-implementation-reference-zh.md)
3. [当前跨平台架构](cross-platform-architecture-zh.md)
4. [三端统一方案](three-surface-unification-zh.md)
5. [同步后端契约](cross-platform-sync-backends-v2-zh.md)
6. [浏览器扩展网页内浮窗交互](browser-extension-in-page-prompts-zh.md)
7. [测试基线与同步端到端约定](test-baseline-and-sync-e2e-zh.md)

## 当前事实

| 文档 | 用途 |
| --- | --- |
| [current-app-extension-implementation-reference-zh.md](current-app-extension-implementation-reference-zh.md) | 当前代码真实实现、设计意图、失败语义、能力矩阵和已知限制的首要入口。 |
| [cross-platform-architecture-zh.md](cross-platform-architecture-zh.md) | Tauri / Docker Web / Chrome Web 扩展的当前分层、存储、锁和平台能力边界。 |
| [three-surface-unification-zh.md](three-surface-unification-zh.md) | 三端统一管理 UI、命令入口、同步设置和仍未对齐的当前结论。 |
| [browser-extension-in-page-prompts-zh.md](browser-extension-in-page-prompts-zh.md) | 网页内账号选择、拖动、保存/更新确认浮窗的状态流、安全边界、手工验收和排障。 |
| [scoped-account-order-design-zh.md](scoped-account-order-design-zh.md) | 全部账号与各文件夹独立账号顺序的当前数据模型和同步规则。 |
| [local-write-durability-and-history-consistency-zh.md](local-write-durability-and-history-consistency-zh.md) | 本地写入、撤销/重做、历史、快照和锁定后的数据清理规则。 |
| [three-surface-csv-core-zh.md](three-surface-csv-core-zh.md) | Tauri / Docker Web / Chrome 扩展的 CSV 转义、解析、浏览器导入和公式防护。 |
| [three-surface-vault-mutate-zh.md](three-surface-vault-mutate-zh.md) | 三端 mutation 规则、墓碑保留和敏感字段清理约束。 |

## 当前契约

| 文档 | 用途 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 简版架构宪章：分层职责、禁止事项、端优先级和阶段边界。 |
| [sync-protocol-v2.md](sync-protocol-v2.md) | 当前 V2 同步包、ETag/CAS、幂等、补偿队列和报告契约。 |
| [cross-platform-sync-backends-v2-zh.md](cross-platform-sync-backends-v2-zh.md) | 自建服务器与 WebDAV 的跨平台接入规则、能力矩阵和安全边界。 |
| [manual-sync-import-export-design-and-implementation-zh.md](manual-sync-import-export-design-and-implementation-zh.md) | 同步包导入导出、密钥轮换、预览、安全检查和冲突合并规则。 |
| [three-surface-command-matrix-zh.md](three-surface-command-matrix-zh.md) | Tauri / Docker Web / Chrome Web 扩展命令覆盖、返回结构和测试门禁。 |
| [schemas/pass-data-v2.schema.json](schemas/pass-data-v2.schema.json) | 统一数据模型 `pass.data.v2` 的机器校验定义。 |
| [schemas/pass-sync-bundle-v2.schema.json](schemas/pass-sync-bundle-v2.schema.json) | 统一同步包 `pass.sync.bundle.v2` 的机器校验定义。 |
| [schemas/sync-operation-report-v1.schema.json](schemas/sync-operation-report-v1.schema.json) | 同步操作报告的机器校验定义。 |

## 运行手册

| 文档 | 用途 |
| --- | --- |
| [test-baseline-and-sync-e2e-zh.md](test-baseline-and-sync-e2e-zh.md) | 根级测试入口、临时 Cargo target、Docker/Android 可选套件和同步边界测试约定。 |
| [pass-web-docker-development-zh.md](pass-web-docker-development-zh.md) | Pass Web 的 Docker/OCI 构建、Compose、数据卷、发布、备份、回滚和排障规范。 |
| [pass-web-three-stage-design-zh.md](pass-web-three-stage-design-zh.md) | Web 端三阶段架构；前两阶段部分落地，第三阶段多用户目标尚未完成。 |
| [sync-protocol-contract-zh.md](sync-protocol-contract-zh.md) | 旧 V1 本地配对/op-log 设计，仅供历史追溯；当前实现不得新增 V1 端点。 |

## 审计记录

| 文档 | 用途 |
| --- | --- |
| [audit-2026-07-26-zh.md](audit-2026-07-26-zh.md) | 程序与文档一致性审计，记录旧理解、代码事实、修正结果和仍未解决风险。 |
| [audit-2026-07-27-zh.md](audit-2026-07-27-zh.md) | 同步功能、锁状态、Docker Web 边界和合并收敛复核记录。 |

## 历史/蓝图

| 文档 | 用途 |
| --- | --- |
| [password-manager-design-zh.md](password-manager-design-zh.md) | 早期 Chrome + 移动 + Native Host 产品设计背景，不是当前运行架构。 |
| [browser-client-passkey-full-design-zh.md](browser-client-passkey-full-design-zh.md) | 浏览器插件、客户端协同和 Passkey 的目标蓝图；当前实现以当前事实文档为准。 |
| [implementation-spec-full-zh.md](implementation-spec-full-zh.md) | V1 历史目标规范与测试门槛，不作为当前模块清单。 |
| [unified-data-sync-v2-design-and-plan-zh.md](unified-data-sync-v2-design-and-plan-zh.md) | APP/扩展统一数据格式、迁移规则、合并规则与实施排期。 |
| [dev-roadmap-a-c-j-g-zh.md](dev-roadmap-a-c-j-g-zh.md) | 历史交付路线和阶段退出门；当前三端事实以当前实现基准为准。 |
| [sqlite-schema.sql](sqlite-schema.sql) | `pass-storage` 内嵌的 V1 规范化存储候选；当前 Tauri/Swift 只建 KV 表，Web 使用加密 JSON vault。 |

## 模块 README

| 模块 | 文档 |
| --- | --- |
| 根项目 | [../README.md](../README.md) |
| Tauri 桌面 | [../apps/codex-tauri/README.md](../apps/codex-tauri/README.md) |
| Docker Web | [../apps/pass-web/README.md](../apps/pass-web/README.md) |
| Chrome 扩展 | [../apps/extension_chrome_web/README.md](../apps/extension_chrome_web/README.md) |
| 扩展共享层 | [../apps/extension_shared/README.md](../apps/extension_shared/README.md) |
| Firefox 壳 | [../apps/extension_firefox/README.md](../apps/extension_firefox/README.md) |
| Safari 壳 | [../apps/extension_safari/README.md](../apps/extension_safari/README.md) |
| macOS 平台模块 | [../apps/app_macos/README.md](../apps/app_macos/README.md) |
| Android Provider | [../apps/android_credential_provider/README.md](../apps/android_credential_provider/README.md) |
| 本地同步服务 | [../apps/sync_server_local/README.md](../apps/sync_server_local/README.md) |
| Ubuntu 同步服务 | [../apps/sync_server_ubuntu/README.md](../apps/sync_server_ubuntu/README.md) |
| Rust Core | [../core/pass_core/README.md](../core/pass_core/README.md) |

## 维护要求

- 更新代码能力时，同步更新当前事实文档、相关模块 README 和必要的历史/蓝图状态说明。
- 更新版本时运行 `node scripts/version.mjs check`，它会检查当前实现基准和三端统一文档中的版本号。
- 修改文档链接后运行 `node scripts/check_markdown_links.mjs`。
- 历史文档可以保留旧版本号、旧测试数量和旧方案，但必须在文件开头说明其历史性质。
- 不要在文档中记录密码、同步密钥、Bearer Token、SSH 私钥、证书私钥或本机私密路径内容。
