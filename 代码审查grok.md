# Pass 代码审查报告（Grok · 第三轮）

> 审查日期：2026-07-20  
> 审查模型：grok-4.5-latest  
> 当前 HEAD：`8b04f8e`（`master` = `origin/master`）  
> 对照基线：  
> - 2026-07-19 P0/P1 加固 `83db132`  
> - 后续功能提交（明文同步可选 `38d6f83`/`34c8ac2`、密码全局显示 `65c9dcf`–`9fa4ebc` 等）  
> 方法：关键路径 Read 核实行号 + 提交历史 diff；工作区仅有 `.gradle` 锁与本报告脏文件

---

## 0. 执行摘要

第三轮结论与第二轮**实质一致**（HEAD 未再改安全核心）：

**仍然健康的加固（`83db132` 存活）**  
填充域名/HTTPS 校验、消息 `sender.id`、内容脚本无全库密码、数据密钥禁铸钥、Shadow passkey 选择器、postMessage 限 origin、If-Match 强制、幂等陈旧、purge opt-in、备份不含裸 DB 密钥、临时文件名插值、AutoFill 无交互拒绝、空 domains 不枚举全库、CSV 公式防护（多处）、JS 站点 tombstone、toast 分色。

**明确回归 / 当前最高风险**

| ID | 级别 | 一句话 |
|----|------|--------|
| C-R1 | Critical | 可选明文同步：客户端空密钥透传 + 服务端默认 `allow_plaintext=True` |
| C-R2 | Critical | `showPasswordsGlobally` 默认 `true`，敏感字段默认明文 |
| H-7 | High | Swift 合并仍 `mergedSites.isEmpty ? primary.sites`（JS 已修） |
| H-8 | High | AutoFill `prepareInterface…` 命中 record 可直接出密 |
| H-1 | High | 软件 passkey `extractable` JWK 可同步 |

**总体**：默认安全姿态为 **fail-open（默认可明文同步 + 默认可见密码）**。在默认配置下仍不建议存放高价值主保险库。  
`apps/app_macos/README.md` 仍写「无密钥禁止同步/导出」——**与代码冲突**。

---

## 1. 上一轮修复存活矩阵

| 项 | 状态 | 证据 |
|----|------|------|
| 消息 `sender.id` | ✅ | `background.js:637` |
| Fill 域名 + HTTPS | ✅ | `background.js:870-932` |
| `PASS_CONTENT_CHECK_LOGIN` | ✅ | `content.js:79`；不下发密码 |
| 有密文禁铸钥 | ✅ | `data_store.js:158-163` |
| disable 不裸写 local | ✅ | `data_store.js` disable 路径 |
| Closed Shadow 选择器 | ✅ | `content.js:556-565` |
| postMessage origin | ✅ | content / webauthn_injected |
| JS 站点 tombstone | ✅ | `sync_merge_core.js:304-305` |
| 备份无 `pass-db-key-v1` | ✅ | `backup_and_verify_local.py` |
| If-Match / 幂等陈旧 / purge | ✅ | `pass_sync_server.py` |
| 临时文件插值 | ✅ | `PassSharedFileSecretStore.swift:22` |
| AutoFill 无交互拒绝 | ✅ | `provideCredentialWithoutUserInteraction` |
| 空 domains → `[]` | ✅ | `PassSharedAccountRepository` |
| CSV 公式防护 | ✅ | ffi / options / AccountStore |
| toast 三色 | ✅ | macOS + 扩展 |
| **远程强制加密** | ❌ 回归 | `38d6f83` / `34c8ac2` |
| **服务端默认拒明文** | ❌ 回归 | 默认 `True` / env `"1"` |
| **密码默认隐藏** | ❌ 新债 | 默认 `true` |

---

## 2. Critical

### C-R1 可选明文同步（跨端 + 服务端默认开）

**引入：** `38d6f83` 支持全选分流与可选同步加密；`34c8ac2` 统一明文同步解析默认配置  

| 位置 | 行为 |
|------|------|
| `sync_crypto.js:25-28` | 空密钥 `return document` |
| `PassSharedCrypto.swift:148-151` | 空密钥 `return plaintext` |
| `AccountStore.performSyncNow` ~2398 | **无**「必须配置密钥」门禁 |
| `AccountStore.exportSyncBundle` ~1794 | 允许未加密导出 |
| `options.js:1098-1108` | 明文导出 +「请妥善保管」 |
| `options.html:130` | 「留空则使用明文同步包」 |
| `pass_sync_server.py:35` | `allow_plaintext: bool = True` |
| `pass_sync_server.py:1121` | env 默认 `"1"` |
| `ServerProvisioning.swift:400` | 未配置密钥时生成 `PASS_SYNC_ALLOW_PLAINTEXT=1` |

**失败场景：** 未填同步密钥的设备执行合并/覆盖/导出 → 密码、TOTP、passkey JWK 以 `pass.sync.bundle.v2` 明文上云/落盘。Bearer Token 持有者可读全库。

**半吊子防护：** 扩展 `runAutoSync` 仍在无密钥时跳过（`background.js:303-306`），手动同步不跳过 → 用户误以为「都加密」。

**文档冲突：** `apps/app_macos/README.md:5,47` 仍写 blocked until key configured。

**修复：** 客户端 `encrypt*` 空密钥 throw；同步/导出/预览门禁；服务端默认 `False`/`"0"`；systemd 写死 0；单测禁止明文上传；接入服务器脚本勿默认明文。

**置信度：** Confirmed  

### C-R2 全局显示密码默认开启

| 位置 | 行为 |
|------|------|
| `AccountStore.swift:164` | `showPasswordsGlobally = true` |
| ~3816 | 加载默认 `?? true` |
| `PasswordField.swift` | 跟随全局；用于密码/TOTP/Token/SSH/主密码等 |
| `SettingsView.swift:78` | Toggle「全局显示密码、令牌和密钥」 |

**失败场景：** 默认肩窥/录屏/共享屏幕可见全部敏感字段。

**修复：** 默认 `false`；敏感字段默认 SecureField。

**置信度：** Confirmed  

---

## 3. High

### H-1 软件 passkey 可导出 JWK 并同步

- `passkey_store.js:152-155, 651-668`：`extractable:true` + `exportKey("jwk")`  
- 叠加 C-R1 时远端即得可伪造断言的私钥。  

### H-2 本地密钥与密文同址（未开主密码）

- 扩展仍可把 raw key 写入 `chrome.storage.local`  
- macOS `pass-db-key-v1` app-group 明文 0600  
- AppLock 仍偏 UI；菜单 Commands 未全面 gate  

### H-3 手动 vs 自动同步加密策略不一致  

### H-4 明文同步包导出  

### H-5 SSH「接入服务器」+ 默认明文密码 UI  

- 开发 ad-hoc、调用系统 ssh；凭据进 PasswordField 且默认可见  

### H-6 FFI `last_error` 借用指针 UAF  

- `ffi/src/lib.rs:378-384`  

### H-7 Swift 站点 tombstone 回退 `primary.sites`

- `AccountStore.swift:4904`：`mergedSites.isEmpty ? primary.sites : mergedSites`  
- JS 已正确；跨端漂移 → 删光别名后 macOS 复活站点  

### H-8 AutoFill `prepareInterfaceToProvideCredential` 可直接 complete  

- 无交互路径已拒；有界面路径命中 record 仍可一次出密  

---

## 4. Medium

| ID | 摘要 |
|----|------|
| M-1 | `PASS_CONTENT_CHECK_LOGIN` 不在 `SENSITIVE_MESSAGE_TYPES`，锁定后仍可做 match 预言机 |
| M-2 | `handleSaveFromLogin` 信任 `payload.domain`，未强制 `sender.tab.url` |
| M-3 | eTLD+1 硬编码 7 后缀 |
| M-4 | 剪贴板无自动清空 |
| M-5 | JS LWW vs Rust HLC 双轨；Rust merge 非生产 |
| M-6 | passkey 选择器仍在页面进程（closed shadow 非 popup） |
| M-7 | `etag_matches` 空 If-Match 返回 True（PUT 另有门禁，API 易误用） |
| M-8 | 巨型 `AccountStore`/`options.js` 易回归 |
| M-9 | README/UI 与实现多处冲突 |
| M-10 | toast 关键词分色可能误判 |
| M-11 | 锁定后菜单栏命令可能仍写 vault |

---

## 5. Low

- Gradle 锁文件污染 git status  
- Flutter/Tauri 仍 demo-only  
- 备份仍拷贝 `sync-credentials-v1.json`（非 DB key，仍敏感）  
- toast 分色本身为正向改进  

---

## 6. 子系统简评

| 子系统 | 评价 |
|--------|------|
| 扩展 | fill/content/message 仍强；**同步/导出默认可明文**是最大洞 |
| macOS | 锁窗口/AutoFill 无交互/CSV/toast 好；**明文同步 + 默认显示密码 + Swift tombstone** 差 |
| 同步服务 | CAS/幂等/purge 好；**默认 allow_plaintext** 差 |
| 合并/Rust | JS tombstone 好；Swift 未跟；FFI last_error 未修 |

---

## 7. 修复优先级

### P0
1. 回滚默认可选明文同步（客户端强制密钥 + 服务端默认拒明文 + 单测）  
2. `showPasswordsGlobally` 默认 `false`  
3. 对齐 README / options / Settings / ServerProvisioning 文案  
4. Swift `sites: mergedSites` 与 JS 一致  

### P1
5. 手动/自动同步加密策略统一  
6. 明文导出禁止或强确认  
7. AutoFill `prepareInterface` 强制点选  
8. `PASS_CONTENT_CHECK_LOGIN` 进锁定集合；save 绑 tab 域名  
9. 菜单 Commands 尊重 AppLock  
10. SSH 凭据强制 SecureField  

### P2
11. 软件 passkey 模型  
12. 数据密钥信封化 + 锁清内存  
13. eTLD PSL、剪贴板超时、FFI last_error  

---

## 8. 方法与局限

- 关键文件 Read + 符号检索 + `git log`/`git show 38d6f83` 等  
- 未做动态 exploit / 真机 AutoFill 渗透  
- 未逐行通读 6500+ 行 AccountStore 全部分支  

---

## 9. 结语

第三轮相对第二轮：**无新 HEAD 安全变更**；问题清单以「回归确认 + 跨端细节」为主。  
工程在填充信任边界、CAS、备份密钥分离上仍有成果，但 **`38d6f83` 一类功能提交在无门禁测试下回退了默认同步机密性**。建议 P0 四项合并为一批「默认安全姿态」修复，并加 CI 断言：空密钥 encrypt 必须失败、服务端默认拒 `pass.sync.bundle.v2`。
