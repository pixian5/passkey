# Pass 当前实现与设计决策基准

> 文档性质：**当前代码事实**，不是目标蓝图。版本以仓库根目录 `VERSION` 为唯一来源，当前为 `1.2.0`。
>
> 使用规则：当历史设计稿、路线图、旧 Swift 代码或界面文字与本文冲突时，先以本文和自动化门禁为准，再回到代码核对。没有测试或代码依据时，不得写“完整”“完全一致”“所有端均支持”。

## 1. 当前产品到底包含哪些端

### 1.1 三个统一管理面

| 表面 | 用户入口 | 管理 UI | 命令适配器 | 合并实现 |
|---|---|---|---|---|
| Tauri 桌面 | `PassDesktop.app`，也可构建 Windows/Linux | `apps/codex-tauri/src` | `apps/codex-tauri/src-tauri` | Rust `pass_merge::v2` |
| Docker Web | `apps/pass-web` 暴露网页端口 | 读取 Tauri 生成的同一份 `dist` | `/api/invoke/:command` | Rust `pass_merge::v2` |
| Chrome Web 扩展 | `apps/extension_chrome_web` | 构建时从 Tauri UI 生成 | `extension-bridge.js` | 同源 JS 实现，必须与 Rust 黄金向量对拍 |

“三端统一”只表示：管理 UI 单源、UI 使用的命令名都有适配、核心数据语义有共同契约。它**不表示**三端存储介质、系统能力、返回对象形状、锁运行时或合并语言实现完全相同。

### 1.2 保留但不是统一管理面的模块

| 模块 | 当前定位 | 不能据此得出的结论 |
|---|---|---|
| `apps/app_macos` | 旧 SwiftUI 客户端，以及 macOS AutoFill/Credential Exchange 参考实现 | 不是当前桌面主端；不能把其数组、排序或锁实现当三端规范 |
| `apps/extension_shared` | popup、网页填充、Passkey、Firefox/Safari 共享代码 | 不是新版 Chrome 管理页本身 |
| `apps/extension_firefox` / `extension_safari` | 平台壳和系统集成 | 未承诺拥有 Chrome Web 管理面的全部能力 |
| `apps/android_credential_provider` | Android 14+ Credential Provider 开发中模块 | 不是可与三端等价使用的完整 Android 客户端 |
| `apps/sync_server_local` | 本地启动/launchd 辅助脚本 | 不是独立业务合并服务 |

## 2. 单一 UI、生成物和修改入口

- 唯一管理 UI 源码是 `apps/codex-tauri/index.html`、`src/main.js`、`src/styles.css`。
- `npm run prepare:dist` 生成 Tauri/Docker Web 使用的 `apps/codex-tauri/dist`，并同步 Chrome Web 扩展的 `web-options.html`、`web-main.js`、`web-options.css`。
- `scripts/build-extension-chrome-web.sh` 也会先同步 UI。生成后的三个扩展 UI 文件不能手工维护，否则下次构建会覆盖。
- Chrome 的 popup、content script 和 WebAuthn 注入不来自管理 UI；它们属于扩展专属界面和系统能力。
- UI 当前调用 68 个命令。命令矩阵只证明“有对应处理分支”，不自动证明三个分支的所有返回字段和副作用都相同。

## 3. 数据模型：哪些是实体，哪些是关系和顺序

### 3.1 顶层载荷

当前同步载荷是 `pass.data.v2` / `pass.sync.bundle.v2`，业务 `payload` 包含：

- `accounts`：账号实体，活动、回收站和永久删除墓碑都可能存在；
- `folders`：文件夹实体，包括删除墓碑；
- `passkeys`：软件管理的 Passkey 记录，包括删除墓碑；
- `allRegularAccountIds`、`allRegularOrderUpdatedAtMs`、`allRegularOrderUpdatedDeviceName`；
- `folderOrderIds`、`folderOrderUpdatedAtMs`、`folderOrderUpdatedDeviceName`。

同步包外层还包含 schema、导出时间和来源信息。启用同步加密密钥时，整个同步包再包装为 `pass.sync.encrypted.v1` AES-256-GCM 信封。

### 3.2 账号身份和字段

- `recordId` 是首选稳定身份；历史数据可回退到 `id` / `accountId`，但新写入必须保留稳定 ID。
- 用户名和密码都允许为空；新建/编辑仍至少需要一个可识别站点。
- `username`、`password`、`totpSecret`、`recoveryCodes`、`note`、Passkey 关联等各有更新时间和设备名，不能只看账号整体 `updatedAtMs`。
- `folderIds`、`sites`、`passkeyCredentialIds` 是当前可见关系集合；对应的 `folderMembershipStates`、`siteAliasStates`、`passkeyLinkStates` 记录关系增加/移除及墓碑。
- 兼容字段 `folderId`、`regularSortOrder`、`pinnedSortOrder` 仍可能存在，但普通账号顺序的权威是作用域 ID 数组，不是稀疏数字序号。

### 3.3 删除的三个状态

| 状态 | 条件 | UI 可见性 | 同步意义 |
|---|---|---|---|
| 活动 | `isDeleted=false` 且 `isPermanentlyDeleted=false` | 正常列表 | 参与活动数量和排序 |
| 回收站 | `isDeleted=true` 且非永久删除 | 只在回收站 | 可恢复，并保留原文件夹关系 |
| 永久删除墓碑 | `isPermanentlyDeleted=true` | 不显示，也不计入预览可见数量 | 阻止旧设备把账号复活 |

“清空回收站”不是物理删除数组元素。永久删除必须保留稳定 ID 和删除元数据，同时清除密码、TOTP、恢复码等敏感材料。任何预览、导入摘要和数量都必须排除永久删除墓碑，不能把墓碑误报为新增账号。

### 3.4 文件夹归属语义

- 单选或多选“添加到文件夹”面板的勾选集合表示最终归属集合，而不是只追加关系。
- 已经属于某个勾选文件夹的账号保持原位置，不因再次确认而重排。
- 新加入文件夹的账号按当前批量选择的相对顺序插入该文件夹普通区顶部。
- 未勾选文件夹会移除归属并写关系墓碑；删除文件夹只移除归属，账号仍在“全部账号”。
- 从回收站恢复时，仅恢复到仍存在的原文件夹；已经删除的文件夹会被过滤。

## 4. 排序是作用域字段，不是账号的全局数字

| 作用域 | 权威字段 | 含义 |
|---|---|---|
| 全部账号 | 顶层 `allRegularAccountIds` | 所有活动普通账号在“全部账号”的顺序 |
| 某文件夹 | `Folder.regularAccountIds` | 该文件夹活动普通账号的独立顺序 |
| 文件夹侧栏 | 顶层 `folderOrderIds` | 活动文件夹顺序 |

数组第一个 ID 就是普通区最上方。新建账号、新加入文件夹和恢复账号都进入相应普通区顶部，但不会改变其置顶状态，也不会越过置顶分区。批量操作必须保持选中账号原相对顺序。

加载、导入和同步后会规范化顺序：去重、移除无效/删除/非成员 ID，再把合法但遗漏的活动 ID 追加到末尾。固定“新账号”文件夹始终位于文件夹列表第一。置顶是独立分区；普通顺序可继续保留置顶账号 ID，以便取消置顶后返回原普通位置。

每个顺序作用域有独立更新时间和设备名。同步冲突时胜出的**整个作用域数组**作为基线，再执行规范化；账号密码变新不会顺便覆盖文件夹顺序。

## 5. 合并和安全裁决

### 5.1 合并规则

- Tauri/Web 的运行时权威是 Rust `pass_merge::v2`；Chrome 使用 JS 同源实现并由黄金向量约束。
- 标量字段采用字段级 LWW：先比较字段时间戳，再比较设备名和值，保证相同输入得到确定结果。
- 关系集合不能只做数组并集；移除关系时必须保留关系墓碑。
- 永久删除具有粘性：普通合并不能自行清除 `isPermanentlyDeleted`。
- 服务端不执行合并，也不理解账号、文件夹和顺序；合并只发生在客户端。

### 5.2 安全闸门

以下情况应阻止写入或要求明确风险确认：

- 非空本地即将被空远端清空；
- 本地稳定账号、文件夹或 Passkey 身份在合并结果中无解释地丢失；
- 同步密钥不匹配、加密信封损坏、JSON/Schema 不合法；
- 覆盖模式造成大量删除或远端状态不满足前提；
- 远端已有状态但缺少可用于并发保护的 ETag。

预览只计算差异和安全报告，不落盘、不推送。预览中的“新增”表示相对于当前本地可见状态会新增的活动账号，不等于远端数组中记录总数。

## 6. 三端本地保存和锁

### 6.1 存储位置与事务边界

| 表面 | 业务数据 | 设置/密钥 | 当前原子性和并发边界 |
|---|---|---|---|
| Tauri | 本地 SQLite KV 中的加密 vault 集合 | 同步设置文件；启用应用锁时 Token/同步密钥单独密封 | 同一进程内多集合事务；本地加密文件使用临时文件、文件 `fsync`、rename、目录 `fsync` |
| Docker Web | `/data/pass-web-vault-v1.enc` | `/data/pass-web-vault-key-v1` 与 vault 内设置 | 进程内 `Mutex` 串行；原子文件替换带 `fsync`；**没有跨进程 revision/CAS** |
| Chrome Web | `chrome.storage.local` 中的加密管理工作区 | 本地 AES-GCM 加密设置、UI 偏好和创建服务草稿 | 管理页写入后镜像后台；单次后台 IndexedDB 写事务覆盖账号/文件夹/Passkey/布局集合 |
| Chrome 后台填充层 | IndexedDB `pass.local.db.v1` 业务集合镜像 | 数据密钥由扩展本地保存 | 填充/WebAuthn/后台同步写入后广播回管理页 |

Docker Web 必须单实例运行。同一个 `/data` 目录不能同时挂给两个写进程，否则两个进程各自加载旧状态后可能发生最后写入者覆盖。Tauri 当前也没有为两个同时运行的应用实例提供文件级 revision/CAS 保证。

Chrome 管理页和后台目前仍有两套运行时锁状态。数据通过消息镜像保持一致，但锁定/解锁事件和失效时机尚未收敛成单一状态机；排障时必须分别检查管理页和 service worker。

`docs/sqlite-schema.sql` 与 `core/pass_core/crates/storage/migrations/0001_initial.sql` 是相同的 V1 规范化候选 DDL，包含 `accounts/op_logs/version_vectors` 等表。当前 Tauri 和旧 Swift 实际只创建 `kv` 表，Docker Web 不使用 SQLite；因此候选 DDL 不能当作当前数据库结构，也不能直接应用到 `pass-tauri.db`。

### 6.2 保存失败语义

- 账号、文件夹、Passkey、全局顺序等关联集合应在同一事务/逻辑保存中提交。
- 业务保存失败时，内存、撤销栈和快照栈必须回滚到已持久化状态，不能让 UI 显示未落盘数据。
- 同步采用先写本地合并结果、再推送远端。远端推送失败时，本地合并结果保留并明确提示重试；不能报告为全部成功。
- 远端已经写成功但客户端响应丢失时，服务端通过同一 `Idempotency-Key` 重放，避免一个逻辑写入产生多个版本。

## 7. 设置保存、应用锁和密钥

同步相关设置不需要“保存同步设置”按钮：

- 是否启用同步、自建服务器地址、Bearer Token、同步加密密钥、自动同步间隔、主同步源和 WebDAV 偏好由统一 UI 自动保存；
- 常用输入使用约 450 ms 防抖；部分选择框在 `change` 时保存；关闭设置页前会冲刷尚未完成的设备名保存；
- 自动保存失败目前写入控制台或显示错误，不能把输入框中的值等同于已经持久化；排障时应重新打开设置确认；
- SSL 证书/私钥路径属于“创建服务”草稿，也会自动保存；只有 Tauri 能实际通过 SSH 创建服务。

Bearer Token 和同步加密密钥都允许留空，项目不会自动生成 Bearer Token：

- Token 空：客户端不发送 `Authorization`；服务器未配置 Token 时进入 `default` scope 的开放模式；
- Token 非空：服务器按 Token 映射到 scope；无 Token 返回 401，错误 Token 返回 403；
- 同步密钥空：传输明文 `pass.sync.bundle.v2`，服务器还必须允许明文；
- 同步密钥非空：传输 `pass.sync.encrypted.v1`；所有设备必须配置同一密钥。

仓库的 Token 轮换脚本只把用户通过 `PASS_SYNC_NEW_BEARER_TOKEN` 或交互输入提供的现有 Token 写入配置文件；它不会生成或回显 Token。空 Token 开放模式也是受支持配置，部署和升级脚本不得擅自替换。

主密码不做 `trim`，首尾空格是密码的一部分。应用锁定后，不应把 Token、同步密钥或解密后的业务数据返回 UI。Touch ID 仅在 macOS Tauri 可用；Docker Web 和 Chrome 不得伪装成功。

## 8. 同步流程和模式

### 8.1 自建服务器

接口：

- `GET/PUT /v2/sync/state`；
- `GET /v2/sync/versions`；
- `GET /v2/sync/versions/{id}`；
- `POST /v2/sync/versions/{id}/restore`；
- `/v1/sync/payload` 仅作兼容入口。

`merge` 的逻辑顺序是：拉取远端及 ETag → 客户端合并和安全评估 → 写本地合并结果 → 带 `If-Match` 和 `Idempotency-Key` 推送远端。若 PUT 返回 412，客户端重新拉取、重新合并并重试，最多 5 次。更新已有远端却没有 `If-Match` 时服务器返回 428。

自建服务器 URL 只有 `localhost`、`127.0.0.1` 和 `::1` 可以使用 HTTP；非回环地址必须使用 HTTPS。本地脚本打印的局域网 HTTP URL 仅表示监听/健康检查地址，不代表当前客户端会接受它作为同步 URL。

| 模式 | 本地结果 | 远端结果 | 主要保护 |
|---|---|---|---|
| 预览合并 | 不写 | 不写 | 展示可见账号级差异和安全原因 |
| 合并 | 写合并结果 | 写同一合并结果 | 字段级 LWW、关系墓碑、ETag |
| 云端覆盖本地 | 写远端结果 | 保持/重写同一远端结果 | 远端不能为空，必须风险确认 |
| 本地覆盖云端 | 本地不需改动 | 写本地结果 | 必须风险确认；允许首次推送到空远端 |

### 8.2 WebDAV 和多来源

- Tauri、Docker Web 支持 WebDAV；Chrome 明确不支持，原因是浏览器 CORS/凭据边界。
- WebDAV 使用一个 JSON 资源及 ETag/If-Match，没有自建服务器的版本列表、审计和恢复接口。
- UI 可以设置主同步源和其它启用来源。主源产生合并结果，其它来源作为后续写入目标；某个来源失败必须单独报告完成数，不能掩盖其它来源状态。

### 8.3 服务器版本恢复

“恢复服务器版本”不是只把旧包覆盖到当前设备：客户端先读取当前 ETag，调用服务器恢复接口把指定历史版本生成一个**新的当前版本**，再刷新/覆盖本地。恢复前创建本地安全快照。恢复动作本身也新增一个服务器版本，不会倒退 revision 或删除后来的历史记录。

同步服务器每个 scope 最多保留 50 个载荷版本、5000 条不含密文正文的审计记录。限流当前按 TCP 对端 IP；放在反向代理后会把代理视为客户端，代码也不会直接信任任意 `X-Forwarded-For`。

仓库中的通用 systemd 模板不强制 TLS，证书和私钥必须成对通过 `/etc/pass-sync/pass-sync-server.env` 配置。Tauri/Swift SSH 创建服务在目标 URL 为 HTTPS 时会把已选证书复制到 `/etc/pass-sync/tls/`，并为那次生成的服务单元写入固定证书路径。这两种部署入口不能混为一谈。

## 9. 导入、导出和预览

### 9.1 同步包

- 导出包含实体、墓碑、关系状态和三类顺序；完成后只显示数量/文件信息，不显示秘密内容。
- Tauri 选择保存目录；Web/Chrome 通过浏览器下载。Web 后端只允许在应用数据目录处理导出路径，拒绝 `..` 和越界路径。
- 导入是合并，不是覆盖。先选择文件并解析，再以 `apply=false` 生成账号级差异；用户确认后才以 `apply=true` 创建快照并写本地。
- 取消、解析失败、安全检查失败和密钥错误都不得改变本地状态。

### 9.2 CSV 和 Google Authenticator

- CSV 是账号字段导入，不使用同步包冲突协议；用户名和密码可以为空。
- 浏览器 CSV 方言映射由共享 CSV Core 约束；导出会处理 CSV 公式注入风险。
- Google Authenticator 导入会更新匹配账号的 TOTP，未匹配条目新建账号，并返回创建/更新/跳过摘要。
- CSV 不携带墓碑、关系时间戳和完整顺序，不能当备份同步格式。

## 10. 撤销、重做、历史和快照不是一回事

| 名称 | 保存内容 | 用途 | 是否同步 |
|---|---|---|---|
| 撤销栈 | 操作前完整本地 payload + 简短动作标题 | 回到上一业务状态 | 否 |
| 重做栈 | 撤销时保存的当前 payload | 重放刚撤销状态 | 否 |
| 可浏览历史窗口 | 撤销/重做栈的标题、时间、所在栈 | 查看并从最新项撤销/重做 | 否 |
| 本地安全快照 | 同步、导入、恢复、撤销/重做等高风险写入前 payload | 独立恢复点 | 否 |
| 服务器版本 | 每次成功 PUT/恢复后的远端完整包 | 跨设备远端恢复 | 是服务器状态 |

三端撤销历史最多保留 100 条，本地安全快照最多保留最新 20 个。新业务写入成功后会清空重做栈；失败操作不应产生可用撤销项；撤销会跳过与当前 payload 相同的 no-op。当前标题是“新建账号”“编辑账号”“删除文件夹”等动作级摘要（Tauri 持久化标题常带“前自动备份”，UI 气泡会去掉该后缀），不包含具体账号内容，也不保存密码、TOTP、恢复码和备注正文。

恢复本地快照会先为当前状态再创建一份快照，然后整体替换本地 payload。历史、快照和服务器版本都不是字段级“时间旅行”；恢复后下一次同步仍会按当前墓碑和字段时间戳裁决。

## 11. 平台能力精确矩阵

| 能力 | Tauri | Docker Web | Chrome Web 扩展 |
|---|---|---|---|
| 统一管理 UI 与 68 个 UI 命令入口 | 有 | 有 | 有 |
| 账号/文件夹/排序/回收站主流程 | 有 | 有 | 有 |
| 自建服务器同步、预览和覆盖模式 | 有 | 有 | 有 |
| WebDAV | 有 | 有 | 不支持，调用报错 |
| 自建服务器版本列表/恢复 | 有 | 有 | 有 |
| SSH 检测和创建服务 | 实际执行 | 有限检测/保存草稿，创建报错 | 保存草稿，创建报错 |
| SSL 证书/私钥草稿保存 | 有 | 草稿 | 草稿 |
| 原生目录/文件选择器 | 有 | 浏览器上传下载 | 浏览器上传下载 |
| Touch ID / 生物识别 | 仅 macOS | 不支持 | 不支持 |
| 网页账号填充、popup、WebAuthn 注入 | 不提供 | 不提供 | 扩展专属 |
| 多用户/租户隔离 | 不适用，本地单 vault | **未实现，单用户 vault** | 浏览器配置文件内单 vault |
| 跨进程并发写 CAS | 未提供 | 未提供 | 不适用同一扩展实例；多上下文靠消息/事务协调 |

“命令覆盖 68/68”不能替代这张能力表。不支持的命令可能为了 UI 契约仍有处理分支，但必须返回空值、false 或明确中文错误，不能理解为实际支持。

## 12. 已知尚未统一和不能误解的地方

1. Chrome 管理页与后台锁状态仍是两套运行时状态机。
2. Chrome 的 JS merge 不是 Rust/WASM 运行时；正确性依赖黄金向量和桥接测试。
3. 少数命令仍返回数字、布尔、字符串或 `null`；尚未完成统一对象 Schema。
4. Docker Web 是单用户、单进程 vault，没有 Cookie 会话、多租户授权、WebAuthn 登录或跨进程 CAS。
5. Tauri/Web 的本地文件保存没有跨进程 revision；不要同时让多个实例写同一数据目录。
6. 旧 Swift 文件夹内顺序仍与当前每文件夹 `regularAccountIds` 模型不同，只能作为迁移参考。
7. Firefox、Safari、Android 和旧 Swift 没有被命令矩阵证明与三端管理面等价。
8. 软件 Passkey 私钥是可同步材料，不具备硬件认证器不可导出的安全属性。
9. 同步服务器限流按 TCP 对端 IP，反向代理部署必须额外设计可信代理策略。
10. `pass.data.v2` 机器 Schema 需要与 Rust/JS 当前字段同步维护；新增顺序或墓碑字段时必须同时改两份 Schema 和黄金向量。
11. `cargo fmt --check` 目前仍会发现仓库既有 Rust 格式差异；CI 中格式检查是 informational，不代表代码逻辑失败，也不代表可以继续扩大格式漂移。

## 13. 验证入口和当前基线

```bash
node scripts/version.mjs check
node scripts/check_command_matrix.mjs
bash scripts/core_gate.sh
node core/pass_core/js/check_merge_parity.mjs
cd apps/extension_shared && npm test
cd apps/pass-web && cargo test --locked
cd apps/codex-tauri/src-tauri && cargo test --locked
cd apps/sync_server_ubuntu && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

版本 `1.2.0` 的已验证基线：版本落点 45 项、UI 命令 68 个、扩展测试 79 项、Docker Web 9 项、Tauri 22 项、同步服务器 33 项、脚本测试 23 项。Core 门禁、Clippy correctness、Docker Compose 解析、JSON Schema 文件解析、Shell 语法、Markdown 本地链接和 Swift/Xcode 构建也纳入本轮验证。数字只描述该版本测试发现量，测试增删后应重新运行并更新，不能永久照抄。

关联文档：

- [三端命令矩阵](./three-surface-command-matrix-zh.md)
- [本地写入耐久性与历史一致性](./local-write-durability-and-history-consistency-zh.md)
- [作用域账号排序](./scoped-account-order-design-zh.md)
- [同步包与手动导入导出](./manual-sync-import-export-design-and-implementation-zh.md)
- [跨平台同步后端契约](./cross-platform-sync-backends-v2-zh.md)
- [本轮代码/文档审计](./audit-2026-07-26-zh.md)
