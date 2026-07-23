# Pass Web（Ubuntu / Docker 无 GUI 版）

这是 Pass 的无 GUI 网页版第一阶段实现。完整三阶段方案见 [`docs/pass-web-three-stage-design-zh.md`](../../docs/pass-web-three-stage-design-zh.md)，Docker 专项开发、发布和运维规范见 [`docs/pass-web-docker-development-zh.md`](../../docs/pass-web-docker-development-zh.md)。它复用 `pass_merge::v2` 的账号、文件夹和同步数据结构，并直接提供与 Tauri 前端兼容的命令 RPC：

- 账号新建、编辑、回收站、恢复、永久删除
- 文件夹创建、删除、账号归属和排序
- 置顶、撤销、重做、历史列表
- TOTP/同步设置的基础数据保存
- AES-256-GCM 加密的数据文件和独立密钥文件

当前版本定位为单用户网页保险库。`PASS_WEB_AUTH_TOKEN` 是网页访问令牌，不等同于同步 Bearer Token。

## 本机运行

```bash
cd apps/pass-web
cargo run
```

默认监听 `127.0.0.1:53335`，静态页面默认从 `../codex-tauri/dist` 读取。测试浏览器访问：<http://127.0.0.1:53335/>。

常用环境变量：

```text
PASS_WEB_HOST=127.0.0.1
PASS_WEB_PORT=53335
PASS_WEB_DATA_DIR=./data
PASS_WEB_STATIC_DIR=../codex-tauri/dist
PASS_WEB_AUTH_TOKEN=（留空表示开放模式；生产环境必须设置）
```

## Docker

```bash
cd apps/pass-web
docker compose up -d --build
```

默认只绑定宿主机 `127.0.0.1:53335`，空 `PASS_WEB_AUTH_TOKEN` 允许本机开发和可信内网测试；生产环境应在外部 `.env` 或 Docker secret 中配置已有的 Web 访问令牌，并通过 Caddy/Nginx 提供 HTTPS。程序不会自动生成新的 Bearer Token。

容器数据在 Docker volume `pass_web_data` 中，必须同时保留 `pass-web-vault-v1.enc` 和 `pass-web-vault-key-v1`。丢失密钥文件将无法解密保险库。

生产环境建议用 Caddy/Nginx 反向代理 HTTPS，只开放 443，不要把 53335 直接暴露到公网；同时定期备份 `/data`。

## Web 端当前功能边界

已可用：

- 单用户账号、文件夹、回收站、批量恢复、撤销、重做和历史记录。
- 加密 vault、同步设置保存、同步密钥生成和本地 payload 合并。
- 同步包导出，以及同步包导入前预览、确认后合并写入。
- 基础 CSV 导出、Docker 健康检查和浏览器 `fetch` RPC 适配。

尚未完成但不是系统限制：

- 自建服务器真实拉取/推送、同步预览、ETag/If-Match、失败重试和覆盖模式。
- WebDAV 同步、服务器探测/创建/验证、服务器历史版本和本地快照恢复。
- 浏览器下载式同步包导出、CSV 导入、Google Authenticator 导入。
- 文件夹网站规则、文件夹去重、演示数据和部分 Tauri 锁定命令。

确实属于桌面专属或需要 Web 等价方案：

- macOS Touch ID、系统托盘、窗口菜单和原生窗口状态。
- 系统 AutoFill/Credential Provider 和 macOS 钥匙串直接集成。
- 原生文件选择器；Web 版应使用浏览器上传、下载或 File System Access API。

因此，当前 Web 页面中的同步按钮会调用尚未接入的远端命令，不能当作“服务器或 Docker 不支持”。

Ubuntu 可参考 `pass-web.service.example`，Caddy 可参考 `Caddyfile.example`。仓库中的
`.github/workflows/deploy-pass-web.yml` 会在每次相关提交后运行验证；只有配置仓库变量
`PASS_WEB_DEPLOY_ENABLED=true` 并提供 `PASS_WEB_SERVER_HOST`、`PASS_WEB_SERVER_USER`、
`PASS_WEB_SERVER_SSH_KEY` secrets 后才会自动 SSH 到服务器执行 Docker 部署。

## 当前限制与后续阶段

- 第二阶段：同步预览/合并、同步包上传下载、CSV 导入导出、生产 HTTPS、备份和回滚完善；Docker 基础健康检查已具备。
- 第三阶段：多用户隔离、网页登录会话、WebAuthn、审计日志和权限管理。
- macOS Touch ID、系统托盘、窗口尺寸和原生文件选择器属于桌面专属能力，网页端会改用浏览器会话、上传和下载。
