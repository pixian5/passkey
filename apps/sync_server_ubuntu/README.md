# sync_server_ubuntu

一个可直接部署到 Ubuntu 的自建同步服务，实现本项目当前客户端已经使用的：

- `GET /v1/sync/payload`
- `PUT /v1/sync/payload`
- `GET /v1/sync/versions`
- `GET /v1/sync/versions/{versionId}`（只读恢复下载）
- `POST /v1/sync/versions/{versionId}/restore`（使用当前 `If-Match` 原子恢复）

服务端只负责认证、版本控制和持久化 `pass.sync.encrypted.v1` 密文信封，无法读取账号、密码、TOTP、恢复码或 Passkey。

## 特性

- 单文件 Python 服务，零第三方依赖
- SQLite 持久化，默认启用 WAL
- 自动保留每个同步 scope 最近 50 个快照版本，便于误覆盖后的人工恢复
- 可选 Bearer Token 认证
- 返回 `ETag`，并支持 `If-Match` 并发保护
- `GET /healthz` 健康检查
- 通过受保护的版本接口读取最近保存的加密快照，不会在服务端解密
- 恢复接口要求携带当前数据的 `If-Match`，恢复动作会再次写入版本历史，避免并发覆盖

## 快速启动

```bash
cd /Users/x/code/pass/apps/sync_server_ubuntu
./start.sh
```

脚本会自动生成随机 Bearer Token、监听 `0.0.0.0:53333` 并打印配置信息。

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
  - 必填；未配置时 `/v1/sync/payload` 会拒绝所有请求
  - 支持：
    - `token-value`
    - `default=token-value`
    - `family=token-a,work=token-b`
- `PASS_SYNC_LOG_LEVEL`
  - 默认 `INFO`
- `PASS_SYNC_MAX_BODY_BYTES`
  - 默认 `2097152`（2 MiB）

## 客户端接入

在 mac App 或 Chrome 扩展中填写：

- 服务地址：`https://your-domain.example`
- Token：`PASS_SYNC_BEARER_TOKENS` 中对应值
- 同步加密密钥：在所有客户端填写同一枚 256 位密钥；该密钥不得配置到服务器

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
- `payload_versions` 表保存最近 50 个密文快照；备份时应同时保留整个 SQLite 文件

## systemd 部署（生产推荐）

复制服务文件并修改 Token：

```bash
sudo cp pass-sync-server.service /etc/systemd/system/
sudo editor /etc/systemd/system/pass-sync-server.service
# 修改 PASS_SYNC_BEARER_TOKENS 和路径
sudo systemctl daemon-reload
sudo systemctl enable --now pass-sync-server
```

服务文件模板见 [`pass-sync-server.service`](./pass-sync-server.service)。

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
