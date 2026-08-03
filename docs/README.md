# 文档索引

> 阅读规则：先分清文档性质。**当前事实**可以直接指导修改；**契约/规范**必须与代码门禁一起看；**历史/目标**只说明过去决策或未来方向，不能据此宣称功能已经存在。

## 建议阅读顺序

1. [架构宪章（简版执行边界）：ARCHITECTURE.md](/Users/x/code/pass/docs/ARCHITECTURE.md)
2. [当前实现参考：current-app-extension-implementation-reference-zh.md](/Users/x/code/pass/docs/current-app-extension-implementation-reference-zh.md)
3. [当前跨平台架构：cross-platform-architecture-zh.md](/Users/x/code/pass/docs/cross-platform-architecture-zh.md)
4. [三端统一方案：three-surface-unification-zh.md](/Users/x/code/pass/docs/three-surface-unification-zh.md)
5. [跨平台同步后端契约（V2）：cross-platform-sync-backends-v2-zh.md](/Users/x/code/pass/docs/cross-platform-sync-backends-v2-zh.md)
6. [本轮程序/文档一致性审计：audit-2026-07-26-zh.md](/Users/x/code/pass/docs/audit-2026-07-26-zh.md)
7. [总体历史设计：password-manager-design-zh.md](/Users/x/code/pass/docs/password-manager-design-zh.md)
8. [插件与客户端目标蓝图（含通行密钥）：browser-client-passkey-full-design-zh.md](/Users/x/code/pass/docs/browser-client-passkey-full-design-zh.md)
9. [历史目标规范：implementation-spec-full-zh.md](/Users/x/code/pass/docs/implementation-spec-full-zh.md)
10. [历史本地配对协议：sync-protocol-contract-zh.md](/Users/x/code/pass/docs/sync-protocol-contract-zh.md)
11. [多设备同步与手动导入导出：manual-sync-import-export-design-and-implementation-zh.md](/Users/x/code/pass/docs/manual-sync-import-export-design-and-implementation-zh.md)
12. [统一数据与同步实施计划（V2）：unified-data-sync-v2-design-and-plan-zh.md](/Users/x/code/pass/docs/unified-data-sync-v2-design-and-plan-zh.md)
13. [历史/候选规范化数据库 DDL：sqlite-schema.sql](/Users/x/code/pass/docs/sqlite-schema.sql)
14. [数据模型 Schema（V2）：schemas/pass-data-v2.schema.json](/Users/x/code/pass/docs/schemas/pass-data-v2.schema.json)
15. [同步包 Schema（V2）：schemas/pass-sync-bundle-v2.schema.json](/Users/x/code/pass/docs/schemas/pass-sync-bundle-v2.schema.json)
16. [开发路线图（A+C+J+G）：dev-roadmap-a-c-j-g-zh.md](/Users/x/code/pass/docs/dev-roadmap-a-c-j-g-zh.md)
17. [Web/Docker/Ubuntu 三阶段设计：pass-web-three-stage-design-zh.md](/Users/x/code/pass/docs/pass-web-three-stage-design-zh.md)
18. [Pass Web Docker 开发与发布设计：pass-web-docker-development-zh.md](/Users/x/code/pass/docs/pass-web-docker-development-zh.md)
19. [全部账号与文件夹独立账号排序设计：scoped-account-order-design-zh.md](/Users/x/code/pass/docs/scoped-account-order-design-zh.md)

## 文档职责

- `ARCHITECTURE.md`：当前执行用分层、禁止事项、端优先级与 P0–P5 阶段。
- `password-manager-design-zh.md`：早期业务规则与本地 Native Host 产品设计背景。
- `cross-platform-architecture-zh.md`：当前 Tauri/Web/扩展技术路线与分层。
- `browser-client-passkey-full-design-zh.md`：浏览器插件与客户端协同、通行密钥原理及目标蓝图。
- `implementation-spec-full-zh.md`：V1 历史目标规范与测试门槛，不作为当前模块清单。
- `sync-protocol-contract-zh.md`：V1 本地配对协议草案；当前远端接口看 V2 后端契约。
- `current-app-extension-implementation-reference-zh.md`：当前代码真实实现、设计意图、失败语义和已知限制的首要入口。
- `audit-2026-07-26-zh.md`：逐项记录文档旧理解、代码事实、修正结果和仍未解决风险。
- `manual-sync-import-export-design-and-implementation-zh.md`：多设备同步策略与手动导入导出协议、冲突合并规则及实施说明。
- `unified-data-sync-v2-design-and-plan-zh.md`：APP/扩展统一数据格式、迁移规则、合并规则与实施排期。
- `sqlite-schema.sql`：`pass-storage` 内嵌的 V1 规范化存储候选，当前主端没有执行；Tauri/Swift 实际使用 KV 表，Web 使用加密 JSON vault。
- `schemas/pass-data-v2.schema.json`：统一数据模型 `pass.data.v2` 的机器可校验定义。
- `schemas/pass-sync-bundle-v2.schema.json`：统一同步包 `pass.sync.bundle.v2` 的机器可校验定义。
- `cross-platform-sync-backends-v2-zh.md`：WebDAV/自建服务器跨平台同步协议与接入清单。
- `test-baseline-and-sync-e2e-zh.md`：统一测试入口、临时 Cargo 构建目录、资源关闭和同步边界测试约定。
- `dev-roadmap-a-c-j-g-zh.md`：历史交付路线和阶段退出门；当前三端事实以实现参考与三端统一文档为准。
- `pass-web-three-stage-design-zh.md`：无 GUI Web 版三阶段架构；前两阶段部分已落地，第三阶段多用户目标尚未完成。
- `pass-web-docker-development-zh.md`：只聚焦 Docker/OCI 的开发、Compose、数据卷、发布、多架构、备份、回滚和排障规范。
- `scoped-account-order-design-zh.md`：全部账号与各文件夹独立账号顺序、同步冲突、迁移和分阶段实施方案。
