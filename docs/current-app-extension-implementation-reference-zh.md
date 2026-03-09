# Pass 当前实现参考（APP + 扩展）

## 1. 目的与范围
- 本文档描述 `/Users/x/code/pass` 当前已实现行为（不是目标蓝图）。
- 目标读者：接手重构/重设计的工程师，需快速理解“现在到底做了什么”。
- 覆盖：
  - macOS 客户端（`apps/app_macos`）
  - Chrome 扩展（`apps/extension_chrome`）
  - 共享数据模型、关键交互、当前限制。

## 2. 代码入口
- macOS
  - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/PassMacApp.swift`
  - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/ContentView.swift`
  - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/AccountStore.swift`
  - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/SettingsView.swift`
- Chrome 扩展
  - `/Users/x/code/pass/apps/extension_chrome/manifest.json`
  - `/Users/x/code/pass/apps/extension_chrome/popup.html`
  - `/Users/x/code/pass/apps/extension_chrome/popup.js`
  - `/Users/x/code/pass/apps/extension_chrome/options.html`
  - `/Users/x/code/pass/apps/extension_chrome/options.js`
  - `/Users/x/code/pass/apps/extension_chrome/background.js`
  - `/Users/x/code/pass/apps/extension_chrome/content.js`
  - `/Users/x/code/pass/apps/extension_chrome/passkey_store.js`

## 3. 数据模型（当前真实字段）

### 3.1 账号 `PasswordAccount`
- 主键语义：`网站(eTLD+1)-第一次创建时间(yymmddHHMMSS)-用户名`
- 字段（mac 与扩展均兼容）：
  - `accountId: string`
  - `canonicalSite: string`
  - `usernameAtCreate: string`
  - `isPinned: bool`
  - `pinnedSortOrder: int|null`
  - `regularSortOrder: int|null`
  - `folderId: string|null`（兼容旧字段）
  - `folderIds: string[]`（当前主字段）
  - `sites: string[]`（站点别名，升序）
  - `username: string`
  - `password: string`
  - `totpSecret: string`
  - `recoveryCodes: string`（多行）
  - `note: string`（多行）
  - `passkeyCredentialIds: string[]`
  - `usernameUpdatedAtMs: int64`
  - `passwordUpdatedAtMs: int64`
  - `totpUpdatedAtMs: int64`
  - `recoveryCodesUpdatedAtMs: int64`
  - `noteUpdatedAtMs: int64`
  - `passkeyUpdatedAtMs: int64`（扩展侧已使用）
  - `isDeleted: bool`
  - `deletedAtMs: int64|null`
  - `lastOperatedDeviceName: string`
  - `createdAtMs: int64`
  - `updatedAtMs: int64`

### 3.2 文件夹 `AccountFolder`
- 字段：
  - `id: UUID/string`
  - `name: string`
  - `createdAtMs: int64`
  - `updatedAtMs: int64`
- 固定文件夹：
  - `id = F16A2C4E-4A2A-43D5-A670-3F1767D41001`（扩展显示时用小写）
  - `name = 新账号`
- 语义：从“新建账号”面板创建的账号会自动进入该文件夹（mac）。

### 3.3 通行密钥记录（扩展侧）
- 存储于扩展 IndexedDB（`pass.local.db.v1` / `collections.passkeys`），核心字段：
  - `credentialIdB64u`
  - `rpId`
  - `userName`, `displayName`, `userHandleB64u`
  - `alg`, `signCount`
  - `privateJwk`, `publicJwk`（扩展当前为本地自托管方案）
  - `createdAtMs`, `updatedAtMs`, `lastUsedAtMs`
  - `mode`

## 4. 存储位置（当前）

### 4.1 macOS APP
- 本地主库存储（SQLite + WAL）：
  - `~/Library/Application Support/pass-mac/pass.db`
  - 表：`kv(key, value, updated_at_ms)`，当前键：
    - `accounts`
    - `folders`
    - `passkeys`
- UserDefaults：
  - `pass.deviceName`
  - `pass.export.directoryPath`
  - `pass.sync.deviceId.v1`
  - `pass.folders.data`（兼容镜像，主数据仍以 SQLite 为准）
  - `pass.ui.font.family`
  - `pass.ui.font.textSize`
  - `pass.ui.font.buttonSize`
  - `pass.ui.toast.duration`
- iCloud（`NSUbiquitousKeyValueStore`）：
  - `pass.sync.payload.blob.v2`
  - `pass.sync.payload.updatedAtMs.v2`
- 兼容迁移来源（首次加载会迁移到 SQLite）：
  - `~/Library/Application Support/pass-mac/accounts.json`
  - `~/Library/Application Support/pass-mac/passkeys.json`

### 4.2 Chrome 扩展
- 业务数据（账号/通行密钥/文件夹）：
  - IndexedDB：`pass.local.db.v1`
  - object store：`collections`
  - key：`accounts` / `passkeys` / `folders`
- `chrome.storage.local`（仅设置 + 迁移/变更信号）：
  - `pass.deviceName`
  - `pass.sync.*`（同步配置）
  - `pass.lock.*`（主密码和自动锁策略）
  - `pass.sync.deviceId.v1`
  - `pass.data.migratedToIndexedDb.v1`
  - `pass.data.bump.v1`

## 5. 关键业务规则（当前实现）

### 5.1 域名与站点别名
- 域名标准化：小写、去协议、去尾部点。
- eTLD+1 规则内置后缀：`com.cn/net.cn/org.cn/gov.cn/edu.cn/co.uk/org.uk`。
- 账号别名组同步：
  - 若两个账号 `sites` 有交集，或任一站点 eTLD+1 相同，则视为连通。
  - 连通分量内 `sites` 取并集并回填到每个账号。

### 5.2 删除与回收站
- 删除不是立刻物理删除，而是：
  - `isDeleted = true`
  - `deletedAtMs = now`
- 回收站支持恢复与永久删除。
- “删除全部账号”是把未删除账号全部移入回收站。

### 5.3 排序与置顶
- 列表规则：置顶组在前，普通组在后。
- 组内排序优先级（APP 与扩展已对齐）：
  - 先按 `updatedAtMs`（新到旧）
  - 若相同再按手动排序号：
    - 置顶组：`pinnedSortOrder`
    - 普通组：`regularSortOrder`
- 支持拖拽同组重排（跨组不允许）。

### 5.4 时间格式显示
- UI 显示格式：`yy-M-d H:m:s`，例如 `26-3-14 9:2:8`。
- 同步与冲突判断使用毫秒时间戳（`...AtMs`）。

### 5.5 同步包与冲突内核
- 同步包 schema：`pass.sync.bundle.v2`。
- `source` 元信息包含：
  - `app`
  - `platform`
  - `deviceName`
  - `deviceId`
  - `logicalClockMs`
  - `formatVersion`
- 扩展端同步冲突/合并已集中到共享内核：
  - `/Users/x/code/pass/core/pass_core/js/sync_merge_core.js`
  - `options.js` 通过该内核合并账号/文件夹/通行密钥，避免再次在多页面复制实现。

## 6. macOS 客户端 UI（当前）

### 6.1 主界面
- 左侧导航：
  - 全部 / 通行密钥 / 验证码 / 回收站 / 文件夹列表
- 支持：
  - 单选、Shift 连选、Cmd 多选、Cmd+A 全选
  - 右键菜单（编辑、删除、置顶、放入文件夹）
  - 拖拽账号到文件夹
  - `Cmd+Z` 撤销最近一次“文件夹移动”
- 顶部按钮：新建账号、生成演示账号、删除全部账号、回收站。

### 6.2 新建与编辑
- 新建账号为独立弹窗（非模态，可操作主界面）。
- 字段：
  - 站点别名（多行，每行一个）
  - 用户名 / 密码 / TOTP / 恢复码（多行）/ 备注（多行）
- 编辑为独立弹窗，点击面板外（但在 APP 内）关闭且不保存。

### 6.3 复制与提示
- 可复制：用户名、站点、验证码等。
- Toast 为绿色，默认 3 秒，可在设置中改时长。

### 6.4 设置
- 设备名称
- UI 字体族、文本字号、按钮字号、Toast 时长
- iCloud 手动同步按钮
- CSV 导出（目录规则）
- 同步包导出/导入合并（本次新增）
- 应用解锁（主密码、策略、生物识别优先）

## 7. 扩展 UI（当前）

### 7.1 左击弹窗 `popup`
- 顶部模式：当前网站 / 全部 / 回收站 / 通行密钥
- 搜索：输入即搜；筛选字段可选（全部、用户名、站点别名、备注、密码）
- 账号卡片支持：
  - 加入当前域名
  - 复制密码
  - 填充当前页
  - 编辑
  - 删除账号
  - 若有 TOTP，显示并可点击复制验证码

### 7.2 右击扩展图标菜单（action context menu）
- 当前只有一个项目：`pass设置`，跳转 options 页。

### 7.3 选项页 `options`
- 顶部：设备名称
- 中部：APP 风格侧边栏（全部/通行密钥/验证码/回收站/文件夹）+ 右侧账号列表
- 支持编辑、删除、恢复、永久删除、置顶、拖拽同组排序、搜索筛选。
- 原始数据区（可折叠）支持：
  - 导出同步包（本次实现）
  - 导入并合并同步包（本次实现）
  - 导出 JSON / 导入 JSON / 清空账号

## 8. 扩展后台能力（当前）
- `content.js` 检测登录行为，提示保存/更新密码。
- `background.js` 接收消息并：
  - 执行填充
  - 执行登录保存逻辑
  - 对接通行密钥桥接
  - 注册 passkey 后自动补齐/合并账号
- `passkey_store.js` 实现托管 passkey 创建/断言与本地存储。

## 9. 演示数据
- mac 端支持生成 20 条演示账号（含：
  - 站点别名
  - TOTP
  - 恢复码
  - 多行备注）

## 10. 当前限制与重设计提示
- 当前同步实现仍是“整包（payload）级”同步，不是操作日志级（op-log）同步。
- 逻辑主库建议放在同步层（云端对象/记录版本）；本地库作为离线可写副本已落地（APP=SQLite，扩展=IndexedDB），但服务端版本治理仍需继续完善。
- 通行密钥私钥目前在扩展本地存储，安全模型仍需加强（见独立同步文档）。
- 冲突解决仍依赖设备时间准确性，建议后续把 HLC/向量时钟正式落到同步协议与服务端裁决。
