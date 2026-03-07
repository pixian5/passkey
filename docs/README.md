# 文档索引

## 建议阅读顺序
1. [总体设计：password-manager-design-zh.md](/Users/x/code/pass/docs/password-manager-design-zh.md)
2. [跨平台架构：cross-platform-architecture-zh.md](/Users/x/code/pass/docs/cross-platform-architecture-zh.md)
3. [插件与客户端完整设计（含通行密钥）：browser-client-passkey-full-design-zh.md](/Users/x/code/pass/docs/browser-client-passkey-full-design-zh.md)
4. [完整实施规范：implementation-spec-full-zh.md](/Users/x/code/pass/docs/implementation-spec-full-zh.md)
5. [同步协议契约：sync-protocol-contract-zh.md](/Users/x/code/pass/docs/sync-protocol-contract-zh.md)
6. [当前实现参考（APP + 扩展）：current-app-extension-implementation-reference-zh.md](/Users/x/code/pass/docs/current-app-extension-implementation-reference-zh.md)
7. [多设备同步与手动导入导出：manual-sync-import-export-design-and-implementation-zh.md](/Users/x/code/pass/docs/manual-sync-import-export-design-and-implementation-zh.md)
8. [统一数据与同步实施计划（V2）：unified-data-sync-v2-design-and-plan-zh.md](/Users/x/code/pass/docs/unified-data-sync-v2-design-and-plan-zh.md)
9. [数据库 DDL：sqlite-schema.sql](/Users/x/code/pass/docs/sqlite-schema.sql)
10. [数据模型 Schema（V2）：schemas/pass-data-v2.schema.json](/Users/x/code/pass/docs/schemas/pass-data-v2.schema.json)
11. [同步包 Schema（V2）：schemas/pass-sync-bundle-v2.schema.json](/Users/x/code/pass/docs/schemas/pass-sync-bundle-v2.schema.json)
12. [跨平台同步后端契约（V2）：cross-platform-sync-backends-v2-zh.md](/Users/x/code/pass/docs/cross-platform-sync-backends-v2-zh.md)

## 文档职责
- `password-manager-design-zh.md`：业务规则与产品侧约束。
- `cross-platform-architecture-zh.md`：技术路线、分层、里程碑。
- `browser-client-passkey-full-design-zh.md`：浏览器插件与客户端协同、通行密钥原理与落地方案。
- `implementation-spec-full-zh.md`：模块级实现要求与测试门槛。
- `sync-protocol-contract-zh.md`：接口请求/响应、错误码、幂等策略。
- `current-app-extension-implementation-reference-zh.md`：当前代码真实实现清单，供重构/重设计参考。
- `manual-sync-import-export-design-and-implementation-zh.md`：多设备同步策略与手动导入导出协议、冲突合并规则及实施说明。
- `unified-data-sync-v2-design-and-plan-zh.md`：APP/扩展统一数据格式、迁移规则、合并规则与实施排期。
- `sqlite-schema.sql`：数据结构与索引落地。
- `schemas/pass-data-v2.schema.json`：统一数据模型 `pass.data.v2` 的机器可校验定义。
- `schemas/pass-sync-bundle-v2.schema.json`：统一同步包 `pass.sync.bundle.v2` 的机器可校验定义。
- `cross-platform-sync-backends-v2-zh.md`：WebDAV/自建服务器跨平台同步协议与接入清单。
