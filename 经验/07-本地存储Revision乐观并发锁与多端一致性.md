# 本地存储 Revision 乐观并发锁与多端一致性

归纳三端（Chrome/Firefox/Safari 浏览器扩展、Tauri 桌面端、Pass Web Docker 容器）在本地数据存储与并发写操作时的版本自增、乐观比较交换（CAS, Compare-And-Swap）及并发冲突防护经验。

---

## 1. 本地并发写冲突与静默覆盖

### 现象 / 触发条件
- 浏览器中多标签页同时打开 Pass Web 或 Chrome Web 管理页，或在桌面端通过多窗口 / 异步操作（如后台同步任务与前台手动编辑同时保存）修改账号或排序。
- 较晚触发的保存因基于旧快照写入，静默覆盖了前一个保存的修改，产生“修改丢失”假象。

### 根因
- 过去仅在远端同步协议中依赖 `revision` / `ETag` 进行 CAS 校验，而本地存储（Tauri SQLite、Pass Web 加密文件）在调用全量写入事务时缺少本地层面的业务版本递增与断言机制。
- 浏览器扩展早期已在 IndexedDB `STORE_COLLECTIONS` 中实现了 `businessRevision` 自增与 `LOCAL_CHANGED` 抛错校验，但 Tauri 与 Pass Web 本地持久化未对齐此契约。

### 正确做法【已验证】
1. **统一业务版本字段**：
   - 三端本地状态统一维护 `businessRevision: i64`（或 JS 数字类型）。
   - 初始化或空库时业务版本初始值为 `0`。
2. **写操作原子递增**：
   - 只要写操作涉及账号（accounts）、文件夹（folders）、排序（all_regular_order / folder_order）或通行密钥（passkeys），必须在底层写入事务内递增当前业务版本（`rev + 1`）。
   - 仅写配置或纯辅助状态（如 device_name、window_state）不递增业务版本。
3. **带期望版本的守卫保存（Guard Save）**：
   - 写入接口提供可选的 `expected_revision: Option<i64>` 参数。
   - 若传入期望版本且当前存储版本与期望版本不一致，立即回滚事务并返回 `LOCAL_CHANGED: 本地业务版本已变化（期望 {expected}，实际 {current}），请重新同步/加载`。
4. **前端状态层透传与响应式同步**：
   - `createEmptyState` 保证 `businessRevision: 0`。
   - `normalizeAppState` 解析后端返回的 `businessRevision` 或 `business_revision`。

### 出处
- `apps/codex-tauri/src-tauri/src/main.rs`：`KEY_BUSINESS_REVISION`、`read_business_revision`、`save_collections_atomic_with_guard`
- `apps/pass-web/src/main.rs`：`VaultData.business_revision`、`Vault::save_with_guard`
- `apps/extension_shared/data_store.js`：`STORE_COLLECTIONS`、`LOCAL_CHANGED`
- `apps/codex-tauri/src/store.js`：`createEmptyState`、`normalizeAppState`

---

## 2. 三端存储实现差异与适配规则

### 现象 / 触发条件
- 跨端共享前端代码调用 `save_collections_atomic` 时，底层宿主实现不同：
  - Chrome 扩展：浏览器 IndexedDB 事务
  - Tauri 桌面：本地 SQLite 数据库事务
  - Pass Web：AES-GCM 加密单文件（JSON 格式加密串）持久化

### 根因
- IndexedDB 属于结构化对象仓库，版本号直接存为 `STORE_COLLECTIONS` 记录内属性。
- SQLite 采用多表或 KV 表存储，若无固定元数据表则易与业务数据混淆。
- Pass Web 每次保存写出整个加密文件，无行级锁，依赖进程内存互斥锁与文件原子重命名。

### 正确做法【已验证】
1. **SQLite 采用专用 KV 元数据键**：
   - 在 KV 表中使用 `KEY_BUSINESS_REVISION = "business_revision_v1"` 键记录字符串化整数。
   - 读取时解析为 `i64`，不存在时返回默认值 `0`。
2. **Pass Web 嵌入根结构体**：
   - 在 `VaultData` 中增加 `#[serde(default)] business_revision: i64`。
   - `save_with_guard` 在加密写出前校验并完成 `self.data.business_revision += 1`。
3. **Rust 单元测试兜底**：
   - 每端编写独立的 `local_business_revision_increments_and_guards_against_stale_expected_revision` 测试用例。
   - 验证：初始版本为 0、写操作自增为 1、旧版本保存返回含 `LOCAL_CHANGED` 错误、正确版本保存递增为 2、`app_state` 输出准确对齐。

### 出处
- `apps/codex-tauri/src-tauri/src/main.rs` 中的测试用例
- `apps/pass-web/src/main.rs` 中的测试用例
- `apps/extension_shared/tests/store.test.mjs` 中的端到端规约用例

---

## 3. 防护降级与向后兼容

### 现象 / 触发条件
- 旧版本升到新版本，历史数据库中没有 `business_revision_v1` 键，或旧快照中缺少 `business_revision` 字段。
- 历史 RPC 调用方可能未传递 `expected_revision` 参数（调用旧版接口）。

### 根因
- 存储模式向前演进时，老库数据未初始化，强制读取可能反序列化失败。
- 调用方未迁移时若直接报错会破坏现有功能。

### 正确做法【已验证】
1. **缺失时默认零值**：
   - 反序列化或读取缺失时回退为 `0`，禁止直接抛反序列化异常。
2. **可选期望版本（Option）**：
   - 基础保存函数（如 `save_collections_atomic`、`save()`）作为简易重载，默认传 `None`。
   - `expected_revision` 为 `None` 时，无条件放行并执行自增，保证老调用链路兼容。
3. **前端 store 归一化**：
   - `Number(raw?.businessRevision ?? raw?.business_revision) || 0`，同时兼容驼峰与下划线命名。
