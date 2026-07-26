# Pass 本地同步服务器

适用于 macOS 开发/可信网络的一键同步服务器。服务可以监听局域网地址，但当前 Tauri 和 Chrome 只允许回环地址使用明文 HTTP；跨设备访问必须在服务前配置 HTTPS 反向代理。

## 原理

复用 `apps/sync_server_ubuntu/pass_sync_server.py`（单文件 Python，零第三方依赖）：

- 客户端配置**同步加密密钥**时，用 AES-256-GCM 加密整个同步包；所有客户端必须使用同一密钥
- 同步密钥留空时，默认允许保存明文 `pass.sync.bundle.v2`；此时服务端数据库可以读到密码和软件 Passkey 材料，只能用于可信链路
- 设置 `PASS_SYNC_ALLOW_PLAINTEXT=0` 可拒绝明文同步包，但这不会替客户端生成或保存同步密钥
- 可选 Bearer Token 认证，ETag + If-Match 做并发冲突保护

## 快速启动（前台/手动）

```bash
cd /Users/x/code/pass/apps/sync_server_local
./start.sh
```

脚本会自动：
1. 检测本机局域网 IP
2. 读取用户显式设置的 Bearer Token；留空时进入开放模式
3. 监听 `0.0.0.0:53333`，让局域网内其他设备可访问
4. 打印客户端需要的地址和认证模式

脚本不会把已配置的 Bearer Token 原样打印到终端；需要在客户端使用时，应从原配置来源读取。

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
- 保存安装时的 `PASS_SYNC_BEARER_TOKENS` 和 `PASS_SYNC_ALLOW_PLAINTEXT` 配置
- 日志写入 `~/Library/Logs/pass-sync-server.log`

卸载开机自启：

```bash
./uninstall-launchd.sh
```

## 扩展/客户端配置

在客户端设置页配置：

- **同一台 Mac**: `http://127.0.0.1:53333` 或 `http://localhost:53333`
- **其它设备**: 通过 Caddy/Nginx 暴露的 `https://你的域名`；不要直接填写 `http://局域网IP:53333`
- **访问令牌**: 可留空；需要认证时在启动前显式设置 `PASS_SYNC_BEARER_TOKENS`
- **同步加密密钥**: 可留空；需要加密时在所有客户端填写同一枚 256 位密钥

> 注意：Tauri 和 Chrome Web 扩展都要求非回环同步地址使用 HTTPS。本脚本打印的 `http://局域网IP` 只是服务监听/健康检查地址，不代表客户端会接受；跨设备同步应配置本地 HTTPS 反向代理（如 `mkcert` + Caddy）或使用正式 HTTPS 自建服务。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PASS_SYNC_HOST` | `0.0.0.0` | 监听地址 |
| `PASS_SYNC_PORT` | `53333` | 监听端口 |
| `PASS_SYNC_BEARER_TOKENS` | 留空 | 可选，`default=TOKEN` 格式；项目不会自动生成 |
| `PASS_SYNC_ALLOW_PLAINTEXT` | `1` | `1` 允许空同步密钥产生的明文包；`0` 只接受加密信封 |
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
