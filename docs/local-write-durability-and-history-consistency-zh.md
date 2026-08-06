# 本地写入耐久性与历史一致性

> 状态：当前代码事实，历史复核基线最早记录于版本 `1.4.4`；当前提交必须以根级测试、版本检查和 Markdown 链接检查重新确认。开发测试版允许直接修正，不兼容旧坏历史。

## 1. 背景

代码审查确认过这些问题：

1. 桌面端多集合（账号、文件夹、排序）顺序写入，中途失败会留下半完成状态。
2. 命令保存失败后内存仍保留脏数据，重启前后表现不一致。
3. 失败操作可能留下 no-op 撤销项。
4. 加密 vault 原子替换缺少 `fsync`，断电时可能丢最后一次写入。
5. 同步服务器每次更新重复保存旧版本，revision 跳号且占用历史窗口。
6. 同步审计无限增长，限流表按 IP 永久累积。
7. 主密码比较前 `trim`，首尾空格被静默丢弃。
8. 部署健康检查曾绕过 TLS 校验；Swift SSH 路径缺少 shell 引号。

## 2. 统一规则

### 2.1 多集合本地写入

涉及下列任一组合时，必须同事务提交：

- 账号集合
- 文件夹集合
- 全部账号顺序 `allRegularAccountIds`
- 文件夹内顺序 `Folder.regularAccountIds`
- Passkey 集合（当与账号/文件夹一并更新时）

实现落点：

| 表面 | 实现 |
|---|---|
| Tauri | `save_account_folder_order_atomic` / `save_payload_atomic` |
| Swift | `LocalSQLiteStore.transaction` + `saveCoreCollectionsAtomically` |
| Web | 单文件 vault；失败时整份 `VaultData` 回滚 |

### 2.2 失败回滚

- 命令失败时，内存状态必须回到最近一次成功落盘状态。
- Web 本地命令通过 `run_local_command` 包一层：先备份 `VaultData`，失败后恢复。
- Web 网络命令（同步/服务器版本）在锁外执行网络 I/O；worker 只改内存副本，最终由 vault 锁内 CAS 落盘，提交前若本地已变化，拒绝覆盖并要求重新同步。
- Tauri 网络同步回调在 SQLite 事务内完成读取、比较和写入；不会在 CAS 检查后被另一个本地写入插入。
- Swift 单集合保存失败时从 SQLite 重新读取并恢复内存。

### 2.3 撤销与快照

- 撤销栈忽略与当前 payload 完全相同的 no-op 条目（Tauri：`latest_distinct_undo`；Web：撤销时跳过相同 payload）。
- 本地安全快照可在业务写入前创建；**撤销栈只在业务写入成功后提交**（Tauri：同步回调 CAS 成功后写入 `operation_history`；Web/Swift 同步同样在实际写入路径创建历史）。
- 同步写入本地前仍创建本地安全快照。
- 操作历史只保留动作摘要；密码、TOTP、恢复码、备注不得进入历史。扩展读取旧历史时自动脱敏并重存；中英文旧格式都要识别。

### 2.4 文件耐久性

加密 vault / 本地密钥 / app lock 文件统一：

1. 写临时文件
2. `fsync` 临时文件
3. `rename` 到目标
4. `fsync` 父目录
5. 权限保持 `0600` / 目录 `0700`

### 2.5 主密码语义

- 主密码比较与派生**不** `trim`。
- 首尾空格是有效密码字符。
- 空密码仍禁止。

### 2.6 同步服务器版本与运维边界

- 桌面“创建服务”打包的内嵌 `pass_sync_server.py` 必须与 Ubuntu 规范副本完全一致。
- 每次成功 PUT / restore 只新增 **1** 条 `payload_versions`。
- 首次写入产生 revision 1；第二次成功写入产生 revision 2。不得先插旧快照再插新快照。
- 每个 scope 最多保留 50 个版本。
- 每个 scope 审计最多保留 5000 条。
- 限流窗口只保留最近约 1 分钟内的来源 IP。
- 幂等键仍最多保留 500 条。

### 2.7 部署安全

- 远端路径、证书路径、文件模式必须 shell quote，禁止直接拼进单引号字符串。
- 部署后健康检查必须使用正常 TLS 校验，不能 `danger_accept_invalid_certs`。
- SSH 首次连接必须先展示 SHA-256 主机指纹并由用户确认；确认后写入应用私有 `known_hosts`，后续固定 `StrictHostKeyChecking=yes`。非 22 端口的扫描结果必须精确匹配 `[host]:port`。
- 同步数据库使用 `PRAGMA synchronous=FULL`。数据/备份目录为 `0700`，数据库、WAL、SHM、隔离文件和 Token 文件为 `0600`，systemd/备份进程使用 `UMask=0077`。
- 空 Token 是受支持的开放模式：客户端不发送认证头，创建服务写空令牌文件；不得生成 Token，也不得写伪配置 `default=`。

### 2.8 跨文件事务

- Tauri 的业务数据在 SQLite、撤销/重做栈在独立加密文件。普通修改、撤销和重做先写加密待完成日志，SQLite 提交后再以固定操作 ID 幂等更新历史；数据库打开时补完中断步骤。损坏日志和不一致状态必须阻止后续覆盖。
- Docker Web 的 vault 密文与 vault key/主密码包装是两个文件。启用锁、修改密码、关闭锁时先 `fsync` 两个暂存文件，再写包含目标类型与两份 SHA-256 的事务标记；恢复时只有暂存文件或目标文件摘要吻合才继续 rename，最后 `fsync` 目录并删除标记。
- Swift 账号归属、文件夹普通顺序和相关 Passkey 必须在同一 SQLite 事务提交；任何保存失败都从磁盘重载真实状态，且不得追加成功历史或提示。

## 3. 回归基线（1.1.5）

| 套件 | 数量 |
|---|---|
| 扩展共享测试 | 78 |
| Docker Web | 9 |
| Tauri | 22 |
| 同步服务器 | 33 |
| 脚本 | 17 |
| Core gate / 版本检查 | 通过；45 个版本落点 |

重点新增断言：

- 两次成功 PUT 后 versions 长度为 2，versionId 为 `[1, 2]`
- 审计按 scope 有上限
- 过期限流窗口被清理
- 撤销跳过 no-op
- Web 保存失败回滚内存
- 主密码首尾空格有效
- 历史脱敏覆盖中英文旧格式

## 4. 1.1.2 起的补强

- Tauri / macOS 内嵌 `pass_sync_server.py` 必须与 `apps/sync_server_ubuntu/pass_sync_server.py` 字节级一致；`scripts/version.mjs check` 会拦截漂移，避免“创建服务”重新部署旧服务器。
- Tauri 多集合边角路径（`get_app_state` 迁移、新建/删除文件夹、非置顶排序、导入等）统一走 `save_collections_atomic`。
- Tauri 撤销点改为：先写本地安全快照，业务写入成功后再 `commit_undo_point`；失败操作不再提前污染撤销栈。
- Web 撤销会跳过与当前 payload 完全相同的 no-op 条目。

## 5. 1.2.2 的安全迁移

- Chrome 扩展数据密钥包装升级为 v4。v4 的 PBKDF2 输入保留主密码全部字节，首尾空格与 Web/Tauri 语义一致；v2/v3 只作为一次性迁移读取路径，成功后立即写回 v4。
- Docker Web 启用应用锁时，随机 vault key 从明文 `pass-web-vault-key-v1` 迁移至 `pass-web-vault-key-wrapper-v1.json`。包装文件只包含 salt、验证值、nonce 和密文 key；重启后必须先输入主密码才能读取 vault。旧安装会在首次成功解锁时迁移。
- Docker Web 在 `/data/pass-web-instance.lock` 上持有内核排他文件锁，拒绝两个写进程共享同一数据卷。文件内容只用于诊断；正常退出或崩溃后锁由内核释放，遗留文件不会阻止下次启动。
- Ubuntu 部署脚本以及 Tauri/macOS SSH 创建服务的 TLS 健康检查均使用证书域名和 `curl --resolve ...:127.0.0.1`，不再跳过 TLS 校验。
- Web 自建/WebDAV 若远端 PUT 成功但本地保存失败，返回明确错误，要求立即重新同步；不再把半成功状态伪装成同步完成。

## 5. 1.1.3 起的补强

- Swift `deleteFolder` 与加载迁移路径改为账号/文件夹同事务写入（`saveAccountsAndFoldersAtomically` / `writeCollectionsAtomically`），失败回滚内存。
- Tauri 浏览器密码导入、谷歌验证器导入、文件夹去重在写入账号时同步归一化并原子保存排序集合。

## 6. 后续仍可改进

- 日常单字段写入也可继续统一事务包装与故障注入测试。
- Swift 可继续增加可注入磁盘故障的单元测试，目前主要由编译和真实 SQLite 路径保证。
- 远端已成功、本地失败时的自动补偿/回滚策略（当前只保证错误可见与提示重同步）。
- Tauri 的待完成日志目前按单应用实例设计；仍没有两个桌面进程共享同一数据目录的跨进程 CAS。

## 7. 1.1.5 起的补强

- 同步改为**先写入本地合并结果，再推送远端**（Tauri 自建/WebDAV 与 Web 自建/WebDAV）。远端推送失败时保留本地合并结果并明确提示重试，避免“远端已新、本地仍旧”。
- Swift 单集合 `saveAccounts` / `saveFoldersToDefaults` 统一走 `writeCollectionsAtomically`，失败回滚内存。
- CI 增加 `quality-gates`：版本/内嵌服务器漂移、Rust fmt、Clippy correctness 和三个 Rust crate 的 `cargo audit` 都是硬门禁；新漏洞不能用 `continue-on-error` 或 `|| true` 绕过。
