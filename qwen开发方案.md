# Pass 密码管理器 - 完整技术分析与开发方案

> **版本基线**：1.7.6\
> **分析日期**：2026-08-10\
> **分析范围**：全项目代码、架构、同步协议、安全机制、性能特征\
> **文档性质**：技术深度分析与开发建议

---

## 目录

1. [项目概览](#一项目概览)
2. [架构深度分析](#二架构深度分析)
3. [模块职责与实现细节](#三模块职责与实现细节)
4. [同步协议与合并机制](#四同步协议与合并机制)
5. [安全机制分析](#五安全机制分析)
6. [性能特征与瓶颈](#六性能特征与瓶颈)
7. [技术债务清单](#七技术债务清单)
8. [风险评估](#八风险评估)
9. [开发建议与路线图](#九开发建议与路线图)
10. [测试策略](#十测试策略)
11. [部署与运维](#十一部署与运维)
12. [总结与优先级](#十二总结与优先级)

---

## 一、项目概览

### 1.1 项目定位

Pass 是一个**跨平台密码管理器 Monorepo**，采用 **共享 Rust 内核 + 分端 UI** 架构。项目目标是提供一套统一的密码管理解决方案，覆盖桌面、Web、浏览器扩展等多个平台。

**核心理念**：
- **Core 厚、UI 薄**：业务逻辑集中在 Rust Core，UI 层只负责展示与交互
- **合并权威**：`pass_merge::v2` 是运行时合并的唯一权威来源
- **协议统一**：`pass.data.v2` / `pass.sync.bundle.v2` 作为数据契约
- **渐进迁移**：采用绞杀者模式逐步替换旧代码

### 1.2 当前管理面

| 管理面 | 技术栈 | 定位 | 成熟度 | 关键特性 |
|--------|--------|------|--------|----------|
| **Tauri 桌面** | Rust + HTML/CSS/JS | Win/macOS/Linux 主力桌面端 | ★★★★★ | SSH 创建服务、Touch ID（macOS）、原生文件选择器 |
| **Docker Web** | Rust + 复用 Tauri UI | 无 GUI/服务器浏览器管理 | ★★★★☆ | 单用户 vault、文件锁、加密存储 |
| **Chrome Web 扩展** | JS 对拍 + 复用 Tauri UI | 浏览器填充与管理 | ★★★★☆ | 自动填充、WebAuthn、后台同步调度 |

**保留模块**（非主管理面）：
- `apps/app_macos`：旧 SwiftUI 客户端，macOS AutoFill/Credential Exchange 参考实现
- `apps/extension_firefox` / `extension_safari`：浏览器壳层，能力不等价于 Chrome
- `apps/android_credential_provider`：Android 14+ Credential Provider 骨架（未完成）

### 1.3 已完成的关键能力

#### 同步与合并
- ✅ **V2 同步协议**：字段级 LWW（Last-Writer-Wins）合并、ETag/If-Match 并发保护、幂等重放
- ✅ **Rust 合并权威**：`pass_merge::v2` 作为运行时权威，JS 通过黄金向量对拍
- ✅ **多同步源支持**：自建服务器（主源）+ WebDAV（镜像），后台统一调度
- ✅ **永久删除墓碑**：保留稳定 ID 防止旧设备复活账号，清除敏感字段
- ✅ **作用域排序**：全局顺序、文件夹顺序独立同步，互不干扰
- ✅ **别名并集**：跨账号站点域名自动归并，关系墓碑正确传播

#### 加密与安全
- ✅ **本地加密**：AES-256-GCM，密钥由 PBKDF2-SHA-256（310000 次）派生
- ✅ **端到端加密**：可选同步密钥，`pass.sync.encrypted.v1` 信封
- ✅ **密钥轮换**：支持 `previousEncryptionKey` 回退读取旧包
- ✅ **撤销/重做/历史**：本地操作可回滚，安全快照保护

#### UI 与交互
- ✅ **三端 UI 统一**：单源码生成 Tauri/Web/Chrome 管理页
- ✅ **72 个命令**：UI 调用统一命令名，各表面实现同名接口
- ✅ **网页内浮窗**：closed Shadow DOM + manual Popover，支持拖动
- ✅ **SSH 创建服务**：Tauri 可远程部署同步服务，检测旧服务并询问删除

### 1.4 当前限制

| 限制 | 影响范围 | 严重程度 | 优先级 |
|------|----------|----------|--------|
| Chrome 使用 JS 对拍而非 WASM | 维护成本高，存在语义漂移风险 | 高 | P0 |
| 多进程同数据目录无文件级 CAS | Tauri/Web 并发写入可能冲突 | 中 | P1 |
| Android Provider 未完成 | 移动端缺失 | 低 | P3（延后） |
| Firefox/Safari 能力不等价 | 浏览器覆盖不完整 | 低 | P2 |
| Docker Web 单用户 | 无法多租户 | 中 | P2 |
| 软件 Passkey 可同步 | 非硬件认证器安全级别 | 产品决策 | - |
| 同步全量传输 | 大数据量时慢 | 中 | P1 |

---

## 二、架构深度分析

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        统一管理 UI                                │
│         (apps/codex-tauri/src - HTML/CSS/JS)                    │
│         - 账号/文件夹 CRUD、排序、置顶、回收站                      │
│         - 同步设置、预览、合并、导入导出                            │
│         - 主密码锁、撤销/重做/历史                                 │
└────────────┬────────────────────┬────────────────────┬──────────┘
             │                    │                    │
    ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
    │  Tauri Adapter  │  │  Web Adapter    │  │ Chrome Adapter  │
    │  (Rust cmds)    │  │  (HTTP RPC)     │  │ (extension-     │
    │                 │  │                 │  │  bridge.js)     │
    │ - SQLite KV     │  │ - 加密文件      │  │ - IndexedDB     │
    │ - 文件锁        │  │ - 文件锁        │  │ - chrome.storage│
    └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
             │                    │                    │
    ┌────────▼────────┐           │           ┌────────▼────────┐
    │  Rust Core      │           │           │  JS 对拍 Core   │
    │  pass_merge::v2 │           │           │  (黄金向量约束) │
    │                 │           │           │                 │
    │ - 字段级 LWW    │           │           │ - 同步合并逻辑  │
    │ - 墓碑保留      │           │           │ - 别名归并      │
    │ - 顺序规范化    │           │           │ - 安全检查      │
    └────────┬────────┘           │           └────────┬────────┘
             │                    │                    │
             └────────────────────┼────────────────────┘
                                  │
                     ┌────────────▼────────────┐
                     │    同步服务器 (Python)   │
                     │  ETag/CAS + 版本快照     │
                     │                         │
                     │ - SQLite 持久化         │
                     │ - Bearer Token 认证     │
                     │ - 限流、审计            │
                     │ - 版本恢复              │
                     └─────────────────────────┘
```

### 2.2 核心设计原则

#### 原则 1：Core 厚、UI 薄
- **Core 层**（Rust）：领域模型、合并语义、CSV、域名规则、同步契约
- **UI 层**：纯展示与交互，不复制业务逻辑
- **Adapter 层**：平台 API 胶水，不含业务判定
- **Sync Server**：哑存储，不做合并

**优势**：
- 新端接入只需实现 Adapter
- 合并规则只在 Rust 维护一份
- 同步服务器保持简单可靠

#### 原则 2：权威来源明确
- **运行时合并权威**：`pass_merge::v2`（Rust）
- **数据契约权威**：`pass.data.v2` / `pass.sync.bundle.v2` JSON Schema
- **版本权威**：仓库根 `VERSION` 文件（唯一来源）
- **文档权威**：当前事实文档 > 契约文档 > 历史蓝图

#### 原则 3：渐进式迁移
- macOS SwiftUI 仍保留作为系统能力参考
- Rust FFI 优先，失败时回退 Swift（环境变量 `PASS_USE_SWIFT_MERGE=1`）
- Chrome JS 对拍实现必须通过黄金向量测试

#### 原则 4：禁止事项
- 新端再写第三套 merge / 同步 safety
- 用 UniApp 等做主 vault
- 桌面新端必须接 `pass_merge::v2`，禁止平行 merge
- 同步服务器做字段级合并
- 并行维护多套桌面业务原型

### 2.3 数据流

#### 本地写入流程
```
用户操作 → UI 调用命令 → Adapter 处理 → Rust Core mutation → 本地存储 → 同步队列
```

#### 同步流程（主源成功场景）
```
1. 拉取主源 payload（GET /v2/sync/state）
2. 拉取镜像 payload（WebDAV 等）
3. 执行别名归并（sync_alias_groups）
4. 执行合并（merge_sync_payloads）
5. 执行安全检查（evaluate_sync_safety）
6. 写入本地（原子 CAS）
7. 推送到主源（PUT /v2/sync/state + If-Match）
8. 推送到镜像（WebDAV PUT）
```

#### 冲突处理流程
```
1. 检测到 412/428（Precondition Failed）
2. 重新拉取远端 payload
3. 重新合并
4. 重试推送（最多 5 次）
5. 仍失败则报告 applied: true, pushed: false
```

---

## 三、模块职责与实现细节

### 3.1 Rust Core（core/pass_core）

#### 3.1.1 模块结构

```
core/pass_core/
├── crates/
│   ├── domain/          # 核心数据模型类型
│   ├── merge/           # 合并逻辑（权威）
│   │   └── src/v2/
│   │       ├── merge.rs      # 合并主逻辑
│   │       ├── safety.rs     # 安全检查
│   │       ├── alias.rs      # 别名归并
│   │       ├── mutate.rs     # 变更操作
│   │       ├── normalize.rs  # 规范化
│   │       ├── policy.rs     # 策略常量
│   │       ├── report.rs     # 报告结构
│   │       └── types.rs      # 类型定义
│   ├── storage/         # 候选 SQL schema（未执行）
│   ├── transport/       # 同步协议数据契约
│   ├── csvio/           # CSV 规范化
│   └── ffi/             # C ABI（供宿主应用调用）
└── js/                  # JS 对拍实现
    ├── sync_merge_core.js
    ├── sync_policy.js
    └── check_merge_parity.mjs
```

#### 3.1.2 合并算法详解

**字段级 LWW（Last-Writer-Wins）**：
```rust
// 伪代码
fn merge_field(local, remote) {
    if local.updatedAtMs > remote.updatedAtMs {
        return local.value;
    } else if local.updatedAtMs < remote.updatedAtMs {
        return remote.value;
    } else {
        // 时间戳并列，使用稳定键裁决
        return stable_tiebreaker(local, remote);
    }
}

fn stable_tiebreaker(a, b) {
    // 稳定键：创建设备、最后操作设备、历史账号 ID、主站点、创建用户名、稳定记录 ID
    let key_a = (a.createdDevice, a.lastEditDevice, a.historyId, a.primarySite, a.createdUsername, a.recordId);
    let key_b = (b.createdDevice, b.lastEditDevice, b.historyId, b.primarySite, b.createdUsername, b.recordId);
    return key_a > key_b ? a.value : b.value;
}
```

**关键特性**：
- 纯合并函数禁止读取当前墙钟（`Date.now()`）
- 关系墓碑只能使用载荷中已有的活动时间
- 双客户端正反向输入必须得到相同结果（交换律）
- 首次补齐缺省字段后必须达到固定点（幂等性）

#### 3.1.3 墓碑机制

**删除的三种状态**：
| 状态 | 条件 | UI 可见性 | 同步意义 |
|------|------|----------|----------|
| 活动 | `isDeleted=false` 且 `isPermanentlyDeleted=false` | 正常列表 | 参与活动数量和排序 |
| 回收站 | `isDeleted=true` 且非永久删除 | 只在回收站 | 可恢复，保留原文件夹关系 |
| 永久删除墓碑 | `isPermanentlyDeleted=true` | 不显示 | 阻止旧设备复活账号 |

**永久删除规则**：
- 保留稳定 ID（`recordId`）和删除元数据
- 清除密码、TOTP、恢复码等敏感材料
- 预览、导入摘要和数量统计必须排除永久删除墓碑

#### 3.1.4 作用域排序

**三个独立作用域**：
| 作用域 | 权威字段 | 含义 |
|--------|----------|------|
| 全部账号 | 顶层 `allRegularAccountIds` | 所有活动普通账号在"全部账号"的顺序 |
| 某文件夹 | `Folder.regularAccountIds` | 该文件夹活动普通账号的独立顺序 |
| 文件夹侧栏 | 顶层 `folderOrderIds` | 活动文件夹顺序 |

**排序规则**：
- 数组第一个 ID 是普通区最上方
- 新建账号、新加入文件夹和恢复账号进入相应普通区顶部
- 固定"新账号"文件夹始终位于文件夹列表第一
- 置顶是独立分区；普通顺序可保留置顶账号 ID，以便取消置顶后返回原位置

**冲突处理**：
- 每个顺序作用域有独立更新时间和设备名
- 同步冲突时胜出的**整个作用域数组**作为基线
- 账号字段时间变新不会覆盖排序时钟

### 3.2 Tauri 桌面端（apps/codex-tauri）

#### 3.2.1 模块结构

```
apps/codex-tauri/
├── src/                 # 前端 UI（HTML/CSS/JS）
│   ├── main.js         # 主逻辑
│   ├── styles.css      # 样式
│   └── index.html      # 入口
├── src-tauri/          # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 入口，Tauri commands
│   │   ├── sync/
│   │   │   ├── mod.rs           # 同步模块入口
│   │   │   ├── crypto.rs        # 加密逻辑
│   │   │   ├── http.rs          # HTTP 请求
│   │   │   ├── pipeline.rs      # 同步管道
│   │   │   ├── outbox.rs        # 补偿队列
│   │   │   ├── settings.rs      # 同步设置
│   │   │   └── webdav.rs        # WebDAV 集成
│   │   ├── app_lock.rs          # 应用锁
│   │   ├── local_vault.rs       # 本地 vault
│   │   ├── mutation_journal.rs  # 变更日志
│   │   ├── operation_history.rs # 操作历史
│   │   ├── provision.rs         # SSH 创建服务
│   │   └── ...
│   └── Cargo.toml
└── scripts/
    └── prepare-dist.mjs  # 生成 dist
```

#### 3.2.2 同步引擎实现

**同步管道（pipeline.rs）**：
```rust
pub async fn run_sync_with_context(
    vault: &mut Vault,
    settings: &SyncSettings,
    mode: SyncMode,
) -> Result<SyncResult, String> {
    // 1. 构建本地 payload
    let local_payload = local_payload_from_vault(vault);

    // 2. 拉取远端 payload
    let remote_payload = fetch_remote_payload(settings).await?;

    // 3. 执行别名归并
    let aliased = sync_alias_groups(&local_payload, &remote_payload);

    // 4. 执行合并
    let merged = merge_sync_payloads(&aliased.local, &aliased.remote);

    // 5. 安全检查
    let safety = evaluate_sync_safety(&local_payload, &remote_payload, &merged);
    if !safety.is_safe() {
        return Err("Safety check failed");
    }

    // 6. 写入本地（原子 CAS）
    vault.apply_merged(&merged)?;

    // 7. 推送到远端
    push_to_remote(settings, &merged).await?;

    Ok(SyncResult { applied: true, pushed: true })
}
```

**补偿队列（outbox.rs）**：
```rust
pub struct Outbox {
    operations: Vec<OutboxOperation>,
}

pub struct OutboxOperation {
    id: String,
    target: SyncTarget,  // 主源或镜像
    payload: String,
    retry_count: u32,
    last_error: Option<String>,
    created_at: i64,
}

// 补偿逻辑
pub async fn process_outbox(outbox: &mut Outbox) {
    for op in &mut outbox.operations {
        match push_to_target(op).await {
            Ok(_) => outbox.mark_completed(&op.id),
            Err(e) => {
                op.retry_count += 1;
                op.last_error = Some(e);
                if op.retry_count > MAX_RETRIES {
                    outbox.mark_failed(&op.id);
                }
            }
        }
    }
}
```

#### 3.2.3 存储实现

**SQLite KV 存储**：
```rust
// 键值对存储
const KEY_ACCOUNTS: &str = "accounts.v2";
const KEY_FOLDERS: &str = "folders.v1";
const KEY_PASSKEYS: &str = "passkeys.v1";
const KEY_ALL_REGULAR_ORDER: &str = "all_regular_order.v1";
const KEY_FOLDER_ORDER: &str = "folder_order.v1";

// 写入流程（原子 CAS）
fn save_vault(conn: &Connection, vault: &Vault) -> Result<(), String> {
    let tx = conn.unchecked_transaction()?;

    // 1. 读取当前 payload
    let current: String = tx.query_row(
        "SELECT value FROM kv WHERE key = ?1",
        [KEY_ACCOUNTS],
        |row| row.get(0),
    )?;

    // 2. 比较期望值
    if current != vault.expected_previous {
        return Err("Concurrent modification detected");
    }

    // 3. 写入全部集合
    tx.execute(
        "UPDATE kv SET value = ?1 WHERE key = ?2",
        params![serde_json::to_string(&vault.accounts)?, KEY_ACCOUNTS],
    )?;

    tx.commit()?;
    Ok(())
}
```

**问题**：多进程同时写同一数据目录无文件级 CAS。

### 3.3 Docker Web（apps/pass-web）

#### 3.3.1 架构

```
apps/pass-web/
├── src/main.rs          # Rust 后端
├── Dockerfile
├── docker-compose.yml
└── Caddyfile.example
```

#### 3.3.2 核心实现

**文件锁机制**：
```rust
// 启动时获取文件锁
fn acquire_lock(data_dir: &Path) -> Result<File, String> {
    let lock_path = data_dir.join("pass-web-instance.lock");
    let lock_file = File::create(&lock_path)?;

    // 内核排他文件锁
    lock_file.lock_exclusive()
        .map_err(|_| "数据目录已被占用")?;

    // 写入 PID/nonce 供诊断
    writeln!(lock_file, "pid={} nonce={}", std::process::id(), Uuid::new_v4())?;

    Ok(lock_file)
}
```

**Vault 存储**：
```rust
// 加密文件结构
struct EncryptedVault {
    ciphertext: Vec<u8>,      // AES-256-GCM 加密内容
    nonce: [u8; 12],
    key_file: PathBuf,        // 独立密钥文件
}

// 启用主密码时
struct WrappedVault {
    encrypted_vault: EncryptedVault,
    wrapper: KeyWrapper,      // 主密码派生密钥包装 vault key
}
```

**安全限制**：
- `PASS_WEB_AUTH_TOKEN` 是网页访问令牌，不等同于同步 Bearer Token
- 仅绑定 `127.0.0.1`、`localhost` 或 `::1` 时可留空
- 绑定局域网或公网地址时必须设置令牌并通过 HTTPS 反向代理

### 3.4 Chrome Web 扩展（apps/extension_chrome_web + extension_shared）

#### 3.4.1 模块结构

```
apps/extension_shared/
├── background.js          # 后台 Service Worker
├── content.js             # 内容脚本
├── popup.js               # 弹出窗口
├── options.js             # 选项页
├── data_store.js          # 数据存储（IndexedDB）
├── lock_crypto.js         # 主密码加密
├── lock_state.js          # 锁定状态
├── sync_crypto.js         # 同步加密
├── sync_outbox.js         # 补偿队列
├── passkey_store.js       # Passkey 存储
├── credential_fill_core.js # 填充逻辑
├── account_core.js        # 账号核心
└── ...

apps/extension_chrome_web/
├── manifest.json          # Chrome 扩展清单
├── extension-bridge.js    # 命令桥接
├── web-main.js            # 从 Tauri UI 同步生成
├── web-options.html       # 从 Tauri UI 同步生成
└── web-options.css        # 从 Tauri UI 同步生成
```

#### 3.4.2 后台同步调度

```javascript
// background.js
class SyncScheduler {
    async runSync() {
        // 1. 检查互斥锁
        if (await this.isSyncing()) {
            return;
        }

        // 2. 申请 session 锁（10 分钟过期）
        await this.acquireLock();

        try {
            // 3. 拉取主源
            const primary = await this.fetchPrimary();
            if (!primary) {
                throw new Error("Primary source failed");
            }

            // 4. 拉取镜像（失败不阻塞）
            const mirrors = await this.fetchMirrors();

            // 5. 合并
            const merged = await this.merge(primary, mirrors);

            // 6. 写入本地
            await this.saveLocal(merged);

            // 7. 推送到主源
            await this.pushPrimary(merged);

            // 8. 推送到镜像（失败进入 outbox）
            for (const mirror of mirrors) {
                try {
                    await this.pushMirror(mirror, merged);
                } catch (e) {
                    await this.addToOutbox(mirror, merged);
                }
            }
        } finally {
            await this.releaseLock();
        }
    }
}
```

#### 3.4.3 JS 对拍实现

```javascript
// sync_merge_core.js
function mergeSyncPayloads(local, remote) {
    // 合并账号
    const accounts = mergeAccountCollections(local.accounts, remote.accounts);

    // 合并文件夹
    const folders = mergeFolderCollections(local.folders, remote.folders);

    // 合并 Passkeys
    const passkeys = mergePasskeyCollections(local.passkeys, remote.passkeys);

    // 合并顺序
    const allRegularAccountIds = mergeOrderArrays(
        local.allRegularAccountIds,
        remote.allRegularAccountIds
    );

    return { accounts, folders, passkeys, allRegularAccountIds };
}

function mergeAccountCollections(localAccounts, remoteAccounts) {
    const result = [];
    const allIds = new Set([
        ...localAccounts.map(a => a.recordId),
        ...remoteAccounts.map(a => a.recordId)
    ]);

    for (const id of allIds) {
        const local = localAccounts.find(a => a.recordId === id);
        const remote = remoteAccounts.find(a => a.recordId === id);

        if (local && remote) {
            result.push(mergeAccount(local, remote));
        } else {
            result.push(local || remote);
        }
    }

    return result;
}
```

**问题**：JS 实现必须与 Rust 保持语义一致，维护成本高。

### 3.5 同步服务器（apps/sync_server_ubuntu）

#### 3.5.1 核心特性

- **单文件 Python 服务**，零第三方依赖
- **SQLite 持久化**，默认启用 WAL
- **自动保留**每个同步 scope 最近 50 个快照版本
- **每个 scope 审计**最多保留 5000 条操作记录
- **限流**按客户端 IP 计数，清理过期窗口
- **可选 Bearer Token 认证**
- **返回 ETag**，支持 `If-Match` 并发保护
- **幂等重放**：相同 `Idempotency-Key` 不重复创建版本

#### 3.5.2 API 端点

```
GET  /v2/sync/state              # 获取当前 payload
PUT  /v2/sync/state              # 更新 payload（需要 If-Match）
GET  /v2/sync/versions           # 获取版本列表
GET  /v2/sync/versions/{id}      # 获取特定版本
POST /v2/sync/versions/{id}/restore  # 恢复特定版本
GET  /v2/sync/audit              # 获取审计记录
GET  /healthz                    # 健康检查
GET  /metrics                    # 运维指标（需要 Bearer Token）
```

#### 3.5.3 数据库 Schema

```sql
-- 当前 payload
CREATE TABLE payloads (
    scope TEXT PRIMARY KEY,
    etag TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    payload BLOB NOT NULL,
    scope_revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);

-- 版本历史
CREATE TABLE payload_versions (
    scope TEXT NOT NULL,
    version_id TEXT NOT NULL,
    etag TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    payload BLOB NOT NULL,
    scope_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, version_id)
);

-- 幂等记录
CREATE TABLE sync_idempotency (
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    etag TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    scope_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope, idempotency_key)
);

-- 审计日志
CREATE TABLE sync_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    operation TEXT NOT NULL,  -- 'put', 'restore', 'get'
    status TEXT NOT NULL,     -- 'success', 'failed'
    etag TEXT,
    scope_revision INTEGER,
    created_at TEXT NOT NULL
);
```

#### 3.5.4 部署架构

```
/opt/pass-sync-source/       # 源码目录（Git 仓库）
/opt/pass-sync-server/       # 安装目录（实际运行）
    ├── pass_sync_server.py
    ├── pass-sync-server.service
    ├── pass-sync-server-backup.service
    ├── pass-sync-server-backup.timer
    └── data/
        └── sync.db

/etc/systemd/system/
    ├── pass-sync-server.service
    └── pass-sync-server-backup.timer

/etc/pass-sync-server/
    └── config.env           # 配置文件（端口、Token 等）
```

**部署流程**：
1. 暂停服务
2. 备份当前程序、systemd 单元和 SQLite
3. 拉取新代码
4. 复制到安装目录
5. 安装 systemd 单元
6. 启动服务
7. 健康检查（`/healthz`）
8. 失败时恢复备份

---

## 四、同步协议与合并机制

### 4.1 V2 同步协议

#### 4.1.1 数据契约

**pass.data.v2**（业务 payload）：
```json
{
  "schema": "pass.data.v2",
  "exportedAtMs": 1234567890,
  "exportedAtDevice": "MacBook-Pro",
  "payload": {
    "accounts": [...],
    "folders": [...],
    "passkeys": [...],
    "allRegularAccountIds": [...],
    "allRegularOrderUpdatedAtMs": 1234567890,
    "allRegularOrderUpdatedDeviceName": "MacBook-Pro",
    "folderOrderIds": [...],
    "folderOrderUpdatedAtMs": 1234567890,
    "folderOrderUpdatedDeviceName": "MacBook-Pro"
  }
}
```

**pass.sync.bundle.v2**（同步包）：
```json
{
  "schema": "pass.sync.bundle.v2",
  "exportedAtMs": 1234567890,
  "exportedAtDevice": "MacBook-Pro",
  "payload": { ... }  // pass.data.v2
}
```

**pass.sync.encrypted.v1**（加密信封）：
```json
{
  "schema": "pass.sync.encrypted.v1",
  "keyId": "key-1",
  "nonce": "base64...",
  "ciphertext": "base64..."  // AES-256-GCM 加密的 pass.sync.bundle.v2
}
```

#### 4.1.2 同步流程

```
客户端 A                    同步服务器                    客户端 B
    |                           |                           |
    |--- GET /v2/sync/state --->|                           |
    |<-- 200 OK + ETag + payload|                           |
    |                           |                           |
    |                           |<--- GET /v2/sync/state ---|
    |                           |---- 200 OK + ETag + payload->|
    |                           |                           |
    |--- PUT /v2/sync/state --->|                           |
    |    (If-Match: ETag_A)     |                           |
    |                           |                           |
    |<-- 200 OK + new ETag -----|                           |
    |                           |                           |
    |                           |<--- PUT /v2/sync/state ---|
    |                           |    (If-Match: ETag_B)     |
    |                           |                           |
    |                           |---- 412 Precondition Failed->|
    |                           |                           |
    |                           |<--- GET /v2/sync/state ---|
    |                           |    (重新拉取)              |
    |                           |                           |
    |                           |<--- PUT /v2/sync/state ---|
    |                           |    (If-Match: new ETag)   |
    |                           |---- 200 OK ------------->|
```

#### 4.1.3 并发控制

**ETag/If-Match**：
- 服务端返回 `ETag` 标识当前 payload 版本
- 客户端 PUT 时携带 `If-Match: <ETag>`
- 服务端比较 `If-Match` 与当前 `ETag`
- 不匹配则返回 `412 Precondition Failed`

**幂等重放**：
- 客户端生成 `Idempotency-Key`
- 服务端按 `(scope, idempotency_key)` 去重
- 相同 key 返回原有 ETag/payload 摘要，不创建新版本

**scope_revision**：
- 每个 scope 内连续递增
- 旧数据库启动时自动迁移补齐
- 用于客户端判断是否需要重新合并

### 4.2 合并算法详解

#### 4.2.1 字段级 LWW

```rust
fn merge_account(local: &PasswordAccount, remote: &PasswordAccount) -> PasswordAccount {
    let mut result = local.clone();

    // 合并每个字段
    result.username = merge_field(
        &local.username, local.usernameUpdatedAtMs, local.usernameUpdatedDevice,
        &remote.username, remote.usernameUpdatedAtMs, remote.usernameUpdatedDevice,
    );

    result.password = merge_field(
        &local.password, local.passwordUpdatedAtMs, local.passwordUpdatedDevice,
        &remote.password, remote.passwordUpdatedAtMs, remote.passwordUpdatedDevice,
    );

    // ... 其他字段

    result
}

fn merge_field<T: Clone>(
    local_value: &T,
    local_time: i64,
    local_device: &str,
    remote_value: &T,
    remote_time: i64,
    remote_device: &str,
) -> T {
    if local_time > remote_time {
        local_value.clone()
    } else if local_time < remote_time {
        remote_value.clone()
    } else {
        // 时间戳并列，使用稳定键裁决
        if local_device >= remote_device {
            local_value.clone()
        } else {
            remote_value.clone()
        }
    }
}
```

#### 4.2.2 别名归并

```rust
fn sync_alias_groups(accounts: &[PasswordAccount], device_name: &str, now_ms: i64) -> AliasResult {
    let mut changed = false;
    let mut result = accounts.to_vec();

    // 按站点域名分组
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, account) in accounts.iter().enumerate() {
        for site in &account.sites {
            let domain = normalize_domain(site);
            groups.entry(domain).or_default().push(i);
        }
    }

    // 合并同组账号的站点
    for (_, indices) in groups {
        if indices.len() > 1 {
            let union_sites: HashSet<String> = indices.iter()
                .flat_map(|&i| accounts[i].sites.iter().cloned())
                .collect();

            for &i in &indices {
                let old_sites = result[i].sites.clone();
                result[i].sites = union_sites.iter().cloned().collect();
                if old_sites != result[i].sites {
                    changed = true;
                    result[i].sitesUpdatedAtMs = now_ms;
                    result[i].sitesUpdatedDevice = device_name.to_string();
                }
            }
        }
    }

    AliasResult { accounts: result, changed }
}
```

#### 4.2.3 安全检查

```rust
fn evaluate_sync_safety(
    local: &SyncPayload,
    remote: &SyncPayload,
    merged: &SyncPayload,
    mode: &str,
) -> SyncSafetyReport {
    let mut report = SyncSafetyReport::new();

    // 1. 检查永久删除墓碑是否保留
    for account in &merged.accounts {
        if account.isPermanentlyDeleted {
            if !local.accounts.iter().any(|a| a.recordId == account.recordId && a.isPermanentlyDeleted)
                && !remote.accounts.iter().any(|a| a.recordId == account.recordId && a.isPermanentlyDeleted)
            {
                report.status = SyncSafetyStatus::Failed;
                report.errors.push("Permanent delete tombstone not preserved");
            }
        }
    }

    // 2. 检查敏感字段是否清除
    for account in &merged.accounts {
        if account.isPermanentlyDeleted {
            if !account.password.is_empty() || !account.totpSecret.is_empty() {
                report.status = SyncSafetyStatus::Failed;
                report.errors.push("Sensitive fields not cleared for permanently deleted account");
            }
        }
    }

    // 3. 检查数量统计
    let visible_count = merged.accounts.iter()
        .filter(|a| !a.isPermanentlyDeleted)
        .count();
    report.visibleAccountCount = visible_count;

    report
}
```

### 4.3 多同步源支持

#### 4.3.1 主源与镜像

```rust
struct SyncSettings {
    primarySource: SyncSource,      // 主源（唯一合并输入）
    mirrors: Vec<SyncSource>,       // 镜像（只接收结果）
    syncIntervalMs: i64,
    encryptionKey: Option<String>,
}

enum SyncSource {
    SelfHosted {
        baseUrl: String,
        bearerToken: Option<String>,
    },
    WebDav {
        url: String,
        username: String,
        password: String,
    },
}
```

#### 4.3.2 同步逻辑

```rust
async fn run_sync(settings: &SyncSettings) -> Result<SyncResult, String> {
    // 1. 拉取主源（失败则停止）
    let primary_payload = fetch_primary(&settings.primarySource).await?;

    // 2. 拉取镜像（失败不阻塞）
    let mut mirror_payloads = Vec::new();
    for mirror in &settings.mirrors {
        match fetch_mirror(mirror).await {
            Ok(payload) => mirror_payloads.push(payload),
            Err(e) => log::warn!("Mirror fetch failed: {}", e),
        }
    }

    // 3. 合并（主源是唯一输入）
    let merged = merge_sync_payloads(&local, &primary_payload);

    // 4. 写入本地
    vault.apply_merged(&merged)?;

    // 5. 推送到主源
    push_primary(&settings.primarySource, &merged).await?;

    // 6. 推送到镜像（失败进入 outbox）
    for mirror in &settings.mirrors {
        match push_mirror(mirror, &merged).await {
            Ok(_) => {},
            Err(e) => outbox.add(mirror, &merged),
        }
    }

    Ok(SyncResult { applied: true, pushed: true })
}
```

---

## 五、安全机制分析

### 5.1 本地加密

#### 5.1.1 密钥派生

```rust
// PBKDF2-SHA-256，310000 次迭代
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac_sha256(password.as_bytes(), salt, 310000, &mut key);
    key
}
```

#### 5.1.2 数据加密

```rust
// AES-256-GCM
fn encrypt_vault(vault: &Vault, key: &[u8; 32]) -> EncryptedVault {
    let nonce = generate_nonce();  // 12 字节
    let ciphertext = aes_gcm_encrypt(key, &nonce, vault.to_json().as_bytes());

    EncryptedVault {
        ciphertext,
        nonce,
    }
}

fn decrypt_vault(encrypted: &EncryptedVault, key: &[u8; 32]) -> Result<Vault, String> {
    let plaintext = aes_gcm_decrypt(key, &encrypted.nonce, &encrypted.ciphertext)?;
    let vault = Vault::from_json(&String::from_utf8(plaintext)?)?;
    Ok(vault)
}
```

#### 5.1.3 主密码包装

```rust
// 启用主密码时
struct WrappedVault {
    encrypted_vault: EncryptedVault,  // vault key 加密的 vault
    wrapper: KeyWrapper,              // 主密码派生密钥包装 vault key
}

struct KeyWrapper {
    salt: [u8; 16],
    nonce: [u8; 12],
    wrapped_key: Vec<u8>,  // 主密码派生密钥加密的 vault key
}

// 解锁流程
fn unlock_vault(wrapped: &WrappedVault, password: &str) -> Result<Vault, String> {
    // 1. 派生主密钥
    let master_key = derive_key(password, &wrapped.wrapper.salt);

    // 2. 解包 vault key
    let vault_key = aes_gcm_decrypt(&master_key, &wrapped.wrapper.nonce, &wrapped.wrapper.wrapped_key)?;

    // 3. 解密 vault
    decrypt_vault(&wrapped.encrypted_vault, &vault_key)
}
```

### 5.2 同步加密

#### 5.2.1 端到端加密

```rust
// 可选同步密钥
fn encrypt_sync_bundle(bundle: &SyncBundle, key: &str) -> EncryptedBundle {
    let key_bytes = base64_decode(key)?;
    let nonce = generate_nonce();
    let ciphertext = aes_gcm_encrypt(&key_bytes, &nonce, bundle.to_json().as_bytes());

    EncryptedBundle {
        schema: "pass.sync.encrypted.v1",
        keyId: compute_key_id(&key_bytes),
        nonce: base64_encode(&nonce),
        ciphertext: base64_encode(&ciphertext),
    }
}
```

#### 5.2.2 密钥轮换

```rust
struct SyncSettings {
    encryptionKey: Option<String>,           // 当前密钥
    previousEncryptionKey: Option<String>,   // 旧密钥（运行时使用，不持久化）
}

// 解密流程
fn decrypt_sync_bundle(encrypted: &EncryptedBundle, settings: &SyncSettings) -> Result<SyncBundle, String> {
    // 1. 尝试当前密钥
    if let Some(key) = &settings.encryptionKey {
        if compute_key_id(key) == encrypted.keyId {
            return decrypt_with_key(encrypted, key);
        }
    }

    // 2. 尝试旧密钥
    if let Some(key) = &settings.previousEncryptionKey {
        if compute_key_id(key) == encrypted.keyId {
            return decrypt_with_key(encrypted, key);
        }
    }

    Err("No matching key found")
}
```

### 5.3 安全边界

#### 5.3.1 同步端点

- **必须使用 HTTPS**
- 仅 `localhost`、`127.0.0.1` 和 `::1` 可为本机开发使用 HTTP
- 避免 WebDAV Basic 凭据及服务器 Bearer Token 明文传输

#### 5.3.2 内容脚本

- 自动填充校验活动标签页域名与账号站点匹配
- 默认只允许 HTTPS（本机 HTTP 例外）
- 内容脚本不缓存全库明文密码
- 保存/更新提示向后台查询，不直接访问密码

#### 5.3.3 Passkey

- 软件 Passkey 私钥可同步（产品模型限制）
- 不等价于硬件认证器不可导出的安全属性
- UI 应明确标注区别

### 5.4 安全风险

#### 5.4.1 明文同步包

**问题**：同步密钥允许留空，此时使用明文 `pass.sync.bundle.v2`。

**风险**：
- 网络传输暴露密码
- 服务器存储明文数据

**缓解措施**：
- 生产环境强制要求同步密钥
- 留空密钥时 UI 显示强警告
- 考虑将"允许明文"作为编译时开关

#### 5.4.2 软件 Passkey 可导出

**问题**：软件实现的 Passkey 私钥可同步。

**风险**：
- 用户可能误解安全级别
- 私钥泄露风险

**缓解措施**：
- UI 明确标注"软件 Passkey"与"硬件认证器"区别
- 提供导出警告
- 未来支持 FIDO2 硬件认证器

---

## 六、性能特征与瓶颈

### 6.1 当前性能特征

#### 6.1.1 内存使用

- **所有数据加载到内存**：账号、文件夹、Passkeys 全部反序列化后保存在内存
- **预期影响**：1000 个账号约 5-10MB 内存

#### 6.1.2 同步性能

- **全量传输**：每次同步传输完整 payload
- **预期影响**：1000 个账号约 100-200KB，同步时间 1-2 秒（局域网）

#### 6.1.3 合并性能

- **O(n) 复杂度**：遍历所有账号进行合并
- **预期影响**：1000 个账号合并约 10-50ms（Rust），100-200ms（JS）

### 6.2 性能瓶颈

#### 6.2.1 大型 Vault 加载

**问题**：所有数据加载到内存，账号数量多时可能卡顿。

**测试场景**：
- 1000 个账号：可接受
- 5000 个账号：可能卡顿
- 10000+ 个账号：严重性能问题

**建议**：
1. 实现分页加载
2. 搜索使用索引而非全量扫描
3. 虚拟化列表渲染

#### 6.2.2 同步全量传输

**问题**：每次同步传输完整 payload，数据量大时慢。

**测试场景**：
- 1000 个账号：100-200KB，1-2 秒
- 5000 个账号：500KB-1MB，3-5 秒
- 10000+ 个账号：1-2MB，5-10 秒

**建议**：
1. 实现增量同步（diff-based）
2. 压缩 payload（gzip/brotli）
3. 大附件（如 Passkey 图标）使用独立存储

#### 6.2.3 JS 对拍性能

**问题**：Chrome 使用 JS 实现合并，性能低于 Rust。

**测试场景**：
- 1000 个账号：100-200ms（JS） vs 10-50ms（Rust）
- 5000 个账号：500-1000ms（JS） vs 50-100ms（Rust）

**建议**：
- 将 Rust 核心编译为 WASM，Chrome 直接调用

### 6.3 性能优化建议

#### 6.3.1 短期优化（1-3个月）

1. **同步压缩**
   - 服务端支持 `Content-Encoding: gzip`
   - 客户端发送前压缩 payload
   - 预期收益：同步速度提升 50-70%

2. **虚拟化列表**
   - 使用虚拟滚动渲染账号列表
   - 只渲染可见区域的账号
   - 预期收益：1000+ 账号时流畅度提升

#### 6.3.2 中期优化（3-6个月）

1. **增量同步**
   - 客户端维护本地 op-log
   - 同步时发送 `last_sync_revision`
   - 服务端返回变更部分
   - 预期收益：同步时间减少 80%+

2. **分页加载**
   - 首次加载前 100 个账号
   - 滚动时按需加载
   - 预期收益：首次加载时间减少 90%

#### 6.3.3 长期优化（6-12个月）

1. **本地索引**
   - 使用 SQLite FTS5 全文搜索
   - 搜索时查询索引而非全量扫描
   - 预期收益：搜索时间减少 95%

2. **WebAssembly**
   - Chrome 使用 WASM 调用 Rust 核心
   - 预期收益：合并性能提升 5-10 倍

---

## 七、技术债务清单

### 7.1 高优先级债务

#### 7.1.1 Chrome JS 对拍实现

**问题描述**：
Chrome 扩展使用 JS 重新实现了合并逻辑（`sync_merge_core.js`），必须通过黄金向量与 Rust 对拍。

**影响**：
- 维护两套合并代码，容易语义漂移
- 新合并规则需要同步修改 JS 和 Rust
- 对拍测试只能覆盖已知场景，无法保证完全等价

**清理计划**：
1. **短期**（1个月）：增加更多边界场景的黄金向量测试
2. **中期**（3个月）：将 Rust 核心编译为 WASM，Chrome 直接调用
3. **长期**（6个月）：删除 JS 对拍实现，统一使用 WASM

**风险**：
- WASM 体积可能较大（预计 1-2MB）
- 需要处理 WASM 加载失败场景

#### 7.1.2 多进程并发写入

**问题描述**：
Tauri 和 Docker Web 使用 SQLite KV 存储，但多进程同时写同一数据目录无文件级 CAS。

**影响**：
- 用户同时打开多个应用实例可能数据冲突
- Docker Web 使用文件锁阻止第二实例，但 Tauri 没有

**清理计划**：
1. **短期**（1个月）：Tauri 增加文件锁检测，启动时检查数据目录是否被占用
2. **中期**（3个月）：考虑引入 SQLite WAL 模式 + 行级锁
3. **长期**（6个月）：实现应用层 CAS：写入前读取 revision，提交时比较

**实现参考**：
```rust
use fs2::FileExt;
use std::fs::File;

fn acquire_data_lock(data_dir: &Path) -> Result<File, String> {
    let lock_path = data_dir.join(".lock");
    let lock_file = File::create(&lock_path)?;
    lock_file.try_lock_exclusive()
        .map_err(|_| "数据目录已被占用")?;
    Ok(lock_file)
}
```

### 7.2 中优先级债务

#### 7.2.1 旧 SwiftUI 代码残留

**问题描述**：
`apps/app_macos` 仍保留大量旧代码，虽然标记为"参考实现"，但可能被误用。

**影响**：
- 新开发者可能误以为这是活跃代码
- 旧 Swift 合并实现可能与 Rust 不一致

**清理计划**：
1. **短期**（1个月）：在 `app_macos/README.md` 顶部增加醒目警告
2. **中期**（3个月）：考虑将旧代码移到 `archive/` 目录
3. **长期**（6个月）：只保留 AutoFill/Credential Exchange 系统能力代码

#### 7.2.2 同步全量传输

**问题描述**：
每次同步传输完整 payload，数据量大时慢。

**影响**：
- 同步时间长
- 带宽成本高

**清理计划**：
1. **短期**（1个月）：实现同步压缩（gzip）
2. **中期**（3个月）：实现增量同步（diff-based）
3. **长期**（6个月）：大附件独立存储

### 7.3 低优先级债务

#### 7.3.1 文档过时

**问题描述**：
部分历史文档未明确标注性质，可能被误认为当前事实。

**影响**：
- 开发者可能误解当前能力
- 决策基于错误信息

**清理计划**：
1. **短期**（1个月）：在 `docs/README.md` 增加文档分类标签
2. **中期**（3个月）：历史文档顶部增加醒目警告
3. **长期**（6个月）：删除无用的旧设计文档

#### 7.3.2 错误处理不统一

**问题描述**：
各端错误码和错误消息不统一。

**影响**：
- 调试困难
- 用户体验不一致

**清理计划**：
1. **短期**（1个月）：定义标准错误码表
2. **中期**（3个月）：所有端使用相同错误码
3. **长期**（6个月）：UI 根据错误码显示友好提示

---

## 八、风险评估

### 8.1 技术风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| WASM 集成失败 | 中 | 高 | 保留 JS 降级方案 |
| 多用户支持复杂 | 高 | 中 | 先实现简单账户系统 |
| 移动端开发成本高 | 高 | 中 | 使用 KMP/Flutter 共享逻辑 |
| 性能回归 | 中 | 中 | CI 增加性能基准测试 |
| 安全漏洞 | 低 | 高 | 定期安全审计、依赖更新 |

### 8.2 产品风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 用户误解 Passkey 安全性 | 高 | 中 | UI 明确标注区别 |
| 明文同步暴露密码 | 中 | 高 | 生产环境强制同步密钥 |
| 数据丢失 | 低 | 高 | 版本历史、安全快照 |
| 同步冲突 | 中 | 中 | ETag/If-Match、幂等重放 |

### 8.3 运维风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 同步服务器宕机 | 低 | 高 | 健康检查、自动恢复 |
| 数据库损坏 | 低 | 高 | 定期备份、WAL 模式 |
| 部署失败 | 中 | 中 | 回滚机制、健康检查 |
| 证书过期 | 中 | 高 | 自动续期、监控告警 |

---

## 九、开发建议与路线图

### 9.1 短期目标（1-3个月）

#### 9.1.1 P0：Chrome WASM 集成

**目标**：将 Rust 核心编译为 WASM，Chrome 直接调用，消除 JS 对拍实现。

**步骤**：
1. 在 `core/pass_core` 增加 `wasm` crate，导出 WASM 接口
2. 编写 JS bindings，封装 WASM 调用
3. Chrome 扩展切换到 WASM 实现
4. 保留 JS 实现作为降级方案（WASM 加载失败时）
5. 更新黄金向量测试，验证 WASM 与 Rust 等价

**预期收益**：
- 消除 JS 对拍维护成本
- 保证合并语义完全一致
- 性能提升（WASM 比 JS 快 5-10 倍）

**验收标准**：
- WASM 体积 < 2MB
- 所有黄金向量测试通过
- Chrome 扩展功能正常

#### 9.1.2 P0：Tauri 文件锁

**目标**：防止多进程同时写同一数据目录。

**步骤**：
1. 启动时尝试获取文件锁（`flock` 或 `fcntl`）
2. 获取失败时提示用户"已有实例运行"
3. 崩溃时自动释放锁（内核保证）

**预期收益**：
- 防止数据冲突
- 提升用户体验

**验收标准**：
- 同时启动两个实例，第二个实例提示错误
- 崩溃后重新启动，可正常获取锁

#### 9.1.3 P1：同步压缩

**目标**：减少同步 payload 体积。

**步骤**：
1. 服务端支持 `Content-Encoding: gzip`
2. 客户端发送前压缩 payload
3. 接收后解压并验证 SHA256

**预期收益**：
- 同步速度提升 50-70%
- 服务器带宽成本降低

**验收标准**：
- 压缩后 payload 体积减少 60%+
- 同步功能正常

#### 9.1.4 P1：错误处理增强

**目标**：统一错误码和错误消息。

**步骤**：
1. 定义标准错误码表（如 `SYNC_412_PRECONDITION_FAILED`）
2. 所有端使用相同错误码
3. UI 根据错误码显示友好提示
4. 日志记录完整错误上下文

**预期收益**：
- 调试效率提升
- 用户体验一致

**验收标准**：
- 所有错误码有文档
- UI 显示友好错误消息

### 9.2 中期目标（3-6个月）

#### 9.2.1 P1：增量同步

**目标**：只传输变更部分，减少同步时间和带宽。

**方案**：
1. 客户端维护本地 op-log（操作日志）
2. 同步时发送 `last_sync_revision`
3. 服务端返回该 revision 之后的变更
4. 客户端应用增量变更

**预期收益**：
- 同步时间减少 80%+
- 带宽成本降低

**技术挑战**：
- 需要处理冲突（两端同时修改同一字段）
- 需要处理删除（墓碑传播）
- 需要处理顺序变更

#### 9.2.2 P2：Docker Web 多用户支持

**目标**：Docker Web 支持多租户。

**方案**：
1. 用户认证（OAuth2 / LDAP / 本地账户）
2. 数据隔离（每用户独立 vault）
3. 权限管理（管理员 / 普通用户）
4. 审计日志

**技术选型**：
- 认证：Keycloak / Authelia / 内置简单账户系统
- 存储：每用户独立 SQLite 文件 / 统一数据库 + 租户字段

#### 9.2.3 P2：浏览器扩展能力对齐

**目标**：Firefox/Safari 扩展达到 Chrome 同等能力。

**步骤**：
1. 审查 Chrome 扩展功能清单
2. 识别 Firefox/Safari 缺失功能
3. 逐个实现并测试
4. 更新命令矩阵文档

**挑战**：
- Safari Web Extension API 限制较多
- Firefox MV3 迁移进度

### 9.3 长期目标（6-12个月）

#### 9.3.1 P2：端到端加密增强

**目标**：提升端到端加密安全性。

**方向**：
1. **零知识证明**：服务器无法解密用户数据
2. **密钥分片**：使用 Shamir's Secret Sharing 分散密钥
3. **硬件安全模块**：支持 YubiKey / Secure Enclave

#### 9.3.2 P3：协作功能

**目标**：支持团队共享密码。

**功能**：
1. 共享 vault（团队成员可访问）
2. 权限管理（读/写/管理员）
3. 审计日志（谁访问了什么）
4. 密码策略（强制复杂度、定期更换）

**技术挑战**：
- 共享密钥管理
- 权限同步
- 冲突解决

#### 9.3.3 P3：移动端 MVP

**目标**：发布 Android/iOS 基础版本。

**方案**：
- 使用 Kotlin Multiplatform / Flutter 共享业务逻辑
- 原生 UI（Jetpack Compose / SwiftUI）
- 复用 Rust Core（通过 FFI）

**功能范围**：
- 查看/搜索账号
- 自动填充（Credential Manager / AutoFill）
- 基础同步

**不包含**：
- 高级管理功能（批量操作、CSV 导入等）
- Passkey 管理

---

## 十、测试策略

### 10.1 当前测试覆盖

#### 10.1.1 单元测试

- **Rust Core**：`cargo test --workspace`
- **扩展 JS**：`npm test`（30+ 测试文件）
- **同步服务器**：`test_server.py`

#### 10.1.2 集成测试

- **黄金向量对拍**：`check_merge_parity.mjs`
- **命令矩阵检查**：`check_command_matrix.mjs`
- **端到端同步**：`test_sync_e2e.py`

#### 10.1.3 性能测试

- **缺失**：当前无性能基准测试

### 10.2 测试改进建议

#### 10.2.1 增加性能基准测试

```yaml
# .github/workflows/ci.yml
- name: Performance Benchmark
  run: |
    cargo bench --workspace
    # 与基线比较，超过 10% 回归则失败
```

#### 10.2.2 增加安全扫描

```yaml
# .github/workflows/ci.yml
- name: Security Audit
  run: |
    cargo audit
    npm audit --production
```

#### 10.2.3 增加端到端测试

```yaml
# .github/workflows/ci.yml
- name: E2E Test
  run: |
    # 启动同步服务器
    # 启动 Tauri 应用
    # 启动 Chrome 扩展
    # 执行同步场景测试
```

#### 10.2.4 增加覆盖率报告

```yaml
# .github/workflows/ci.yml
- name: Code Coverage
  run: |
    cargo tarpaulin --out Xml
    bash <(curl -s https://codecov.io/bash)
```

### 10.3 测试目标

- **核心模块测试覆盖率**：> 80%
- **性能回归检测**：CI 自动检测
- **安全漏洞扫描**：每次提交自动扫描

---

## 十一、部署与运维

### 11.1 当前部署架构

#### 11.1.1 同步服务器

```
/opt/pass-sync-source/       # 源码目录（Git 仓库）
/opt/pass-sync-server/       # 安装目录（实际运行）
    ├── pass_sync_server.py
    ├── pass-sync-server.service
    ├── pass-sync-server-backup.service
    ├── pass-sync-server-backup.timer
    └── data/
        └── sync.db

/etc/systemd/system/
    ├── pass-sync-server.service
    └── pass-sync-server-backup.timer

/etc/pass-sync-server/
    └── config.env           # 配置文件（端口、Token 等）
```

#### 11.1.2 Docker Web

```yaml
# docker-compose.yml
version: '3.8'
services:
  pass-web:
    build: .
    ports:
      - "127.0.0.1:53335:53335"
    volumes:
      - pass_web_data:/data
    environment:
      - PASS_WEB_TRUSTED_LOOPBACK_PROXY=1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:53335/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 11.2 部署改进建议

#### 11.2.1 自动化部署

**建议**：
1. 使用 GitHub Actions 自动部署
2. 部署前自动运行测试
3. 部署后自动健康检查
4. 失败时自动回滚

#### 11.2.2 监控告警

**建议**：
1. 同步服务器：监控 `/metrics` 端点
2. Docker Web：监控容器健康状态
3. 日志收集：使用 Loki / ELK
4. 告警：使用 Prometheus + Alertmanager

#### 11.2.3 备份策略

**建议**：
1. 同步服务器：每日自动备份 SQLite
2. Docker Web：每日自动备份 `/data` 目录
3. 备份保留：最近 7 天
4. 异地备份：每周同步到对象存储

### 11.3 运维手册

#### 11.3.1 同步服务器

**启动**：
```bash
cd /opt/pass-sync-server
./start.sh
```

**停止**：
```bash
cd /opt/pass-sync-server
./stop.sh
```

**查看日志**：
```bash
journalctl -u pass-sync-server -f
```

**健康检查**：
```bash
curl http://localhost:53333/healthz
```

**备份**：
```bash
cd /opt/pass-sync-server
./backup_sync_db.sh
```

#### 11.3.2 Docker Web

**启动**：
```bash
cd apps/pass-web
docker compose up -d
```

**停止**：
```bash
cd apps/pass-web
docker compose down
```

**查看日志**：
```bash
docker compose logs -f
```

**健康检查**：
```bash
curl http://localhost:53335/healthz
```

**备份**：
```bash
docker run --rm -v pass_web_data:/data -v $(pwd):/backup alpine tar czf /backup/pass-web-backup.tar.gz /data
```

---

## 十二、总结与优先级

### 12.1 项目优势

1. **架构清晰**：分层明确，权威来源清晰
2. **技术先进**：Rust + Tauri + WASM（未来）
3. **测试完善**：黄金向量对拍、命令矩阵检查
4. **文档丰富**：当前事实、契约、历史蓝图分类清晰

### 12.2 核心建议

#### 立即执行（1个月内）
1. ✅ **Chrome WASM 集成**（消除 JS 对拍）
2. ✅ **Tauri 文件锁**（防止并发写入）
3. ✅ **同步压缩**（提升性能）

#### 短期规划（3个月内）
1. 文档整理与错误处理增强
2. 性能监控与基线建立
3. UI 美化与国际化

#### 中期目标（6个月内）
1. 增量同步（减少带宽）
2. Docker Web 多用户支持
3. 浏览器扩展能力对齐

#### 长期愿景（12个月内）
1. 端到端加密增强
2. 团队协作功能
3. 移动端 MVP

### 12.3 风险缓解

| 风险 | 缓解措施 |
|------|----------|
| WASM 集成失败 | 保留 JS 降级方案 |
| 多用户支持复杂 | 先实现简单账户系统 |
| 移动端开发成本高 | 使用 KMP/Flutter 共享逻辑 |
| 性能回归 | CI 增加性能基准测试 |

### 12.4 成功指标

#### 技术指标
- 核心模块测试覆盖率 > 80%
- 同步时间 < 2秒（1000 账号）
- WASM 体积 < 2MB
- 性能回归 < 10%

#### 产品指标
- 用户留存率 > 70%
- 日活用户 > 1000
- GitHub Stars > 500
- 用户满意度 > 4.5/5

---

## 附录

### A. 关键文件索引

| 文件 | 用途 |
|------|------|
| `docs/current-app-extension-implementation-reference-zh.md` | 当前事实入口 |
| `docs/ARCHITECTURE.md` | 架构宪章 |
| `docs/sync-protocol-v2.md` | V2 同步协议 |
| `core/pass_core/crates/merge/src/v2/` | Rust 合并权威 |
| `apps/codex-tauri/src/` | 统一管理 UI |
| `apps/sync_server_ubuntu/pass_sync_server.py` | 同步服务器实现 |

### B. 相关文档

- [当前实现基准](docs/current-app-extension-implementation-reference-zh.md)
- [架构宪章](docs/ARCHITECTURE.md)
- [三端统一方案](docs/three-surface-unification-zh.md)
- [同步协议 V2](docs/sync-protocol-v2.md)
- [开发路线图](docs/dev-roadmap-a-c-j-g-zh.md)

### C. 联系方式

- GitHub: https://github.com/pixian5
- 项目仓库: https://github.com/pixian5/passkey

---

**文档版本**：2.0\
**最后更新**：2026-08-10\
**维护者**：Pass 开发团队\
**分析工具**：Qwen3.7-Plus
