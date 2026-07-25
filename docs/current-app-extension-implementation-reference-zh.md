# Pass 当前实现参考

> 状态：当前代码事实，随主分支更新。版本以仓库根目录 `VERSION` 为唯一来源，当前为 `1.1.3`。

## 0. 关键实现文档

- 写入耐久性 / 失败回滚 / 撤销一致性 / 同步版本历史：[local-write-durability-and-history-consistency-zh.md](./local-write-durability-and-history-consistency-zh.md)
- 三端统一方案：[three-surface-unification-zh.md](./three-surface-unification-zh.md)
- 同步协议：[sync-protocol-v2.md](./sync-protocol-v2.md)

## 1. 当前产品表面

| 表面 | 前端 | 后端/适配 | 当前定位 |
|---|---|---|---|
| Tauri 桌面 | `apps/codex-tauri/src` | `apps/codex-tauri/src-tauri` | Win/macOS/Linux 统一桌面客户端；macOS 包名 `PassDesktop.app` |
| Docker Web | Tauri 构建生成的同一套 `dist` | `apps/pass-web` | Ubuntu/Docker 无 GUI，浏览器访问 |
| Chrome Web 扩展 | Tauri UI 构建同步生成 | `apps/extension_chrome_web/extension-bridge.js` | 完整管理页加浏览器填充/WebAuthn 能力 |

仍保留但不属于三端统一管理面的代码：

- `apps/app_macos`：旧 SwiftUI 原生客户端及 macOS AutoFill/Credential Exchange 参考实现。
- `apps/extension_shared` + Firefox/Safari 壳：共享填充、popup、passkey 和平台扩展实现；Chrome 正式壳是 `extension_chrome_web`。
- `apps/android_credential_provider`：Android 14+ Credential Provider 开发中模块。

## 2. 单一 UI 与命令契约

- 管理 UI 唯一源码：`apps/codex-tauri/index.html`、`apps/codex-tauri/src/main.js`、`apps/codex-tauri/src/styles.css`。
- `npm run prepare:dist` 生成桌面/Web 使用的 `dist`，并同步新版扩展的 `web-options.html`、`web-main.js`、`web-options.css`。
- UI 当前使用 68 个命令；`scripts/check_command_matrix.mjs` 检查 Tauri、Web、扩展是否全部覆盖。
- 各表面通过 `health_check.capabilities` 声明平台能力；不支持的功能必须隐藏、降级或明确报错，不能伪成功。

## 3. 当前数据与合并语义

同步数据使用 `pass.data.v2` / `pass.sync.bundle.v2`，顶层包含：

- `accounts`
- `folders`
- `passkeys`
- `allRegularAccountIds` 及更新时间/设备名
- `folderOrderIds` 及更新时间/设备名

文件夹自身保存 `regularAccountIds` 及更新时间/设备名；数组位置就是普通账号顺序。账号在全部账号和每个文件夹中拥有独立顺序，新加入或恢复的账号插入对应普通列表顶部，但不会越过置顶账号。

账号、文件夹、通行密钥使用稳定 ID 和字段级更新时间。合并采用字段级 LWW，并在时间相同的情况下使用设备名和值做确定性裁决。永久删除不会物理移除实体，而是保留墓碑、稳定 ID 和删除元数据，同时清除账号密码、TOTP、恢复码等敏感字段。

文件夹归属使用 `folderIds + folderMembershipStates`；移出文件夹会写关系墓碑，防止离线旧设备重新加入。站点别名和 passkey 关联也有相同的关系删除语义。

## 4. 各端存储

| 表面 | 存储 |
|---|---|
| Tauri | 本地加密 vault/SQLite KV；同步秘密在启用应用锁时单独密封 |
| Docker Web | `/data` 下加密 vault 文件与独立密钥文件 |
| Chrome Web 扩展 | 独立 `chrome.storage.local` 加密工作区，并镜像到扩展 IndexedDB 供填充后台使用 |
| 扩展共享填充层 | IndexedDB `pass.local.db.v1`；账号、文件夹、passkey 集合使用同一数据密钥 |


写入要求（详见 [local-write-durability-and-history-consistency-zh.md](./local-write-durability-and-history-consistency-zh.md)）：

- 账号、文件夹、全局排序和 Passkey 等多集合本地写入必须同事务提交；任一步失败时回滚内存到磁盘已持久化状态。
- 加密 vault / 本地密钥文件采用“临时文件 + `fsync` + rename + 目录 `fsync`”落盘。
- Web 同步网络 I/O 不得长期占用全局 Vault 锁；本地变更在保存失败时回滚内存。
- 同步服务器每次成功 PUT 只新增 1 条版本；每个 scope 版本上限 50、审计上限 5000；限流窗口清理过期 IP。
- 主密码比较与派生不 `trim`；首尾空格是有效密码字符。
- 撤销栈忽略与当前状态相同的 no-op 条目；操作历史只保留动作摘要并自动脱敏旧敏感描述。
- 桌面 SSH 部署对远端路径使用 POSIX shell 安全引用；部署健康检查使用正常 TLS 校验。

## 5. 同步现状

三端都支持自建服务器：

- 主接口：`GET/PUT /v2/sync/state`
- 兼容接口：`GET/PUT /v1/sync/payload`
- 版本：`/v2/sync/versions`
- 并发保护：`ETag`、`If-Match`、`428/412` 冲突处理
- 模式：预览合并、合并、云端覆盖本地、本地覆盖云端
- 同步前安全评估和本地快照

Bearer Token 和同步加密密钥都允许留空：

- Token 留空：服务器进入显式开放模式，客户端不发送 `Authorization`。
- Token 非空：使用用户提供的 Bearer Token；项目不会自动生成 Token。
- 同步密钥留空：使用明文 `pass.sync.bundle.v2`，服务器必须允许明文。
- 同步密钥非空：使用 AES-256-GCM 加密信封；所有客户端配置同一密钥。

WebDAV 当前由 Tauri 和 Docker Web 支持；Chrome Web 扩展明确不支持。三端均支持自建服务器版本列表与恢复。

## 6. 平台能力边界

| 能力 | Tauri | Docker Web | Chrome Web 扩展 |
|---|---|---|---|
| 账号/文件夹/排序/回收站 | 完整 | 完整 | 完整 |
| 自建服务器同步 | 完整 | 完整 | 完整 |
| WebDAV | 完整 | 完整 | 不支持，明确报错 |
| SSH 创建服务 | 完整 | 只保存草稿/检测 | 只保存草稿 |
| 服务器版本恢复 | 完整 | 完整 | 完整 |
| 原生文件选择器 | 完整 | 浏览器上传/下载 | 浏览器上传/下载 |
| Touch ID | macOS 可用 | 不支持 | 不支持 |
| 页面自动填充/WebAuthn | 不提供 | 不提供 | 扩展专属 |

## 7. 导入导出与历史

- CSV：通用 CSV 和 Chrome/Firefox/Safari 方言导入导出；用户名、密码均允许为空。
- 同步包：导出后显示摘要；导入先展示账号级差异与安全检查，用户确认后才写入。
- 永久删除墓碑不计入可见账号数量，也不会在预览中显示为新增账号。
- 本地快照、服务器版本、撤销、重做和可浏览历史窗口均已接入统一 UI。
- 操作历史只保留动作摘要；密码、TOTP、恢复码和备注不会写入历史，读取旧记录时会自动脱敏并重存。
- 历史脱敏同时识别中文旧格式与英文 `password/totp/recovery/note changed to ...` 描述。
- Tauri 撤销会跳过与当前 vault 相同的 no-op 历史项，避免失败操作留下假撤销按钮。

## 8. 验证入口

```bash
node scripts/version.mjs check
bash scripts/core_gate.sh
node scripts/check_command_matrix.mjs
cd apps/pass-web && cargo test --locked
cd apps/codex-tauri/src-tauri && cargo test --locked
cd apps/sync_server_ubuntu && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

当前自动化基线（1.1.3）：扩展 78 项、Docker Web 9 项、Tauri 22 项、同步服务器 33 项、脚本 17 项；命令矩阵覆盖 68 个 UI 命令；版本落点 45 个。

## 9. 当前限制

- 同步仍是整包 payload 合并，不是服务端 op-log 合并；服务端保持哑存储。
- Chrome 扩展不能直接执行 SSH 部署，也不直接实现 WebDAV。
- Docker Web 当前是单用户 vault；多用户隔离、WebAuthn 登录和权限模型不在现有实现内。
- 软件 passkey 私钥仍属于可同步材料，不等同于硬件认证器安全模型。
- 桌面 SSH 创建服务对远端路径采用 POSIX shell 安全引用；证书路径中的引号不能拼接为远端命令。
- 同步服务器是哑存储：只做认证、ETag/revision、版本历史与审计，不解密账号内容。
- 桌面内嵌 `pass_sync_server.py`（Tauri/macOS）必须与 `apps/sync_server_ubuntu/pass_sync_server.py` 一致；版本检查会拦截漂移。
