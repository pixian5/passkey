# Pass 当前实现与设计决策基准

> 文档性质：**当前代码事实**，不是目标蓝图。版本以仓库根目录 `VERSION` 为唯一来源；本轮完成后由版本脚本递增。
> 当前为 `1.5.4`。
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
- UI 当前调用 72 个命令。命令矩阵只证明“有对应处理分支”，不自动证明三个分支的所有返回字段和副作用都相同。

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
- 账号级元数据时间戳并列时，按创建设备、最后操作设备、历史账号 ID、主站点、创建用户名和稳定记录 ID 组成的稳定键选择来源；正反向输入不能改变结果。
- 纯合并函数禁止读取当前墙钟。关系墓碑只能使用载荷中已有的活动时间，否则预览、条件写入重试和下一轮同步会不断产生新状态。
- 旧载荷允许在首轮归一化时补齐默认字段；归一化后再次合并必须达到固定点。双客户端回归测试还必须验证字段、永久删除墓碑、全局顺序和文件夹顺序不变。
- 站点别名归并在安全检查前执行；别名归并不能越过永久删除墓碑。
- `pinnedViews` 按作用域键合并，同一作用域由较新的账号裁决，单侧作用域保留。
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
| Tauri | 本地 SQLite KV 中的加密 vault 集合 | 同步设置文件；启用应用锁时 Token/同步密钥单独密封 | 同一进程内多集合事务；跨 SQLite 与加密历史文件的写入使用加密待完成日志，数据库打开时幂等恢复；本地加密文件使用临时文件、文件 `fsync`、rename、目录 `fsync` |
| Docker Web | `/data/pass-web-vault-v1.enc` | 未启用应用锁时为 `pass-web-vault-key-v1`；启用后为主密码派生密钥包装的 `pass-web-vault-key-wrapper-v1.json` | 进程内 `Mutex` 串行；应用锁变更用带 SHA-256 校验的双文件事务同时提交 vault 与密钥凭据；数据目录单实例锁拒绝第二写实例，**仍没有跨进程 revision/CAS**；非回环监听必须配置网页访问令牌，除非明确声明只经宿主机回环 Docker 映射访问 |
| Chrome Web | `chrome.storage.local` 中的加密管理工作区 | 本地 AES-GCM 加密设置、UI 偏好和创建服务草稿 | 管理页写入后镜像后台；单次后台 IndexedDB 写事务覆盖账号/文件夹/Passkey/布局集合 |
| Chrome 后台填充层 | IndexedDB `pass.local.db.v1` 业务集合镜像 | 数据密钥由扩展本地保存 | 填充/WebAuthn/后台同步写入后广播回管理页 |

Docker Web 必须单实例运行。同一个 `/data` 目录不能同时挂给两个写进程，否则两个进程各自加载旧状态后可能发生最后写入者覆盖。Tauri 当前也没有为两个同时运行的应用实例提供文件级 revision/CAS 保证。

Chrome 后台 Service Worker 的 `chrome.storage.session` 锁记录是唯一权威状态。popup 与管理页只订阅 `PASS_LOCK_STATE_CHANGED`：收到锁定事件后先禁用交互、清除会话数据密钥，再清除账号、历史与同步密钥输入；即使会话存储删除失败，页面内存仍必须清空。连续锁定/解锁通知在每个页面内串行处理，解锁不能越过尚未完成的锁定清理。收到解锁事件后重新从加密存储加载。页面可请求“立即锁定”，但不能自行把状态改为已解锁。

`docs/sqlite-schema.sql` 与 `core/pass_core/crates/storage/migrations/0001_initial.sql` 是相同的 V1 规范化候选 DDL，包含 `accounts/op_logs/version_vectors` 等表。当前 Tauri 和旧 Swift 实际只创建 `kv` 表，Docker Web 不使用 SQLite；因此候选 DDL 不能当作当前数据库结构，也不能直接应用到 `pass-tauri.db`。

### 6.2 保存失败语义

- 账号、文件夹、Passkey、全局顺序等关联集合应在同一事务/逻辑保存中提交。
- 业务保存失败时，内存、撤销栈和快照栈必须回滚到已持久化状态，不能让 UI 显示未落盘数据。
- Tauri 普通修改、撤销、重做以及同步/导入/快照恢复写入在 SQLite 提交前先落加密待完成日志；若进程在数据库与历史栈两次耐久写入之间退出，下次打开数据库会按固定操作 ID 补完历史或栈移动。日志损坏或数据库状态与日志不一致时拒绝继续覆盖。
- Swift 保存账号、文件夹或 Passkey 失败后从 SQLite 重载真实集合；账号归属与文件夹顺序必须在同一事务成功后才产生成功历史和提示。
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

主密码不做 `trim`，首尾空格是密码的一部分。Docker Web 启用锁、修改主密码、关闭锁会先暂存新 vault 密文和新密钥包装/原始密钥，再写事务标记并幂等替换；重启会先恢复未完成事务，摘要不一致时拒绝覆盖。应用锁定后，不应把 Token、同步密钥或解密后的业务数据返回 UI。Touch ID 仅在 macOS Tauri 可用；Docker Web 和 Chrome 不得伪装成功。

## 8. 同步流程和模式

### 8.1 自建服务器

接口：

- `GET/PUT /v2/sync/state`；
- `GET /v2/sync/versions`；
- `GET /v2/sync/versions/{id}`；
- `POST /v2/sync/versions/{id}/restore`；
- `/v1/sync/payload` 仅作兼容入口。

`merge` 的逻辑顺序是：拉取远端及 ETag → 别名归并 → 客户端合并和安全评估 → 写本地合并结果 → 带 `If-Match` 和 `Idempotency-Key` 推送远端。若 PUT 返回 412/428，客户端重新拉取、重新合并并重试，最多 5 次。成功写入还必须校验 JSON 回执及 `ETag`、`X-Sync-*` 响应头的一致性。恢复接口要求 `If-Match` 和 `Idempotency-Key`，重复请求只重放原回执，不重复创建历史版本。

自建服务器 URL 只有 `localhost`、`127.0.0.1` 和 `::1` 可以使用 HTTP；非回环地址必须使用 HTTPS。本地脚本打印的局域网 HTTP URL 仅表示监听/健康检查地址，不代表当前客户端会接受它作为同步 URL。

| 模式 | 本地结果 | 远端结果 | 主要保护 |
|---|---|---|---|
| 预览合并 | 不写 | 不写 | 展示可见账号级差异和安全原因 |
| 合并 | 写合并结果 | 写同一合并结果 | 字段级 LWW、关系墓碑、ETag |
| 云端覆盖本地 | 写远端结果 | 保持/重写同一远端结果 | 远端不能为空，必须风险确认 |
| 本地覆盖云端 | 本地不需改动 | 写本地结果 | 必须风险确认；允许首次推送到空远端 |

### 8.2 WebDAV 和多来源

- Tauri、Docker Web 和 Chrome 均支持 WebDAV。Chrome 依靠扩展的跨域 host permission 在后台 Service Worker 执行 GET/PUT、可选 Basic Auth 和 ETag/If-Match；普通网页本身的 CORS 能力不能类推到扩展后台。
- WebDAV 使用一个 JSON 资源及 ETag/If-Match，没有自建服务器的版本列表、审计和恢复接口。
- UI 可以设置主同步源和其它启用来源。主源产生合并结果，其它来源作为后续写入目标；镜像拉取或推送失败不阻塞主源，但会单独报告并进入 outbox；主源拉取失败则停止本次同步。
- Chrome 的 `managedMultiSourceSync=true` 表示 UI 只能调用一次 `sync_now_mode`，由后台一次性读取并调度全部已启用来源；不得再按自建服务器和 WebDAV 各调用一次。Tauri/Docker Web 仍由共享 UI 按主源、镜像顺序调用各自后端命令。
- Tauri、Swift 与 Chrome 扩展的补偿任务都按同一策略记录：目标 + payload SHA-256 相同才复用同一次逻辑写入的 ETag/revision 与幂等/会话/操作 ID；5 秒起步、最高 1280 秒退避，连续失败 12 次进入 `paused`。`paused` 不会因时间到期而被自动重试，只有用户点击“立即重试补偿任务”才把尝试次数和等待时间重置为零，且不更换逻辑写入 ID。同步页会明确显示“已暂停”，镜像源失败时 UI 只提示“同步部分完成”，不会显示绿色全成功。
- Docker Web 将补偿队列加密保存到自身 vault：自建服务器和 WebDAV 都保存 payload 摘要、ETag 与幂等/会话/操作 ID，连续失败 12 次进入 `paused`，手动重试才恢复。共享 UI 可以读取队列并清理已禁用目标；网页关闭后任务仍保留，但仅在 Web UI 打开并触发自动同步时执行，不存在独立后台调度器。

### 8.3 服务器版本恢复

“恢复服务器版本”不是只把旧包覆盖到当前设备：客户端先读取当前 ETag，调用服务器恢复接口把指定历史版本生成一个**新的当前版本**，再刷新/覆盖本地。恢复前创建本地安全快照。恢复动作本身也新增一个服务器版本，不会倒退 revision 或删除后来的历史记录。

同步服务器每个 scope 最多保留 50 个载荷版本、5000 条不含密文正文的审计记录。限流当前按 TCP 对端 IP；放在反向代理后会把代理视为客户端，代码也不会直接信任任意 `X-Forwarded-For`。

服务器启动会自动迁移旧 SQLite：为 `payload_versions`、`sync_idempotency`、`payloads` 补齐 `scope_revision` 列；按 scope 和 `version_id` 检查历史 revision，完整 scope 保留原值，存在缺失/非法值的 scope 全量重建连续序号；当前 payload/幂等记录按 `scope + etag` 回填，找不到历史匹配时为 `0`。该迁移不改写载荷 JSON、不生成 Token/密钥、不跨 scope 合并。启动阶段另有独立的旧协议载荷清理，会把不支持的记录转移到临时 `.jsonl` 后移出当前表；升级前必须备份数据库，不能让新旧服务器进程并行写同一文件。

仓库中的通用 systemd 模板不强制 TLS，证书和私钥必须成对通过 `/etc/pass-sync/pass-sync-server.env` 配置。Tauri/Swift SSH 创建服务在目标 URL 为 HTTPS 时会把已选证书复制到 `/etc/pass-sync/tls/`，并为那次生成的服务单元写入固定证书路径。这两种部署入口不能混为一谈。

同步服务器数据库使用 WAL + `synchronous=FULL`；数据目录和备份目录为 `0700`，数据库、WAL、SHM、令牌与隔离文件为 `0600`，systemd 和备份脚本使用 `UMask=0077`。Tauri/Swift 创建服务也生成相同权限，不得只修改仓库模板。空 `tokens.conf` 明确表示开放模式，不得写成 `default=` 或自动生成 Token。

Tauri/Swift 的 SSH 创建服务不再使用 `accept-new`。首次连接先用 `ssh-keyscan` 读取公钥、用 `ssh-keygen -E sha256` 展示指纹，用户与服务器控制台核对并确认后才写入应用私有 `known_hosts`；22 端口使用主机名，非 22 端口必须精确匹配 `[主机]:端口`。之后统一使用 `StrictHostKeyChecking=yes`，主机密钥变化会被拒绝。

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

Chrome 有管理页工作区快照和后台同步安全快照两种本地来源。`list_local_snapshots` 合并展示两者并用 `workspace:` / `background:` 前缀路由恢复；后台快照本体始终留在加密 IndexedDB，不复制到管理页存储。恢复后台快照前，后台先保存当前权威业务数据，再写入目标快照并广播管理页刷新。旧后台快照迁移时按创建时间补稳定 ID，同一 ID 的明文旧副本和加密副本只保留一份。

## 11. 平台能力精确矩阵

| 能力 | Tauri | Docker Web | Chrome Web 扩展 |
|---|---|---|---|
| 统一管理 UI 与 72 个 UI 命令入口 | 有 | 有 | 有 |
| 账号/文件夹/排序/回收站主流程 | 有 | 有 | 有 |
| 自建服务器同步、预览和覆盖模式 | 有 | 有 | 有 |
| WebDAV | 有 | 有 | 有，由后台统一调度 |
| 自建服务器版本列表/恢复 | 有 | 有 | 有 |
| SSH 检测和创建服务 | 实际执行 | 有限检测/保存草稿，创建报错 | 保存草稿，创建报错 |
| SSL 证书/私钥草稿保存 | 有 | 草稿 | 草稿 |
| 原生目录/文件选择器 | 有 | 浏览器上传下载 | 浏览器上传下载 |
| Touch ID / 生物识别 | 仅 macOS | 不支持 | 不支持 |
| 网页账号填充、popup、WebAuthn 注入 | 不提供 | 不提供 | 扩展专属 |
| 多用户/租户隔离 | 不适用，本地单 vault | **未实现，单用户 vault** | 浏览器配置文件内单 vault |
| 跨进程并发写 CAS | 未提供 | 未提供 | 不适用同一扩展实例；多上下文靠消息/事务协调 |

“命令覆盖 72/72”不能替代这张能力表。不支持的命令可能为了 UI 契约仍有处理分支，但必须返回空值、false 或明确中文错误，不能理解为实际支持。

## 12. 已知尚未统一和不能误解的地方

1. Chrome 锁定状态已由后台收口，但锁配置和业务数据仍分别存放在 `chrome.storage.local`、`chrome.storage.session` 与 IndexedDB；后续迁移必须保持锁定事件先清密钥、再清业务视图的顺序。
2. Chrome 的 JS merge 不是 Rust/WASM 运行时；正确性依赖黄金向量和桥接测试。
3. 高风险同步、同步包、撤销/重做/快照恢复命令返回结构化对象；普通写命令 `delete_folder`、`set_account_folders`、`set_accounts_folders`、`set_accounts_pinned`、`restore_account`、`hard_delete_account` 成功统一返回布尔值 `true`；批量删除/恢复/清空仍返回数字 count，创建/编辑仍返回实体对象。锁设置、偏好设置等无业务载荷命令仍可返回 `null`，不能把它们误认为业务写入成功契约。
4. Docker Web 是单用户、单进程 vault，没有 Cookie 会话、多租户授权、WebAuthn 登录或跨进程 CAS。
5. Tauri/Web 的本地文件保存没有跨进程 revision；不要同时让多个实例写同一数据目录。
6. Swift 已加入每文件夹 `regularAccountIds` 及其时间戳/设备名，并在同步合并与文件夹成员变更时保留；仍需通过真实跨端 round-trip 测试继续验证历史数据迁移。
7. Firefox、Safari、Android 和旧 Swift 没有被命令矩阵证明与三端管理面等价。

8. Android Provider 当前只声明密码能力并返回不含密码的 demo 查询条目；真实 vault 解锁、密码结果、Passkey 和 Credential Exchange 均未实现，不能作为生产 Provider 发布。仓库包含 Gradle Wrapper，CI 已配置单元测试与 debug APK 构建，但这不代表凭据回填可用。Safari Web Extension 构建包只包含 `dist`、HTML/CSS、manifest 和图标等运行资源，不再携带 `node_modules`、README、构建脚本或重复源码；这不改变 Safari 未纳入三端命令矩阵的事实。
9. 软件 Passkey 私钥是可同步材料，不具备硬件认证器不可导出的安全属性。
10. 同步服务器限流按 TCP 对端 IP，反向代理部署必须额外设计可信代理策略。
11. `pass.data.v2` 机器 Schema 需要与 Rust/JS 当前字段同步维护；新增顺序或墓碑字段时必须同时改两份 Schema 和黄金向量。
12. Docker Web 数据目录只能由一个实例持有；进程对 `pass-web-instance.lock` 持有的是内核排他锁，异常终止后由内核释放，遗留文件无需删除。若仍提示占用，说明另有实际进程挂载并持有同一 volume，必须停止该进程，不能通过删文件或多实例共享 volume 规避。
13. Chrome 主密码与数据密钥包装当前为 v4：主密码字节不做 `trim`；旧 v2/v3 包装仅在成功解锁时兼容读取并立即重包为 v4。
14. 同步服务的 TLS 健康检查必须以证书域名请求，并用 `--resolve` 连接本机监听地址；禁止用 `--insecure` 绕过证书校验。
15. `cargo fmt --check` 是 CI 阻断门禁，任何 Rust 格式漂移都必须在提交前清理。
16. 多来源同步只有 `syncPrimarySource` 指定的来源参与合并；其它来源只作为镜像接收最终结果。主源拉取失败不得继续覆盖镜像。
17. 永久删除墓碑不计入可见数量，但稳定 ID 必须保留，避免旧设备数据复活；安全闸门和 JS/Rust 对拍都遵守这一规则。
18. 当前密钥轮换期间，Tauri/Web/扩展同步、服务器快照恢复和同步包导入均可用运行时上一把密钥读取旧包；空密钥仍表示明文模式。
19. 自建服务器条件写入统一处理 412/428；Tauri 一次逻辑同步复用同一幂等键，扩展重试也复用稳定键。WebDAV 依赖 ETag，不宣称服务端幂等。
20. 扩展选项页和后台自动同步共享 `chrome.storage.session` 短时互斥锁，异常退出由过期时间释放。
21. 服务端 `X-Sync-Revision` 是 scope 内连续 revision；`version_id` 仍是全局历史行 ID，旧数据库启动时会补齐 scope revision。
22. 合并交换律不仅约束密码等字段值，也约束创建设备、最后操作设备、Passkey 更新设备和删除设备等元数据；任何 `>=` 隐式左侧优先或合并过程读取 `Date.now()` 都会破坏双客户端收敛。
23. Chrome 真实页面验收使用 `scripts/fixtures/extension-autofill.html`。内容脚本注入、版本标记和页面无脚本错误可在本地 HTTP 页面验证；账号选择器只有在当前扩展存储存在匹配账号且扩展管理页可用时才可验证。Chrome 安全策略禁止自动化直接打开 `chrome://extensions/` 或 `chrome-extension://` 管理页，不能把“无账号时不显示选择器”误判为注入失败。
24. 一次鼠标点击输入框会依次触发 `pointerdown`、`focusin`、`click`，三个监听器不能分别查询账号。内容脚本以“输入框对象 + 650ms”认领一次用户激活：同一次点击只发起一次账号列表请求，因此有账号时只开一个选择器、无账号或锁定时也只提示一次；切换到另一输入框或时间窗结束后仍允许重新打开。
25. 网页内的成功、警告、错误、无匹配账号和 Passkey 提示统一由内容脚本的单一 toast 实现渲染。宿主使用 closed Shadow DOM 隔离网页 CSS，并优先进入 manual Popover top layer，固定在浏览器视口右上角；不支持 Popover 时才回退到带 `!important` 关键定位的 fixed 容器。并行安装旧扩展和新扩展时按三段版本号裁决 UI 所有权，新版本必须接管旧版本，同版本才按扩展 ID 破平。`scripts/fixtures/extension-toast-hostile.html` 故意使用全局超大字号、错误绝对定位和根节点变换验证这些约束。
26. 密码账号选择框与 Passkey 选择框均固定在视口右上角，并优先使用 manual Popover top layer，避免被登录页的输入框、堆叠上下文或页面 CSS 遮挡。WebAuthn 主世界注入覆盖所有认证子框架（含 `about:blank`）；读取请求不以 `allowCredentials.transports` 排除 Pass。只有没有匹配 Pass 通行密钥，或用户在 Pass 选择框中明确切换浏览器时，才会调用浏览器原生通行密钥；扩展通信和超时错误必须返回页面，不能静默回退。
27. 填充以用户当前聚焦的输入框为准：只填写该字段及同一表单中的配对字段。分步登录页只有用户名或密码字段时，单字段填充就是成功，不能为了补全另一字段写入页面中其他表单的输入框。
28. WebAuthn 收集客户端数据必须使用认证调用所在框架的有效来源：同源 iframe 不能仅因 `window.top !== window.self` 被误标为跨源，`about:blank` 子框架继承父来源；真正跨源时必须同时返回 `crossOrigin: true` 和 `topOrigin`，同源请求显式返回 `crossOrigin: false`。网站请求 `credProps` 时返回 `rk: true`。扩展只提示“已生成，等待网站确认”，不能在 RP 服务端接受注册前宣称最终保存成功。
29. 扩展构造的 `AuthenticatorAttestationResponse` 不能只修改原型：必须提供自有的 `getAuthenticatorData()`、`getPublicKey()`、`getPublicKeyAlgorithm()`、`getTransports()` 和 `toJSON()`，否则 Google 等网站调用原生原型方法时会因浏览器品牌校验失败。创建响应同时返回 SPKI 公钥、COSE 算法和认证数据；`PublicKeyCredential.toJSON()` 必须包含 `authenticatorAttachment` 及完整响应字段。
30. Pass 新建的托管通行密钥是同步型、多设备凭据：注册认证数据使用 `UP|UV|BE|BS|AT`（`0x5d`），断言使用 `UP|UV|BE|BS`（`0x1d`），并写入 Pass 固定的非零 UUID AAGUID；全零 AAGUID 表示未标识认证器，会被部分 RP（包括 Google）拒绝。`backupEligible`、`backupState` 随凭据同步并在合并时保守保留；创建这些字段前的旧凭据继续使用原有设备绑定标志，避免注册与后续断言声明不一致。
31. 当 RP（例如 Google）接受 WebAuthn API 返回值却在服务端拒绝注册时，Pass 在 `chrome.storage.session` 保存最近 40 个脱敏诊断事件，并按随机会话 ID 聚合同一次注册时间线。时间线包含请求字段/字节长度、扩展输入、clientData 解析摘要、认证数据标志、响应字段长度、算法、客户端扩展输出、本地一致性检查、页面收到的凭据/API 调用，以及返回凭据后 30 秒内的 `error` / `unhandledrejection`（例如 Google `RpcError`）。弹窗“通行密钥”页可先清空诊断再重试，并复制完整报告。禁止记录 challenge、用户 ID、凭据 ID、密钥、完整 clientData；页面错误中的 URL、邮箱和长令牌也必须脱敏。
32. 注册请求指定 `attestation: "direct"` 或 `"enterprise"` 时，不能固定返回 `fmt: "none"`；Pass 必须用新建凭据私钥对 `authData || hash(clientDataJSON)` 签名，返回 Packed self-attestation。`none` 与未指定证明的请求仍返回 `fmt: "none"`。
33. `googleLegacyAppidSupport` 是 Google 的旧 U2F 路由输入，不是客户端扩展输出。值为 `true` 时，协议要求使用漫游认证器并绑定 Google 固定 AppID；Pass 必须放弃接管并交给 Chrome 原生处理。值为 `false` 时仍可按普通平台 Passkey 创建，但不得把该输入伪造成 `getClientExtensionResults()` 输出。
34. `appidExclude` 是创建请求的旧 U2F AppID 排除检查输入，不属于 `AuthenticationExtensionsClientOutputs`。Pass 只在自身的 RP 凭据库执行 `excludeCredentials`，但不得把未处理外部 AppID 伪造成 `appidExclude: false` 返回给页面；这会偏离 Chrome 输出并可能被 Google 拒绝。
35. Chrome 的 `webAuthenticationProxy` 是远程桌面专用的全局 WebAuthn 代理；当前 Pass 采用页面桥接且没有代理 attach/detach 生命周期，因此 manifest 不声明该权限。

## 13. 验证入口和当前基线

推荐先运行根级统一入口；它默认使用临时 Cargo target，并在结尾区分代码失败与环境不可用。Docker/Android 可选套件和同步边界说明见 [`test-baseline-and-sync-e2e-zh.md`](./test-baseline-and-sync-e2e-zh.md)。

```bash
bash scripts/test_all.sh
```

完整手工/分模块命令仍保留如下：

```bash
node scripts/version.mjs check
node scripts/check_command_matrix.mjs
bash scripts/core_gate.sh
node core/pass_core/js/check_merge_parity.mjs
cd apps/extension_shared && npm test
cd apps/pass-web && cargo test --locked
cd apps/codex-tauri/src-tauri && cargo test --locked
cd apps/sync_server_ubuntu && .venv/bin/python -m unittest discover -s tests -p 'test_*.py'
cd apps/sync_server_ubuntu && .venv/bin/python -m unittest discover -s ../../scripts/tests -p 'test_sync_e2e.py'
# Chrome 本地页面验收（手动）：
python3 -m http.server 8766 --bind 127.0.0.1
# Chrome 打开 http://127.0.0.1:8766/scripts/fixtures/extension-autofill.html，
# 确认 data-pass-content-version、用户名/密码联动和无重复页面 UI。
# 再打开 http://127.0.0.1:8766/scripts/fixtures/extension-toast-hostile.html，
# 点击手机号输入框，确认提示位于视口右上角且不继承测试页的冲突样式。
```

版本 `1.4.4` 的当前复核基线：扩展测试 112 项、Core Rust 测试 41 项与 JS/Rust 合并对拍 48 组、Tauri 33 项、同步服务器 Python 测试 37 项及脚本/端到端测试 26 项、Docker Web 测试 17 项，以及 Swift `swift build`、Safari Xcode 构建、Android 4 项单元测试与 debug APK 构建、三套 Clippy/Rust fmt、三套 `cargo audit`、actionlint 和 72/72 命令矩阵均通过。Android 本机验证使用 JDK 17、Android SDK Platform 36；由于没有 Android 14+ 真机，不能宣称系统 Credential Manager 交互已实测。

Tauri 审计仍报告 Tauri/GTK 依赖树中的 20 条上游未维护/unsound warning，但没有已知 vulnerability；CI 的 `cargo audit` 为漏洞硬门禁，不使用 `continue-on-error`。Docker 镜像生命周期实测覆盖首次启动、普通重启、测试监护进程下的 `pass-web` 子进程被 `SIGKILL` 后容器 `RestartCount` 增加、强制重建和 `/healthz`。不能用容器内 `kill -9 1` 代替该验证，因为 PID namespace init 的信号语义可能让命令返回成功但主进程不退出。

同步报告统一保留兼容字段并增加报告版本、安全结果、阶段、实际主源、重试状态、会话/操作 ID、错误码和 revision。Chrome 的成功、预览、安全阻断、拉取失败和本地并发变化报告均由同一构造器产生，并通过 JSON Schema 测试；拉取期间发现本地并发修改时返回 `checkingLocalConcurrency` 可重试报告。UI 可区分“已写本地”“已推送”“待补偿”及“已暂停”。Chrome 管理页的手动同步、自动同步、预览与补偿队列全部委托扩展后台 Service Worker；后台的加密 outbox、同步锁和多来源调度是唯一权威。后台同步快照已并入统一管理页列表并可恢复。

Chrome、Swift、Tauri 与 Docker Web 的补偿队列都保存 payload 摘要、ETag/revision 和完整幂等上下文；同一目标且摘要相同才复用逻辑写入，摘要改变则创建新 key，第 12 次连续失败后暂停并等待用户恢复。Tauri 使用独立加密 `sync_outbox.json`；Docker Web 队列保存在加密 vault 内，但仅由打开的 Web UI 自动同步计时器调度。安全检查阻止的预览不会写入队列，成功推送后自动清除。账号实体数组按稳定 `recordId`（再按 `accountId`）作传输规范化，用户可见顺序只由顶层和文件夹顺序数组决定。扩展的填充路径、单次激活去重、网页提示样式隔离和新版本 UI 所有权裁决均有独立回归。测试数量只描述该版本实际运行结果，测试增删后必须重新更新。

`1.4.2` 在上述同步实现基础上修复了 Docker 发布工作流对 Trivy action tag 的引用：GitHub Action ref 必须使用真实的 `v0.36.0` tag，不能省略 `v`，否则 job 会在创建阶段失败，镜像不会发布。

关联文档：

- [三端命令矩阵](./three-surface-command-matrix-zh.md)
- [本地写入耐久性与历史一致性](./local-write-durability-and-history-consistency-zh.md)
- [作用域账号排序](./scoped-account-order-design-zh.md)
- [同步包与手动导入导出](./manual-sync-import-export-design-and-implementation-zh.md)
- [跨平台同步后端契约](./cross-platform-sync-backends-v2-zh.md)
- [本轮代码/文档审计](./audit-2026-07-26-zh.md)
- [同步功能复核记录（2026-07-27）](./audit-2026-07-27-zh.md)

## 同步风险边界（1.2.8）

- 预览差异匹配优先 `recordId/id`。
- 空同步密钥与覆盖模式执行前二次确认。
- WebDAV 远端有内容但无 ETag 时拒绝同步/预览。
- 同步报告区分本地已写入与远端已推送/待补偿。
- 记录主源指纹，变化时警告。
