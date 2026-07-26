# 开发路线图：A + C + J + G

> 状态：历史路线记录（2026-07-21 基线）。当前产品已收敛到 Tauri / Docker Web / Chrome Web 扩展三端统一，现状以 [`current-app-extension-implementation-reference-zh.md`](./current-app-extension-implementation-reference-zh.md) 为准。
> 适用范围：在已排除「单 UI 框架打四端（模式 B）」之后，以共享 Rust 内核为目标的多端扩展。  
> 关联：[`cross-platform-architecture-zh.md`](./cross-platform-architecture-zh.md)、[`current-app-extension-implementation-reference-zh.md`](./current-app-extension-implementation-reference-zh.md)、[`unified-data-sync-v2-design-and-plan-zh.md`](./unified-data-sync-v2-design-and-plan-zh.md)

---

## 1. 北极星

一份 **Rust 内核**在运行时裁决加密、本地状态变更、冲突合并与同步语义；  
**macOS / 浏览器扩展 / 桌面壳 / 移动端**只负责 UI 与系统能力适配；  
用 **主端优先**节奏扩展到 Windows · Linux · iOS · Android。

**目标组合标签：`A + C + J + G`**

| 代号 | 含义 | 在本路线图中的角色 |
|------|------|-------------------|
| **A** | 共享 Core + 分族原生/近原生 UI | 目标架构 |
| **C** | 主端优先、分阶段扩端 | 交付节奏（已在走） |
| **J** | Win+Linux 共用一个桌面壳；移动双原生 | A 的桌面落地形 |
| **G** | 同一 Rust → FFI / WASM / CLI | Core 的多运行时形态 |
| **H** | 共享 ViewModel | 后期可选 |
| **I** | 设计系统 / Token | 后期可选 |
| **B** | 单框架全平台 UI | **已排除** |

---

## 2. 历史起点判定

### 2.1 已具备

- **macOS（当时基线）**（`apps/app_macos`）：当时的 SwiftUI 主客户端，包含账号 CRUD、回收站、别名、同步、AutoFill、CSV/CXF 等；此描述不代表当前主端或当前功能优先级。
- **浏览器扩展**（`apps/extension_shared` + 三壳）：填充、锁定、同步、passkey 等可构建可使用。
- **同步服务**（`apps/sync_server_ubuntu`）：哑存储 + ETag/CAS + 版本快照。
- **协议**：`pass.sync.bundle.v2` / 可选加密信封，macOS ↔ 扩展已互通。
- **Rust Core 仓库**（`core/pass_core`）：`pass_merge::v2` 文档定为合并权威；含 C ABI FFI、CLI、JS 对拍脚手架。

### 2.2 关键缺口（因此还不是完整 A+C）

- 生产 **macOS 未链接** `pass_core`；合并等业务在 Swift（如 `AccountStore.mergePayloads`）。
- 扩展 **JS 平行实现** merge（`sync_merge_core.js` 等），非 WASM/FFI。
- Flutter / Tauri / Android Provider 多为原型或骨架，**不能当产品主路径加功能**。
- 准确标签：**C 型主端先行 + 协议多端 + A 的基建（平行实现期）**，不是 A 竣工态。

### 2.3 依赖总链（不可反）

```text
P0 冻结 → P1 merge 运行时化 → P2 Core 变厚
        → P3 扩展 WASM（可与 P2 尾部并行）
        → P4 桌面壳 J → P5 移动+填充 → P6 硬化/可选增强
```

**硬规则：未完成 P1 退出门之前，不开启 Win/Linux/iOS/Android 产品功能冲刺。**

---

## 3. 总原则

1. **先统一内核，再开新端 UI。**
2. **绞杀迁移 macOS**：不推倒 SwiftUI，只替换内脏。
3. **协议已通 ≠ 内核已统一**；禁止再新增 Swift/JS 平行 merge 规则。
4. **自动填充 / 钥匙串 / 生物识别永远原生。**
5. **同步服务保持哑存储**；合并不进服务器。
6. **每阶段有硬退出门**；不达标不进入下一阶段。
7. **AI 适合写 UI 与样板；Core 契约与安全边界需人工把关。**
8. 桌面交互一套、移动交互一套；不要求桌面与移动像素级同一 UI。

---

## 4. Anti-goals（禁止项）

1. 在 Swift/JS 再写一套字段 LWW / 墓碑 / 同步安全评估规则。
2. 未完成 P1 就并行冲刺新平台产品 UI。
3. 以 Electron 作为正式桌面方案（除非明文推翻体积与安全目标）。
4. 以 UniApp 等超轻跨端方案做主 vault。
5. 服务端做业务合并或「聪明冲突解决」。
6. 为架构好看而整体重写 macOS。
7. 同时把 3 条以上桌面原型（Flutter/Tauri 分叉）都当产品维护。
8. 把密钥、密码明文写入日志或同步诊断输出。

---

## 5. 阶段详述

### P0 — 稳住现网与契约冻结

**目标**：动手术前钉死「何为正确」，保证 macOS ↔ 扩展 ↔ 服务 不因重构无声变差。

**建议体量**：1～2 周（AI 辅助一人量级，下同）。

#### 工作项

| 工作流 | 任务 | 主要路径 |
|--------|------|----------|
| 契约与向量 | 冻结/补全 V2 schema；维护黄金向量；CI 强制对拍 | `docs/schemas/*`、`docs/sync-golden-vectors.json`、`core/pass_core/js/check_merge_parity.mjs`、`crates/merge` CLI |
| 回归基线 | 手工/半自动跑通 macOS、扩展、服务关键路径并记录 | `apps/app_macos`、`apps/extension_shared`、`apps/sync_server_ubuntu` |
| 边界标注 | 标注「未来必须进 Core」的代码区；冻结新增 merge 逻辑 | `AccountStore.swift`、`extension_shared` merge 入口、`PassSyncPolicy.swift` / `sync_policy.js` |

#### 建议回归检查表（P0 起每阶段末执行）

- macOS：创建/编辑/软删/恢复/硬删、别名并集、同步预览、空远端保护、CSV 导出、App Lock。
- 扩展：站点匹配填充、锁定、同步、永久删除后旧快照不复活。
- 服务：ETag/CAS 冲突、版本列表、快照恢复。
- 安全：HTTPS 约束、日志无密钥材料。

#### 验收（退出门）

- [ ] 黄金向量 / merge 对拍在主分支 CI 常绿。
- [ ] 回归检查表已跑通并留基线说明（可附在 PR 或 `docs/` 短记录）。
- [ ] 团队约定：**禁止再往 Swift/JS 新增 merge 语义**（仅允许 bugfix 且须同步向量）。

#### 本阶段不做

- 新平台 UI；大拆 `AccountStore`；同步协议大版本变更。

---

### P1 — 合并权威运行时化（进入 A 的门槛 / G 启动）

**目标**：生产路径上的 **merge 与同步安全评估只来自 Rust**；Swift/JS 仅调用或临时 shim。

**建议体量**：3～6 周。  
**依赖**：P0。

#### 工作项

| 工作流 | 任务 | 主要路径 |
|--------|------|----------|
| FFI 表面 | 稳定导出：`merge_sync_payloads_json`、`evaluate_sync_safety_json`、错误与内存释放约定；写清 ABI 策略 | `core/pass_core/crates/ffi`、`crates/merge/src/v2`、`core/pass_core/README.md` |
| macOS 绞杀 | 打包链接 `libpass_core_ffi`；`mergePayloads` / 安全评估改 FFI；开发期可双跑对比后删除 Swift 主路径 | `apps/app_macos`（工程、`package_app.sh`、`AccountStore.swift`） |
| 扩展对拍 | JS 与 Rust **同一组向量零差分**；禁止新开 merge 分支 | `apps/extension_shared`、`core/pass_core/js/*`、相关 tests |
| 可观测性 | 同步诊断只记计数/哈希/版本，不记密码 | macOS / 扩展同步日志路径 |

#### 验收（退出门）

- [ ] **Release 配置**的 macOS 同步合并走 FFI（可用构建断言或受控日志证明）。
- [ ] 扩展 ↔ Rust 对拍 CI 必过。
- [ ] P0 回归检查表全过，行为与基线一致（允许仅日志/实现路径变化）。
- [ ] Swift 内联 merge **主路径**已删除或不再参与 Release。

#### 风险

- dylib 打包、签名、rpath → 先在 dev 包打通再改 `package_app.sh`。
- JSON 字段与 schema 微调不一致 → **以 schema + 黄金向量为准**。

#### 本阶段不做

- Win/Linux 产品 UI；移动 UI；一次性把整个 SQLite 迁入 Rust。

---

### P2 — Core 变厚（A 真正成立）

**目标**：领域规则与本地状态变更 **默认在 Rust**；`AccountStore` 等变为会话 / UI / 平台 I/O 编排层。

**建议体量**：4～8 周。  
**依赖**：P1。

#### 建议迁入顺序（由纯到脏）

1. 账号 / 文件夹 / passkey 状态机（upsert、软删、恢复、硬删+墓碑）
2. 域名别名并集规则（向量化现网行为）
3. CSV 导入导出规范化（扩展 `pass-csvio`）
4. 同步 payload 构建与 canonical 规范化
5. 本地存储适配（SQLite/SQLCipher 逐步下沉；主密钥材料可由平台注入）
6. 加密原语与参数统一（兼容现网 PBKDF2 / AES-GCM，支持升级路径）

#### 永远留在平台侧的

- 密钥容器（Keychain / 文件 0600 / DPAPI / libsecret / Keystore）
- 生物识别门槛、AutoFill UI、系统分享/导入面板
- 窗口 / 菜单 / 托盘 / 权限与装机脚本

#### 主要路径

- `core/pass_core/crates/{domain,merge,storage,transport,csvio,ffi}`
- `apps/app_macos/Sources/app_macos/AccountStore.swift`（持续抽瘦）
- `apps/app_macos/Sources/shared/*`

#### 验收（退出门）

- [ ] CRUD / 回收站 / 别名 **主路径**经 FFI（或等价 Core API）。
- [ ] 同一操作序列下，macOS 与扩展产出可对拍的同步包语义。
- [ ] Core 单测 + FFI 集成测覆盖：墓碑、空库保护、字段 LWW、别名并集。
- [ ] 客户端编排层不再实现第二套内核（代码审阅可辨）。

#### 本阶段不做

- 桌面壳功能对标 macOS 全部菜单；H（共享 ViewModel）大抽象。

---

### P3 — 扩展多运行时（G 做完）

**目标**：扩展 **运行时**使用与 App 同一 merge 实现（优先 WASM）；JS 内核降为 shim 或删除。

**建议体量**：2～5 周。  
**依赖**：P1 完成；可与 **P2 尾部并行**。

#### 工作项

1. 将 `pass-merge`（及必要只读校验）编译为 WASM。
2. `extension_shared` 构建打入 `dist/`，三壳加载。
3. background / options 同步路径调用 WASM。
4. JS 仅保留 WebExtension API、DOM 填充、存储胶水。
5. Chrome / Firefox / Safari 回归。

#### 验收（退出门）

- [ ] 扩展包内 merge 来自 WASM（或单一非平行实现），有构建证据。
- [ ] 三浏览器：同步、墓碑、冲突场景与 macOS 一致。
- [ ] 体积与大库 merge 性能可接受（需有粗测记录）。

#### 过渡策略

- P1～P2 期间允许「JS 实现 + 强制对拍」；**P3 退出后不得再依赖平行 JS merge 语义**。

---

### P4 — 桌面壳 J（Windows + Linux）

**目标**：一个桌面壳覆盖 Win/Linux，只消费 Core；功能对齐 macOS **非苹果专有**部分。

**建议体量**：4～8 周。  
**依赖**：P2 退出门（建议 P3 至少启动；理想 P3 已完成 merge 统一）。

#### 进入 P4 前必须锁定的决策

| 决策 | 选项 | 默认建议 |
|------|------|----------|
| 桌面壳技术 | Tauri 2 / Flutter Desktop / Avalonia | **Tauri 2**（Rust 同进程、包体小） |
| 与 Core 集成 | 同进程 crate / C ABI | 桌面壳 **同进程依赖 `pass_*` crates** 优先 |
| macOS UI | 保留 SwiftUI / 迁入桌面壳 | **至少保留到 P5 之后再评估** |

#### 功能切片顺序

1. 解锁/锁定、设备名、列表/编辑  
2. 回收站、别名、CSV  
3. 同步（自建服务 + 可选 WebDAV）  
4. 托盘 / 开机启动（可后置）  
5. 平台自动填充（Windows 另项评估；Linux 优先级低于移动）

#### 仓库收敛

- 当前跨平台桌面产品路径统一为 `apps/codex-tauri`；旧 Copilot/Flutter 实验壳已从仓库移除，禁止再创建未接共享 Core 的平行业务实现。

#### 验收（退出门）

- [ ] Windows、Linux 可安装运行包。
- [ ] 与 macOS 经同一自建服务同步，黄金场景一致。
- [ ] 无第二套 merge/业务实现。

#### 本阶段不做

- 用桌面壳重写 macOS 主界面；iOS/Android 大功能并行冲刺。

---

### P5 — 移动端 + 系统填充

**目标**：iOS / Android 成为系统级密码库入口（管理 UI + 系统填充），Core 同一套。

**建议体量**：8～14 周。  
**依赖**：P2；建议 P3、P4 至少其一已稳定同步路径。

#### 结构

```text
Rust Core（FFI / UniFFI）
  ├─ Android：Kotlin（Compose）管理 UI + Credential Provider
  └─ iOS：SwiftUI 管理 UI + Credential Provider Extension
```

#### 建议顺序

1. **Android**：基于 `apps/android_credential_provider` 接 vault 查询/填充，再补管理 UI。  
2. **iOS**：新建薄 App + Credential Provider，直接调 Core。  
3. 生物识别解锁、自动锁定、同步设置。  
4. Passkey 与桌面/扩展策略对齐（单独产品决策，不阻塞密码填充 MVP）。

#### 验收（退出门）

- [ ] 系统设置中可选为密码/凭据提供者。  
- [ ] 真实应用登录流可填充。  
- [ ] 与桌面/扩展同步：无重复账号复活、墓碑有效。  
- [ ] 密钥在 Keystore/Keychain；日志无密钥材料。

#### 本阶段不做

- 单框架四端 UI；服务端聪明合并。

---

### P6 — 硬化与可选增强

**目标**：安全、性能、发布与体验治理；按信号启用 H/I/Agent 等。

#### 常开

- 威胁建模、依赖审计、merge 属性/模糊测试  
- 备份恢复演练、密钥轮换路径  
- 大库（如 1 万+ 条目）同步与搜索性能  
- 签名、更新通道、版本矩阵与发布说明  

#### 可选（有痛点再上）

| 项 | 触发信号 |
|----|----------|
| **H 共享 ViewModel** | 第三端 UI 出现大量重复界面状态机 |
| **I 设计系统** | AI 多端生成 UI「不像同一产品」 |
| **桌面 Agent（E）** | 托盘+扩展+多窗口共享解锁会话且 IPC 复杂 |
| **统一 macOS 到桌面壳** | 维护 SwiftUI + 桌面壳 的成本明显高于收益 |

---

## 6. 阶段总览表

| 阶段 | 名称 | 核心产出 | 体量提示 |
|------|------|----------|----------|
| P0 | 稳住现网 | 契约冻结、对拍 CI、回归基线 | 1～2 周 |
| P1 | merge 运行时化 | macOS FFI merge；扩展强制对拍 | 3～6 周 |
| P2 | Core 变厚 | CRUD/别名/存储等进 Rust | 4～8 周 |
| P3 | 扩展 WASM | 扩展与 App 同一 merge 运行时 | 2～5 周 |
| P4 | 桌面壳 J | Win/Linux 接 Core | 4～8 周 |
| P5 | 移动+填充 | iOS/Android App + Provider | 8～14 周 |
| P6 | 硬化/增强 | 安全发布；H/I 等按需 | 持续 |

体量为 **AI 辅助一人** 的相对量级，不是合同工期。

---

## 7. 里程碑（打勾用）

```text
M1  对拍 CI 常绿，契约冻结                              ← P0
M2  macOS 生产 merge = Rust FFI                         ← P1，进入 A 的门槛
M3  CRUD/别名/墓碑主路径 = Core                           ← P2
M4  扩展 merge = WASM（或单一运行时实现）                 ← P3
M5  Win+Linux 桌面壳 + 与 macOS 同步对齐                 ← P4
M6  Android 系统填充可用                                 ← P5
M7  iOS 系统填充可用                                     ← P5
M8  安全与发布硬化；H/I 按需                             ← P6
```

---

## 8. 前 30 天执行清单

### 第 1 周（P0）

1. 接入/加固 CI：Rust `pass-merge` CLI + `check_merge_parity.mjs` + 扩展 merge 相关单测。  
2. 跑通回归检查表，记录基线。  
3. 新增短 ADR：`docs/adr-core-runtime.md`（可随后补）：ABI 策略、禁止平行 merge、阶段退出门引用本文。  
4. 在 `AccountStore.mergePayloads` 等处标注 Core 边界；**冻结新 merge 语义**。

### 第 2～3 周（P1 前半）

5. 整理 `pass-core-ffi` 导出与错误处理、内存释放测试。  
6. macOS 工程/打包链接 `pass_core_ffi`。  
7. Swift wrapper：仅 merge + sync safety。  
8. Debug 开关：FFI 与旧实现双跑对比（仅开发包）。

### 第 4 周（P1 后半）

9. 开发/预发包装默认 FFI；修复与向量差分。  
10. 删除或隔离 Swift 旧 merge 主路径。  
11. 扩展侧对拍加强；输出 WASM 预研结论（不强制本周上线 WASM）。  
12. 可安装 macOS 包 + 满表回归 → **尝试关闭 P1 退出门**。

---

## 9. 关键决策点

| 时机 | 决策 | 选项 | 默认 |
|------|------|------|------|
| P1 开始 | 绑定方式 | 手写 C ABI / UniFFI | **先用手写 C ABI（已有代码），P2 再评估 UniFFI** |
| P3 开始 | 扩展 Core | WASM / 长期仅对拍 | **WASM**（对拍只是过渡） |
| P4 开始 | 桌面壳 | Tauri / Flutter Desktop / Avalonia | **Tauri** |
| P4～P6 | macOS UI | 保留 SwiftUI / 迁壳 | **P5 前默认保留** |
| P5 前 | 移动 UI | 双原生 / Flutter 移动 | **SwiftUI + Compose** |
| P6 | H / I / Agent | 上或不上 | **有明确痛点再上** |

---

## 10. 常开事项（全阶段）

- 维护 V2 schema 与黄金向量；任何 merge 语义变更必须改向量。  
- 安全默认：无密钥日志、同步端点 HTTPS（本机回环例外策略与现网一致）。  
- 扩展三壳构建与冒烟（`extension_shared` → chrome/firefox/safari）。  
- 更新 [`current-app-extension-implementation-reference-zh.md`](./current-app-extension-implementation-reference-zh.md) 中「谁是权威实现」表述，避免文档与代码漂移。  
- 每个 PR 自检三问：  
  1. 是否新增平行业务实现？  
  2. 是否越过未完成阶段的退出门？  
  3. 是否让 Core 更接近唯一运行时权威？

---

## 11. 与现有文档的关系

| 文档 | 关系 |
|------|------|
| `cross-platform-architecture-zh.md` | 长期分层与平台适配清单；本文是其 **交付切片与禁令** |
| `implementation-spec-full-zh.md` | 模块实现要求；阶段验收应满足其测试门槛精神 |
| `unified-data-sync-v2-design-and-plan-zh.md` | 数据与合并语义；P0～P3 必须服从 |
| `current-app-extension-implementation-reference-zh.md` | 现状真源；随 P1+ 重写「权威实现」段落 |
| `sync-protocol-contract-zh.md` / schemas | 协议与机器校验；服务端与客户端共同遵守 |

若本文与旧「Flutter 五端 UI 默认」表述冲突：**以本文交付顺序为准**——UI 技术可在 P4/P5 决策点调整，但 **不得绕过 Core 运行时化**。

---

## 12. 路线图一览

```text
P0  冻结契约 / 回归 / 禁止平行 merge
 │
 ▼
P1  macOS + 对拍 → Rust merge 成为运行时事实     ═══ A 门槛（G 启动）
 │
 ▼
P2  Core 变厚（状态机 / 存储 / CSV / …）         ═══ A 成立
 │
 ├────────────────┐
 ▼                ▼
P3 扩展 WASM     （可与 P2 尾部并行）
 │
 ▼
P4 桌面壳（默认 Tauri）Win + Linux = J
 │
 ▼
P5 Android → iOS + 原生 Provider
 │
 ▼
P6 硬化；可选 H / I / Agent / 统一 macOS 壳
```

---

## 13. 一句话

**近期唯一主线：让 Rust Core 在 macOS（以及扩展 merge）上成为运行时事实；在此之前，不扩 Win / Linux / iOS / Android 产品面。**

---

## 14. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-21 | 初版：基于现网 macOS+扩展+平行实现现状，固化 A+C+J+G 分阶段路线 |
