# Pass Web / Docker / Ubuntu 三阶段完整设计

本文定义把当前 Tauri 桌面版扩展为「Ubuntu 无 GUI + Docker + 浏览器」版本的完整实施方案。目标是复用桌面版业务规则和同步合并规则，在浏览器中完成同等的数据管理操作。

## 1. 目标与边界

### 目标

- Ubuntu Server 无桌面环境运行。
- Docker 一条命令启动，网页端口访问。
- 账号、文件夹、回收站、批量恢复、撤销、重做、历史记录、导入导出、同步预览和合并规则保持一致。
- 与现有 `pass.sync.bundle.v2`、`pass_merge::v2`、macOS/扩展同步协议兼容。
- 数据落盘加密，支持备份、恢复、健康检查和失败回滚。
- 第一版先支持单个保险库；第三阶段再支持多用户和权限隔离。

### 不承诺完全相同的系统能力

以下能力属于操作系统或桌面容器能力，网页端必须使用等价方案：

| 桌面能力 | Web 等价方案 |
| --- | --- |
| Touch ID / 指纹解锁 | WebAuthn、安全密钥或网页登录密码 |
| 原生文件选择器 | 浏览器上传、下载和 File System Access API |
| 菜单栏、托盘、窗口尺寸 | 浏览器标签页、响应式布局 |
| macOS 快捷键 | 浏览器快捷键和网页事件 |
| 系统 AutoFill / Credential Provider | 浏览器扩展或独立客户端 |
| SSH 安装远端服务 | 管理员部署脚本，默认不开放给普通网页用户 |

## 2. 当前代码盘点

当前 Tauri 前端位于 `apps/codex-tauri/src/main.js`，通过 `window.__TAURI__.core.invoke` 调用 Rust 命令。后端命令集中在 `apps/codex-tauri/src-tauri/src/main.rs`，本地数据包括：

- 账号、文件夹、通行密钥和字段时间戳。
- 撤销/重做和本地快照。
- `pass_merge::v2` 字段级 LWW 合并。
- 同步设置、WebDAV、自建服务器和同步包。
- Tauri 应用锁和 macOS 生物识别适配。

现有 `apps/sync_server_ubuntu` 只负责同步 payload 的版本、ETag、审计和持久化，不能直接承担完整保险库网页 CRUD。因此新增 `apps/pass-web`，采用独立 Web API，同时复用 `core/pass_core` 的数据类型和合并 crate。

## 3. 总体架构

```text
浏览器
  │ HTTPS / Cookie 会话
  ▼
Pass Web API（Axum）
  ├── Web 命令适配器：/api/invoke/{command}
  ├── 认证、会话、CSRF、限流
  ├── 保险库服务层
  ├── 导入导出与同步服务
  └── 审计事件
        │
        ├── 加密保险库文件 / SQLite 元数据
        ├── 本地快照和历史
        └── pass_merge::v2

Tauri 桌面端 ──同一服务层规则── Web API
同步服务器 ──pass.sync.bundle.v2── Web / Tauri / macOS / 扩展
```

### 分层要求

1. **Domain**：账号、文件夹、通行密钥、字段时间戳、删除墓碑、合并规则。
2. **Vault service**：CRUD、回收站、快照、撤销/重做、导入导出。
3. **Transport**：Tauri command、HTTP JSON、同步服务器客户端。
4. **Web UI**：尽量复用现有 `index.html`、`main.js`、`styles.css`，只替换 `invoke` 传输适配。

禁止把 HTTP 解析、Cookie、Tauri `AppHandle` 或浏览器 API 写进 Domain 层。

## 4. 三阶段交付

### 阶段一：单用户 Web 核心（当前已开始）

交付内容：

- Axum HTTP 服务和静态资源服务。
- `POST /api/invoke/{command}` 兼容桌面前端命令形状。
- 账号创建、编辑、删除、恢复、永久删除。
- 文件夹创建、删除、账号归属、排序。
- 置顶、回收站、撤销、重做、历史列表。
- UI 偏好和同步设置落盘。
- Web vault 使用 AES-256-GCM 加密文件，密钥独立保存。
- `GET /healthz` 健康检查。
- 前端在 Tauri 环境使用 `invoke`，浏览器环境自动使用 `fetch`。

退出条件：

- 浏览器可打开首页并加载当前状态。
- 创建账号、编辑账号、删除、恢复、文件夹归属、撤销和重做端到端通过。
- 重启服务后数据仍存在。
- 错误请求不会写入部分数据。

### 阶段二：Docker、同步和生产部署

交付内容：

- Docker 多阶段构建：Node 生成前端 dist，Rust 构建 Web 二进制，Debian slim 运行。
- Docker Compose，数据目录使用 named volume 或宿主机目录。
- 同步预览、合并、云端覆盖、本地覆盖、ETag/If-Match 和失败重试。
- 同步包上传预览、用户确认后写入、浏览器下载导出。
- CSV 导入、CSV 下载导出、Google Authenticator 导入。
- 反向代理模板：Caddy/Nginx + HTTPS。
- systemd 模板和 GitHub Actions 自动部署。
- 启动检查、健康检查、数据备份、失败回滚。

生产部署约束：

- Web 服务只监听 `127.0.0.1`，由反向代理对外提供 HTTPS。
- 生产环境必须设置 `PASS_WEB_AUTH_TOKEN` 或网页登录认证配置。
- `/data` 同时包含加密 vault 和密钥文件，备份必须成套进行。
- 不把同步 Bearer Token、同步加密密钥、网页登录密钥写入镜像或 Git。
- Docker 构建必须固定基础镜像大版本，并在 CI 中执行漏洞扫描。

### 阶段三：多用户与强认证

交付内容：

- 用户、组织、角色和保险库隔离。
- 每个用户独立数据密钥，使用服务器主密钥或 KMS 包装。
- Cookie 会话、会话撤销、空闲超时、设备列表和强制下线。
- WebAuthn 注册、登录、恢复密钥和设备变更确认。
- 管理员、普通用户、只读审计员三类权限。
- 审计日志：登录、导出、恢复、删除、同步、权限变更；默认不记录密码和密钥明文。
- 速率限制、IP/设备异常检测、CSRF、防重放和安全响应头。
- 多用户并发写入使用版本号和事务，避免一个用户覆盖另一个用户的操作。

退出条件：

- 两个用户的数据在数据库、缓存和 API 响应中完全隔离。
- 无权限用户无法读取、导出或恢复其他用户数据。
- WebAuthn 注册、登录、撤销和恢复流程有自动化测试。
- 审计事件可以按用户、时间和操作类型查询。

## 5. Web API 契约

### 基础接口

```text
GET  /healthz
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
POST /api/invoke/{command}
GET  /api/audit
GET  /api/export/{format}
POST /api/import/{format}
```

阶段一的 `invoke` 兼容层用于快速复用现有前端。阶段二开始，新增的接口必须采用明确的 REST 输入输出，不再让新功能依赖字符串命令名。

### 命令响应格式

成功：

```json
{"result": {}}
```

失败：

```json
{
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "未找到账号",
    "requestId": "..."
  }
}
```

错误码必须稳定，前端显示文本可以本地化。所有写操作返回 `requestId` 和新的 vault revision。

### 并发控制

- 每个保险库维护递增 `revision`。
- 写请求携带 `If-Match: revision` 或 JSON `expectedRevision`。
- 不匹配返回 `409 REVISION_CONFLICT`，客户端先拉取、预览合并，再由用户确认。
- 同一用户的写操作按 vault 锁串行化；不同用户的数据不能共享锁。

## 6. 数据与加密设计

### 阶段一单用户文件

```text
/data/
  pass-web-vault-v1.enc       # AES-256-GCM 密文
  pass-web-vault-key-v1       # 32 字节随机密钥，0600
  snapshots/                  # 加密快照
  audit.jsonl                 # 不含密码、密钥内容
```

阶段二可迁移到 SQLite：

- `users`
- `vaults`
- `vault_revisions`
- `audit_events`
- `webauthn_credentials`
- `sessions`

密码、TOTP、恢复码和私钥不得出现在普通日志、审计记录、错误信息或 HTTP tracing 中。

### 备份规则

- 备份必须同时包含 vault 密文和 vault key。
- 写入前先生成快照，再替换主文件。
- 恢复前生成当前状态快照。
- 保留最近 20 个本地快照和最近 50 个服务端同步版本。
- 恢复失败不得删除原数据。

## 7. 浏览器适配清单

| 现有命令/功能 | Web 行为 |
| --- | --- |
| `get_app_state` | HTTP JSON 返回同名字段 |
| `create_account` / `update_account` | 保持输入字段和时间戳规则 |
| `export_sync_bundle` | 生成临时下载响应，不返回服务器绝对路径给用户 |
| `import_sync_bundle_text` | 浏览器上传后先预览，确认后再次提交 `apply=true` |
| `choose_export_directory` | 删除，改为下载 |
| `navigator.clipboard` | 使用浏览器权限，失败显示中文提示 |
| Touch ID | WebAuthn 或密码 |
| `window_state` | 不迁移，使用 CSS 响应式布局 |
| SSH provision | 管理员 API 或部署脚本，不允许普通用户调用 |

## 8. 认证和安全

### 阶段一

- 支持环境变量 Bearer Token，开发时可以留空。
- 浏览器第一次收到 401 时请求令牌并保存在 `localStorage`。
- 生产部署不能使用开放模式。

### 阶段二

- 使用 `HttpOnly; Secure; SameSite=Lax` 会话 Cookie。
- 密码只存 Argon2id/PBKDF2 哈希，不存明文。
- 所有写接口检查 CSRF Token。
- 登录失败限流，令牌不写日志。

### 阶段三

- WebAuthn challenge 单次使用、短时过期并绑定 session。
- 凭据变更要求现有会话再次认证。
- 管理员操作需要二次确认。
- 备份、导出、删除和同步写入审计事件。

## 9. Docker 与 Ubuntu 上线流程

### Docker

```bash
cd apps/pass-web
printf 'PASS_WEB_AUTH_TOKEN=替换为长随机令牌\n' > .env
docker compose up -d --build
curl http://127.0.0.1:53335/healthz
```

### Ubuntu systemd

1. 创建 `passweb` 系统用户和 `/var/lib/pass-web`。
2. 安装二进制、静态资源和 `pass-web.service`。
3. `/etc/pass-web/pass-web.env` 设置监听地址、数据目录和认证配置。
4. Caddy/Nginx 代理到 `127.0.0.1:53335`。
5. 执行健康检查后再切换 DNS。

### 自动部署

`.github/workflows/deploy-pass-web.yml`：

- 每次相关提交先执行 Node、Rust 和前端语法测试。
- 设置仓库变量 `PASS_WEB_DEPLOY_ENABLED=true` 后才执行部署。
- 通过 SSH 拉取 `master`，执行 Docker Compose 构建和重启。
- `/healthz` 失败时输出日志并使工作流失败；生产脚本应在下一版增加自动回滚到上一镜像 digest。

## 10. 测试矩阵

### 单元测试

- 账号字段更新和空用户名/空密码。
- 文件夹归属和删除后的账号去向。
- 永久删除墓碑不出现在可见统计。
- 撤销/重做栈顺序。
- AES-GCM 加解密、密钥丢失和密文损坏。
- 字段级同步合并和安全检查。

### API 测试

- 未授权、错误 token、开放模式。
- 账号 CRUD、回收站、文件夹、历史。
- 并发 revision 冲突。
- 导入预览不写入，确认后才写入。
- 大请求、超时、速率限制和未知命令。

### 浏览器测试

- Chromium/Firefox/Safari 加载首页。
- 首次登录、刷新、退出和失效会话。
- 上传同步包、确认预览、取消导入。
- 下载 CSV/同步包。
- 移动端窗口不遮挡底部操作栏。

### 部署测试

- 空数据目录启动。
- 重启容器数据仍在。
- 备份恢复后密钥和数据匹配。
- 旧版本镜像回滚。
- amd64/arm64 构建。

## 11. 迁移方案

### 从 Tauri 本地数据迁移

1. 桌面端导出 `pass.sync.bundle.v2`。
2. Web 端进入导入预览，展示账号、文件夹、通行密钥数量和具体差异。
3. 用户确认后写入 Web vault。
4. Web 端生成第一份安全快照。
5. Tauri 和 Web 使用同一个同步服务逐步收敛，不直接复制桌面数据库文件。

禁止直接复制 `pass-tauri.db` 到服务器：桌面数据库的本地 key、平台路径和锁状态不适合作为远程部署格式。

## 12. 当前实施状态

- 已完成：`apps/pass-web` Axum 服务骨架、加密 vault、静态页面、浏览器 `invoke` 适配、核心账号/文件夹/回收站/撤销重做 API。
- 已完成：本地 Rust 单元测试和 API 端到端测试。
- 已完成基础验证：Dockerfile、Docker Compose、`.dockerignore`、容器健康检查和 arm64 本机构建。
- 已准备：Caddy、systemd、GitHub Actions 部署模板。
- 待继续：同步服务完整接入、真正的浏览器下载/上传接口、Cookie 会话、SQLite 多用户模型和 WebAuthn。
- 远程 Ubuntu 部署和多架构镜像发布尚未执行，需要在对应服务器和 CI 环境继续验证。

## 13. 最终验收标准

只有满足以下条件，才能称为“三阶段完成”：

- 浏览器端核心操作与桌面端结果一致。
- 同步预览、合并和导入确认流程一致。
- Docker 和 Ubuntu systemd 均可从空目录部署。
- 数据、密钥、快照和备份可恢复。
- 多用户无法越权读取其他保险库。
- WebAuthn、会话撤销、审计和并发冲突均有自动化测试。
- CI 在每次相关提交后完成构建、测试和可选部署。
