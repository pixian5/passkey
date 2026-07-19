# Pass 跨平台密码管理器 — 代码审查报告（Grok）

> 审查日期：2026-07-19  
> 审查模型：grok-4.5-latest  
> 审查方法：源码静态深读 + 关键路径逐行核实 + 跨子系统对照；对既有审查结论独立复验（不照搬，以当前仓库状态为准）  
> 审查范围：`core/pass_core`、`apps/extension_shared`（含 Chrome/Firefox/Safari 共享层）、`apps/app_macos`、`apps/sync_server_ubuntu`、`scripts/`、次要客户端（Flutter/Tauri）、`docs/` 与 CI  
> 输出文件：本报告

---

## 0. 执行摘要

`pass` 是一个目标覆盖 macOS / 浏览器扩展 / 自建同步服务，并规划 Flutter/Tauri 多端的密码管理器 monorepo。当前真正可运行并承载真实数据的路径主要是：

| 路径 | 成熟度 |
|------|--------|
| macOS SwiftUI App + AutoFill | 生产候选，功能最完整 |
| 浏览器扩展（Chrome/Firefox，Safari 次之） | 生产候选，含 passkey shim / 同步 |
| Ubuntu 自建同步服务（Python） | 可部署，有 CAS/ETag/幂等 |
| Rust `pass_core` | **骨架级**：domain/merge/storage/ffi 多为契约/占位，**生产合并路径实际走 JS** |
| Flutter / Tauri 各工程 | 演示/脚手架，不可当生产保险库 |

本轮审查确认：**安全模型在多处与“密码管理器”应有承诺不一致**。问题不是零散笔误，而是几条系统性主题：

1. **通行密钥（WebAuthn）被实现为可导出、可远程同步的软件私钥**——破坏 WebAuthn 的根本安全假设。  
2. **“锁定”在扩展与 macOS 上多为 UI/会话门禁**，数据密钥仍可在锁定态被 AutoFill 或其它上下文使用。  
3. **本地加密密钥与密文同址存放**（扩展 storage / app-group 文件 / 备份脚本），磁盘访问者可直接解密。  
4. **自动填充与内容脚本路径过度暴露明文密码**，且跨域填充缺少硬校验。  
5. **合并内核双轨**：JS 快照 LWW 是运行时真相；Rust HLC/op-log 合并是死代码；文档与实现脱节。  
6. **CSV 公式注入、剪贴板不清空、eTLD+1 硬编码** 等跨端复现问题。

### 与既有审查的差异（重要）

对照仓库内 `代码审查glm5.2.md` 独立复验后：

| 既有结论 | 当前状态 |
|----------|----------|
| 跨扩展 `onMessage` 无 `sender.id` 校验 | **已修复**：`message_security.js` + `background.js:637` |
| 同步幂等键 `Math.random` 退化 | **大部分已修复**：`secure_random.js`；历史条目/WebAuthn requestId/CXP 仍有退化 |
| 同步可明文上传 | **客户端已强制加密密钥**（`sync_crypto.js` / macOS `PassSyncCrypto.encrypt` 空密钥抛错）；服务器默认 `allow_plaintext=false` |
| 服务器无超时/无线程上限 | **已改善**：`client_timeout_seconds` + `BoundedSemaphore` |
| Unicode `int()` 路径 500 | **已修复**：`parse_ascii_decimal` 要求 ASCII decimal |
| 通行密钥可导出 / 填充无域名校验 / 明文 DB 密钥 / AppLock UI 门禁 等 | **仍成立** |

**统计（当前代码，已剔除已修复项）**：

| 严重程度 | 约计 | 主分布 |
|----------|------|--------|
| Critical | 10 | 扩展 passkey/填充/密钥、macOS 锁与密钥、合并架构、备份、服务器启动删库 |
| High | 23 | 合并语义、CAS 绕过、内容脚本泄密、CSV、AutoFill、并发同步、XSS、剪贴板 |
| Medium | ~25 | eTLD、outbox 复活、临时文件路径、盐随机源、DoS 边角、Rust 死代码 |
| Low | ~15 | 演示客户端、硬编码设备名、日志噪音、工程卫生 |

**总体结论**：作为个人/小团队自建同步密码管理器，工程完成度与测试密度已高于“脚手架”；**在默认配置与常见威胁模型下尚不建议用于高价值主保险库**，除非先关闭软件 passkey 同步、强制主密码包裹数据密钥、并堵住填充/AutoFill 旁路。

---

## 1. 架构与代码地图

```
pass/
├── core/pass_core/                 # Rust workspace + JS 合并/交换内核
│   ├── crates/{domain,merge,storage,transport,csvio,ffi}
│   └── js/{sync_merge_core.js, credential_exchange_cxf.js}
├── apps/
│   ├── app_macos/                  # SwiftUI 主客户端 + AutoFill 扩展
│   ├── extension_shared/           # 扩展业务真相源（打包到 chrome/firefox）
│   ├── extension_{chrome,firefox,safari}/
│   ├── sync_server_ubuntu/         # 自建 E2E 信封中继
│   ├── sync_server_local/
│   ├── app_flutter / copilot-*-flutter / *-tauri   # 演示/实验
│   └── android_credential_provider/
├── scripts/                        # 审计、备份、e2e
└── docs/                           # 设计/协议（与实现部分脱节）
```

### 实际运行时数据路径

| 层 | 真相源 | 说明 |
|----|--------|------|
| 扩展本地 | IndexedDB AES-GCM + `chrome.storage` 包裹密钥 | `data_store.js` |
| 扩展合并 | `core/pass_core/js/sync_merge_core.js` | **唯一生产合并** |
| 扩展同步 | AES-256-GCM 信封 → WebDAV / 自建 server | `sync_crypto.js` + `background.js` |
| macOS 本地 | SQLite 行级 AES-GCM；密钥 `pass-db-key-v1` 文件 | `PassSharedCrypto` / `LocalSQLiteStore` |
| macOS 合并 | Swift 侧 LWW（与 JS 语义对齐意图） | `AccountStore` 巨型单文件 |
| 服务端 | 不解密；CAS ETag + 版本快照 + 幂等键 | `pass_sync_server.py` |
| Rust | 基本未接入客户端 | FFI 仅 state upsert/csv 骨架 |

### 体量观察

- `AccountStore.swift` ~6500 行、`options.js` ~5700 行、`background.js` ~1860 行：业务集中在少数巨型文件，审查与回归成本高。  
- Rust crates 极薄（domain/merge 合计约 300 行），与 README“共享核心”表述不匹配。

---

## 2. 横向主题（跨端复现）

### 主题 A — CSV 公式注入（三处均未处理）

任何以 `= + - @`（及 Tab/CR）开头的字段，在 Excel/Numbers 中可触发公式/DDE。

| 位置 | 行为 |
|------|------|
| `core/pass_core/crates/ffi/src/lib.rs:88-90` `escape_csv` | 仅引号转义 |
| `apps/extension_shared/options.js:2364-2366` `csvEscape` | 同上 |
| `apps/app_macos/.../AccountStore.swift:5377-5379` `csvEscaped` | 同上，且不清洗 `\r` |

**统一修复**：首字符 ∈ `{=,+,-,@,\t,\r}` 时前缀 `'`；导入时剥离。

### 主题 B — 安全 ID 的弱随机退化（部分修复）

已有 `secure_random.js`：同步幂等键在无 CSPRNG 时**硬失败**（正确）。仍存在：

| 位置 | 用途 |
|------|------|
| `data_store.js:635` | 历史条目 id：`Math.random` 回退 |
| `webauthn_injected.js:158` | WebAuthn 请求 id |
| `credential_exchange_cxf.js:422` | CXP 项 id |
| `AppLockStore.swift:206` | 主密码盐：`UInt8.random`（**非** `SecRandomCopyBytes`） |

### 主题 C — eTLD+1 仅 7 条后缀

`account_core.js:1-9` 与 `DomainUtils.swift:4-12` 同步硬编码 `com.cn/net.cn/.../co.uk/org.uk`。

失败场景：`a.github.io` 与 `b.github.io`、`bank.co.jp` 与 `evil.co.jp`、`*.s3.amazonaws.com` 被当成同一可注册域 → **跨站自动填充候选错配**。

### 主题 D — 密钥与密文同址

| 子系统 | 密钥位置 | 密文位置 |
|--------|----------|----------|
| 扩展 | `chrome.storage.local` 明文 `pass.data.encryptionKey.v1`（未启用主密码时） | IndexedDB |
| macOS | app-group `pass-db-key-v1` 32B 明文 0600 | `pass.db` |
| 备份 | 同上密钥被 `backup_and_verify_local.py` 原样拷贝 | 备份目录内 `pass.db` |

### 主题 E — 剪贴板永不自动清空

- 扩展：`popup.js:878` 复制密码；TOTP 同理  
- macOS：`ContentView.swift` 密码/TOTP；`AccountStore.swift:5167-5168` **同步加密密钥**  

无 15–30s 清空/恢复逻辑。

### 主题 F — 合并内核双轨

生产：JS 墙钟 LWW（字段 `*UpdatedAtMs`）。  
文档/Rust：HLC + causal_parents + time_range + `NeedsReview`。  
Rust `pass-merge` **无任何生产调用方**（仅 crate 自测）。跨语言“共享合并语义”目前是虚假承诺。

---

## 3. Critical 发现

### C-1 软件通行密钥：`extractable:true` + 导出 JWK + 随同步包上传

- **文件**：  
  - `apps/extension_shared/passkey_store.js:152-155, 651-668`（`generateKey(..., true, ...)` + `exportKey("jwk")`）  
  - 持久化 `privateJwk`：`passkey_store.js:187-201`  
  - 同步序列化：`background.js:1361+`（`privateJwk` 进入 bundle）  
  - 交换格式：`core/pass_core/js/credential_exchange_cxf.js`、`AppleCredentialExchange.swift`
- **失败场景**：攻击者拿到同步加密密钥（用户复制到剪贴板且永不清理，或从备份/磁盘取）+ 远端信封，即可导出**所有站点**私钥，离线伪造 WebAuthn 断言。RP 侧见 `fmt:"none"` + `authenticatorAttachment:"platform"` 可能误信硬件绑定。
- **修复**：  
  1. 首选：停止劫持 `navigator.credentials`，仅链接真实平台认证器元数据；  
  2. 若必须软件密钥：`extractable:false`，`wrapKey` 本地包裹，**禁止跨设备同步私钥**，仅同步 credentialId/userHandle。  
- **置信度**：Confirmed  

### C-2 通行密钥选择器在页面共享 DOM，可被合成点击静默签署

- **文件**：`content.js:593-711`（`selectPasskeyCandidate` 把 `<button>` 挂到 `document.documentElement`）；`passkey_store.js:345-422`（`getManagedAssertion` 无用户验证）
- **失败场景**：恶意源站在用户有该站 passkey 时发起 `credentials.get`，50ms 后 `document.querySelector('#pass-passkey-chooser button').click()`。`HTMLElement.click()` 对监听器为 trusted 路径 → 背景直接签攻击者 challenge 返回断言。WebAuthn 的 UV/在场性被 DOM 按钮替代。
- **修复**：选择器必须在扩展 popup / `chrome.windows.create` 隔离 UI；仅经用户在扩展页面的手势后签署。
- **置信度**：Confirmed  

### C-3 `PASS_FILL_ACTIVE_TAB` 不校验活动标签域名与账号匹配

- **文件**：`background.js:866-878`；`popup.js:1831-1835`、`889`（“全部账号”模式仍显示填充）
- **失败场景**：用户在 `evil.com` 打开 popup → 全部账号 → 误点 `bank.com` 的“填充当前页” → bank 凭据写入 evil.com DOM。后台只执行 `fillCredentialInPage(username, password)`，不查 `account.sites` vs `activeTab.url`。
- **修复**：后台按 accountId 读库，强制 `accountMatchesDomain(account, host)`；全部账号模式禁用跨域填充按钮。
- **置信度**：Confirmed  

### C-4 扩展数据密钥可明文落盘；读路径在无密钥时静默铸造新密钥

- **文件**：`data_store.js:124-147` `loadOrCreateEncryptionKey`；`195-203` `disableDataEncryption`
- **失败场景**：  
  (a) 未启用主密码时：32 字节密钥写 `STORAGE_KEY_ENCRYPTION_KEY`，与密文同 profile 可读 → “加密”对本地攻击者无效。  
  (b) wrapped key 缺失时：`rawKey.length !== 32` 则 `getRandomValues` 新密钥写回 → **旧密文永久不可读**（账号集合会抛错；history 被吞成 `[]`）。读路径不应铸造密钥。
- **修复**：禁止裸密钥写入；无 session/wrapped 时统一 `locked`；禁用加密应改为明文集合而非旁置密钥。
- **置信度**：Confirmed  

### C-5 锁状态非全局：SW 自动锁后其它上下文可仍持有 CryptoKey

- **文件**：`data_store.js:43,124-147,190-193`；`background.js:697-762`
- **失败场景**：`unlockedEncryptionKey` 为模块级缓存，每个扩展 realm 一份。SW `lockDataEncryption()` 清 session + 自身缓存；options 页若曾解锁，本地缓存仍可用。自动锁仅在 `getBackgroundLockStatus` 被轮询时评估（无独立 alarm 驱动时可能长期不锁）。
- **修复**：以 `chrome.storage.session` 为唯一真相；每次 IO 重新 import；`broadcastLockState(true)` 强制各上下文清缓存；`chrome.alarms` 周期评估空闲锁。
- **置信度**：Confirmed（缓存） / Plausible（取决于是否多上下文解锁）  

### C-6 macOS AppLock 为 UI 门禁；DB 密钥 app-group 明文；AutoFill 与次级窗口绕过锁

- **文件**：  
  - `AppLockStore.swift:114-121`（锁仅 `isLocked=true`）  
  - `PassSharedCrypto.swift:62-100`（`pass-db-key-v1`）  
  - `PassSharedAccountRepository.swift:7-58`  
  - `AutoFillCredentialProviderViewController.swift:29-38`（无交互直接返回密码）  
  - `PassMacApp.swift`（设置 / 新建账号 / 历史等窗口未统一套 `AppLockGateView`）
- **失败场景**：主密码不参与派生 DB 密钥；锁定后内存与磁盘密钥仍在。AutoFill `provideCredentialWithoutUserInteraction` 直接解密返回。共享 app-group 使扩展与主程序共享同一裸密钥。锁定主窗口后仍可能通过设置/历史/菜单命令读写完整 vault。
- **修复**：主密码/设备密钥信封包裹 DB 密钥；`lock()` 清空内存账号；所有窗口与菜单统一 gate；AutoFill 要求生物识别/设备认证；锁定时拒绝无交互提供。
- **置信度**：Confirmed  

### C-7 合并内核双轨 + Rust 死代码 → 未来跨端数据损坏高风险

- **文件**：`sync_merge_core.js`（运行时）；`crates/merge/src/lib.rs`（HLC/因果）；`crates/ffi` 不调用 merge；文档 `docs/sync-protocol-v2.md` 等
- **失败场景**：若任一端改用 Rust 语义（或按文档实现 op-log），与现网 JS LWW 对同一冲突选不同胜者 → 密码来回跳动或删除复活。当前 macOS/扩展均走快照 LWW，**今日尚不爆炸**，但是架构级 Critical 债务。
- **修复**：选定单一真相（建议：文档降级为 LWW 并删/冻结 Rust merge，**或** 全端经 FFI 用同一内核）；补跨语言 golden vectors。
- **置信度**：Confirmed（架构）；数据损坏为 Plausible-on-migration  

### C-8 FFI `pass_core_last_error_message` 返回 Mutex 内 CString 借用指针

- **文件**：`core/pass_core/crates/ffi/src/lib.rs:369-377`
- **失败场景**：返回 `message.as_ptr()` 后锁释放；并发 `set_last_error` 释放旧 CString → 调用方 UAF；若误 `pass_core_string_free` 则 double-free。
- **修复**：返回 `into_raw` 拥有副本并文档要求 free；或写入调用方缓冲区。
- **置信度**：Confirmed（API 契约 UB；当前客户端未广泛调用降低即时风险）  

### C-9 备份脚本把裸 DB 密钥与加密库一并拷贝

- **文件**：`scripts/backup_and_verify_local.py:21-24`
- **失败场景**：备份目录含 `pass.db` + `pass-db-key-v1` + 同步凭据文件 → 备份介质失窃 = 全库明文。
- **修复**：密钥独立保管或口令再包裹；备份强制 0700/0600；文档警告。
- **置信度**：Confirmed  

### C-10（数据可用性）服务器启动时静默删除非白名单 schema 的 payload

- **文件**：`pass_sync_server.py:160-171`
- **失败场景**：`_initialize` 对 schema ∉ `{encrypted.v1, bundle.v2}` 的行 **DELETE**，无 per-scope 备份、无显式 opt-in。升级/脏数据可导致远端保险库蒸发。
- **修复**：删除前写入 `purged_*.jsonl`；默认拒绝启动除非 `PASS_SYNC_PURGE_LEGACY=1`；日志打印 scope。
- **置信度**：Confirmed  

---

## 4. High 发现

### H-1 内容脚本拉取**全库明文密码**

- `background.js:972-982` `handleContentGetAccounts` 映射全部 `password`  
- `content.js` 在页面侧缓存用于“是否提示保存”  
- **风险**：隔离世界今天挡住页面 JS，但攻击面过大；任何消息/DOM/日志泄漏即整库。  
- **修复**：改为 `CHECK_LOGIN {domain,username,password} → {mode}`，密码永不离开 SW。

### H-2 自动填充可见性检测过弱 + 允许 http 注入

- `fillCredentialInPage`（`background.js:1759+`）只看 display/visibility/disabled  
- 1×1 / opacity:0 字段可窃取填充结果  
- 应对 https-only（localhost 例外）并加强可见性启发式  

### H-3 删除 vs 更新并列：JS 静默 `keepDeleted`，无 `conflict_review`

- `sync_merge_core.js:245-252`：`latestDeletedAt >= latestActivityAt` → 删除胜  
- Rust `resolve_delete` 会 `NeedsReview`；schema 有 `conflict_review` 列但生产不写  
- **风险**：同毫秒删/改 → 改密丢失且无提示  

### H-4 `evaluateSyncSafety` 主要查 local→merged，弱于 remote 丢失检测

- 远端独有记录若被错误折叠，可能 `safe:true` 后被下一次 push 抹掉  
- 需双向 identity 检查  

### H-5 `mergeAccountCollections` 按 accountId **或** recordId 命中即合并

- 共享 accountId、不同 recordId 可能折叠丢账号（eTLD 归一化加剧）  
- 测试覆盖了部分大规模合并，但未穷尽 identity 交叉  

### H-6 同步包 AAD 仅绑定 schema 常量

- `sync_crypto.js:33-34,78-82`  
- 不绑定 deviceId / exportedAtMs → 被攻陷服务器可重放旧合法信封做保险库回滚  
- **修复**：AAD 绑定关键元数据 + 客户端水位线拒绝旧 exportedAtMs  

### H-7 扩展 `runAutoSync` 缺少互斥锁

- macOS 已有 `syncNowTask` 防重入（`AccountStore.swift:2366-2380`）  
- 扩展自动同步 + 手动同步可并发读改写 + 双 PUT  
- **修复**：`navigator.locks.request("pass.sync", ...)`  

### H-8 同步 outbox 用陈旧 payload 重试，可复活已删数据

- `sync_outbox.js` 长退避重试原始包  
- 用户删除后旧 outbox 成功 → 远端复活 → 下次 pull 拉回  
- **修复**：重试前用当前库重打包；丢弃早于最近成功 tombstone 的任务  

### H-9 macOS AutoFill 在 domains 为空时返回全部账号

- `PassSharedAccountRepository.swift:38-44`  
- `.app` 类型标识被丢弃（`AutoFill...swift:99-100`）→ 选择器枚举用户名+站点  
- **修复**：空 domains = 无匹配  

### H-10 设备名字段未 escape 插入 `innerHTML`

- `popup.js:1331-1340`、`options.js:4144-4153`  
- 其它列表路径已用 `escapeHtml`，编辑器元数据遗漏  
- MV3 默认 CSP 限制脚本执行，仍可 UI 伪造；CSP 一旦放松即 XSS  

### H-11 CSV 公式注入（主题 A）— High  

### H-12 剪贴板不清空（主题 E）— High（含同步密钥）  

### H-13 eTLD+1 错并（主题 C）— High（填充错配）  

### H-14 macOS 主密码盐使用 `UInt8.random`

- `AppLockStore.swift:206`  
- 应 `SecRandomCopyBytes` / `SymmetricKey`  

### H-15 `PassSharedFileSecretStore` 临时文件名未插值

- `PassSharedFileSecretStore.swift:21-23`：  
  `".(fileName).(UUID().uuidString).tmp"` **字面量**，并发写同一路径可撕裂密钥/凭据文件  
- **修复**：`".\(fileName).\(UUID().uuidString).tmp"`  

### H-16 FFI / 扩展 / macOS CSV 明文导出权限与公式（主题 A）  

### H-17 密码/同步密钥 UI 常以 `type=text` 展示

- `options.html` 同步密钥输入；肩窥/录屏风险  

### H-18 扩展 history id 仍 `Math.random` 回退（主题 B）  

### H-19 macOS `newerField` 与 JS 合并核心不一致，同步可清空密码/TOTP

- **文件**：`AccountStore.swift` 字段合并（约 L5172+）；对照 `sync_merge_core.js:41-74`  
- **问题**：JS 在字段时钟打平时优先保留非空值；Swift 在 `lhsUpdatedAt == rhsUpdatedAt` 时先比 account 时钟，**缺少**“空值不覆盖非空凭据”的对称保护。  
- **失败场景**：一端只改 note 推高 `updatedAtMs`，字段时钟缺省/并列 → 合并后密码被空串覆盖并推到全设备。  
- **修复**：Swift 与 `sync_merge_core.js` 对齐 + 跨端 golden 单测。  
- **置信度**：Confirmed  

### H-20 WebAuthn bridge `postMessage(..., "*")` + 弱 requestId

- **文件**：`webauthn_injected.js:157-217`；`content.js:735-746`  
- **问题**：MAIN world 与 content 用固定 `source` 字段 + `"*"` 目标域；`requestId` 混用 `Math.random()`。同页脚本可窃听/干扰/伪造响应。  
- **修复**：`postMessage` 限 `window.location.origin` 或改 runtime port；requestId 用 `crypto.randomUUID()`。  

### H-21 服务端已有 state 时缺少 `If-Match` 仍允许 PUT（CAS 可绕过）

- **文件**：`pass_sync_server.py:994-996` `etag_matches`：`if_match` 空则 `return True`  
- **对照**：`docs/sync-protocol-v2.md` 要求更新已有 state 必须带 If-Match  
- **失败场景**：恶意/过期客户端对已有 scope 无条件覆盖最新保险库，无 412。  
- **修复**：`current is not None` 且缺 If-Match → 428/412；仅首写允许空 If-Match。  

### H-22 全部站点 tombstone 后回退 `primary.sites` 复活域名

- **文件**：`sync_merge_core.js:304`：`sites: mergedSites.length > 0 ? mergedSites : primary.sites`  
- **失败场景**：用户删光某账号站点别名 → 合并后站点列表从 `primary.sites` 复活。  
- **修复**：固定 `sites: mergedSites`（允许空）；旧数据在 normalize 时物化为 states。  

### H-23 幂等重放可返回陈旧 ETag，掩盖并发推进

- **文件**：`pass_sync_server.py` 幂等命中路径（约 L270–296）  
- **失败场景**：A 写入后 B 推进 etag；A 重试同 Idempotency-Key → 200 + 旧 etag，客户端状态机漂移。  
- **修复**：重放前比对当前 etag，不一致返回 409/412。  

---

## 5. Medium 发现（精选）

| ID | 摘要 | 位置 |
|----|------|------|
| M-1 | v1 主密码摘要单次 SHA-256，仅解锁时升级 | `lock_crypto.js` / macOS legacy |
| M-2 | `readCollection` 见明文 array 即重写加密行；可被植入空库 | `data_store.js:74-76` |
| M-3 | `assertRpIdAllowedForHost` 过宽，可能接受过短公共后缀 | `passkey_store.js:498+` |
| M-4 | passkey `signCount` 非事务自增 | `passkey_store.js:374-392` |
| M-5 | WebAuthn MAIN world 注入 + `postMessage` 目标域需收紧 | `webauthn_injected.js` |
| M-6 | 硬编码 `"ChromeMac"` 设备名污染合并并列 | `sync_merge_core.js` 多处 |
| M-7 | `*UpdatedAtMs` 无上界，恶意时钟永久霸权 | schema + merge |
| M-8 | Rust HLC 无 tick/receive/溢出 | `domain` |
| M-9 | 服务器 token 比较非恒时；单 token 多设备无隔离 | `pass_sync_server.py` |
| M-10 | OPTIONS / 限流边角、审计表无限增长、幂等重放与 If-Match 交互 | server |
| M-11 | 多进程部署时进程内锁无效 | server README 假设单进程 |
| M-12 | macOS 未监听锁屏/睡眠自动锁（除非 onBackground） | `AppLockStore` |
| M-13 | TOTP 密钥进 DOM `data-*` | popup/options |
| M-14 | 默认自建服务器 URL 写死 `uk.sbbz.tech:5443` | `background.js:86` |
| M-15 | Rust storage 仅 embed SQL 字符串，无运行时引擎 | `storage/src/lib.rs` |
| M-16 | Flutter/Tauri 多副本演示 + 明文落盘 + demo 与真库混用 | `apps/*-tauri`、`*flutter` |
| M-17 | Tauri `innerHTML` XSS + `csp: null` | `codex-tauri`/`copilot-53-tauri` `main.js` / `tauri.conf.json` |
| M-18 | `AccountStore.swift` 上帝对象，同步/导入/合并/UI 耦合 | 维护性/回归风险 |
| M-19 | 扩展 `host_permissions: <all_urls>` + clipboardRead 权限面大 | `manifest.json` |
| M-20 | 文档幽灵模块（sync_agent_desktop / crypto crate / 五端 Flutter） | README + docs |
| M-21 | `.gitignore` 过窄，构建产物/二进制易入库 | 根 `.gitignore`、`app_macos/dist` 等 |
| M-22 | deploy healthcheck `curl --insecure` | `.github/workflows/deploy-sync-server.yml` |

---

## 6. Low / 工程卫生

- 仓库根存在 `codex-Flutter-RustFFI`、`copilot-Claude-flutter` 与 `apps/` 下重复实验树，易误导贡献者。  
- `.gradle` lock 文件出现在 git status（构建产物噪音）。  
- README 称 Rust core“共享核心已初始化”，但客户端未 FFI 接入合并/存储。  
- 演示客户端 `generate_demo_accounts` 不应与生产包混淆发布。  
- 部分日志 `console.info` 可能带 rpId/username（一般不含密码，仍需注意）。  
- CI 覆盖 extension tests / server / rust / `swift build`，**无 macOS 逻辑单元测试、无 passkey 对抗测试、无填充域名校验测试**。

---

## 7. 已修复或已缓解项（本轮复验）

以下在当前主干**不应再按 Critical 开新单**（除非回归）：

1. **跨扩展消息来源**：`isTrustedExtensionMessageSender` 强制 `sender.id === runtime.id`。  
2. **同步幂等键 CSPRNG**：`createSyncIdempotencyKey` 无安全随机则抛错。  
3. **远程同步强制加密密钥**：`encryptSyncBundleDocument` / macOS encrypt 空密钥失败；配置密钥后拒绝明文包。  
4. **服务器读超时与并发槽**：`client_timeout_seconds`、`max_concurrent_requests`。  
5. **版本路径 ASCII 数字解析**：`parse_ascii_decimal`。  
6. **macOS 手动同步防重入**：`syncNowTask`。  
7. **扩展侧合并/加密/消息安全单测**：`apps/extension_shared/tests/*` 质量较好（尤其 merge golden 与 data_store 包装）。  

---

## 8. 测试与 CI 评估

| 区域 | 覆盖 | 缺口 |
|------|------|------|
| 扩展 merge/crypto/outbox/data_store | 较强 | 无 passkey 选择器、无 fill 域名、无消息锁竞态 |
| 同步服务器 unittest | 有 | 慢速客户端、多进程 CAS、purge 启动路径 |
| Rust | 极薄单元测试 | 无 FFI 内存/并发、无与 JS golden 对齐 |
| macOS | 仅 `swift build` | 无业务单测；AccountStore 不可测性高 |
| e2e scripts | 有基础 | 未覆盖 passkey/填充攻击路径 |
| Flutter/Tauri | 基本无安全测试 | — |

CI（`.github/workflows/ci.yml`）对主路径有门禁；deploy workflow 含健康检查回滚，方向正确。

---

## 9. 子系统简评

### 9.1 浏览器扩展

**优点**：IndexedDB AES-GCM + 主密码包裹 v3、同步强制 E2E、outbox、safety snapshot、消息来源校验、merge 单测。  
**致命短板**：软件 passkey 模型、填充信任边界、锁定非全局、内容脚本全库密码。

### 9.2 macOS App

**优点**：功能完整（回收站、别名、同步 CAS 重试、导入导出、AutoFill 集成）、同步密钥配置门禁、并发同步门闩。  
**致命短板**：AppLock 不保护数据平面；DB 密钥文件化；AutoFill 无锁；巨型 `AccountStore`。

### 9.3 同步服务器

**优点**：零依赖可部署、ETag/CAS、幂等、版本与审计、限流、TLS 配置、默认拒明文。  
**短板**：启动 purge、token 模型粗糙、单进程假设、审计可归因性弱。

### 9.4 Rust core

**定位应改为**：协议草稿 / 未来 FFI，而非“当前共享核心”。  
**风险**：文档与 README 过度承诺；FFI 字符串 API 有 UB 面；CSV 无公式防护。

### 9.5 Flutter / Tauri（均不可生产）

| 客户端 | 问题摘要 |
|--------|----------|
| `app_flutter` | 明文 `state.json`；非五端（仅 linux/windows）；无 FFI/锁/同步 |
| `copilot-Claude-flutter` | 内存态演示，关应用即丢 |
| `copilot-53-flutter` | 明文 `~/.passkey/*.json`；Windows 误用 `HOME`；搜索含密码/TOTP；`Random()` 非 CSPRNG |
| `codex-tauri` / `copilot-53-tauri` | 近乎克隆；SQLite 存明文密码 JSON；`innerHTML` 拼接用户名/站点 + `csp: null` → XSS 可导出整库 |

共性：**演示入口与真实持久化路径混用**（生成 demo 账号写入同一库）。与文档中的 SQLCipher/Argon2/`pass_core` 完全脱节。全部应标记 **demo-only**，生产构建 strip demo，禁止接真实同步密钥。

**附加 High**：Tauri `src/main.js` 的 `innerHTML` 未转义 + `tauri.conf.json` `"csp": null`；`copilot-53-flutter` 在 Windows 上数据目录错误。

### 9.6 文档 / 仓库卫生

- README / 架构图仍列 **`sync_agent_desktop`、`adapters/`、`crypto` crate** 等**不存在**路径；`app_flutter` 被写成“五端”与事实不符。  
- 实现参考文档（`docs/current-app-extension-implementation-reference-zh.md`）相对诚实，与根 README 的“可构建 monorepo”叙事双轨。  
- `.gitignore` 过窄：`.gradle`、`dist/`、macOS 打包二进制等易入库。  
- 根目录与 `apps/` 重复实验树（`codex-Flutter-RustFFI`、`copilot-Claude-flutter`）增加选型噪音。  
- CI 不覆盖 Flutter/Tauri；deploy 健康检查使用 `curl --insecure`。

---

## 10. 修复优先级路线图

### P0（立刻，阻断高价值使用）

1. 关闭或重做软件 passkey：禁止 `extractable` 私钥同步；选择器移出页面 DOM。  
2. `handleFillActiveTab` 强制域名匹配；全部账号模式禁用跨域填充。  
3. 扩展：禁止裸数据密钥；读路径禁止铸钥。  
4. macOS：AppLock 绑定数据密钥或至少锁时清内存 + AutoFill 认证；修临时文件名插值。  
5. 备份脚本停止拷贝裸 `pass-db-key-v1`（或再加密）。  
6. 服务器：purge 显式 opt-in + 备份；**强制已有 state 必须 If-Match**；幂等重放校验当前 etag。  

### P1（一周内）

7. 内容脚本改为无密码 CHECK API。  
8. 扩展同步 `navigator.locks` + outbox 刷新。  
9. CSV 三处公式转义；剪贴板自动清空。  
10. eTLD 换 PSL；站点 tombstone 不再回退 `primary.sites`；Swift/JS `newerField` 对齐。  
11. 设备名 `escapeHtml`；主密码盐 CSPRNG。  
12. 同步信封 AAD + 水位防重放；合并 identity 改为 recordId 优先两阶段。  

### P2（架构还债）

13. 合并内核单一化（删 Rust merge 或 FFI 统一）+ 跨端 golden vectors。  
14. 拆分 `AccountStore.swift` / `options.js`。  
15. 收敛演示客户端与文档状态声明。  
16. 补 passkey/填充/锁 的对抗测试与 macOS 单测。  

---

## 11. 严重度明细索引（便于开 issue）

| ID | 级别 | 一句话 |
|----|------|--------|
| C-1 | Critical | 可导出可同步软件 passkey |
| C-2 | Critical | 页面 DOM 选择器可静默签断言 |
| C-3 | Critical | 填充不校验域名 |
| C-4 | Critical | 明文数据密钥 + 读路径铸钥 |
| C-5 | Critical | 锁非全局 |
| C-6 | Critical | macOS 锁 UI 化 + AutoFill 旁路 |
| C-7 | Critical | JS/Rust 合并双轨 |
| C-8 | Critical | FFI last_error UAF |
| C-9 | Critical | 备份含裸密钥 |
| C-10 | Critical | 服务启动静默删 payload |
| H-1…H-18 | High | 见第 4 节 |
| M-* | Medium | 见第 5 节 |

---

## 12. 审查方法说明与局限

- **做了什么**：通读/精读上述主路径源码；用检索交叉验证消息总线、加密、合并、填充、AutoFill、服务器 CAS；对照既有报告做“仍成立/已修复”判定；查看 CI 与测试清单。  
- **没做什么**：未运行动态 exploit、未对真实部署做渗透、未完整阅读 6500 行 AccountStore 每一分支、未审计 Android provider 细节。  
- **置信度标注**：Confirmed = 源码路径闭合可论证；Plausible = 依赖配置/竞态窗口。  

---

## 13. 结语

项目在**同步协议工程**（ETag、幂等、安全快照、强制 E2E 信封、扩展单测）上表现出认真迭代；若干历史 Critical（跨扩展消息、明文同步、服务器慢速读）已在主干缓解。

但作为密码管理器，当前仍有**产品级安全模型错误**：把 passkey 做成可同步软件密钥、把“锁”做成 UI、把数据密钥与密文同放、把填充信任交给用户不点错。这些问题不修复前，不建议将本仓库默认配置用于存放高价值主密码库。

建议下一阶段以 **P0 清单** 为发布门禁，并单独开一轮“passkey 去 shim / 数据密钥信封化 / 填充信任边界”专项设计评审。
