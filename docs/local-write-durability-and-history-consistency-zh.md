# 本地写入耐久性与历史一致性

> 状态：当前代码事实（版本 `1.1.2`）。开发测试版允许直接修正，不兼容旧坏历史。

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
- Web 网络命令（同步/服务器版本）在锁外执行网络 I/O；提交前若本地已变化，拒绝覆盖并要求重新同步。
- Swift 单集合保存失败时从 SQLite 重新读取并恢复内存。

### 2.3 撤销与快照

- 撤销栈忽略与当前 payload 完全相同的 no-op 条目（Tauri：`latest_distinct_undo`；Web：撤销时跳过相同 payload）。
- 本地安全快照可在业务写入前创建；**撤销栈只在业务写入成功后提交**（Tauri：`commit_undo_point`）。
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

## 3. 回归基线（1.1.2）

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
- Web 自建/WebDAV 若远端 PUT 成功但本地保存失败，返回明确错误，要求立即重新同步；不再把半成功状态伪装成同步完成。

## 5. 后续仍可改进

- 日常单字段写入也可继续统一事务包装与故障注入测试。
- Swift 日常 CRUD 多步保存可继续收拢到 `saveCoreCollectionsAtomically`。
- 远端已成功、本地失败时的自动补偿/回滚策略（当前只保证错误可见与提示重同步）。
- CI 可再补 Clippy / fmt / 依赖审计；当前已覆盖 Tauri/Web 测试与内嵌服务器一致性检查。
