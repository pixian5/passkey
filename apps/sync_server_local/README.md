# Pass 本地同步服务器

适用于 macOS 局域网环境的一键同步服务器。扩展和 App 已内置客户端，直接填写地址和令牌即可同步。

## 原理

复用 `apps/sync_server_ubuntu/pass_sync_server.py`（单文件 Python，零第三方依赖）：

- 扩展/客户端用**同步加密密钥**对密码数据做端到端 AES-256-GCM 加密
- 服务端只存储加密后的密文信封，无法读取账号、密码、Passkey 等内容
- 通过 Bearer Token 做设备认证，ETag + If-Match 做并发冲突保护

## 快速启动（前台/手动）

```bash
cd /Users/x/code/pass/apps/sync_server_local
./start.sh
```

脚本会自动：
1. 检测本机局域网 IP
2. 生成随机 Bearer Token（如果未自定义）
3. 监听 `0.0.0.0:53333`，让局域网内其他设备可访问
4. 打印客户端需要的地址和令牌

### 停止

```bash
./stop.sh
```

### 查看状态

```bash
./status.sh
```

## 开机自启（推荐）

```bash
cd /Users/x/code/pass/apps/sync_server_local
./install-launchd.sh
```

这会：
- 在 `~/Library/LaunchAgents` 创建 plist
- 设置开机自动启动、崩溃自动重启
- 日志写入 `~/Library/Logs/pass-sync-server.log`

卸载开机自启：

```bash
./uninstall-launchd.sh
```

## 扩展/客户端配置

在 Chrome 扩展、Safari 扩展或 macOS App 的设置页：

- **服务器地址**: `http://<你的局域网IP>:53333`
- **访问令牌**: `install-launchd.sh` 或 `start.sh` 打印的 Token
- **同步加密密钥**: 在所有客户端填写同一枚 256 位密钥（各客户端独立生成后统一填写）

> 注意：浏览器扩展要求同步地址必须是 HTTPS，但本机回环地址（`localhost`、`127.0.0.1`、`::1`）允许使用 HTTP。如果你需要从其他设备通过局域网访问，Chrome 扩展在 `http://局域网IP` 下会拒绝，建议在该局域网内使用 macOS App 或配置本地 HTTPS 反向代理（如 `mkcert` + `caddy`）。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PASS_SYNC_HOST` | `0.0.0.0` | 监听地址 |
| `PASS_SYNC_PORT` | `53333` | 监听端口 |
| `PASS_SYNC_BEARER_TOKENS` | 自动生成 | `default=TOKEN` 格式 |
| `PASS_SYNC_LOG_LEVEL` | `INFO` | 日志级别 |

自定义示例：

```bash
export PASS_SYNC_BEARER_TOKENS="home=my-secret-token"
export PASS_SYNC_PORT=54321
./start.sh
```

## 数据备份

数据库位于：

```text
~/Library/Application Support/PassSync/pass_sync.sqlite3
```

定期备份此文件即可。
