# 创建服务的 TLS 部署说明

“在服务器创建同步服务”要求服务器地址使用 `https://`。当地址带显式端口（例如 `https://example.com:53334`）时，桌面端会通过 SSH 将证书和私钥复制到 `/etc/pass-sync/tls/`，生成 `PASS_SYNC_TLS_CERT`、`PASS_SYNC_TLS_KEY`，并以 HTTPS 方式执行 `/healthz` 健康检查。

创建器生成的 systemd 单元会先加载 `/etc/pass-sync/pass-sync-server.env`，再写入本次创建的监听地址、端口和 TLS 路径。这样旧部署遗留的 `PASS_SYNC_PORT` 或 TLS 参数不会覆盖新配置。证书必须是完整证书链（`fullchain.cer`/`fullchain.pem`）和对应私钥；两者缺一时创建应失败。

同步服务创建器不会监听 1-1023 的特权端口（包括 80/443），也不会停止或覆盖目标端口上已有的其他进程。安装前会检查端口占用；若端口已被 Xray、`bz` 或其他服务使用，会返回“同步服务端口已被其他进程占用；不会修改现有服务”的错误。请为同步服务使用 1024 以上的专用端口（例如 53334），再由现有反向代理转发 443。

端口预检必须失败关闭：优先使用 `ss`，命令异常时回退到 `lsof`；两种工具都不可用或检查失败时直接中止，不把空输出当作端口空闲。重新创建已有服务时，Tauri 会先完成暂存，再停止旧服务并执行严格二次检查；二次检查失败会尝试恢复旧服务，避免竞态中删除旧配置后才发现端口不可用。

首次 SSH 连接采用无提示 TOFU：应用会自动保存 `ssh-keyscan` 返回的主机公钥，不再要求用户核对指纹。这只能保证后续主机密钥变化会被拒绝，不能证明首次连接的服务器身份；首次连接遭遇 DNS 污染或中间人时，SSH 密码、Bearer Token 或用户粘贴的 TLS 私钥可能泄露。仅应在可信网络和已确认的域名解析环境中使用，优先采用私钥认证，并将首次自动信任视为明确接受的安全风险。

不带显式端口的 HTTPS 地址用于已有的 443 反向代理场景，服务进程保持回环 HTTP 监听。生产环境不应把同步进程直接暴露为明文公网 HTTP，也不应使用空同步密钥或空 Bearer Token；创建前请配置访问令牌和 256 位同步加密密钥。

使用 `apps/sync_server_ubuntu/deploy.sh` 更新已有服务时，脚本会从运行中的服务迁移自定义监听地址、端口和 TLS 参数到配置文件；这保证旧版将 TLS 参数写在 systemd 单元中的部署升级后仍保持 HTTPS。

部署完成后应确认：

```text
systemctl show pass-sync-server --property=ActiveState,MainPID
ss -ltnp
curl --fail https://example.com:53334/healthz
```

若客户端仍访问旧端口，先检查 `/etc/pass-sync/pass-sync-server.env` 和 systemd 实际环境，再重新点击“创建服务”更新服务单元。
