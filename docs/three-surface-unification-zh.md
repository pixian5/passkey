# Pass 三端统一方案（Tauri / Docker Web / Chrome Web 扩展）

> 文档性质：当前架构决策与已实施记录。能力现状以 [`current-app-extension-implementation-reference-zh.md`](./current-app-extension-implementation-reference-zh.md) 为准；“统一”不表示平台能力、存储和返回对象完全相同。
> Chrome 正式入口为 `apps/extension_chrome_web`；旧 `apps/extension_chrome` 壳已移除。`apps/extension_shared` 继续提供填充、popup、WebAuthn 和 Firefox/Safari 共用代码。

## 1. 目标

三端对用户应表现为“同一套 Pass 管理软件”，只在平台能力上有明确差异：

| 表面 | 入口 | 前端 | 后端命令适配 |
|---|---|---|---|
| Tauri 桌面 | `PassDesktop.app` | `apps/codex-tauri/src/*` | Rust Tauri commands |
| Docker / Ubuntu Web | `pass-web` HTTP | 同一 UI 的 `dist` | Rust `pass-web` `/api/invoke/:command` |
| Chrome 新扩展 | `web-options.html` | 从 Tauri UI 同步生成 | `extension-bridge.js` |

原则：

1. **UI 单源**：`apps/codex-tauri/src/main.js` + `styles.css` + `index.html` 是唯一管理页源码。
2. **命令同名**：UI 只调用统一命令名；各表面实现同一接口。
3. **同步同核**：账号/文件夹/通行密钥/顺序字段合并由 `pass_merge::v2` 与共享 Schema 裁决。
4. **能力显式声明**：`health_check.capabilities` 告诉 UI 当前表面支持什么，不靠猜运行时环境。
5. **桌面专属能力可降级**：SSH 创建服务、Touch ID、原生目录选择器、部分 WebDAV/服务器版本能力可隐藏或给出明确错误，但不得导致页面崩溃。

## 2. 当前差异（代码事实）

### 2.1 界面

- CSS 已一致。
- 管理页 JS/HTML 原先通过复制维护；现已改为构建时从 Tauri 源同步到：
  - `apps/extension_chrome_web/web-main.js`
  - `apps/extension_chrome_web/web-options.css`
  - `apps/extension_chrome_web/web-options.html`
- Docker Web 本来就读取 `apps/codex-tauri/dist`。

### 2.2 命令覆盖

UI 当前调用 68 个命令。
重叠能力：账号/文件夹 CRUD、排序、置顶、回收站、撤销重做、历史、同步设置、同步预览/合并、同步包导入导出、CSV、快照、主密码锁。

| 能力 | Tauri | Docker Web | Chrome Web 扩展 |
|---|---|---|---|
| 账号/文件夹/排序/回收站主流程 | 已接入 | 已接入 | 已接入 |
| 字段级同步合并 | Rust Core | Rust Core | JS 本地合并（自建服务器可用） |
| 文件夹顺序同步 | 已接入 | 已接入 | 已接入 |
| 文件夹去重 | 已接入 | 已接入 | 已接入 |
| WebDAV | 已接入 | 已接入 | 未实现，明确报错 |
| 服务器版本列表/恢复 | 已接入 | 已接入 | 已接入（`/v2/sync/versions`） |
| SSH 创建服务 | 实际执行 | 草稿/有限检测 | 保存草稿 |
| Touch ID / 生物识别 | macOS | 无 | 无 |
| 原生目录选择器 | 有 | 无（浏览器下载） | 无（浏览器下载） |
| 页面自动填充 / content script | 无 | 无 | 有（扩展独有） |

### 2.3 存储

| 表面 | 本地存储 |
|---|---|
| Tauri | 加密 SQLite KV + 本地 vault 封装 |
| Docker Web | 加密 vault 文件 + 密钥文件 |
| Chrome Web 扩展 | `chrome.storage.local` 中的加密管理工作区 + 后台 IndexedDB 业务集合镜像 |

数据模型统一为 v2 账号/文件夹/通行密钥 + 顶层顺序字段；存储介质可以不同。

## 3. 统一架构

```text
                ┌──────────────────────────────┐
                │  Shared Web UI (single source)│
                │  main.js / styles / index.html│
                └──────────────┬───────────────┘
                               │ invoke(command, args)
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Tauri runtime         pass-web HTTP        extension-bridge
   generate_handler      /api/invoke/:cmd     chrome.storage
          │                    │                    │
          └──────────┬─────────┴──────────┬─────────┘
                     ▼                    ▼
              pass_merge::v2         payload v2 schema
              field LWW + orders     accounts/folders/passkeys
```

### 3.1 UI 生成规则

- `npm run prepare:dist`（Tauri/Docker）会：
  1. 生成 `apps/codex-tauri/dist`
  2. 同步 UI 到 `apps/extension_chrome_web`
- `scripts/build-extension-chrome-web.sh` 也会强制同步 UI，避免扩展加载旧副本。
- 禁止手改 `web-main.js` / `web-options.css` / `web-options.html`。

### 3.2 能力声明契约

`health_check` 必须返回：

```json
{
  "app": "codex-tauri|pass-web|pass-extension-chrome-web",
  "surface": "tauri-desktop|docker-web|chrome-extension-web",
  "capabilities": {
    "nativeFilePicker": true,
    "sshProvision": true,
    "biometricUnlock": true,
    "webdavSync": true,
    "serverVersions": true,
    "folderDedup": true,
    "selfHostedSync": true,
    "localSnapshots": true,
    "sharedWebUi": true
  }
}
```

UI 启动时读取并隐藏/降级不支持控件。

### 3.3 同步语义（已统一 / 继续坚持）

顶层同步字段：

- `allRegularAccountIds` + 时间戳/设备名
- `folderOrderIds` + 时间戳/设备名
- 每个 `Folder.regularAccountIds` + 时间戳/设备名

规则：

1. 内容字段与顺序字段独立 LWW。
2. 文件夹内容合并与文件夹列表顺序合并独立。
3. 胜出顺序遗漏的活动实体追加到末尾。
4. 删除/永久删除不占活动顺序。
5. 固定“新账号”文件夹始终第一。

### 3.4 命令契约

所有表面实现同一命令名和近似返回形状。平台不支持的命令：

- 优先返回可读中文错误；
- 对“列表类”可返回空数组并在 UI 侧隐藏入口；
- 不允许静默 no-op 且假装成功。

## 3.5 三端不可违反的数据规则

这些规则适用于 Tauri、Docker Web、Chrome 新扩展，任何表面实现 mutation 时都必须遵守。违反会导致同步后账号复活、敏感信息残留或顺序漂移。

1. **清空回收站不是物理删除**：`hard_delete_all_deleted_accounts` 只能把回收站账号标记为永久删除墓碑，禁止 `filter` 掉记录。
2. **永久删除墓碑必须保留稳定 `recordId`/`accountId`**，以便远端旧副本合并时继续识别为已永久删除。
3. **永久删除必须清空敏感明文**：至少清空 `password`、`totpSecret`、`recoveryCodes`；可保留站点、用户名、备注等非密钥字段供审计与冲突裁决。
4. **永久删除字段必须写全**：`isDeleted=true`、`isPermanentlyDeleted=true`、`deletedAtMs`、`deletedDeviceName`、`updatedAtMs`、`lastOperatedDeviceName`。
5. **普通同步不得清除 `isPermanentlyDeleted`**；只有明确的恢复策略或未来压缩策略才能处理墓碑。
6. **软删除/恢复必须写删除时间与设备名**：进入回收站时写 `deletedAtMs/deletedDeviceName`；恢复时清空删除时间与设备名，并更新 `updatedAtMs/lastOperatedDeviceName`。
7. **恢复时只能回到仍存在的文件夹**：过滤已删除/永久删除文件夹；恢复后账号进入“全部账号”和所属文件夹顺序顶部，批量恢复保持原相对顺序。
8. **文件夹加入/移除必须同步更新 `folderMembershipStates`**；站点别名关系用 `siteAliasStates`，禁止只改数组不写关系墓碑。
9. **顺序字段与内容字段分离 LWW**：`allRegularAccountIds`、`folderOrderIds`、`Folder.regularAccountIds` 各自带更新时间与设备名，不可被账号内容更新时间覆盖。
10. **单删、批量删、去重删必须复用同一删除 helper**，禁止某条路径漏写字段。
11. **本地 mutation 写入的 payload 必须可被三端合并 Core 正确理解**；快照、导入、同步写回必须包含顺序字段与关系墓碑。
12. **平台不支持功能通过 capability 隐藏或明确报错**，禁止伪成功。
13. **命令返回结构逐步统一为对象**；不要再新增只返回裸字符串的成功接口。
14. **扩展本地敏感配置必须加密**：账号库、同步设置、UI 偏好中的密钥/密码、创建服务草稿都使用本地 AES-GCM；旧明文读取后自动迁移。

## 4. 本轮已统一

1. UI 单源同步脚本：`apps/codex-tauri/scripts/sync-web-ui.mjs`
2. Tauri prepare-dist / 扩展构建自动同步 UI
3. 三端 `health_check.capabilities`
4. UI 按能力隐藏 SSH 创建服务、生物识别偏好、服务器版本入口
5. 扩展补齐文件夹去重
6. 扩展恢复快照时保留文件夹顺序字段
7. 扩展端点健康检测改为真实 HTTP `/health`，不再伪装成 SSH 能力
8. 新版扩展同步合并直接使用 `core/pass_core/js/sync_merge_core.js`，删除扩展内的简化合并器
9. 扩展构建自动复制共享合并 Core 与同步策略，桥接脚本以 ES module 加载
10. Rust/JS payload parity 覆盖全部账号顺序、文件夹顺序和文件夹内账号顺序
11. 扩展本地数据、同步包和安全快照完整保留三类顺序及其更新时间、设备名
12. 新版扩展应用锁增加 PBKDF2 密码验证、锁定命令拦截和空闲超时
13. 扩展账号编辑补齐字段级时间戳、文件夹关系墓碑和站点关系墓碑
14. 扩展同步预览/导入复用同步安全评估，避免空远端或实体丢失静默写入
15. 扩展同步合并补齐显式域名别名规则（包括 Microsoft/Microsoft Online）
16. 扩展同步设置改为 AES-GCM 加密保存，自动填充镜像携带完整排序字段
17. 扩展清空回收站改为保留永久删除墓碑，并清空密码/TOTP/恢复码
18. 扩展单删、批量删、去重统一 `softDeleteAccountState` / `permanentlyDeleteAccountState`
19. 扩展批量恢复补齐删除时间清理、有效文件夹过滤、关系状态与原顺序
20. 扩展置顶/批量置顶补齐 `pinnedSortOrder`、`updatedAtMs`、设备名，并拒绝回收站账号
21. 扩展 UI 偏好与创建服务草稿改为 AES-GCM 加密，旧明文自动迁移
22. Docker Web 永久删除统一 `mark_account_permanently_deleted`，补齐删除时间/设备名/更新时间
23. Docker Web 单账号置顶对齐桌面：写 `pinnedSortOrder` 与设备名，返回账号对象

## 5. 明确不统一 / 后续阶段

### 5.1 必须保留的平台差异

- **Touch ID**：仅 macOS 桌面。
- **SSH 创建服务**：仅桌面；Web/扩展只保存草稿，避免公开网页获得远程执行能力。
- **原生文件选择器**：仅桌面；Web/扩展用下载/上传。
- **浏览器自动填充 / WebAuthn 注入**：仅扩展。

### 5.2 后续应继续统一的部分

> 阶段 D 已启动：见 `docs/three-surface-command-matrix-zh.md` 与 `scripts/check_command_matrix.mjs`。

优先级从高到低：

1. **扩展 WebDAV（平台边界）**
   浏览器直接使用 WebDAV 需要 CORS；应选择受控代理或明确保持桌面/Web 专属，不能绕过浏览器安全边界。
2. **命令返回形状对象化**
   少数命令仍返回数字/布尔/字符串；关键计数命令已统一为 number。完整对象化继续分阶段推进。
3. **命令矩阵完整返回 schema**
   已有矩阵覆盖与部分契约；后续继续扩到完整返回 schema。
4. **更多 CSV 方言样例**
   共享 CSV Core 已落地；后续仅补更多密码管理器导入样例。
5. **更深共享领域层**
   账号/文件夹 mutation 主干已抽到 `pass_merge`/`vault_mutate_core`；排序数组、撤销栈、快照仍按表面实现。

已落地（勿再当待办）：

- 扩展服务器版本
- 共享 CSV Core 初版 + browser CSV 映射
- 命令矩阵自动化初版
- 共享 vault mutation（删除/恢复/置顶/文件夹墓碑/关系墓碑）

## 6. 验收标准

1. 修改 `apps/codex-tauri/src/main.js` 后，执行 prepare-dist 或扩展构建，扩展 options 页面同步变化。
2. 三端 `health_check` 都带 `capabilities`。
3. 同一同步包在 Tauri / Web / 扩展导入后，账号字段、文件夹顺序、全部账号顺序一致（在共享 Core 路径下）。
4. 扩展不再出现“去重按钮点了没反应”。
5. 桌面专属按钮在扩展/Web 上隐藏或给出清晰错误，不出现英文堆栈或空白失败。
6. `npm run test:core-parity` 必须比较完整 payload 顺序字段，不能只分别比较账号、文件夹和通行密钥集合。
7. 扩展桥接冒烟测试必须覆盖锁定拦截、错误密码、Microsoft 别名和安全预览。
8. 清空回收站后账号记录仍在，且 `isPermanentlyDeleted=true`、敏感字段已清空。
9. 永久删除墓碑与旧远端活动记录合并后，不得复活为可见账号。
10. 批量恢复后删除时间清空，原文件夹关系与相对顺序保持，无效文件夹被过滤。

## 7. 开发操作

```bash
# 桌面 / Docker 静态资源
cd apps/codex-tauri && npm run prepare:dist

# 新版 Chrome 扩展
cd apps/extension_shared && npm run build
../../scripts/build-extension-chrome-web.sh

# Web 后端
cd apps/pass-web && cargo test && cargo build --release
```

旧 Chrome 壳和专用构建入口已移除；Chrome 只加载 `apps/extension_chrome_web`。

## 8. 当前对齐结论（版本 1.3.0）

已对齐并必须保持：

1. UI 单源、命令同名、同步同核。
2. 各端在自身事务/逻辑保存边界内提交关联集合；保存失败回滚内存。Web/Tauri 尚无跨进程 CAS。
3. vault 原子落盘带 `fsync`。
4. Web 同步网络 I/O 不长期占用全局 vault 锁。
5. 主密码不 `trim`。
6. 操作历史脱敏；撤销忽略 no-op。
7. 同步服务器每次成功写入只产生 1 个新版本；审计/限流有上限。
8. SSH 远端路径 shell quote；部署健康检查正常 TLS 校验。

Chrome 的锁定状态已由后台 Service Worker 收口：popup 和管理页收到锁定通知后清除内存业务视图与本地数据密钥，解锁后重新读取加密存储。仍未对齐：Web/Tauri 跨进程 revision、旧 Swift 文件夹内独立顺序、全部命令返回 Schema。不得把本节“已对齐”扩写为所有运行细节完全一致。

详细规则见 [local-write-durability-and-history-consistency-zh.md](./local-write-durability-and-history-consistency-zh.md) 与 [current-app-extension-implementation-reference-zh.md](./current-app-extension-implementation-reference-zh.md)。


## 9. 阶段 D：命令契约与矩阵

目标：把三端 `invoke` 命令覆盖、平台降级、关键返回形状做成可自动检查的契约。

已交付：

1. `docs/three-surface-command-matrix-zh.md`
2. `scripts/check_command_matrix.mjs`
3. `apps/extension_shared/tests/command_matrix.test.mjs`
4. `soft_delete_accounts` 三端统一返回数字 count

检查命令：

```bash
node scripts/check_command_matrix.mjs
cd apps/extension_shared && npm test -- tests/command_matrix.test.mjs
```

失败即阻断：UI 命令任一端缺失、扩展伪成功平台能力、关键计数命令返回非数字。

## 10. 阶段 E：共享 CSV Core

已交付：

1. `core/pass_core/js/csv_core.js`
2. 扩展导入/导出改用共享 CSV Core
3. `apps/extension_shared/tests/csv_core.test.mjs`
4. `docs/three-surface-csv-core-zh.md`

下一小步：把 Docker Web/Tauri 浏览器 CSV 导入路径也尽量复用同一映射表，减少方言分叉。

### 阶段 E 续完成项

- Rust `pass_csvio` 新增 `parse_csv_rows` / `browser_csv_to_account_drafts`
- Tauri 与 Docker Web 浏览器 CSV 导入改为共享映射
- 用户名/密码可选，站点可识别即可导入

## 11. 阶段 F：共享 vault mutation

已交付初版共享 mutation helper：

- Rust：`pass_merge::v2::{soft_delete_account, permanently_delete_account, restore_account_fields, set_account_pinned, permanently_delete_folder, mark_folder_membership}`
- JS：`core/pass_core/js/vault_mutate_core.js`（含 `setAccountPinned`）
- 接入：
  - Tauri 删除/恢复
  - Docker Web 删除/恢复
  - Chrome 扩展删除 helper

规则：

1. 清空回收站/永久删除必须走 `permanently_delete_account`，保留墓碑并清空敏感字段。
2. 软删除走 `soft_delete_account`。
3. 恢复走 `restore_account_fields`，永久删除不可恢复。
4. 排序/列表维护仍由各表面负责，共享层只保证账号字段语义一致。
5. 三端置顶/批量置顶统一走 `set_account_pinned` / `setAccountPinned`。
6. 删除文件夹统一走 `permanently_delete_folder` / `permanentlyDeleteFolder`（永久墓碑，非软删除）。

## 12. 阶段 G：扩展服务器版本

已交付：

1. 扩展 `list_server_versions` 读取自建服务器 `/v2/sync/versions`
2. 扩展 `restore_server_version` 下载 `/v2/sync/versions/{id}` 并覆盖本地 vault（自动备份/撤销栈）
3. `health_check.capabilities.serverVersions = true`
4. 命令矩阵/契约测试同步更新

边界：

- WebDAV 仍不在扩展实现（浏览器 CORS）
- SSH 创建服务仍桌面专属

## 13. 小修：文件夹创建/重命名规则对齐

扩展 `create_folder` / `rename_folder` 与桌面/Web 对齐：

1. 新建文件夹名称不可为空
2. 固定“新账号”文件夹不可重命名
3. 已删除/永久删除文件夹不可重命名
4. 重命名名称不可为空

## 14. 阶段 H：文件夹关系墓碑写入对齐

已交付：

1. 共享 `mark_folder_membership` / `markFolderMembership`
2. 删除文件夹时，移出账号写入关系墓碑
3. 单账号/批量设置文件夹归属时，新增与移除都写入关系状态

目的：避免“本机移出文件夹后，旧设备同步又把账号塞回来”。

## 15. 小修：去重/单删路径统一走 soft_delete_account

桌面与 Docker Web 的去重删除、Web 单账号软删除均改为共享 `soft_delete_account`，避免漏写设备名/更新时间。
