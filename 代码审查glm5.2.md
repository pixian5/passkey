# Pass 跨平台密码管理器 — 代码审查报告

> 审查日期：2026-07-18 ~ 2026-07-19
> 审查模型：GLM-5.2-think
> 审查方法：基于源码静态阅读 + 对抗式安全分析（adversarial review），按子系统并行展开，逐条核实文件:行号
> 审查范围：Python 同步服务、Rust 核心 6 crate + FFI、浏览器扩展（共享层 + Chrome/Firefox/Safari）、macOS Swift 应用、Python 审计/备份脚本、同步协议契约与 Schema、测试用例

---

## 0. 执行摘要

项目是一个跨平台密码管理器 monorepo，覆盖 macOS / Windows / Linux / iOS / Android 客户端及 Chrome / Firefox / Safari 扩展，核心同步已在 macOS App、浏览器扩展与 Ubuntu 服务之间落地。

审查发现的问题集中在几个系统性主题上，而非零散 bug：

1. **WebAuthn 通行密钥被实现为可导出软件 shim**：扩展用 `extractable:true` 生成私钥、导出为 JWK、存入 IndexedDB 并同步到远程服务器。这破坏了 WebAuthn"私钥不可导出"的根本安全承诺，使通行密钥退化为"可同步的存储密码"。
2. **"端到端加密"在多个客户端可被静默降级为明文**：扩展、macOS App 都存在"空密钥即明文上传"或"明文包探测短路"路径，恶意/被攻陷的同步服务器可向保险库注入伪造账号。
3. **浏览器扩展的跨扩展消息总线无来源校验**：任何已安装扩展可调用 Pass 的 `onMessage`，直接读取整个保险库明文或静默签署通行密钥断言。
4. **扩展运行时锁并非真正强制**：明文数据密钥落盘 `chrome.storage.local`；锁定后非 SW 上下文仍持有可用 CryptoKey；自动锁仅在轮询时才触发。
5. **JS 合并内核与 Rust 合并内核语义不一致，且 Rust 内核是死代码**：两者在排序原语（墙钟 vs HLC）、删除冲突处理、时间区间重叠判定上均不同，存在导致跨端数据损坏/密码复活的风险。
6. **密钥与密文同址存储**：扩展 `chrome.storage.local`、macOS app-group 容器、Python 备份脚本均将数据库密钥与密文放在同一可读位置，使"加密落盘"在本地攻击者面前形同虚设。
7. **CSV 公式注入**在三个独立代码路径（Rust FFI 导出、扩展 options.js、macOS AccountStore）同时存在。
8. **同步服务器存在慢速 DoS**（无读超时 + 无线程上限），以及 Unicode 数字 `int()` 解析导致的 500/路径混淆。

共发现 **11 个严重 (Critical)**、**23 个高危 (High)**、**约 30 个中危 (Medium)**、**约 25 个低危 (Low)** 问题，外加 9 处测试覆盖缺口。下文按"横向主题 → 分级详述 → 测试缺口 → 修复优先级"组织。

---

## 1. 审查范围与方法

### 1.1 审阅文件清单（全部使用 Read 工具逐行核对行号）

**Python 同步服务**
- [apps/sync_server_ubuntu/pass_sync_server.py](apps/sync_server_ubuntu/pass_sync_server.py) (1050 行)
- apps/sync_server_ubuntu/tests/test_server.py、README.md、start.sh、backup_sync_db.sh、systemd unit

**Rust 核心 + FFI + 协议契约**
- [core/pass_core/js/sync_merge_core.js](core/pass_core/js/sync_merge_core.js) (642 行)
- [core/pass_core/js/credential_exchange_cxf.js](core/pass_core/js/credential_exchange_cxf.js) (423 行)
- core/pass_core/crates/{domain,merge,transport,csvio,storage,ffi}/src/lib.rs
- core/pass_core/crates/storage/migrations/0001_initial.sql
- docs/schemas/*.schema.json、docs/sync-golden-vectors.json、docs/sync-protocol-v2.md、docs/sync-protocol-contract-zh.md

**浏览器扩展共享层**
- [apps/extension_shared/background.js](apps/extension_shared/background.js) (1856 行)
- [apps/extension_shared/content.js](apps/extension_shared/content.js) (747 行)
- [apps/extension_shared/webauthn_injected.js](apps/extension_shared/webauthn_injected.js) (671 行)
- [apps/extension_shared/data_store.js](apps/extension_shared/data_store.js) (639 行)
- [apps/extension_shared/passkey_store.js](apps/extension_shared/passkey_store.js) (886 行)
- apps/extension_shared/{lock_crypto,sync_crypto,account_core,sync_outbox,options,popup}.js
- apps/extension_shared/manifest.json、popup.html、options.html

**macOS Swift 应用**
- apps/app_macos/Sources/app_macos/*.swift（16 个文件）
- apps/app_macos/Sources/shared/*.swift（4 个文件）
- apps/app_macos/AutofillExtension/AutoFillCredentialProviderViewController.swift
- apps/app_macos/Package.swift、entitlements

**Python 审计/备份脚本**
- [scripts/audit_sync_data.py](scripts/audit_sync_data.py)、scripts/backup_and_verify_local.py、scripts/verify_local_backup.py
- scripts/tests/test_{audit_sync_data,verify_local_backup,sync_e2e}.py

### 1.2 方法

每个子系统由一个独立的对抗式审查 agent 深读全部源码并按"严重程度 / 文件:行 / 标题 / 失败场景 / 修复建议 / 置信度"输出。本报告汇总去重，并将跨子系统复现的同类问题归入"横向主题"，避免重复但保留每个 file:line。

---

## 2. 严重程度统计

| 严重程度 | 数量 | 主要分布 |
|---|---|---|
| Critical | 11 | 扩展运行时(5)、扩展加密(2)、合并内核(2)、macOS(1)、脚本(1) |
| High | 23 | 合并内核(5)、扩展(6)、macOS(6)、同步服务器(2)、UI(4) |
| Medium | ~30 | 各子系统均有分布 |
| Low | ~25 | 各子系统均有分布 |
| 测试缺口 | 9 | 主要在 scripts 与合并内核 |

---

## 3. 横向主题（跨子系统复现的同类问题）

### 主题 A — CSV 公式注入（三处独立实现，均缺失）

任何以 `= + - @` Tab/CR 开头的字段值，在被用户用 Excel/Numbers/LibreOffice 打开时会作为公式执行（DDE RCE 或 `=HYPERLINK` 外泄）。

| 位置 | 现状 |
|---|---|
| [core/pass_core/crates/ffi/src/lib.rs:88-90](core/pass_core/crates/ffi/src/lib.rs#L88) `escape_csv` | 仅 `"` 包裹 + 转义内嵌引号 |
| [apps/extension_shared/options.js:2326-2328](apps/extension_shared/options.js#L2326) `csvEscape` | 同上，导出与导入往返均不处理 |
| [apps/app_macos/Sources/app_macos/AccountStore.swift:5279-5281](apps/app_macos/Sources/app_macos/AccountStore.swift#L5279) `csvEscaped` | 同上，且不处理 `\r` 行终止符 |

**统一修复**：对首字符 ∈ `{= + - @ \t \r}` 的单元格，导出时前缀单引号 `'`（RFC 4180 兼容）或 Tab，导入时反向剥离。三处保持一致。

### 主题 B — 安全相关标识符使用 `Math.random()` 退化分支

`crypto.randomUUID` 缺失时回退到 `Date.now() + Math.random()`，非 CSPRNG，导致幂等键/设备 ID/通行密钥请求 ID 可预测。

| 位置 | 影响 |
|---|---|
| [data_store.js:633](apps/extension_shared/data_store.js#L633) | 历史条目 ID |
| [background.js:1638](apps/extension_shared/background.js#L1638) / [options.js:1985](apps/extension_shared/options.js#L1985) | 同步幂等键（可被服务器观察 → 预测 → 去重丢数据） |
| [background.js:1555](apps/extension_shared/background.js#L1555) / [options.js:4534](apps/extension_shared/options.js#L4534) | syncDeviceId 回退（用于未认证的 source.deviceId） |
| [webauthn_injected.js:158](apps/extension_shared/webauthn_injected.js#L158) | WebAuthn 请求 ID |
| [credential_exchange_cxf.js:421-423](core/pass_core/js/credential_exchange_cxf.js#L421) | CXP 项 ID |

**统一修复**：`crypto.getRandomValues(new Uint8Array(16))` 格式化为 UUID；彻底移除安全路径中的 `Math.random()`。

### 主题 C — eTLD+1 仅硬编码 7 条后缀

`account_core.js:1-9` 的 `ETLD2_SUFFIXES` 只含 `com.cn/net.cn/org.cn/gov.cn/edu.cn/co.uk/org.uk`。导致 `foo.github.io` 与 `bar.github.io`、两个无关 S3 桶 `*.s3.amazonaws.com`、`bank.co.jp` 与 `evil.co.jp` 被合并为同一别名组，自动填充跨域错配。该函数同时被扩展 [background.js:1851](apps/extension_shared/background.js#L1851)（`accountMatchesDomain`）、[popup.js:2021](apps/extension_shared/popup.js#L2021)（`isAccountMatchCurrentDomain`）、macOS `DomainUtils` 消费。

**统一修复**：内置真实 Public Suffix List（`tldts`/`psl`）或大幅扩充多标签 eTLD 列表；最严格时直接要求 registrable-domain 完全相等。

### 主题 D — 数据库密钥与密文同址存储（本地"加密落盘"失效）

| 子系统 | 位置 | 现状 |
|---|---|---|
| 扩展 | [data_store.js:133-147,195-203](apps/extension_shared/data_store.js#L133) | 明文数据密钥写入 `chrome.storage.local`；读路径缺密钥时静默生成新明文密钥 |
| macOS | [PassSharedCrypto.swift:62-100](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L62) | `pass-db-key-v1` 为 32 字节 0600 明文，存于 host + AutoFill 共享的 app-group 容器 |
| 备份脚本 | [backup_and_verify_local.py:21-24](scripts/backup_and_verify_local.py#L21) | 将 `pass-db-key-v1` 原样拷入备份目录紧邻加密 DB |

**统一修复**：用主密码派生（Argon2id/PBKDF2）或信封加密包裹文件密钥；禁止裸密钥落盘；备份不得携带裸密钥。

### 主题 E — 剪贴板永不自动清空

| 位置 | 复制内容 |
|---|---|
| [popup.js:874-884](apps/extension_shared/popup.js#L874) | 主密码 |
| popup.js:2361 / options.js:5523 | TOTP 动态码 |
| [ContentView.swift:1386-1391](apps/app_macos/Sources/app_macos/ContentView.swift#L1386) | 密码/TOTP/恢复码 |
| [AccountStore.swift:5059-5072](apps/app_macos/Sources/app_macos/AccountStore.swift#L5059) | 256 位同步加密密钥 |

**统一修复**：写入剪贴板后 15~30s 清空（保留原内容并在超时后恢复以兼顾 UX）。

### 主题 F — JS 合并内核 ↔ Rust 合并内核语义不一致

详见 C-9 与下文交叉表。这是数据完整性层面的最高风险区。

---

## 4. 严重 (Critical) 发现

### C-1 任何已安装扩展可通过 `chrome.runtime.onMessage` 读取全部保险库明文 / 静默签署通行密钥

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/background.js:633-689](apps/extension_shared/background.js#L633)（onMessage 入口，未校验 `sender.id`）；敏感消息类型集合 [background.js:98-104](apps/extension_shared/background.js#L98)
- **标题**：运行时消息总线无来源校验
- **失败场景**：在 MV3 中，任何其他扩展可调用 `chrome.runtime.sendMessage(<Pass-id>, {type:"PASS_CONTENT_GET_ACCOUNTS"})`。处理器从不校验 `sender.id === chrome.runtime.id`，对每个站点返回全部账号及明文密码（`handleContentGetAccounts` 返回 `password: String(account?.password || "")`，不按来源站点过滤）。攻击扩展直接获得整个保险库。更进一步，攻击扩展可发起 `PASS_PASSKEY_OPERATION`，`payload={operation:"get", origin:"https://github.com", host:"github.com", publicKey:{rpId:"github.com", challenge:<攻击者challenge>, allowCredentials:[...]}}`，背景脚本只校验 `assertSecureOrigin`/`assertRpIdAllowedForHost`（均通过），然后调用 `getManagedAssertion` 用用户存储的 github.com 私钥签署攻击者提供的 challenge 并返回断言，完全绕过 `content.js` 中的选择器 UI。攻击者将断言转发到 github.com 即可冒充用户登录。
- **修复建议**：在 `onMessage` 入口拒绝 `sender.id !== chrome.runtime.id` 的消息；对页面来源的敏感请求，额外要求 `sender.tab` 且 `new URL(sender.tab.url).origin === message.payload.origin`。对所有直接调用 `PASS_PASSKEY_OPERATION` 的请求要求其必须源自与 `payload.origin` 匹配的本扩展内容脚本。
- **置信度**：Confirmed

### C-2 WebAuthn 通行密钥被实现为可导出、可远程同步的软件 shim

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/passkey_store.js:152-155](apps/extension_shared/passkey_store.js#L152)（`generateManagedKeyPair` 用 `extractable:true` + `exportKey("jwk", privateKey)`）；持久化 [:187-201](apps/extension_shared/passkey_store.js#L187)；签名时导入 [:688-705](apps/extension_shared/passkey_store.js#L688)；同步序列化 [background.js:1361-1374](apps/extension_shared/background.js#L1361)；经 `pushRemotePayload` 上传 [background.js:1641-1687](apps/extension_shared/background.js#L1641)
- **标题**：通行密钥私钥可导出并随同步包远程传播
- **失败场景**：WebAuthn 的核心价值是私钥绑定硬件认证器且**不可导出**。本扩展用 `crypto.subtle.generateKey(..., true, ["sign","verify"])` 生成密钥，导出为 JWK，存入 IndexedDB 并通过 `buildSyncBundleFromPayload` 加密上传至 WebDAV/自建服务器。任何掌握同步加密密钥（其本身位于 `chrome.storage.local` 且经 `migrateLegacySyncSecrets` 轮换）与远程包副本的攻击者，可获得所有站点的通行密钥私钥，无任何硬件屏障。该"通行密钥"实质等同于存储型密码。依赖方看到 `fmt:"none"` 与 `authenticatorAttachment:"platform"` 会相信用户拥有硬件级平台认证器，可能放松其它防御（如跳过二次密码）。
- **修复建议**：以 `extractable:false` 生成密钥，永不调用 `exportKey`，用 `crypto.subtle.wrapKey` 加单独的 per-passkey 包裹密钥存储，仅在签名时解包为不可导出 CryptoKey 并即用即清。不跨设备同步私钥，只同步 credentialId/userHandle 元数据，要求每设备重新注册。更优解：停止覆盖 `navigator.credentials.create/get`，让浏览器真实平台认证器处理通行密钥，扩展仅负责密码填充与通行密钥-账号链接元数据。
- **置信度**：Confirmed

### C-3 通行密钥 `get`（断言签署）无真实用户在场/用户验证门禁，页面可自动点击选择器

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/passkey_store.js:345-422](apps/extension_shared/passkey_store.js#L345)（`getManagedAssertion` 直接签署，无确认）；[apps/extension_shared/content.js:438-498](apps/extension_shared/content.js#L438)（选择器注入到共享 DOM）；[apps/extension_shared/content.js:593-712](apps/extension_shared/content.js#L593)（选择器为普通 `<button>`，页面可 `.click()`）
- **标题**：静默断言签署 / 选择器可被合成 DOM 点击绕过
- **失败场景**：恶意页面 `evil.com`（用户有 evil.com 通行密钥）调用 `navigator.credentials.get({publicKey:{rpId:"evil.com", challenge:<攻击者>, ...}})`。`webauthn_injected.js` 转发至 `content.js`，选择器以普通 `<button>` 追加到 `document.documentElement`。**选择器位于共享 DOM**，页面可 `setTimeout(()=>document.querySelector('#pass-passkey-chooser button').click(), 50)`。`HTMLElement.click()` 被 DOM 视为可信事件，内容脚本监听器触发 `cleanup(credentialId)` → `sendPasskeyBridgeOperation` 回调背景 `get` → 用存储私钥签署攻击者 challenge 并返回有效断言。页面在无用户手势、无生物识别、无用户实际看到确认对话框的情况下获得 `evil.com` 的已签署 WebAuthn 断言。`create` 路径同样可被自动点击，允许静默向用户保险库注册凭据。WebAuthn 的 user-verification 正是为阻止静默断言而存在，本实现仅以 DOM 可点击按钮为门禁。
- **修复建议**：选择器改为扩展 popup 或独立窗口 `chrome.windows.create({type:"popup"})`，而非页面 DOM。仅在经 popup 内真实用户手势的 `chrome.runtime.sendMessage` 往返后才签署。`create` 持久化前显式确认。即使加 `event.isTrusted && event.detail>0` 也仍不足（`.click()` 仍是 trusted），popup 才是真正修复。
- **置信度**：Confirmed

### C-4 `PASS_FILL_ACTIVE_TAB` 不校验当前标签页域名与被填充账号匹配

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/background.js:860-873](apps/extension_shared/background.js#L860)（`handleFillActiveTab` 无域名校验直接注入）；填充实现 [:1751-1804](apps/extension_shared/background.js#L1751) `fillCredentialInPage`；popup 全部账号模式 [popup.js:1831-1842](apps/extension_shared/popup.js#L1831) 与 [:938-946](apps/extension_shared/popup.js#L938) 绕过 `isAccountMatchCurrentDomain`；域名匹配用 eTLD+1（见主题 C）
- **标题**：自动填充向任意活动标签页注入任意账号凭据
- **失败场景**：用户在 `evil.com` 打开 popup，"全部账号"模式列出所有账号（不论域名）。用户误点 `bank.com` 账号的"填充当前页"。`fillCurrentPage` 发送 `{username,password}` 到背景；`handleFillActiveTab` 取 `chrome.tabs.query({active:true,currentWindow:true})`（即 `evil.com` 标签），经 `fillCredentialInPage` 将 bank.com 用户名/密码写入 evil.com 的 DOM。evil.com 从自身表单字段读取注入值（或经 input/paste 监听）外泄。扩展从未校验 `activeTab.url` 的 host 是否匹配 `account.sites`。一次误点 = 全凭据泄露。
- **修复建议**：`handleFillActiveTab` 按 id 从存储查账号（而非接受调用方自由传入 username/password），要求 `accountMatchesDomain(account, new URL(activeTab.url).hostname)`，否则拒绝。popup 在"全部账号"模式下对非当前域账号不显示填充按钮。
- **置信度**：Confirmed

### C-5 扩展明文数据加密密钥持久化于 `chrome.storage.local`，且读路径缺密钥时静默生成新明文密钥

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/data_store.js:133-147](apps/extension_shared/data_store.js#L133)（`loadOrCreateEncryptionKey`）与 [:195-203](apps/extension_shared/data_store.js#L195)（`disableDataEncryption`）
- **标题**：明文数据密钥落盘 + 读路径自我铸造
- **失败场景**：`loadOrCreateEncryptionKey()` 顺序为：① 会话密钥（解锁时存在）→ 用之；② 否则若存在 wrapped key → 抛"locked"；③ 否则读 `STORAGE_KEY_ENCRYPTION_KEY`（明文密钥），**缺失或非 32 字节则生成新随机密钥并写回 `chrome.storage.local` 明文**。两条致命路径：(a) `disableDataEncryption()` 显式写裸密钥并移除 wrapped key，从此保险库被一个紧邻它的明文密钥加密，任何可读 `chrome.storage.local` 的代码（同 profile 的恶意伴随扩展、`<all_urls>` 内容脚本、磁盘访问者）无需主密码即可解密全部密码，"锁"形同虚设；(b) `readCollection()` 每次触碰 IndexedDB 都调用此函数，若 wrapped key 因任何原因缺失（异常、未来迁移），函数会**静默铸造新明文密钥、覆盖存储、用新密钥再加密**，先前用真实主密码派生密钥加密的行变为不可读——`readCollection` 仅对 `COLLECTION_HISTORY` 捕获此异常，`COLLECTION_ACCOUNTS` 直接抛错，用户被锁出自身保险库。读路径铸造密钥本身即 Bug。
- **修复建议**：永不将裸数据密钥写入 `chrome.storage.local`，移除 `STORAGE_KEY_ENCRYPTION_KEY` 写入；读路径永不铸造新密钥，会话密钥与 wrapped key 均缺失时直接抛"locked"。`disableDataEncryption` 若真要"禁用加密"则将保险库以明文 IndexedDB 行存储，而非把密钥留置密文旁。
- **置信度**：Confirmed

### C-6 扩展锁按上下文隔离，非 SW 上下文在 SW 自动锁后仍持有可用 CryptoKey

- **严重程度**：Critical
- **文件:行**：[apps/extension_shared/data_store.js:43,124-147,190-193](apps/extension_shared/data_store.js#L43)（模块级 `unlockedEncryptionKey` 缓存）；自动锁 [background.js:711-757](apps/extension_shared/background.js#L711)
- **标题**：锁状态非全局；SW 自动锁后 options/popup 仍可解密
- **失败场景**：`loadOrCreateEncryptionKey()` 模块级 `let unlockedEncryptionKey` 在每个扩展上下文（background SW、options 页、popup）各自独立。SW 调用 `lockDataEncryption()` 清除会话密钥与自身缓存；但 options 页在其自己的 JS realm 仍持有 `unlockedEncryptionKey` 为活 CryptoKey，且 `broadcastLockState(true)` 仅更新状态标志，不清缓存。自动锁触发后，popup 经 broadcast 显示"已锁定"，但 options 页仍可调用 `getAccounts()` 解密保险库。本地攻击者（肩窥+点击）或可向 options 页发消息的恶意内容脚本，在用户认为已锁定后仍可提取明文。此外空闲超时锁（[:711](apps/extension_shared/background.js#L711)）仅在 `getBackgroundLockStatus` 被轮询时才评估，无人轮询则永不自动锁。
- **修复建议**：以 `chrome.storage.session` 为唯一真相源，每次调用重新派生而非跨请求缓存；或在 `broadcastLockState(true)` 时令每个上下文本地调用 `lockDataEncryption()` 清缓存。用 `chrome.alarms` 周期触发自动锁评估。
- **置信度**：Confirmed（C-6 的缓存部分）+ Plausible（取决于各上下文是否分别解锁）

### C-7 macOS AppLock 纯 UI 门禁；保险库密钥在 app-group 容器明文落盘；AutoFill 扩展绕过锁

- **严重程度**：Critical
- **文件:行**：[apps/app_macos/Sources/app_macos/AppLockStore.swift:114-121](apps/app_macos/Sources/app_macos/AppLockStore.swift#L114)（锁仅翻转 `isLocked`）；[AppLockGateView.swift:10-22](apps/app_macos/Sources/app_macos/AppLockGateView.swift#L10)（门禁仅 `.disabled().blur(3)`）；[PassSharedCrypto.swift:62-100](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L62)（密钥以 0600 明文存于共享 app-group 容器）；[PassSharedAccountRepository.swift:5-25,33-58](apps/app_macos/Sources/shared/PassSharedAccountRepository.swift#L5)；[AutoFillCredentialProviderViewController.swift:29-39](apps/app_macos/AutofillExtension/AutoFillCredentialProviderViewController.swift#L29)
- **标题**：AppLock 是 UI 门禁，加密密钥与 AutoFill 共享且锁不强制
- **失败场景**：`loadOrCreateKey()` 将 AES-GCM 数据库密钥以 `pass-db-key-v1`（32 字节明文 0600）写入 host 与 AutoFill 扩展均可读的 app-group 容器（`group.com.pass.desktop.shared`）。`LocalSQLiteStore.readData` 读行时透明调用 `PassSharedCrypto.decrypt`，无需认证即可获密钥。AppLock 启用后仅在 UI 上加主密码提示，DB 密钥仍在磁盘，主密码仅作为 PBKDF2 验证器存于另一 0600 文件，`AccountStore.accounts`（内存中已解密）仅被模糊显示而非清除。AutoFill 扩展调用 `repository.account(...)`/`matchingAccounts(...)` → `sqliteStore.readData("accounts")` 解密全部凭据，**不查询 `AppLockStore.isLocked`**，故 `provideCredentialWithoutUserInteraction(for:)` 在用户认为保险库已锁定时仍返回 user/password。任何能读 host 进程内存的进程（或同用户会话的第三方 App）在锁屏显示时仍可读完整解密 `accounts` 数组。
- **修复建议**：将解密门禁置于主密码后——用主密码派生 DB 密钥（Argon2id/PBKDF2）替代裸密钥文件；或信封加密文件密钥，AutoFill 要求 `LAContext.evaluatePolicy(.deviceOwnerAuthentication)` 后才解密。`lock()` 时从 `AccountStore` 清除 `accounts/passkeys/editingAccount`，仅在 `unlockWithPassword()` 成功后重新加载。AutoFill `provideCredentialWithoutUserInteraction` 锁定时返回 `ASExtensionError.userInteractionRequired`。
- **置信度**：Confirmed

### C-8 JS 合并内核与 Rust 合并内核语义不一致，且 Rust 合并内核是死代码

- **严重程度**：Critical（架构级分歧 / 潜在数据损坏）
- **文件:行**：JS 内核 [core/pass_core/js/sync_merge_core.js:41-88](core/pass_core/js/sync_merge_core.js#L41)（`newerField` 仅墙钟）；Rust [core/pass_core/crates/merge/src/lib.rs:16-39](core/pass_core/crates/merge/src/lib.rs#L16)（HLC + causal_parents + time_range）；协议文档 docs/sync-protocol-v2.md:18-22 声称"较新时间戳胜出"
- **标题**：两种合并内核在不同抽象层运行，永不一致
- **失败场景**：时钟偏斜两设备：Mac op A `passwordUpdatedAtMs=100` 值"p1"；iOS 拉 A 后做 op B `passwordUpdatedAtMs=99`（时钟慢 1ms）`causal_parents=[A]` 值"p2"。JS 内核（运行时使用）：99<100 → A 胜 → 密码=`p1`。Rust 内核（规范/参考，未被调用）：causal_parents 规则使 B"在"A 之后 → B 胜 → 密码=`p2`。同输入两内核选相反胜者，任一设备运行"另一"内核即与对端分歧，密码每次同步反复跳动并可能复活旧值。**Rust 内核未被任何非测试代码引用**（`crates/merge` 的 `compare_ops/winner/resolve_delete` 在 ffi/transport/storage 中均未调用，仅自身单测使用），JS 内核是唯一运行时路径。仓库宣称"与 Rust 共享逻辑"的契约并不存在。
- **修复建议**：要么让 JS 内核经 FFI 消费 Rust 内核（`pass_core_merge_ops`/`pass_core_resolve_delete`）形成单一真相源；要么删除 Rust merge crate 并更新 sync-protocol-v2.md 反映"快照级墙钟 LWW 即契约"。
- **置信度**：Confirmed

### C-9 FFI `pass_core_last_error_message` 返回借用进 Mutex 的 CString 指针 → use-after-free / double-free

- **严重程度**：Critical（FFI 内存安全 / UB）
- **文件:行**：[core/pass_core/crates/ffi/src/lib.rs:369-377](core/pass_core/crates/ffi/src/lib.rs#L369)
- **标题**：`last_error_message` 返回裸借用指针，锁在返回前释放
- **失败场景**：① T1 调用 `pass_core_state_upsert_account` 传入坏 JSON → 失败 → `set_last_error("invalid state json: …")` 存 CString。② T2 调用 `pass_core_last_error_message()`，获得 `message.as_ptr()`（指向该 CString），锁在返回前释放。③ T2 解引用前，T1 又一次失败调用 → `*slot = Some(new_cstring)` → 旧 CString 丢弃 → 缓冲区释放。④ T2 解引用指针 → use-after-free（UB）。⑤ 若 C 调用方误以为返回的 `*const c_char` 是拥有指针而调 `pass_core_string_free`，`CString::from_raw` 读越界 length/capacity 头 → double-free / 堆损坏。`pass_core_string_free`（[:380](core/pass_core/crates/ffi/src/lib.rs#L380)）文档要求"必须由 CString::into_raw 分配"，但 last-error 指针并非如此。
- **修复建议**：返回 `into_raw_c_string(message.to_string())` 拥有副本（并文档化调用方须 `pass_core_string_free`），或拷入调用方提供的定长缓冲区。
- **置信度**：Confirmed

### C-10 Python 备份脚本将裸数据库解密密钥与加密 DB 同址存放

- **严重程度**：Critical
- **文件:行**：[scripts/backup_and_verify_local.py:21-24](scripts/backup_and_verify_local.py#L21)
- **标题**：备份同时拷贝 `pass-db-key-v1` 紧邻加密 `pass.db`
- **失败场景**：脚本将明文加密密钥 `pass-db-key-v1` 与 `sync-credentials-v1.json`、`app-lock-credential-v1.json` 一并 `shutil.copy2` 进备份目录，紧邻加密 `pass.db`。`pass-db-key-v1` 是加密 SQLite 行的 AES 密钥（[verify_local_backup.py:32](scripts/verify_local_backup.py#L32) 强制 32 字节）。密钥与密文同址，落盘加密对备份零保密性。任何能读备份目录者（外接硬盘、云同步文件夹、被盗笔记本备份、误共享文件夹）均可完全解密 DB。
- **修复建议**：不将裸密钥拷入备份。要么用用户口令（Argon2id/scrypt + AES-GCM）重包裹密钥，要么拒绝备份密钥并要求用户单独存于 Keychain，要么加密整个备份目录。每文件 `os.chmod 0o600`、目录 `0o700`。
- **置信度**：Confirmed

### C-11 同步服务器"遗留明文迁移"实为静默批量删除，非迁移

- **严重程度**：Critical（数据可用性）
- **文件:行**：[apps/sync_server_ubuntu/pass_sync_server.py:156-167](apps/sync_server_ubuntu/pass_sync_server.py#L156)
- **标题**：启动迁移删除 schema 不在白名单的全部 payload，无备份无按 scope 通知
- **失败场景**：`_initialize` 扫描 `payloads` 全表，解析 `payload_json`，**删除**任何 `schema` 不在 `{"pass.sync.encrypted.v1","pass.sync.bundle.v2"}` 的行（[:166](apps/sync_server_ubuntu/pass_sync_server.py#L166)）。任务将其描述为"历史明文自动加密迁移"，但**不执行任何加密**——直接销毁行。若运维从接受旧 schema 的服务器升级、且客户端尚未推送加密包，用户整个服务端保险库在首次重启被静默丢弃。日志仅"Removed N legacy unsupported payload(s)"，无 scope 名、无备份。更微妙：`pass.sync.bundle.v2`（明文 schema）在白名单中保留，明文 v2 包存活，仅在请求时由 `allow_plaintext` 门禁；故迁移连明文 v2 都不清，只清真正未知 schema。
- **修复建议**：重命名为"purge"；删除前将受害行写入 sidecar `data/purged_<ts>.jsonl` 供恢复；删除行数 >0 时除非 `PASS_SYNC_PURGE_LEGACY=1` 否则拒绝启动；至少逐 scope 记名。
- **置信度**：Confirmed

---

## 5. 高危 (High) 发现

> 受篇幅限制，每条按"文件:行 / 标题 / 失败场景要点 / 修复 / 置信度"紧凑呈现。

### H-1 `newerField` 在时间戳并列时，空值胜出可丢失非空字段
- **文件:行**：[sync_merge_core.js:41-88](core/pass_core/js/sync_merge_core.js#L41)（特指 [:75-87](core/pass_core/js/sync_merge_core.js#L75)）
- **失败场景**：左 `password="real"`, `passwordUpdatedAtMs=100`；右 `password=""`（用户故意清空）同时间戳、同 accountUpdatedAtMs。`!leftValue && rightValue` 守卫不触发 → 落设备名比较 → `"chromemac"<"windows"` → 右胜 → `password=""`，静默抹除真密码。`evaluateSyncSafety` 检测不到（无身份丢失）。
- **修复**：并列前加 `else if (!rightValue && leftValue) return left;`，或"非空并列胜"。
- **置信度**：Confirmed

### H-2 JS 内核对删除-vs-更新并列从不置 `conflict_review`，违反规范与 Rust
- **文件:行**：[sync_merge_core.js:238-245](core/pass_core/js/sync_merge_core.js#L238)；Rust [merge/src/lib.rs:41-65](core/pass_core/crates/merge/src/lib.rs#L41)；DB 列 [0001_initial.sql:61](core/pass_core/crates/storage/migrations/0001_initial.sql#L61)（`conflict_review` 永不写）
- **失败场景**：Mac T=100 删账号；iOS（分区）T=100 更新密码。`latestDeletedAt=100, latestActivityAt=100` → `keepDeleted=true` → 账号删除，密码更新静默丢弃。Rust `resolve_delete` 对同时间并列返回 `NeedsReview`，规范第 5 节与契约测试第 9 节要求置审阅标记。JS 静默裁决且不设 `conflict_review`，用户永不被告警，iOS 更新丢失。
- **修复**：采纳 Rust `resolve_delete`，`NeedsReview` 时置 `conflict_review=1` 并发 `ConflictItem`；至少将同时间删除-vs-更新并列改为产 `conflict_review` 而非 `keepDeleted=true`。
- **置信度**：Confirmed

### H-3 `mergeAccountCollections` 去重按 `accountId` **或** `recordId` → 共享其一即折叠丢数据
- **文件:行**：[sync_merge_core.js:432-442](core/pass_core/js/sync_merge_core.js#L432)
- **失败场景**：`{recordId:"r1",accountId:"a1"}` 入；`{recordId:"r2",accountId:"a1"}`（合法第二账号，因 eTLD+1 归一化使两 sites 折叠为同 accountId，但 recordId 不同应为不同记录）→ 按 `accountId=="a1"` 命中候选 #1 → 折叠 → `recordId:"r2"` 从输出消失。`evaluateSyncSafety` 仅查 local→merged（见 H-4），丢失不被标记。
- **修复**：对称匹配两键，或回退为按 `recordId` 专属匹配，仅两方均无 `recordId` 时用 `accountId`。
- **置信度**：Plausible（取决于 accountId 碰撞是否可行，eTLD+1 派生使其可能）

### H-4 `evaluateSyncSafety` 不查 remote→merged 丢失身份 → 静默丢远端记录
- **文件:行**：[sync_merge_core.js:577-642](core/pass_core/js/sync_merge_core.js#L577)（仅 [:591-608](core/pass_core/js/sync_merge_core.js#L591) local→merged）
- **失败场景**：Local=[A], Remote=[A,B]。因 H-3 去重 bug 或 `merged.filter(Boolean)` 吞异常（[:444](core/pass_core/js/sync_merge_core.js#L444)）→ merged=[A]。`evaluateSyncSafety` 仅查 local A 是否存活（存活）→ `safe:true`，Remote B 在下次写入静默丢失。
- **修复**：加 `missingIdentities(remote, merged, …)` 检查（至少 merge 模式下 `remote→merged`）。
- **置信度**：Confirmed

### H-5 FFI CSV 导出无公式注入缓解（见主题 A）
- **文件:行**：[ffi/src/lib.rs:88-90,333-367](core/pass_core/crates/ffi/src/lib.rs#L88)
- **修复**：`escape_csv` 对首字符 `= + - @ | %` 前缀 `'`。
- **置信度**：Confirmed

### H-6 FFI `Account` 结构体携带明文 `password/totp/recovery/note`，与密文落盘 schema 矛盾
- **文件:行**：[ffi/src/lib.rs:51-67](core/pass_core/crates/ffi/src/lib.rs#L51)；schema [0001_initial.sql:47-57](core/pass_core/crates/storage/migrations/0001_initial.sql#L47)（`password_cipher BLOB`）
- **失败场景**：C 宿主调 `pass_core_state_upsert_account` 传含明文 password 的 JSON → Rust 反序列化为 `Account`（明文 String，无 zeroize）→ 序列化回 JSON → 宿主持久化。DB schema 要求 `password_cipher` blob，FFI 侧接受并往返明文。crash dump/swap/调试器沿途抓取明文。FFI `Account` 无 `password_cipher` 字段，调用方根本无法走加密路径。
- **修复**：重命名为 `passwordCipherB64` 并拒绝明文，或导入 schema 的 cipher blob 字段；至少 `Zeroizing<String>` 并文档化 JSON 为未加密中转。
- **置信度**：Confirmed

### H-7 硬编码 `\"ChromeMac\"` 设备名回退污染稳定设备名并列与审计轨迹
- **文件:行**：[sync_merge_core.js:62,226-227,273,367,384,417](core/pass_core/js/sync_merge_core.js#L62)；schema [pass-data-v2.schema.json:218-281](docs/schemas/pass-data-v2.schema.json#L218) 要求 `*UpdatedDeviceName` `minLength:1`
- **失败场景**：iOS 无 `deletedDeviceName` 的 passkey 记录 → [:367](core/pass_core/js/sync_merge_core.js#L367) 回退字面量 `"ChromeMac"`，结果记录谎称 ChromeMac 删除。schema 要求 `minLength:1`，空值会被包验证器拒，但 JS 内核**合成错误设备名以通过验证**。后续 `mergeRelationStates` 并列（`incoming.deviceName > current.deviceName`）中合成"ChromeMac"与真实 ChromeMac 竞争，结果不确定。
- **修复**：归一化时拒缺失/空设备名而非合成；确需回退时用包封装 `payload.source.deviceName` 而非硬编码字面量。
- **置信度**：Confirmed

### H-8 安全相关 ID 生成回退 `Math.random()`（见主题 B）
- **文件:行**：见主题 B 表
- **最严重项**：同步幂等键经 `Idempotency-Key` 头被服务器观察 → 预测未来键 → 服务器去重导致用户上传被丢弃；`syncDeviceId` 用于未认证 `source.deviceId`。
- **修复**：见主题 B。
- **置信度**：Confirmed

### H-9 同步包 AAD 仅认证常量 schema 串，不绑定设备身份/时钟/nonce → 重放与回滚
- **文件:行**：[sync_crypto.js:27,57](apps/extension_shared/sync_crypto.js#L27)（`additionalData: SYNC_ENCRYPTED_SCHEMA_V1`）
- **失败场景**：`source.deviceId/exportedAtMs/logicalClockMs` 均在明文，未被 AAD 绑定。被攻陷的同步服务器（或未强制 HTTPS 的 WebDAV MITM）可：（1）重放旧的合法加密包，客户端无 `exportedAtMs` 高水位检查，静默降级保险库到旧状态，期间改密的密码丢失；（2）因 AAD 不绑 deviceId，整个旧的合法 `(key,nonce,ciphertext)` 三元组可被替换为另一时刻的有效包，重放不可检测。
- **修复**：AAD = `len||schema || len||deviceId || uint64be(exportedAtMs) || uint64be(logicalClockMs)`；解密侧拒 `exportedAtMs` 旧于本地 `lastSeenExportedAtMs` 水位；强制 HTTPS-only。
- **置信度**：Confirmed

### H-10 同步服务器慢速 DoS：`rfile.read()` 无读超时 + 无线程上限
- **文件:行**：[pass_sync_server.py:742](apps/sync_server_ubuntu/pass_sync_server.py#L742)；`daemon_threads=True` [:835](apps/sync_server_ubuntu/pass_sync_server.py#L835) 但无线程池
- **失败场景**：客户端发 `Content-Length: 2097152` 后以 1 字节/分钟滴漏。`BaseHTTPRequestHandler` 默认无 socket 读超时，服务器永不设 `self.timeout`。`ThreadingHTTPServer` 无线程上限，每连接占一线程，~1000 连接即 ~1000 阻塞线程（8 MiB 栈/线程 ≈ 8 GB 虚拟 + Python 开销），服务器停止 accepting。OPTIONS（见 M-1）绕过限流更甚。复现：`printf 'PUT ... Content-Length: 2097152\r\n\r\n' | nc host 53333` 后挂起。
- **修复**：`self.timeout=30`；`ThreadingHTTPServer` 子类 + `ThreadPoolExecutor(max_workers=64)` 或信号量；PUT body cap 降到 ~1 MiB。
- **置信度**：Confirmed

### H-11 同步服务器 `int(raw_version_id)` 接受非 ASCII Unicode 数字 → 500 / 路径混淆
- **文件:行**：[pass_sync_server.py:518,523](apps/sync_server_ubuntu/pass_sync_server.py#L518)
- **失败场景**：`'１'.isdigit()` 为 True 且 `int('１')==1` → `/v1/sync/versions/１` 被当作 version 1（全宽/阿拉伯/孟加拉数字别名到 ASCII 版本号，两条 URL 路径映射同一资源）；`'²'.isdigit()` 为 True 但 `int('²')` 抛 ValueError → 被 [:566](apps/sync_server_ubuntu/pass_sync_server.py#L566) 裸 `except Exception` 捕获 → 500 + traceback，errors 指标膨胀。复现：`curl 'http://127.0.0.1:53333/v1/sync/versions/%C2%B2'` → 500。
- **修复**：`raw.isascii() and raw.isdigit()`（或 `^[0-9]+$`），否则 404 而非 500。
- **置信度**：Confirmed

### H-12 `PASS_CONTENT_GET_ACCOUNTS` 向每页内容脚本返回全部站点全部明文密码
- **文件:行**：[background.js:966-977](apps/extension_shared/background.js#L966) `handleContentGetAccounts`；[content.js:135-151](apps/extension_shared/content.js#L135) `fetchAccountsForContent` 每页加载与每次 storage bump拉全部
- **失败场景**：内容脚本实际只需回答一个是非题（当前域+刚输入用户名+密码是否精确匹配/更新候选/新凭据），背景却向每个用户访问页面的内容脚本交付**所有站点所有明文密码**。隔离世界今日阻止页面直接访问，但任一未来 Bug（误赋 `window`、误入 postMessage、误入 toast）即整库泄露。结合 C-1（跨扩展可直接调用绕过隔离世界），该数据路径不可辩护。
- **修复**：以 `PASS_CONTENT_CHECK_LOGIN`（入参 `{domain,username,password}`，返回 `{mode}`）替换；密码材料永不离开背景。
- **置信度**：Confirmed

### H-13 自动填充注入 http 页面 + 视觉隐藏输入字段
- **文件:行**：[background.js:221-224](apps/extension_shared/background.js#L221) `shouldInjectMainWorldBridge` 接受任意 host 的 `http://`（非仅 localhost）；[background.js:1751-1804](apps/extension_shared/background.js#L1751) `fillCredentialInPage` `visible()` 仅检 `display:none/visibility:hidden/disabled/readonly`
- **失败场景**：(a) http://evil.com 注入填充，MITM 在线读密码；(b) `visible()` 不检 zero-size/opacity:0/clip-path/off-screen/font-size:0，恶意页面以 1×1 透明 `<input type=password>` 作首密码字段 + 1×1 文本作用户名，扩展填入，页面读 `input.value` 外泄。
- **修复**：注入仅限 `https:` + localhost 例外；`visible()` 增检 opacity/尺寸/视口/clip-path；优先填用户刚聚焦的字段或当前交互表单内字段。
- **置信度**：Confirmed

### H-14 `PASS_LOCK_ACTIVITY` 接受任意来源 → 闲置锁永不触发
- **文件:行**：[background.js:662-665,812-816](apps/extension_shared/background.js#L662)；不在 `SENSITIVE_MESSAGE_TYPES`（[:98-104](apps/extension_shared/background.js#L98)）
- **失败场景**：任何扩展每 30s 发 `PASS_LOCK_ACTIVITY` → `registerBackgroundLockActivity` 写 `Date.now()` 入 `STORAGE_KEY_LOCK_LAST_ACTIVITY`，`getBackgroundLockStatus` 的 `Date.now()-lastActivity >= idleMinutes*60*1000` 永不触发，保险库无限期解锁。
- **修复**：`PASS_LOCK_ACTIVITY` 白名单 `sender.id === chrome.runtime.id`。
- **置信度**：Confirmed

### H-15 macOS 同步 E2E 可降级：明文包探测短路 + 空密钥回退
- **文件:行**：[PassSharedCrypto.swift:139-201](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L139)（`encrypt` 空密钥返明文 [:140-143](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L140)；`decrypt` 明文 schema 探测返明文 [:165-171](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L165)）；[AccountStore.swift:5014-5042](apps/app_macos/Sources/app_macos/AccountStore.swift#L5014) `decodeSyncBundle`；SettingsView 允许无密钥启用同步源
- **失败场景**：`encrypt` 中 `key.isEmpty → return plaintext` → 空密钥上传全明文 JSON 至 WebDAV/iCloud/自建。`decrypt` 中即便用户配了 256 位密钥，仍接受 `schema=="pass.sync.bundle.v2"` 明文包原样返回。恶意/被攻陷服务器或 TLS MITM 取得 bearer 后可注入伪造账号（如假 `google.com`）进入用户保险库，瓦解 E2E 承诺。`isValidKeyString` 对空串返 true（[:134-137](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L134)），UI"密钥必填"未强制。
- **修复**：配置密钥时拒收非密文包；除非 `isEncryptionKeyConfigured` 为真否则拒启用任一同步源；明文 schema 包视为不可信，要求显式 opt-in。
- **置信度**：Confirmed

### H-16 macOS CSV 导入在重复列头崩溃（preconditionFailure）
- **文件:行**：[BrowserPasswordImport.swift:168-194](apps/app_macos/Sources/app_macos/BrowserPasswordImport.swift#L168)（[:169](apps/app_macos/Sources/app_macos/BrowserPasswordImport.swift#L169) `Dictionary(uniqueKeysWithValues:)`）
- **失败场景**：重复列头（两 `password` 列等）触发 `Dictionary(uniqueKeysWithValues:)` trap。用户打开恶意/意外重复列头 CSV 即运行时崩整个 UI（解析在 @MainActor [AccountStore.swift:1825-1829](apps/app_macos/Sources/app_macos/AccountStore.swift#L1825)）。
- **修复**：用 `Dictionary(_:uniquingKeysWith:)`，重复时报 `unsupportedHeader`。
- **置信度**：Confirmed

### H-17 macOS CSV 导出明文 + 默认 0644 权限（见主题 A + 主题 D）
- **文件:行**：[AccountStore.swift:1694-1708,1710-1724](apps/app_macos/Sources/app_macos/AccountStore.swift#L1694) `exportCsv`/`exportBrowserPasswordCsv`
- **失败场景**：`csv.write(... atomically:true ...)` 与 `data.write(... .atomic)` 走进程 umask（022 → 0644）。导出含 `password/totp_secret/recovery_codes/note` 明文，写入桌面/Documents/Dropbox 等宽位置即全员可读。
- **修复**：导出文件 `0o600` 原子写后 chmod；明文导出前警告。
- **置信度**：Confirmed

### H-18 macOS 剪贴板永不自动清空（见主题 E，含 256 位同步密钥）
- **文件:行**：[ContentView.swift:1386-1391](apps/app_macos/Sources/app_macos/ContentView.swift#L1386)；[AccountStore.swift:5059-5072](apps/app_macos/Sources/app_macos/AccountStore.swift#L5059)
- **修复**：见主题 E。
- **置信度**：Confirmed

### H-19 macOS AutoFill 在请求方无/`.app` 服务标识时返回全部账号
- **文件:行**：[PassSharedAccountRepository.swift:33-58](apps/app_macos/Sources/shared/PassSharedAccountRepository.swift#L33)（`normalizedDomains.isEmpty` 时返回全部）；[AutoFillCredentialProviderViewController.swift:15-78,99-100](apps/app_macos/AutofillExtension/AutoFillCredentialProviderViewController.swift#L15)（`.app` 标识被丢）
- **失败场景**：请求 App 以 `.app` 类型或无标识触发扩展 → 选择器显示**整个保险库**的用户名+站点供用户点选。结合 C-7（扩展未锁定），泄露用户名+站点清单，选中还返回密码。恶意请求方可枚举用户注册站点并社工。
- **修复**：空 domains 视为"无匹配"而非"全匹配"；要求 `serviceIdentifiers.first?.type ∈ {.domain,.URL}` 才列出。
- **置信度**：Confirmed

### H-20 编辑器详情面板将设备名字段未转义插入 innerHTML（XSS）
- **文件:行**：[popup.js:1331-1340](apps/extension_shared/popup.js#L1331)；[options.js:4106-4115](apps/extension_shared/options.js#L4106)
- **失败场景**：8~9 个 `*UpdatedDeviceName` 字段经 `String(...).trim()` 原样插入 `innerHTML`，无 `escapeHtml`。对端设备/导入包/CSV 设 `lastOperatedDeviceName='<img src=x onerror=alert(1)>'`。当前 MV3 默认 CSP 阻断内联处理器，但恶意 HTML 仍渲染（UI 伪造/布局破坏）；若 CSP 一旦放松（引入框架需 `unsafe-inline`）即执行 → 从特权扩展页读 vault 并 `fetch` 外泄。
- **修复**：每处加 `escapeHtml(...)`，或改 `createElement`+`textContent`。
- **置信度**：Confirmed（注入确定；可利用性取决于 CSP）

### H-21 密码/TOTP/同步令牌/同步密钥以 `type="text"` 明文渲染
- **文件:行**：[popup.html:63,67](apps/extension_shared/popup.html#L63)；[options.html:99,111,117](apps/extension_shared/options.html#L99)（含 256 位同步密钥明文）；动态编辑器 [options.js:4481-4484](apps/extension_shared/options.js#L4481) 与 [popup.js:1379-1393](apps/extension_shared/popup.js#L1379) 均设 `input.type="text"`
- **失败场景**：肩窥、录屏、屏幕阅读器逐字符播报（无 `aria-label` 遮蔽策略）、输入法遥测、剪贴板/自动填充管理器扫描、共享屏支持。同步加密密钥尤甚——它是远程保险库落盘对称密钥，设置页打开即明文显示。
- **修复**：密钥字段 `type="password"` + 显隐切换 + 超时自动隐藏；同步密钥默认永不 `type="text"`；加 `aria-label` 状态描述。
- **置信度**：Confirmed

### H-22 扩展密码复制到剪贴板永不清空（见主题 E）
- **文件:行**：[popup.js:874-884](apps/extension_shared/popup.js#L874)（全代码库无 `clipboard.*Timer`/`clearClipboard`）
- **修复**：见主题 E。
- **置信度**：Confirmed

### H-23 扩展 CSV 导出/导入公式注入（见主题 A，含 Cherry Chrome/Firefox/Safari 三格式）
- **文件:行**：[options.js:2326-2328](apps/extension_shared/options.js#L2326) `csvEscape`；[:2300-2324](apps/extension_shared/options.js#L2300) `buildBrowserPasswordCsv`；[:2434-2455](apps/extension_shared/options.js#L2434) 导入往返
- **修复**：见主题 A。
- **置信度**：Confirmed

---

## 6. 中危 (Medium) 发现

### 加密与会话

- **M-1 通行密钥私钥以 `extractable:true` JWK 存于同一保险库**（C-2 的子项）：[passkey_store.js:152-155,651-669](apps/extension_shared/passkey_store.js#L152)。主密码泄露即获全部 passkey JWK，可离线伪造各 RP 签名。修复：`extractable:false` + `wrapKey` 单独包裹。
- **M-2 v1 遗留主密码摘要为单次 SHA-256（无 KDF），仅在解锁时升级**：[lock_crypto.js:36-42,73-81](apps/extension_shared/lock_crypto.js#L36)。磁盘窃取 v1 凭据可 GPU 暴力（~10^10/s vs PBKDF2 310k≈30/s 有效）。修复：启动时强制 v1→v2 迁移，不再接受 v1 验证。
- **M-3 模块级 CryptoKey 缓存在锁后非 SW 上下文残留**（C-6 窄化）：[data_store.js:43,190](apps/extension_shared/data_store.js#L43)。修复：单次异步任务后不缓存，每调用从 session 重新派生。
- **M-4 读路径静默重写 IndexedDB；植入未加密行即清库**：[data_store.js:75-97,371-380](apps/extension_shared/data_store.js#L75)。`readCollection` 见未加密 array 形式即立即重加密写入；攻击者植入 `{key:"accounts",value:[]}` 即下次读静默覆写为空库，且经同步 push 传播到远端。`mergeLegacyCollection` 解密失败返 `[]` 亦触发 `writeCollection` 覆盖。修复：读即读，永不写；一次性迁移标志前置设置。
- **M-5 同步发件箱用**原始**载荷重试长达 ~2.5h，可复活已删凭据**：[sync_outbox.js:9-12,47-61](apps/extension_shared/sync_outbox.js#L9)（MAX_ATTEMPTS=12, 指数退避封顶 1h）。用户删密码后，先前失败 push 的旧载荷 35 分钟后重试成功即上传删除前库 → 服务端复活 → 下次 pull 拉回本地。修复：每次重试前从当前内存状态刷新 payload，或丢弃迟于最近成功 push 的发件箱项。
- **M-6 `etldPlusOne` 静态表错并无关站点（见主题 C）**：[account_core.js:1-38](apps/extension_shared/account_core.js#L1)。`*.github.io`、`*.s3.amazonaws.com` 被合并 → 钓鱼页 `login-phish.github.io` 触发自动填充 UI 复用真实 `login.github.io` 凭据。
- **M-7 解密错误分支泄漏 cipher/格式 vs 密钥错误，cipher 字段未绑 AAD**：[sync_crypto.js:40-67](apps/extension_shared/sync_crypto.js#L40)。分支于错误消息是否含"同步"；未来引入 v2 cipher 可被服务器降级。修复：统一泛化错误；`cipher` 绑 AAD。
- **M-8 `unwrapDataKey` 拒 iterations != 常量，阻断 KDF 加固**：[data_store.js:249-270](apps/extension_shared/data_store.js#L249)。提升 `LOCK_PBKDF2_ITERATIONS` 即砖所有现存用户。修复：读存储值而非等比常量；成功 rewrap 时升级。

### 合并内核与 Rust

- **M-9 `isPinned` 严格跟随新账号而 `pinnedViews` 取并集，两者可矛盾**「pin 修复」不完整：[sync_merge_core.js:287-293](core/pass_core/js/sync_merge_core.js#L287)。UI 信任 `isPinned` 显示未置顶而 `pinnedViews.all.pinned` 为 true。修复：合并后从 `pinnedViews` 派生 `isPinned`。
- **M-10 `pinnedSortOrder/regularSortOrder` 严格新胜，旧值静默丢**：[:288-289](core/pass_core/js/sync_merge_core.js#L288)。远端 `pinnedSortOrder:null` 覆盖本地 `1`。修复：`?? olderAccount.… ?? null`。
- **M-11 `mergeAccountCollections` 不排序合并后账号 → 载荷哈希不稳定**：[:423-445](core/pass_core/js/sync_merge_core.js#L423)。两设备互拉哈希不同，ETag/快照比较 spuriously 冲突。passkey 已排序（[:463-472](core/pass_core/js/sync_merge_core.js#L463)），账号缺。提交 `fa32ffb`"修复载荷排序"仅加 `pinnedViews` 字段未加账号排序。修复：返前按 `recordId||accountId` 稳定排序。
- **M-12 `*UpdatedAtMs`/`hlc_physical_ms` 无上限，恶意/溢出对端永久霸权**：[pass-data-v2.schema.json:217-293](docs/schemas/pass-data-v2.schema.json#L217)（仅 `minimum:0`）；[domain/src/lib.rs:45-49](core/pass_core/crates/domain/src/lib.rs#L45)（`i64`）；[0001_initial.sql:98](core/pass_core/crates/storage/migrations/0001_initial.sql#L98)（无 CHECK）。`passwordUpdatedAtMs:Number.MAX_SAFE_INTEGER` 永久胜出，合法更新恒败。修复：schema 加 `maximum`；合并路径拒超 `now+clock_uncertainty` 的 HLC。
- **M-13 TimeRange 重叠把端点相 Touch 判为重叠**：[merge/src/lib.rs:24-29](core/pass_core/crates/merge/src/lib.rs#L24)；[ffi/src/lib.rs:208-221](core/pass_core/crates/ffi/src/lib.rs#L208)。半开区间 `[10,20)` `[20,30)` 不应重叠却触发 HLC 并列。修复：明确半开用 `<=`。
- **M-14 HLC 无单调性/漂移恢复/计数溢出守卫（Rust 仅数据类）**：[domain/src/lib.rs:45-58](core/pass_core/crates/domain/src/lib.rs#L45)。墙钟回退（NTP）后 logical 不 bump 即自身旧 op 胜自身新 op；无 `logical==u32::MAX` 溢出测试。修复：加 `tick`/`receive`，溢出饱和或报错。
- **M-15 Passkey `signCount` 在 CXP 导入强制 0 且不再前进 → 克隆检测失效**：[credential_exchange_cxf.js:19-21,46](core/pass_core/js/credential_exchange_cxf.js#L19)。跨设备再导入即重置 0，RP 克隆检测（`signCount<=stored`）永久静默。修复：CXP 不存 signCount，依赖认证器首用计数。
- **M-16 Rust `resolve_delete` 死代码，`conflict_review` 列永不写**（H-2 的契约面）：[merge/src/lib.rs:41-65](core/pass_core/crates/merge/src/lib.rs#L41)；[0001_initial.sql:61,79](core/pass_core/crates/storage/migrations/0001_initial.sql#L61)。契约承诺的 `conflict_review`/`ConflictItem` 无生产路径写入。修复：接入或删列。

### 扩展运行时

- **M-17 WebAuthn override 可被页面检测、可破坏合法 passkey 流、`postMessage` 用 `targetOrigin:"*"`**：[webauthn_injected.js:217,640-670](apps/extension_shared/webauthn_injected.js#L217)；[content.js:735-747](apps/extension_shared/content.js#L735)。原型层覆盖 `navigator.credentials`，`mediation:"conditional"` 时弹 1.2s fallback overlay 破坏条件 UI；`*` targetOrigin 使同页第三方脚本可读 `rpId`/`user.name`/断言字节。修复：用 `window.location.origin`；仅实例层覆盖；条件 UI 期间不弹 overlay。
- **M-18 MV3 SW 终止中途同步留下本地/远端不一致，发件箱未写**：[background.js:292-494](apps/extension_shared/background.js#L292)（长串 await，outbox 仅 [:477](apps/extension_shared/background.js#L477) 提交）。SW 在 `writeBusinessDataToStore`（[:409](apps/extension_shared/background.js#L409)）与 `setSyncOutbox`（[:477](apps/extension_shared/background.js#L477)）间被杀 → push 失败未入补偿队列，下次不重试。修复：每 await 前持久化 in-flight intent；push 抛错时立即写 outbox；`navigator.locks` 防双 SW 并跑；大库分块。
- **M-19 `runAutoSync` 无互斥，手动+自动同步竞态双写**：[background.js:188-193,272-290](apps/extension_shared/background.js#L188)。两路读同一 local、拉同一 remote、`setAllDataToDataStore` last-writer-wins，输者 outbox 项可能丢；不同幂等键两 PUT 并发烧 412。修复：`navigator.locks.request("pass.sync",…)`，告警与手动触发合一队列。
- **M-20 Passkey `signCount` 自增非事务，并发同计数 → 服务器重放拒/纳**：[passkey_store.js:383-399,466-473](apps/extension_shared/passkey_store.js#L383)。两并发 `get` 均读 N、签 N+1、写 N+1；同样 `create` 的 exclude 检查（[:134](apps/extension_shared/passkey_store.js#L134)）与 `savePasskeys`（[:202](apps/extension_shared/passkey_store.js#L202)）竞态可双插。修复：单 IDB 事务 + 锁的读改写。
- **M-21 `assertRpIdAllowedForHost` 接受公共后缀 rpId 如 `"com"`/`"co.uk"`**：[passkey_store.js:498-504](apps/extension_shared/passkey_store.js#L498)。`rpId="co.uk"` 注册后任何 `*.co.uk` 可读/签。修复：要求 rpId 可注册（`etldPlusOne(rpId)===rpId` 为 false）。
- **M-22 `handleSaveFromLogin`/`upsertAccountForPasskey` 取 `domain` 自 payload 而非 `sender.tab.url`**：[background.js:875-899,901-964,989-1079](apps/extension_shared/background.js#L875)。结合 C-1，攻击扩展可注入 `domain:"github.com"` 假账号污染别名组；隔离于 C-1 为中。修复：服务端从 `sender.tab.url` 解析 domain。
- **M-23 每次 `onUpdated`/`onActivated` 重复注入 `dist/content.js` + MAIN-world 探针**：[background.js:159-171,226-270](apps/extension_shared/background.js#L159)。`__passContentBridgeInstalled` 守卫减损，但重复 `console.info`、`initAccountCache` 全库拉取（放大 H-12）、`data-pass-content-version` 属性写可被页面 `MutationObserver` 探测焦点事件；MAIN-world 探针每导航重写并 `console.warn`，页面可指纹识别扩展。修复：删冗余 `dist/content.js` 注入；per-tab flag 存 `chrome.storage.session` 防重注入。

### macOS

- **M-24 不在睡眠/锁屏/快速用户切换时自动锁（除非选 `.onBackground`）**：[AppLockStore.swift:7-23,177-182](apps/app_macos/Sources/app_macos/AppLockStore.swift#L7)；[AppLockGateView.swift:24-36](apps/app_macos/Sources/app_macos/AppLockGateView.swift#L24)。无 `NSWorkspace.willSleepNotification`/`screensDidSleepNotification`/`com.apple.screenIsLocked` 观察者。修复：订阅并 `lock(reason:)`。
- **M-25 `PassSharedFileSecretStore.write` 临时文件路径是字面字符串无插值 → 同名竞态撕裂**：[PassSharedFileSecretStore.swift:21-24](apps/app_macos/Sources/shared/PassSharedFileSecretStore.swift#L21)。`".(fileName).(UUID().uuidString).tmp"` 缺 `\(...)`，每次同路径，两并发写互相覆盖 in-flight 字节。修复：`".\(fileName).\(UUID().uuidString).tmp"`。
- **M-26 `Data(base64URLString:)!` 强解包于密钥路径**：[PassSharedCrypto.swift:151,199](apps/app_macos/Sources/shared/PassSharedCrypto.swift#L151)。今日安全但依赖 `isValidKeyString` 与解码精确一致，未来改动即崩同步 push/decrypt。修复：`guard let raw = Data(base64URLString: key), raw.count==32 else { throw }`。
- **M-27 `quarantineAndReplaceData` 备份与 `saveLocalSyncSafetySnapshot` 无 0o600**：[LocalSQLiteStore.swift:152-170](apps/app_macos/Sources/app_macos/LocalSQLiteStore.swift#L152)；[AccountStore.swift:6126-6148](apps/app_macos/Sources/app_macos/AccountStore.swift#L6126)。备份目录无 0700。结合 C-7 同容器裸密钥，备份可被同进程读 + 密钥可读 = 可解。修复：写后 `0o600` + 目录 `0o700`。
- **M-28 `csvEscaped` 不处理 `\r` 行终止符**：[AccountStore.swift:5279-5281](apps/app_macos/Sources/app_macos/AccountStore.swift#L5279)。`"abc\r\n=cmd|...` 可行分裂 + 公式注入组合。修复：sanitize `\r`。
- **M-29 明文 CSV 导出无确认警告**：[options.js:1088-1099](apps/extension_shared/options.js#L1088)。仅 toast 行数，无 modal 警告明文落盘 ~/Downloads（可能云同步/索引）。
- **M-30 TOTP 密钥存于 DOM `data-pass-totp-secret` 属性，全程持久**：[popup.js:2350](apps/extension_shared/popup.js#L2350)；[options.js:5512](apps/extension_shared/options.js#L5512)。DevTools/AT/读 popup DOM 的扩展可获长期 TOTP 密钥。修复：闭包保管密钥，`data-*` 仅存动态码。

### 同步服务器

- **M-31 OPTIONS 绕过限流（H-10 放大器）**：[pass_sync_server.py:492-494,574-610](apps/sync_server_ubuntu/pass_sync_server.py#L492)。未鉴权无限 OPTIONS，每请求新线程。修复：`do_OPTIONS` 顶加 `enforce_rate_limit`。
- **M-32 鉴权 token 字典查找非恒时，纯 bearer 无 replay 防护，scope 内无设备隔离**：[:888](apps/sync_server_ubuntu/pass_sync_server.py#L888) `token_scopes.get(token.strip())`。README 主推 `default=token` 单 token 共享，两设备同 scope 同 `payloads` 行 last-writer-wins，被攻陷设备可覆写对端快照。修复：`secrets.compare_digest` 逐候选；长远 per-device token+scope；审计日志记 device_id。
- **M-33 `sync_operations` 审计表无保留期无限增长**：[:414-430](apps/sync_server_ubuntu/pass_sync_server.py#L414)。`payload_versions`(50)、`sync_idempotency`(500) 有 trim，`sync_operations` 无。修复：per scope trim N 或日 vacuum。
- **M-34 `restore_version` 响应宣称输入 version_id 而非新快照 id**：[:692-724](apps/sync_server_ubuntu/pass_sync_server.py#L692)。restore 实际插新行（[:336-344](apps/sync_server_ubuntu/pass_sync_server.py#L336)），但响应 `restoredVersionId`/`X-Sync-Version` 用输入 id。客户端按响应 GET 反取旧快照（可能已被 trim）。修复：`put` 返 `lastrowid` 并用之。
- **M-35 审计日志无 client_ip/idempotency_key/device_id，取证不可归因**：[:414-430,659-675](apps/sync_server_ubuntu/pass_sync_server.py#L414)（仅 scope/operation/status/etag/version_id/created_at_ms）。共享 token 泄露时无法判"谁覆盖了保险库"。修复：增列。
- **M-36 `_rate_windows` 字典按 IP 无界增长**：[:843-858](apps/sync_server_ubuntu/pass_sync_server.py#L843)。botnet 旋转 IP 可积十万条目。修复：opportunistic prune 或 LRU。
- **M-37 幂等重放绕过 `If-Match` 并返回陈旧 ETag**：[:266-292](apps/sync_server_ubuntu/pass_sync_server.py#L266)。Client A 重试 key K `If-Match:E1`（已被 B 推进到 E2）→ 服务器幂等命中返 200+E1，A 误以为服务器在 E1，实为 E2，静默分歧。修复：幂等重放时若 `If-Match` 与缓存 etag 不符返 412/409。
- **M-38 多进程部署不安全（进程内锁跨进程 TOCTOU）**：[:81,265-296](apps/sync_server_ubuntu/pass_sync_server.py#L81)。`_write_lock` 是 `threading.Lock`（进程级），读与写在不同短连接，两进程可同 get 同 etag、同过 If-Match、双 insert，输者静默覆写。README 假单进程但不强制。修复：同连接 `BEGIN IMMEDIATE` 单事务读写。

---

## 7. 低危 (Low) 与观察项

> 简表，按子系统。

**合并内核/Rust**
- L-1 `cryptoRandomId` fallback `Math.random`（见主题 B）：[credential_exchange_cxf.js:421-423](core/pass_core/js/credential_exchange_cxf.js#L421)。
- L-2 Schema 契约测试仅 2 例，无分歧/畸形覆盖（与 G-2 呼应）。
- L-3 FFI `Account.id` vs SQL `account_id` 命名不匹配：[ffi/src/lib.rs:54](core/pass_core/crates/ffi/src/lib.rs#L54) vs [0001_initial.sql:41](core/pass_core/crates/storage/migrations/0001_initial.sql#L41)，往返漏 rename 即插重复行。
- L-4 `hlc_physical_ms` 无 `CHECK >= 0`：[0001_initial.sql:98](core/pass_core/crates/storage/migrations/0001_initial.sql#L98)。
- L-5 `mergeFolderMembershipStates` 与 `mergeRelationStates` 近重复（DRY 违例，归一化已分歧——folder `.toLowerCase()`，passkey 不）：[sync_merge_core.js:90-150](core/pass_core/js/sync_merge_core.js#L90)。
- L-6 Rust 单测不覆盖计数溢出/墙钟回退/传递因果：[merge/src/lib.rs:12-14](core/pass_core/crates/merge/src/lib.rs#L12)（`happened_before` 仅直接父）。
- L-7 `mergeFolderCollections` 注入固定文件夹 `createdAtMs:0` 跨客户端可指纹：[sync_merge_core.js:490-499](core/pass_core/js/sync_merge_core.js#L490)。
- L-8 `usernameAtCreate` 回退用可变 `username`，破坏不可变性：[:265-268](core/pass_core/js/sync_merge_core.js#L265)。

**扩展加密**
- L-9 `timingSafeEqual` 长度检查早返泄漏长度（今日良性）：[lock_crypto.js:83-88](apps/extension_shared/lock_crypto.js#L83)。
- L-10 主密码 `.trim()` 哈希前，缩熵：[lock_crypto.js:60-64](apps/extension_shared/lock_crypto.js#L60)、[data_store.js:208](apps/extension_shared/data_store.js#L208)。
- L-11 遗留明文同步密钥/令牌懒迁移前滞留 `chrome.storage.local`：[data_store.js:30-32,563-589](apps/extension_shared/data_store.js#L30)。
- L-12 WebAuthn shim 在 MAIN world `document_start` 全 URL 注入：[manifest.json:33-39](apps/extension_shared/manifest.json#L33)。
- L-13 manifest 无显式 CSP、`<all_urls>` host perms：[manifest.json:6-18,33-45](apps/extension_shared/manifest.json#L6)。

**扩展运行时**
- L-14 `window.postMessage(...,"*")` 桥接响应/通知：[content.js:735-747](apps/extension_shared/content.js#L735)、[webauthn_injected.js:217,454-461](apps/extension_shared/webauthn_injected.js#L217)。
- L-15 扩展内部行为 `console.info` 进页面控制台（rpId、候选数、credentialId 片段）：[content.js:20-26](apps/extension_shared/content.js#L20)、[webauthn_injected.js:40-46](apps/extension_shared/webauthn_injected.js#L40)。
- L-16 密码值经消息通道流转（仅 C-1 下 material）：[content.js:172-195,113-121](apps/extension_shared/content.js#L172)。
- L-17 无 `externally_connectable`（正面），但 C-1 仍适用：[manifest.json:50](apps/extension_shared/manifest.json#L50)。
- L-18 host perms 与 content script 用 `<all_urls>`（含 file:）：[manifest.json:16-18,33-44](apps/extension_shared/manifest.json#L16)。

**UI**
- L-19 passkey meta 混合转义/数值 innerHTML，未来绕过归一化即注入：[popup.js:1201-1205](apps/extension_shared/popup.js#L1201)。
- L-20 TOTP 动态码复制不清空（30s 轮转，影响小）：[popup.js:2361](apps/extension_shared/popup.js#L2361)、[options.js:5523](apps/extension_shared/options.js#L5523)。
- L-21 可见密钥编辑器无自动隐藏计时：[popup.js:1307-1377](apps/extension_shared/popup.js#L1307)、[options.js:4082-4145](apps/extension_shared/options.js#L4082)。
- L-22 导入无文件大小上限（DoS）：[options.js:1110,1172,2243-2278](apps/extension_shared/options.js#L1110)。
- L-23 `JSON.parse` 攻击者 JSON 的原型污染面（取决于未审合并内核）：[options.js:1110,1812](apps/extension_shared/options.js#L1110)。
- L-24 `window.prompt` 取主密码于 options 加载（UX 降级）：[options.js:445](apps/extension_shared/options.js#L445)。

**macOS**
- L-25 DB 密钥为 32 裸字节无信封加密（C-7 的设计观察）。
- L-26 `LocalKeychain.read` 用默认 accessibility、无速率限（仅迁移用）：[LocalKeychain.swift:9-30](apps/app_macos/Sources/app_macos/LocalKeychain.swift#L9)。
- L-27 `TotpGenerator.powerOfTen` digits>9 溢出 UInt32（仅 6 位用，潜在）：[TotpGenerator.swift:57-63](apps/app_macos/Sources/app_macos/TotpGenerator.swift#L57)。
- L-28 `AppleCredentialExchange.decodePrivateKey` DER `readNull` 容错吞错：[AppleCredentialExchange.swift:419-440](apps/app_macos/Sources/app_macos/AppleCredentialExchange.swift#L419)。
- L-29 `exportDirectoryPath` 无路径遍历限制（用户显式触发）：[AccountStore.swift:1675-1692,557-589](apps/app_macos/Sources/app_macos/AccountStore.swift#L1675)。
- L-30 无证书 pinning，`URLSession.shared` 无 delegate：默认自建端点 `https://uk.sbbz.tech:5443` 受信任 CA 即可 MITM。

**同步服务器**
- L-31 `_handle_options` 未鉴权暴露路径有效性（标准 CORS）。
- L-32 scope 名若含 CRLF 可注入 header（运维受信，低）：[:770,805](apps/sync_server_ubuntu/pass_sync_server.py#L770)。
- L-33 `record_error` 把 401/403/404/412/429 计入 errors 指标，淹没真 500：[:559-561](apps/sync_server_ubuntu/pass_sync_server.py#L559)。
- L-34 `payload_versions` 保 50 行但每 PUT 插 2 行 → 实际 ~25 快照：[:300-344](apps/sync_server_ubuntu/pass_sync_server.py#L300)。
- L-35 `exported_at_ms` 无范围检查：[:932-934](apps/sync_server_ubuntu/pass_sync_server.py#L932)。
- L-36 加密包校验弱（信任客户端 nonce 唯一性，size 仅下限）：[:918-930](apps/sync_server_ubuntu/pass_sync_server.py#L918)。
- L-37 `tokens.conf` 仅检 mode 不检 owner：[:980-982](apps/sync_server_ubuntu/pass_sync_server.py#L980)。
- L-38 `/healthz` 占限流配额（NAT 后合法客户端被 429）：[:500,612](apps/sync_server_ubuntu/pass_sync_server.py#L500)。
- L-39 `start.sh` 把生成 token echo 到 stdout 与世界可读 log。
- L-40 TLS 无 cipher 加固/无 OCSP/无 mTLS/HSTS 交反代。

**脚本**
- L-41 `audit()` 函数死代码，与 `main()` 内联 dispatch 分歧：[audit_sync_data.py:152-159](scripts/audit_sync_data.py#L152)。
- L-42 SQLite `kv` key 名对任意 `.sqlite3` 原样输出：[audit_sync_data.py:87-127](scripts/audit_sync_data.py#L87)、[verify_local_backup.py:41](scripts/verify_local_backup.py#L41)。
- L-43 `print(report)` 输出 dict repr 非 JSON：[backup_and_verify_local.py:34](scripts/backup_and_verify_local.py#L34)。
- L-44 `sqlite3.connect` 缺失源即创建 0 字节 DB 副作用：[backup_and_verify_local.py:18](scripts/backup_and_verify_local.py#L18)。
- L-45 `VACUUM INTO` 路径未拒 NUL：[backup_and_verify_local.py:19-20](scripts/backup_and_verify_local.py#L19)。
- L-46 非 ASCII 输出未 `reconfigure(utf-8)`，POSIX locale pipe 即 `UnicodeEncodeError` 中断：[audit_sync_data.py:185,189-190](scripts/audit_sync_data.py#L185)、[verify_local_backup.py:63,65](scripts/verify_local_backup.py#L63)。
- L-47 JSON visitor 递归 >1000 即 RecursionError 未捕获：[audit_sync_data.py:34-43,52-60](scripts/audit_sync_data.py#L34)。
- L-48 异常路径把绝对路径泄至 stderr：[verify_local_backup.py:30,63-65](scripts/verify_local_backup.py#L30)。

---

## 8. 隐私声明核实（audit_sync_data.py "只输出数量、时间与哈希，不输出密码"）

**核实结论：对"值"成立，对"元数据"部分不成立。**

- **成立**：三 summarize 函数输出字段为 `path/sizeBytes/sha256/readable/error(仅异常类名)/encryptedEnvelope/counts/maxUpdatedAtMs/collections(子:readable/updatedAtMs/counts/maxUpdatedAtMs)/integrity/encryptedRows/bytes`。无任何明文凭据值、备注、用户名、整行被序列化。差分测试 `test_json_summary_reports_structure_without_values`（[test_audit_sync_data.py:14-27](scripts/tests/test_audit_sync_data.py#L14)）放入 `"password":"must-not-be-output"` 断言其缺席——**该差分测试存在**，但仅覆盖 `password` 一字段名、仅 JSON 路径。
- **不成立项**：
  - **S-5/S-7 目录游走 + `path` 字段**: `iter_candidate_files` 对任意目录 `rglob("*")`（[audit_sync_data.py:132-149,176-183](scripts/audit_sync_data.py#L132)），默认路径含 Chrome `Local Extension Settings` 与 IndexedDB；输出含绝对路径可泄站点身份与文件夹结构。
  - **S-6 明文 JSON 整文件无盐 SHA-256**: `sha256_file`（[:23-28](scripts/audit_sync_data.py#L23)）对明文 JSON（如 `accounts.json`）发原始 SHA-256，构成确认预言机（持有候选副本者可证等）。
  - 建议：仅对已确认加密的文件发哈希；明文 JSON 省略整文件哈希或用 HMAC-SHA256 随机密钥；`path` 替 `name` basename。

---

## 9. 测试覆盖缺口

| ID | 缺口 | 关联发现 |
|---|---|---|
| G-1 | 无 `iter_candidate_files` 含无关 `.json`/`.sqlite3` 目录游走测试 | S-5/S-7/S-10 |
| G-2 | 无 `main()`/`audit()` 的 `--json`/`--integrity` 分支测试；`audit()` 死代码 | L-41 |
| G-3 | 无断言 `sha256_file` 仅哈希文件内容（防回归混入调用方数据） | S-6 |
| G-4 | 无 username/URL/note/site 字段名差分泄漏测试（仅 password/accountId） | M-隐私 |
| G-5 | 无不可读 JSON 产 `readable:False` 且 `error` 仅类名、无文件字节泄漏的测试 | S-5 |
| G-6 | 无 `verify()` 拒 corrupt DB（`integrity_check` 非 "ok"）测试 | 脚本 S-3 |
| G-7 | 无 `verify()` 拒缺失/错误大小 `pass-db-key-v1` 测试 | S-4 |
| G-8 | 无错密钥/坏密文场景（`verify` 设计上就不查可解密性） | S-3 |
| G-9 | 无 `verify()` 的 `main()`/参数/stderr 测试 | 脚本 |

**合并内核测试缺口**（来自 L-2）：
- 契约测试仅 2 例（合法样本通过 + 多余字段拒），缺：负时间戳、超大整数、缺失 `*UpdatedDeviceName`（JS 反以 H-7 合成）、`recordId||accountId` 去重边（H-3）、删除-vs-更新并列（H-2）、JS↔Rust 一致性属性（C-8）。
- golden vectors 仅 1 合并例 + 空远端安全，缺并发删/更、同字段并发写、alias-passkey 链接墓碑交互。
- Rust 单测缺：计数溢出、墙钟回退、传递因果（L-6）。

---

## 10. 修复优先级（建议顺序）

1. **C-1**（onMessage sender 校验）：单一改动阻断最严重的跨扩展全库读取与静默 passkey 签署。
2. **C-2/C-3**（通行密钥私钥不可导出 + 真实用户手势、选择器移出页面 DOM）：恢复 WebAuthn 安全承诺。
3. **C-4 + 主题 C**（域名校验自动填充 + 真实 PSL）：阻断跨域凭据注入。
4. **C-7**（macOS 信封加密 DB 密钥 + AutoFill 锁门禁 + 锁即清内存）：本地攻击者面收窄。
5. **C-5/C-6**（永不裸存数据密钥 + 读不铸新密钥 + 锁按上下文强制 + 真正自动锁）：扩展"锁"成真锁。
6. **C-8**（合并内核单一真相源）：消除跨端数据损坏根因。
7. **H-9 + H-15**（同步包 AAD 绑设备/时钟 + 拒明文包降级）：E2E 不被服务器绕过。
8. **H-10/H-11/M-31**（读超时 + 线程上限 + OPTIONS 限流 + Unicode 数字校验）：服务器 DoS 与 500 收敛。
9. **C-10 + 主题 D/E + H-17/H-21/H-22**（密钥不同址 + 备份不携裸密钥 + 密文/剪贴板/输入框权限与清空）：本地与肩窥面。
10. **主题 A**（三处 CSV 公式注入统一修复）。
11. **H-1/H-2/H-3/H-4/H-7/H-12/H-23**（合并内核数据完整性 + 最小权限账号披露）。
12. **C-9/H-16/L-3**（FFI 内存安全 + CSV 重复列头崩溃 + 字段命名）：FFI 与导入鲁棒性。
13. **G-1~G-9 + L-2**：补齐能捕获上述回归的差分与契约测试。

---

## 11. 附录：JS ↔ Rust 合并内核分歧交叉表（最高风险区）

| 关注点 | JS 内核 | Rust 内核 | 关联发现 |
|---|---|---|---|
| 排序原语 | 墙钟 `*UpdatedAtMs` | HLC `physical_ms`+`logical`+op_id | C-8 |
| 因果性 | 忽略 | 仅直接父（无传递） | C-8, L-6 |
| 删除 vs 更新冲突 | 静默 LWW，删除胜并列 | `NeedsReview` 返回 | H-2 |
| 时间区间重叠 | 未用 | `<` 严格（相 Touch=重叠） | M-13 |
| 冲突浮现 | 无 | `DeleteDecision` 但死代码 | H-2, M-16 |
| 账号排序稳定性 | 未排序 | n/a | M-11 |
| 账号匹配 | `accountId` OR `recordId` | n/a | H-3 |
| 同步安全门 | 仅 local→merged | n/a | H-4 |
| 空值并列裁决 | 非对称，可丢数据 | n/a | H-1 |

两内核无法一致，因其运行于不同抽象层（快照 vs op-log），且 Rust 内核未接入任何运行时路径。在以 FFI 桥接或删除其一之前，每次修复都存在漂移另一方的风险——提交 `e2918d1`/`1f9c837`/`fa32ffb`（仅 JS 修复无对应 Rust 改动）正是此模式。

---

*报告结束。所有 file:line 均经 Read 工具逐行核对。本审查为静态对抗式分析，未执行代码；部分"Plausible"项的运行时可利用性建议以动态验证或补测确认。*
