# sync_server_ubuntu

一个可直接部署到 Ubuntu 的自建同步服务，实现本项目当前客户端已经使用的：

- `GET /v2/sync/state`（主接口；兼容 `GET /v1/sync/payload`）
- `PUT /v2/sync/state`（主接口；兼容 `PUT /v1/sync/payload`）
- `GET /v2/sync/versions`、`GET /v2/sync/versions/{versionId}`（兼容 v1 路径）
- `POST /v2/sync/versions/{versionId}/restore`（兼容 v1 路径）
- `GET /v2/sync/audit`（兼容 v1 路径）
- `GET /v1/sync/versions`
- `GET /v1/sync/versions/{versionId}`（只读恢复下载）
- `POST /v1/sync/versions/{versionId}/restore`（使用当前 `If-Match` 原子恢复）
- `GET /v1/sync/audit`（读取当前 scope 的同步操作审计记录）

服务端只负责认证、版本控制和持久化同步快照；客户端配置密钥时保存 `pass.sync.encrypted.v1` 密文信封，留空时会保存明文内容。

## 特性

- 单文件 Python 服务，零第三方依赖
- SQLite 持久化，默认启用 WAL
- 自动保留每个同步 scope 最近 50 个快照版本，便于误覆盖后的人工恢复
- 可选 Bearer Token 认证
- 返回 `ETag`，并支持 `If-Match` 并发保护
- `GET /healthz` 健康检查
- `GET /metrics`（需要 Bearer Token）返回请求数、限流数、数据库大小等运维指标
- 通过受保护的版本接口读取最近保存的同步快照；启用明文模式时服务端会直接保存明文内容
- 恢复接口要求携带当前数据的 `If-Match`，恢复动作会再次写入版本历史，避免并发覆盖
- 审计接口只返回操作类型、状态、ETag、版本号和时间，不包含同步密文内容
- 支持客户端留空同步密钥后使用明文 `pass.sync.bundle.v2`；明文可能包含密码，生产环境应优先配置同步密钥
- 已有 state 的 `PUT` **必须**携带 `If-Match`；缺失返回 `428/412`
- 启动时若发现未知 schema 的 payload，会先写入 `purged_payloads_*.jsonl` 隔离文件；默认拒绝启动，需显式设置 `PASS_SYNC_PURGE_LEGACY=1` 才删除
- 幂等重放若发现远端 etag 已被推进，返回 `409 IDEMPOTENCY_STALE`
- GitHub Actions 使用 `/opt/pass-sync-source` 保存源码、`/opt/pass-sync-server` 保存安装文件；两者不混用
- 部署前暂停服务并备份当前程序、systemd 单元和 SQLite；`/healthz` 失败时恢复这些实际安装文件和数据库后重启旧服务
- 健康检查从 systemd 运行进程读取实际端口和 TLS 配置，兼容环境文件覆盖默认端口；回滚后工作流保持失败状态
- 部署会安装并启用 `pass-sync-server-backup.timer`，每日备份脚本固定从 `/opt/pass-sync-server/backup_sync_db.sh` 运行

## 快速启动

```bash
cd /Users/x/code/pass/apps/sync_server_ubuntu
./start.sh
```

脚本监听 `0.0.0.0:53333` 并打印配置信息。未显式配置 Token 时进入开放模式，不会自动生成 Bearer Token；设置 `PASS_SYNC_BEARER_TOKENS` 或令牌文件后才启用认证。

```bash
./stop.sh    # 停止服务
```

也可以直接运行 Python 文件：

```bash
python3 pass_sync_server.py
```

默认仅监听 `127.0.0.1:53333`，数据库位于：

```text
./data/pass_sync.sqlite3
```

## 环境变量

- `PASS_SYNC_HOST`
  - 默认 `127.0.0.1`
- `PASS_SYNC_PORT`
  - 默认 `53333`
- `PASS_SYNC_DB_PATH`
  - 默认 `./data/pass_sync.sqlite3`
- `PASS_SYNC_BEARER_TOKENS`
  - 可选；未配置时进入开放模式，`/v2/sync/state`（以及兼容的 `/v1/sync/payload`）不要求 Bearer Token。生产环境建议配置令牌
  - 支持：
    - `token-value`
    - `default=token-value`
    - `family=token-a,work=token-b`
- `PASS_SYNC_BEARER_TOKENS_FILE`
  - 可选；从权限为 `0600` 的文件读取同样的 `scope=token` 列表，便于轮换令牌
  - 文件不存在时会回退到 `PASS_SYNC_BEARER_TOKENS`；两者都未配置时进入开放模式
- `PASS_SYNC_LOG_LEVEL`
  - 默认 `INFO`
- `PASS_SYNC_MAX_BODY_BYTES`
  - 默认 `2097152`（2 MiB）
- `PASS_SYNC_ALLOW_PLAINTEXT`
  - 默认开启（`1`），允许客户端在同步密钥为空时上传明文 `pass.sync.bundle.v2`
  - 如需强制端到端加密，设置为 `0`；此时所有客户端都必须配置 256 位同步密钥
- `PASS_SYNC_PURGE_LEGACY`
  - 默认关闭；发现未知 schema 时只隔离不删除
  - 确认隔离文件后设为 `1` 才允许启动时 purge
- `PASS_SYNC_RATE_LIMIT_PER_MINUTE`
  - 每个客户端 IP 每分钟最大请求数，默认 `120`
- `PASS_SYNC_CLIENT_TIMEOUT_SECONDS`
  - 单个连接读取请求头或请求体的最长时间，默认 `15` 秒；超时连接会被释放，避免慢速请求长期占用 worker
- `PASS_SYNC_MAX_CONCURRENT_REQUESTS`
  - 同时处理请求上限，默认 `32`；达到上限时新请求返回 `503 SERVER_BUSY`，保护已在处理的同步请求
- `PASS_SYNC_ALLOWED_ORIGINS`
  - 可选，逗号分隔的精确 Origin 白名单（例如 `chrome-extension://<扩展ID>,moz-extension://<扩展ID>`）
  - 默认为空，即不返回 CORS 允许头；服务端同步客户端不依赖 CORS 时无需配置
- `PASS_SYNC_TLS_CERT` / `PASS_SYNC_TLS_KEY`
  - 同时配置后启用 TLS；生产环境应使用证书和私钥文件，并将 `PASS_SYNC_PORT` 设置为 HTTPS 监听端口

## 客户端接入

在 mac App 或 Chrome 扩展中填写：

- 服务地址：`https://your-domain.example`
- Token：`PASS_SYNC_BEARER_TOKENS` 中对应值
- 同步加密密钥：在所有客户端填写同一枚 256 位密钥；留空则使用明文同步包，该密钥不得配置到服务器

客户端会自动访问：

```text
https://your-domain.example/v2/sync/state
```

## 建议部署

生产环境建议：

- 用 `Caddy` 或 `Nginx` 反向代理，统一提供 HTTPS
- 只开放 `443`
- 通过 `systemd` 管理进程
- 定期备份 `pass_sync.sqlite3`
- 备份脚本会执行 SQLite `integrity_check`，校验失败时以非零状态退出
- `payload_versions` 表保存最近 50 个密文快照；备份时应同时保留整个 SQLite 文件

仓库的 `Deploy Sync Server` 工作流会在服务器维护两个目录：

- `/opt/pass-sync-source`：GitHub Actions 专用源码检出目录。
- `/opt/pass-sync-server`：systemd 实际运行的稳定安装目录，不是 Git 仓库。
- `/etc/pass-sync/tls`：部署时保存的服务证书副本；systemd 从这里读取证书和私钥。

不要把安装目录当作 Git 仓库，也不要通过切换源码提交冒充程序回滚。回滚必须恢复安装目录、systemd 单元和部署前 SQLite 备份。

## systemd 部署（生产推荐）

复制服务文件并修改 Token：

```bash
sudo cp pass-sync-server.service /etc/systemd/system/
sudo editor /etc/systemd/system/pass-sync-server.service
# 修改 PASS_SYNC_BEARER_TOKENS 和路径
sudo systemctl daemon-reload
sudo systemctl enable --now pass-sync-server

# 轮换令牌（保留旧令牌，确认客户端迁移后再删除旧行）
sudo ./rotate_token.sh /etc/pass-sync/tokens.conf default

# 安装每日数据库备份（推荐）
sudo cp pass-sync-server-backup.service pass-sync-server-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pass-sync-server-backup.timer
```

服务文件模板见 [`pass-sync-server.service`](./pass-sync-server.service)。
备份脚本和每日定时器模板见 [`backup_sync_db.sh`](./backup_sync_db.sh)、
[`pass-sync-server-backup.timer`](./pass-sync-server-backup.timer)。

```ini
[Unit]
Description=Pass Sync Server
After=network.target

[Service]
Type=simple
User=pass
Group=pass
WorkingDirectory=/opt/pass-sync-server
Environment=PASS_SYNC_HOST=127.0.0.1
Environment=PASS_SYNC_PORT=53333
Environment=PASS_SYNC_DB_PATH=/var/lib/pass-sync/pass_sync.sqlite3
Environment=PASS_SYNC_BEARER_TOKENS=default=replace-with-long-random-token
ExecStart=/usr/bin/python3 /opt/pass-sync-server/pass_sync_server.py
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```
