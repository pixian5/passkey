# Pass Web Docker 开发与发布设计

> 文档性质：当前单用户容器运行规范 + 后续生产发布设计。它不表示多用户、WebAuthn、跨进程 CAS、多架构发布和生产自动回滚已经完成。

本文只描述 Pass Web 的 Docker/OCI 容器化方案，不描述 Ubuntu 裸机安装，也不把 Docker 当成业务层。业务规则、数据模型和同步合并规则仍由 Rust 服务与 `core/pass_core` 提供；Docker 负责构建、封装、运行、持久化和发布。

本文的目标是让开发者可以在本机重复构建和测试，让运维人员可以在支持 Docker 或 Podman 的 Linux 主机上启动同一个版本，并让 CI 能构建可回滚的多架构镜像。

## 1. 范围和现状

### 1.1 Docker 交付目标

- 浏览器访问 Pass Web，不需要目标服务器安装桌面环境。
- 使用一个 OCI 镜像运行 Rust Web 服务和编译后的静态前端。
- 数据写入独立 `/data` 卷，容器删除和升级不删除保险库。
- 支持 `linux/amd64` 和 `linux/arm64`，以后按需求增加其它架构。
- 支持开发、测试、单机生产三种 Compose 配置。
- 支持健康检查、备份、恢复、升级、回滚和日志采集。
- 业务服务以非 root 用户运行，生产环境通过 Caddy 或 Nginx 提供 HTTPS。

### 1.2 当前仓库基线

当前已经存在：

- `apps/pass-web/Dockerfile`：Node 生成前端资源，Rust 构建 Web 二进制，Debian slim 运行。
- `apps/pass-web/docker-compose.yml`：单服务 Compose 和 named volume。
- 根目录 `.dockerignore`：排除源码仓库中的构建缓存、依赖、现有 dist 和本地数据。
- `apps/pass-web/Caddyfile.example`：反向代理模板。
- `.github/workflows/deploy-pass-web.yml`：测试通过后可选 SSH 到服务器构建并重启。
- `/healthz`：返回服务健康状态，不需要读取保险库内容。
- Compose 默认只绑定宿主机回环地址，并通过 `curl` 健康检查 `/healthz`。
- Web vault 使用 AES-256-GCM；密文文件和独立密钥文件位于同一数据目录。

当前单用户 Docker 版已具备同步预览/合并、同步包浏览器上传下载、CSV 双向导入导出和本地快照恢复。多用户、WebAuthn、审计和生产级自动回滚仍需后续实现；本文的 Docker 设计必须兼容这些能力，但不假设它们已经实现。

## 2. 总体架构

```text
浏览器
  |
  | HTTPS
  v
Caddy/Nginx（宿主机或独立代理容器）
  |
  | HTTP，仅绑定宿主机回环地址
  v
pass-web 容器
  |- Axum HTTP API
  |- 静态前端资源
  |- Web vault 服务
  |- 同步/导入导出服务
  `- /data 持久化卷
```

### 2.1 容器边界

容器内只放：

- `pass-web` 可执行文件。
- 编译后的 `dist` 静态文件。
- 运行时所需的最小系统库和 CA 证书。

容器内不放：

- Bearer Token、网页登录 Token、同步加密密钥等秘密配置。
- Git 仓库、源码、Node/Rust 编译缓存。
- 用户导出的明文 CSV 或同步包。
- Docker socket。

### 2.2 网络边界

- pass-web 容器内部监听 `53335`。
- 生产 Compose 默认只将宿主机 `127.0.0.1:53335` 映射到容器，避免绕过 HTTPS 代理直接访问。
- Caddy/Nginx 负责 80/443、证书、HTTP 到 HTTPS 跳转和安全响应头。
- 不使用 `network_mode: host`。
- 不使用跨容器共享数据目录；需要代理时只共享 Docker 网络。

## 3. 仓库结构与构建上下文

Docker 构建上下文必须使用仓库根目录，而不是 `apps/pass-web`，因为 Rust crate 依赖 `core/pass_core`：

```text
仓库根目录/
|- apps/codex-tauri/       # index.html、main.js、styles.css、前端构建脚本
|- apps/pass-web/          # Cargo 项目、Dockerfile、Compose
|- core/pass_core/         # pass-merge、pass-csvio 等共享业务 crate
|- docs/
`- .dockerignore
```

建议增加根目录 `.dockerignore`，至少排除：

```text
.git
.github
**/target
**/node_modules
**/.build
**/dist
**/data
*.enc
pass-web-vault-key-v1
*.log
```

排除规则不能影响 Dockerfile 中明确复制的 `apps/codex-tauri/src`、前端脚本和 `core/pass_core`。`web-assets` 阶段也必须复制 `core/pass_core/js`：`prepare-dist.mjs` 会调用 `sync-web-ui.mjs`，后者需要五个共享 JS 模块。只在 Rust 构建阶段复制 Core 会导致真实 Docker 构建在前端阶段以 `ENOENT sync_merge_core.js` 失败。

## 4. 镜像设计

### 4.1 多阶段构建

镜像分为三层：

1. `web-assets`：固定 Node 大版本，执行 `npm ci` 和 `npm run prepare:dist`。
2. `rust-build`：固定 Rust 工具链，执行 `cargo build --release`。
3. `runtime`：使用 `debian:bookworm-slim`，只复制二进制和静态文件。

当前 Dockerfile 已采用这种结构。正式发布时应进一步固定：

- Node、Rust、Debian 的大版本。
- 基础镜像 digest，或由 CI 记录最终 digest。
- npm 和 Cargo lock 文件。
- 镜像标签对应的 Git commit。

不要在运行阶段执行 `npm install`、`cargo build` 或下载依赖。

### 4.2 运行用户和文件权限

- 镜像创建系统用户 `passweb`。
- 使用 `USER passweb` 运行进程。
- `/data` 的所有者必须是 `passweb`。
- 密钥文件权限为 `0600`，目录权限为 `0700`。
- 宿主机 bind mount 时必须提前处理 UID/GID；named volume 优先避免权限漂移。

### 4.3 镜像标签

发布至少使用以下标签：

```text
ghcr.io/<owner>/pass-web:<version>
ghcr.io/<owner>/pass-web:sha-<commit>
ghcr.io/<owner>/pass-web:stable
```

生产环境不得只依赖可变的 `latest`。Compose 应锁定版本标签，重要环境再锁定 digest：

```yaml
image: ghcr.io/<owner>/pass-web:<version>@sha256:<digest>
```

### 4.4 镜像内禁止保存秘密

秘密只能通过以下方式注入：

- Compose `env_file`，并将文件权限设为 `0600`。
- Docker secrets。
- Kubernetes Secret 或等价的外部秘密管理器。

不得把秘密写进 Dockerfile、Git、镜像层、构建参数或前端静态文件。前端代码是公开可读的，不能把任何密码或密钥注入前端构建产物。

## 5. Compose 配置分层

不要用一个 Compose 文件承载所有环境。建议提供：

```text
apps/pass-web/
|- docker-compose.yml              # 基础配置
|- docker-compose.dev.yml          # 开发覆盖
|- docker-compose.test.yml         # 自动化测试覆盖
|- docker-compose.prod.yml         # 生产覆盖
|- .env.example
`- Caddyfile.example
```

### 5.1 开发环境

目标是快速查看前端和 API 行为，数据可使用临时目录或专用开发卷。

建议：

- 使用显式 `PASS_WEB_AUTH_TOKEN=` 开放模式，只允许绑定 `127.0.0.1`。
- 使用独立的 `pass_web_dev_data`，禁止连接生产卷。
- 默认启用详细日志。
- 代码修改后执行 `docker compose build pass-web`，再重启容器。
- 不在开发 Compose 中挂载 Docker socket。

开发模式不代表可以把开放模式直接暴露到公网。基础 Compose 允许空 Token，但生产覆盖配置必须明确启用认证。

### 5.2 测试环境

测试 Compose 必须是一次性、可重复和隔离的：

- 使用临时项目名，例如 `pass-web-ci-${GITHUB_RUN_ID}`。
- 使用临时 volume 或宿主机临时目录。
- 设置固定的测试 Token，不使用个人凭据。
- 启动后执行 `/healthz`、未授权请求、账号 CRUD、重启持久化和加密文件检查。
- 测试结束只删除本次项目的临时资源，不删除开发或生产 volume。

### 5.3 生产环境

生产配置要求：

- 固定镜像版本或 digest。
- `restart: unless-stopped` 或由编排平台接管重启。
- 只映射 `127.0.0.1:53335:53335`，公网流量经过 Caddy/Nginx。
- 使用外部 `.env`、Docker secrets 或秘密管理器。
- 配置健康检查和启动超时。
- 宿主机设置防火墙、时间同步和磁盘告警。
- 数据使用宿主机备份策略，不能只备份容器层。

## 6. 配置契约

当前服务支持的主要环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PASS_WEB_HOST` | `127.0.0.1` | 监听地址；容器内通常为 `0.0.0.0` |
| `PASS_WEB_PORT` | `53335` | HTTP 端口 |
| `PASS_WEB_DATA_DIR` | `./data` | vault 和密钥目录 |
| `PASS_WEB_STATIC_DIR` | `../codex-tauri/dist` | 静态资源目录 |
| `PASS_WEB_AUTH_TOKEN` | 空 | Web 访问 Bearer Token；空值表示开放模式 |

Compose 额外变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PASS_WEB_BIND_ADDRESS` | `127.0.0.1` | 仅控制宿主机端口绑定地址，不会传入服务进程 |

`PASS_WEB_AUTH_TOKEN` 与同步服务使用的 Bearer Token 不是同一个概念。开发和可信内网可以为空；公网生产必须启用认证，并通过 HTTPS 传输。

基础 Compose 允许 `PASS_WEB_AUTH_TOKEN` 为空，并默认只绑定宿主机回环地址；生产覆盖配置必须阻止无认证公网部署。不能自动生成新的强随机 Token，也不能覆盖用户已经配置的空值。

后续新增变量必须同步更新：

1. Rust 启动配置。
2. `.env.example`。
3. Compose 示例。
4. README 和本文件。
5. CI 的配置校验。

## 7. 数据卷、备份和恢复

### 7.1 数据目录契约

`/data` 至少包含：

```text
/data/pass-web-vault-v1.enc
/data/pass-web-vault-key-v1
```

后续可以增加数据库、迁移标记、审计日志或快照文件，但必须保持同一卷内的版本化目录结构。

密文和密钥必须成套备份。恢复时先停止写入，再原子替换完整目录，最后启动容器并检查 `/healthz` 和 vault 解密。

### 7.2 备份流程

建议使用以下顺序：

1. 标记服务进入维护或暂停写入。
2. 创建带时间戳的临时备份目录。
3. 复制整个 `/data`，保留权限和文件名。
4. 生成 SHA-256 校验文件。
5. 将备份复制到独立磁盘或远程存储。
6. 恢复服务并执行健康检查。
7. 定期在隔离目录进行恢复演练。

备份文件不能写入镜像，也不能通过静态网页目录下载。

### 7.3 恢复流程

- 先保存当前 `/data`，不要直接覆盖而失去回滚点。
- 确认密文和 key 文件均存在且权限正确。
- 停止容器，恢复目录，再启动同一版本镜像。
- 检查服务日志、`/healthz`、账号数量、文件夹数量和历史记录。
- 恢复失败时切回原目录，而不是删除原数据。

## 8. 网络、HTTPS 和浏览器访问

开发环境可以直接访问：

```text
http://127.0.0.1:53335/
```

生产环境建议：

```text
https://pass.example.com -> Caddy -> 127.0.0.1:53335 -> pass-web
```

Caddy/Nginx 负责：

- TLS 证书申请和续期。
- HTTP 到 HTTPS 跳转。
- 请求体大小限制。
- 超时和并发连接限制。
- `X-Content-Type-Options`、`Referrer-Policy` 等安全响应头。
- 访问日志脱敏，禁止记录密码、Token 和同步密钥。

Pass Web 的健康检查可以保持在内网 HTTP；对外只开放 443。若必须直接暴露容器端口，必须使用防火墙白名单，不应作为默认生产方案。

## 9. 本地 Docker 开发流程

### 9.1 前置条件

- Docker Engine 或 Docker Desktop。
- Docker Compose v2。
- 可访问镜像仓库和 npm、crates.io 的网络；第一次构建会下载较大依赖。
- `linux/amd64` 或 `linux/arm64` 主机，或已配置 buildx 模拟器。

### 9.2 构建和启动

```bash
cd /Users/x/code/pass/apps/pass-web
docker compose build --pull pass-web
docker compose up -d pass-web
curl --fail http://127.0.0.1:53335/healthz
```

直接用 `docker run` 冒烟时，镜像默认监听容器内 `0.0.0.0`，因此必须提供网页访问 Token；若宿主机端口明确只映射到 `127.0.0.1`，也可以与 Compose 一样设置 `PASS_WEB_TRUSTED_LOOPBACK_PROXY=1`。缺少二者时容器退出是安全策略，不是启动故障。

版本 `1.4.1` 已在 macOS Docker Desktop `linux/arm64` 上完成真实镜像构建和生命周期验证：`/healthz` 返回 200，首次启动、普通重启、测试监护进程下的 `pass-web` 子进程被 `SIGKILL` 后按 `unless-stopped` 自动恢复且 `RestartCount` 确实增加、`--force-recreate` 后恢复均通过。崩溃探针仍运行同一生产镜像和同一二进制，只额外用 shell 作为测试容器 PID 1；不能用容器内 `kill -9 1`，因为 namespace init 的信号规则可能让命令返回成功却没有退出。测试脚本为 `scripts/test_pass_web_container_lifecycle.sh`，使用独立 Compose project、临时容器与临时 volume，不触碰现有 `pass-web_pass_web_data`。Actions 的路径过滤包含该脚本，并在构建前运行 actionlint；`.github/actionlint.yaml` 只声明当前 GitHub 支持但 actionlint 内置列表尚未识别的 `macos-26` runner。该本地验证不等于镜像已经推送到 GHCR；`linux/amd64` 与 `linux/arm64` 的正式构建由 GitHub Actions Buildx 完成。

查看日志：

```bash
docker compose logs -f --tail=200 pass-web
```

停止服务但保留数据：

```bash
docker compose down
```

除非明确要清空开发数据，否则不要使用 `down -v`。

### 9.3 前端调试

当前镜像在构建时生成前端 `dist`。前端代码修改后需要重新构建镜像。后续可增加开发 Compose：

- 前端使用 Vite/静态开发服务器热更新。
- API 容器单独运行。
- 通过环境变量将前端 API 地址指向 API 容器。

开发热更新配置不得进入生产镜像。

## 10. 测试设计

每个镜像至少通过以下测试：

### 10.1 构建测试

- Dockerfile 从仓库根目录构建成功。
- `npm ci` 使用 lock 文件且不执行不必要脚本。
- `cargo build --release` 和 `cargo test` 通过。
- 镜像中不存在源码、Git 目录、Node modules、Cargo target 和秘密文件。
- 容器以 `passweb` 用户运行。

### 10.2 API 测试

- `/healthz` 返回 200 和 `ok: true`。
- Token 为空时按开发策略允许或拒绝，行为必须在配置中明确。
- Token 非空时，缺失或错误 Authorization 返回 401。
- 正确 Token 可以调用 API。
- 静态首页可以加载，前端浏览器环境能使用 `fetch` RPC。

### 10.3 数据测试

- 新建、编辑、删除、恢复账号。
- 创建、删除和归属文件夹。
- 撤销、重做和历史记录。
- 容器重启后数据仍存在。
- 密文和 key 缺失时启动失败并给出明确错误。
- 错误请求不会产生部分写入。
- 备份恢复后账号、文件夹、通行密钥和历史记录一致。

### 10.4 生命周期测试

- `up`、`restart`、`down` 不破坏 volume。
- 新镜像启动失败时旧容器和旧数据仍可恢复。
- 健康检查失败能被 CI 和部署脚本识别。
- 多次部署不会创建重复数据卷或覆盖其它 Compose 项目。

仓库提供的真实门禁：

```bash
bash scripts/test_pass_web_container_lifecycle.sh
```

脚本从容器内部向 PID 1 发送 `SIGKILL` 来模拟进程崩溃。不要用
`docker compose kill` 代替：它属于人工停止，Docker 会按设计抑制自动重启，
不能用于验证 `restart: unless-stopped` 的崩溃恢复。

## 11. 多架构发布

正式发布使用 Docker Buildx：

```bash
docker buildx create --name pass-builder --use
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f apps/pass-web/Dockerfile \
  -t ghcr.io/<owner>/pass-web:<version> \
  --push .
```

CI 必须验证：

- 两种架构都能完成构建。
- 两种架构的 `/healthz`、API 和数据持久化测试通过。
- 镜像清单包含正确架构。
- 运行时没有依赖宿主机特定路径。

如需支持 Alpine 宿主机，不必改变容器基础镜像；只有“裸机运行 Alpine”才需要另外构建 musl 二进制。

## 12. CI/CD 和发布策略

### 12.1 CI 阶段

每个相关提交执行：

1. 前端依赖安装和 `prepare:dist`。
2. Rust 格式、测试和 release 构建。
3. Dockerfile 构建检查。
4. 容器启动、健康检查和 API 冒烟测试。
5. Trivy 或同等工具扫描镜像漏洞。

### 12.2 发布阶段

- 只从保护分支或带签名的 tag 发布。
- 发布不可变版本标签和 commit 标签。
- 记录镜像 digest、源码 commit、Rust/Node/Debian 版本。
- 推送到 GHCR 或其它 OCI Registry。
- 不将生产 Token 写进 GitHub Actions 日志。

### 12.3 部署阶段

部署脚本应遵循：

```text
拉取镜像 -> 备份 /data -> 启动新容器 -> 等待健康 -> 验证 API -> 切换流量
                                      |
                                      `-> 失败则恢复旧镜像
```

当前工作流先在 Ubuntu runner 本地构建镜像并用 Trivy 阻断仍可修复的 HIGH/CRITICAL 漏洞；只有扫描通过后，才发布 `linux/amd64`、`linux/arm64` 镜像并记录不可变 digest，同时生成 SBOM/provenance，避免先污染 `latest` 再报告扫描失败。部署仅在仓库变量 `PASS_WEB_DEPLOY_ENABLED=true` 时执行：部署前备份现有 `/data` named volume，拉取已验证 digest，健康检查失败时恢复上一镜像。未启用该变量时，镜像发布任务仍可运行，但不能宣称已部署 Ubuntu 服务器。

## 13. 安全基线

生产容器应逐步启用：

- 非 root 用户。
- `read_only: true`，只给 `/data` 可写卷和必要的临时目录。
- `cap_drop: [ALL]`，确有需要再按项增加。
- `security_opt: [no-new-privileges:true]`。
- CPU、内存、进程数和打开文件数限制。
- 禁止挂载 `/var/run/docker.sock`。
- 镜像来源白名单和漏洞扫描。
- 运行时 Token 使用 secrets，不使用命令行参数。
- 备份加密、访问控制和恢复演练。

启用只读根文件系统前，必须确认 Rust 运行时不会写入 `/tmp`、工作目录或其它未声明路径。

## 14. 日志和监控

容器日志输出到 stdout/stderr，由 Docker、journald 或采集器统一收集。日志中不得出现：

- 密码、TOTP、恢复码。
- 同步加密密钥。
- Web 访问 Token 或 Authorization 请求头。
- 导出的 CSV 内容。

至少监控：

- 容器是否运行。
- `/healthz` 是否成功。
- 数据卷剩余空间。
- 重启次数。
- 最近一次备份时间和校验结果。
- 镜像版本和 digest。

## 15. 常见故障处理

### 容器启动后立即退出

检查：

```bash
docker compose ps
docker compose logs --tail=200 pass-web
```

重点查看数据目录权限、端口占用、vault 密文和 key 是否成套存在。

### 浏览器能打开但 API 返回 401

- 检查网页保存的 Web Token。
- 确认请求使用 `Authorization: Bearer <token>`。
- 区分 Web 访问 Token 与同步 Bearer Token。
- 不要通过 URL 查询参数传 Token。

### 重启后数据消失

- 检查是否使用了临时容器层而不是 `/data` volume。
- 检查 Compose 项目名是否变化导致创建了另一个 volume。
- 检查是否误执行 `docker compose down -v`。

### 反向代理 502

- 确认代理和容器在同一网络或代理指向宿主机回环地址。
- 确认 pass-web 在容器内监听 `0.0.0.0:53335`。
- 先在宿主机执行 `curl http://127.0.0.1:53335/healthz`。

## 16. Docker 专项实施阶段

### D0：可重复开发

- 增加 `.dockerignore`、`.env.example`。
- 完善开发和测试 Compose。
- 固定基础镜像大版本。
- 增加容器启动和持久化测试。

### D1：生产单机

- 生产 Compose 只绑定回环端口。
- 完善 Caddy/Nginx HTTPS。
- 增加健康检查、资源限制和备份脚本。
- 增加生产 Compose 覆盖，要求显式配置认证 Token。

### D2：镜像发布

- Buildx 构建 `amd64`、`arm64`。
- 推送不可变 tag 和 digest。
- CI 执行漏洞扫描和冒烟测试。
- 生成版本校验文件和变更记录。

### D3：可靠部署

- 部署前自动备份。
- 新容器健康后再切换流量。
- 健康失败自动回滚镜像。
- 增加升级前后的数据格式迁移检查。

### D4：平台扩展

- 验证 Podman、NAS 和 ARM 设备。
- 需要时提供 rootless 部署说明。
- 评估 Kubernetes Helm 或其它编排平台，但不提前引入复杂度。

## 17. 完成验收标准

Docker 方案只有满足以下条件才算完成：

- 新机器只安装 Docker/Compose，按文档可以启动网页。
- `amd64` 和 `arm64` 镜像均能运行。
- 容器重启、升级和回滚不丢数据。
- 密文和密钥备份恢复成功。
- 未授权访问、开放模式和 HTTPS 行为清晰可验证。
- 生产端口不会绕过反向代理直接暴露。
- CI 能构建、测试、扫描并发布不可变镜像。
- 部署失败不会覆盖可恢复的旧数据和旧版本。
- 文档中的命令与实际 Compose 文件、环境变量和镜像标签一致。

## 18. 设计决策

1. Docker 是跨 Linux 的首选分发格式，Ubuntu 裸机不是另一套业务实现。
2. 容器只负责运行环境，账号、文件夹、回收站、撤销、重做和同步合并规则继续复用共享 Rust crate。
3. `/data` 是唯一持久化边界，密文与 key 必须成套管理。
4. 生产流量必须经过 HTTPS 反向代理。
5. 开放模式只用于开发或可信内网，不能作为公网默认配置。
6. 先完成单机 Docker 的可重复构建、测试、备份和回滚，再增加多用户和复杂编排。
