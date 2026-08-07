# 创建服务的 TLS 部署说明

“在服务器创建同步服务”要求服务器地址使用 `https://`。当地址带显式端口（例如 `https://example.com:53334`）时，桌面端会通过 SSH 将证书和私钥复制到 `/etc/pass-sync/tls/`，生成 `PASS_SYNC_TLS_CERT`、`PASS_SYNC_TLS_KEY`，并以 HTTPS 方式执行 `/healthz` 健康检查。

创建器生成的 systemd 单元会先加载 `/etc/pass-sync/pass-sync-server.env`，再写入本次创建的监听地址、端口和 TLS 路径。这样旧部署遗留的 `PASS_SYNC_PORT` 或 TLS 参数不会覆盖新配置。证书必须是完整证书链（`fullchain.cer`/`fullchain.pem`）和对应私钥；两者缺一时创建应失败。

不带显式端口的 HTTPS 地址用于已有的 443 反向代理场景，服务进程保持回环 HTTP 监听。生产环境不应把同步进程直接暴露为明文公网 HTTP，也不应使用空同步密钥或空 Bearer Token；创建前请配置访问令牌和 256 位同步加密密钥。

部署完成后应确认：

```text
systemctl show pass-sync-server --property=ActiveState,MainPID
ss -ltnp
curl --fail https://example.com:53334/healthz
```

若客户端仍访问旧端口，先检查 `/etc/pass-sync/pass-sync-server.env` 和 systemd 实际环境，再重新点击“创建服务”更新服务单元。
