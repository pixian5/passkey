# 多设备 / APP / 扩展同步与手动导入导出（设计 + 已实施）

## 1. 目标
- 支持以下场景离线/半离线同步：
  - 设备 A（mac APP）⇄ 设备 B（mac APP）
  - 设备 A（mac APP）⇄ 设备 B（Chrome 扩展）
  - 设备 A（Chrome 扩展）⇄ 设备 B（Chrome 扩展）
- 合并原则：
  - 按“真实发生时间”字段（`...UpdatedAtMs` / `deletedAtMs`）做冲突解决。
  - 账号不覆盖写，采用字段级 LWW + 删除判定规则。

## 2. 已实现同步通道

### 2.1 自动同步（mac 内部）
- 通道：`NSUbiquitousKeyValueStore`（iCloud KVS）
- 范围：`accounts`（当前已实现）
- 入口：`AccountStore.syncWithICloudNow()`

### 2.2 手动同步（跨端）
- 通道：同步包 JSON 文件（`pass.sync.bundle.v1`）
- APP：
  - 设置页支持“导出同步包”“导入并合并同步包”
  - 实现文件：
    - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/SettingsView.swift`
    - `/Users/x/code/pass/apps/app_macos/Sources/app_macos/AccountStore.swift`
- 扩展（options 页）：
  - 原始数据区支持“导出同步包”“导入并合并同步包”
  - 实现文件：
    - `/Users/x/code/pass/apps/extension_chrome/options.html`
    - `/Users/x/code/pass/apps/extension_chrome/options.js`

### 2.3 手动导出导入（非合并）
- APP：导出全部账号 CSV
- 扩展：导出/导入原始 JSON（可全量替换本地）

## 3. 同步包格式（v1）

```json
{
  "schema": "pass.sync.bundle.v1",
  "exportedAtMs": 1777777777777,
  "source": {
    "app": "pass-mac | pass-extension",
    "platform": "macos-app | chrome-extension",
    "deviceName": "ChromeMac",
    "formatVersion": 1
  },
  "payload": {
    "accounts": [/* PasswordAccount[] */],
    "passkeys": [/* extension 可选 */],
    "folders": [/* AccountFolder[] */]
  }
}
```

兼容策略：
- 若导入文件没有 `schema`，但根层有 `accounts/folders/passkeys`，按 legacy 解析。
- APP 当前不消费 `passkeys`（仅扩展消费）。

## 4. 合并策略（已落地）

## 4.1 账号集合合并
- 主键：`accountId`
- `accountId` 相同则做“同账号合并”，否则并入新账号。

## 4.2 同账号字段合并（字段级 LWW）
- 参与 LWW 的字段：
  - `username` ↔ `usernameUpdatedAtMs`
  - `password` ↔ `passwordUpdatedAtMs`
  - `totpSecret` ↔ `totpUpdatedAtMs`
  - `recoveryCodes` ↔ `recoveryCodesUpdatedAtMs`
  - `note` ↔ `noteUpdatedAtMs`
- 平局策略：
  - 先比字段更新时间
  - 再比账号 `updatedAtMs`
  - 再偏向非空值

## 4.3 站点别名与 canonicalSite
- `sites` 取并集并标准化（去重、排序、域名归一化）。
- `canonicalSite` 优先从并集首项推导 eTLD+1，否则保留历史值。
- 合并后执行“别名连通分量回填”（同站点交集或同 eTLD+1）。

## 4.4 删除冲突规则
- 计算：
  - `latestContentUpdatedAt = max(所有可编辑字段更新时间, passkeyUpdatedAtMs)`
  - `latestDeletedAt = max(lhs.deletedAtMs, rhs.deletedAtMs)`（仅在 `isDeleted=true` 时参与）
- 判定：
  - 若 `latestDeletedAt >= latestContentUpdatedAt`，账号保持删除态
  - 否则恢复为未删除

## 4.5 置顶与排序
- `isPinned / pinnedSortOrder / regularSortOrder` 取“较新账号快照”。
- 组内拖拽顺序最终写回对应 sortOrder 字段。

## 4.6 通行密钥引用（账号内）
- `passkeyCredentialIds` 使用并集合并，去重排序。
- `passkeyUpdatedAtMs` 取最大值。

## 4.7 文件夹合并
- 主键：`folder.id`
- 同 id 冲突：
  - `createdAtMs` 取最小
  - `name` 按固定规则（当前偏本地优先，固定“新账号”强制保留）
- 固定文件夹始终存在：
  - `id = F16A2C4E-4A2A-43D5-A670-3F1767D41001`
  - `name = 新账号`
- 合并后会清理账号 `folderIds`，移除不存在的 folder 引用。

## 4.8 扩展通行密钥集合合并
- 主键：`credentialIdB64u`
- 合并规则：
  - 主体元数据取较新 `updatedAtMs` 记录
  - `signCount` 取最大
  - `lastUsedAtMs` 取最大
  - `createdAtMs` 取最小

## 5. 实操流程

### 5.1 APP → 扩展
1. 在 APP 设置点击“导出同步包”得到 JSON。
2. 打开扩展 options 页，点击“导入并合并同步包”。
3. 扩展读取并合并后写入 `chrome.storage.local`。

### 5.2 扩展 → APP
1. 在扩展 options 点击“导出同步包”。
2. 在 APP 设置点击“导入并合并同步包”选择该文件。
3. APP 合并后保存本地并按现有机制推送 iCloud（如可用）。

### 5.3 设备 A → 设备 B（同端）
- 任意端导出同步包，目标设备导入并合并。

## 6. 导入失败与回退
- 文件非法/JSON 解析失败/结构不匹配：拒绝写入，保持本地原数据。
- 导入过程为“读→合并→一次性写入”。
- 建议操作前先导出一个本地同步包作为快照（人工回退）。

## 7. 与“真实发生时间”的关系
- 当前实现假设设备时间基本可信。
- 若设备时钟偏差很大，LWW 可能出现“旧值压新值”。
- 推荐后续升级：
  - 引入 HLC（Hybrid Logical Clock）或 Lamport Clock
  - 服务器时间锚点/签名事件日志
  - 记录字段级操作日志（而非只存最终值时间戳）

## 8. 安全说明（当前）
- 同步包是明文 JSON，包含敏感字段（密码、TOTP、恢复码、备注、passkey 私钥）。
- 当前仅适合本地受控传输。
- 下一步建议：
  - 同步包加密（`Argon2id + XChaCha20-Poly1305`）
  - 加签防篡改
  - 单次导入口令与过期时间

## 9. 版本演进建议
- v2 建议补充：
  - `folders.updatedAtMs`
  - 字段级操作日志
  - 明确 tombstone 生命周期
  - `sourceClock`（逻辑时钟）和 `deviceId`
