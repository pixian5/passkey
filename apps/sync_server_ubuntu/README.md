# sync_server_ubuntu

一个可直接部署到 Ubuntu 的自建同步服务，实现本项目当前客户端已经使用的：

- `GET /v1/sync/payload`
- `PUT /v1/sync/payload`

服务端只负责认证、版本控制和持久化 `pass.sync.bundle.v2`，可直接被 mac App 和 Chrome 扩展接入。

## 特性

- 单文件 Python 服务，零第三方依赖
- SQLite 持久化，默认启用 WAL
- 可选 Bearer Token 认证
- 返回 `ETag`，并支持 `If-Match` 并发保护
- `GET /healthz` 健康检查

## 启动

```bash
cd /Users/x/code/pass/apps/sync_server_ubuntu
python3 pass_sync_server.py
```

默认监听 `0.0.0.0:53333`，数据库位于：

```text
./data/pass_sync.sqlite3
```

## 环境变量

- `PASS_SYNC_HOST`
  - 默认 `0.0.0.0`
- `PASS_SYNC_PORT`
  - 默认 `53333`
- `PASS_SYNC_DB_PATH`
  - 默认 `./data/pass_sync.sqlite3`
- `PASS_SYNC_BEARER_TOKENS`
  - 为空时不鉴权
  - 支持：
    - `token-value`
    - `default=token-value`
    - `family=token-a,work=token-b`
- `PASS_SYNC_LOG_LEVEL`
  - 默认 `INFO`

## 客户端接入

在 mac App 或 Chrome 扩展中填写：

- 服务地址：`https://your-domain.example`
- Token：`PASS_SYNC_BEARER_TOKENS` 中对应值

客户端会自动访问：

```text
https://your-domain.example/v1/sync/payload
```

## 建议部署

生产环境建议：

- 用 `Caddy` 或 `Nginx` 反向代理，统一提供 HTTPS
- 只开放 `443`
- 通过 `systemd` 管理进程
- 定期备份 `pass_sync.sqlite3`

## systemd 示例

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
