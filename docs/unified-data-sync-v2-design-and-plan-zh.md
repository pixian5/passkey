# APP / 扩展统一数据格式与同步实施计划（V2）

## 1. 目标与范围
- 目标：在当前仓库实现基础上，统一 mac APP 与 Chrome 扩展的数据格式、导入导出协议与合并语义。
- 覆盖场景：
  - APP ⇄ APP
  - 扩展 ⇄ 扩展
  - APP ⇄ 扩展
- 本文聚焦“可落地的 V2 手动同步统一”，自动增量同步（Sync Agent）作为下一阶段。

## 2. 当前状态与问题清单（截至 2026-03-06）
- APP 与扩展使用同名 schema `pass.sync.bundle.v1`，但 payload 字段集合不一致。
  - APP: `accounts + folders`
  - 扩展: `accounts + folders + passkeys`
- APP 账号结构有 `id: UUID`（强解码字段），扩展账号通常无 `id` 字段。
- APP `folderId/folderIds` 为 UUID 类型，扩展为 string。
- 扩展含 `passkeyCredentialIds/passkeyUpdatedAtMs` 与独立 `passkeys` 集合，APP 模型尚未完整承载。
- 两端“别名连通规则”实现细节有偏差，跨端反复导入可能出现收敛漂移。

## 3. 统一数据模型：`pass.data.v2`

### 3.1 顶层结构
```json
{
  "schema": "pass.data.v2",
  "meta": {
    "generatedAtMs": 1777777777777,
    "source": {
      "app": "pass-mac | pass-extension",
      "platform": "macos-app | chrome-extension",
      "deviceName": "MyDevice",
      "formatVersion": 2
    }
  },
  "accounts": [],
  "folders": [],
  "passkeys": []
}
```

### 3.2 统一 ID 规范
- `recordId` / `folder.id` / 其他实体 ID 统一为小写 UUID string。
- `accountId` 保留业务主键语义（站点-创建时间-用户名），用于跨端去重合并。
- `recordId` 不参与跨端去重，仅用于单端内部稳定引用。

### 3.3 账号模型（统一字段）
必填字段：
- `recordId`
- `accountId`
- `canonicalSite`
- `usernameAtCreate`
- `isPinned`
- `sites`
- `username`
- `password`
- `totpSecret`
- `recoveryCodes`
- `note`
- `passkeyCredentialIds`
- `usernameUpdatedAtMs`
- `passwordUpdatedAtMs`
- `totpUpdatedAtMs`
- `recoveryCodesUpdatedAtMs`
- `noteUpdatedAtMs`
- `passkeyUpdatedAtMs`
- `isDeleted`
- `lastOperatedDeviceName`
- `createdAtMs`
- `updatedAtMs`

可选字段：
- `deletedAtMs`
- `pinnedSortOrder`
- `regularSortOrder`
- `folderId`
- `folderIds`

### 3.4 文件夹模型（统一字段）
必填字段：
- `id`
- `name`
- `createdAtMs`
- `updatedAtMs`

约束：
- 固定文件夹始终存在：
  - `id = f16a2c4e-4a2a-43d5-a670-3f1767d41001`
  - `name = 新账号`

### 3.5 Passkey 模型（统一字段）
必填字段：
- `credentialIdB64u`
- `rpId`
- `userName`
- `displayName`
- `userHandleB64u`
- `alg`
- `signCount`
- `createdAtMs`
- `updatedAtMs`
- `mode`

可选字段：
- `privateJwk`
- `publicJwk`
- `lastUsedAtMs`

## 4. 统一同步包：`pass.sync.bundle.v2`

### 4.1 结构
```json
{
  "schema": "pass.sync.bundle.v2",
  "exportedAtMs": 1777777777777,
  "source": {
    "app": "pass-mac",
    "platform": "macos-app",
    "deviceName": "MacDevice",
    "formatVersion": 2
  },
  "payload": {
    "accounts": [],
    "folders": [],
    "passkeys": []
  }
}
```

### 4.2 兼容策略
- 导入端必须支持：
  - `pass.sync.bundle.v2`
  - `pass.sync.bundle.v1`
  - legacy root payload（无 schema 的历史 JSON）
- 导入流程统一为：
  - 解析 -> 归一化 -> 迁移到 V2 -> 合并 -> 原子写入
- 导出只输出 `v2`。

## 5. V1 -> V2 迁移规则

## 5.1 APP 本地数据 -> V2
- `id` -> `recordId`（小写 UUID）。
- 若不存在 `passkeyCredentialIds`：补 `[]`。
- 若不存在 `passkeyUpdatedAtMs`：补 `createdAtMs`。
- `folderId/folderIds(UUID)` 序列化为小写 string UUID。
- `passkeys` 顶层默认 `[]`。
- `folders.updatedAtMs` 缺失时用 `createdAtMs`。

## 5.2 扩展本地数据 -> V2
- 若账号缺失 `recordId`：生成并固化 UUID（写回本地，后续不再变化）。
- `folderId/folderIds` 统一小写 UUID string。
- 若 `usernameAtCreate` 缺失：回填 `username`。
- 若字段更新时间缺失：回填 `createdAtMs`。
- 若 `deletedAtMs` 与 `isDeleted` 不一致：按 `isDeleted` 修正。
- `folders.updatedAtMs` 缺失时用 `createdAtMs`。

## 5.3 bundle v1 -> bundle v2
- `schema: pass.sync.bundle.v1` -> `pass.sync.bundle.v2`
- payload 中缺失 `passkeys` 时补 `[]`。
- payload 中所有账号对象执行账号迁移规则。
- payload 中所有文件夹执行文件夹迁移规则。

## 6. 统一合并规则（V2）

### 6.1 账号集合合并
- 去重键：`accountId`
- 同 `accountId` 进入同账号合并；不同则追加。

### 6.2 同账号字段合并
- 文本字段：字段级 LWW
  - 比较顺序：`fieldUpdatedAtMs` -> `account.updatedAtMs` -> 非空值优先
- `sites`：并集 + 归一化 + 排序
- `passkeyCredentialIds`：并集 + 去重 + 排序
- `passkeyUpdatedAtMs`：取最大值

### 6.3 删除冲突
- `latestContentUpdatedAt = max(所有可编辑字段UpdatedAtMs, passkeyUpdatedAtMs)`
- `latestDeletedAt = max(lhs.deletedAtMs, rhs.deletedAtMs)`（仅 `isDeleted=true` 参与）
- 若 `latestDeletedAt >= latestContentUpdatedAt`：保留删除态
- 否则：恢复为未删除

### 6.4 文件夹合并
- 去重键：`folder.id`
- `createdAtMs` 取最小
- `updatedAtMs` 取最大
- `name` 取 `updatedAtMs` 更晚的一侧
- 固定文件夹 ID/名称强制覆盖
- 合并后清理账号 `folderIds` 中不存在的引用

### 6.5 Passkey 合并
- 去重键：`credentialIdB64u`
- 主体元数据取较新 `updatedAtMs`
- `signCount` 取最大
- `lastUsedAtMs` 取最大
- `createdAtMs` 取最小

## 7. 实施计划（含日期）

## 阶段 A：规格冻结（2026-03-09 ~ 2026-03-13）
- 产出：
  - `pass.data.v2` schema
  - `pass.sync.bundle.v2` schema
  - 迁移映射表
  - 合并测试向量（JSON fixtures）
- 完成标准：两端评审通过，不再增减字段。

## 阶段 B：扩展端接入 V2（2026-03-16 ~ 2026-03-20）
- 任务：
  - 新增 `recordId` 持久化
  - `folders.updatedAtMs` 写入
  - 导入支持 `v1/v2`，导出固定 `v2`
  - 合并逻辑按 V2 规则收口
- 完成标准：扩展自测通过，旧数据可迁移。

## 阶段 C：APP 端接入 V2（2026-03-23 ~ 2026-03-27）
- 任务：
  - `PasswordAccount` 扩充 passkey 相关字段
  - `SyncBundlePayload` 扩充 `passkeys`
  - 导入支持 `v1/v2`，导出固定 `v2`
  - folder 新增 `updatedAtMs`
- 完成标准：APP 能完整导入扩展 `v2` 包。

## 阶段 D：跨端一致性与回归（2026-03-30 ~ 2026-04-03）
- 任务：
  - APP->扩展->APP 往返一致性测试
  - 扩展->APP->扩展 往返一致性测试
  - 冲突样例一致性测试（删除/恢复/同字段冲突/passkey 冲突）
- 完成标准：同输入两端输出一致。

## 阶段 E：自动同步准备（2026-04-06 起）
- 任务：
  - 在 `sync_agent_desktop` 接入 `v2` 载荷
  - pull/push 使用同一合并规则
- 完成标准：手动同步与自动同步使用同一数据契约。

## 8. 测试与验收

### 8.1 核心验收
- 任一端导出 `v2`，另一端导入不报错且不丢字段。
- 旧 `v1` 数据导入后自动迁移并成功写回 `v2`。
- 删除态、恢复态、passkey 引用在往返同步后保持一致。

### 8.2 一致性验收
- 同一冲突样例在 APP 与扩展合并结果完全一致。
- 别名连通后 `sites` 集合一致，且稳定排序。

## 9. 风险与回退
- 风险：旧数据脏值导致迁移失败。
  - 处理：导入前校验并输出错误报告，不覆盖本地原数据。
- 风险：`recordId` 生成策略变化导致重复记录。
  - 处理：首次迁移后落盘锁定，不二次重算。
- 风险：passkey 私钥同步带来安全暴露。
  - 处理：V2 默认允许字段存在，但 UI 默认关闭“导出私钥材料”。

## 10. 立即执行项（从本文件开始）
1. 以 `docs/schemas/pass-data-v2.schema.json` 作为字段唯一真源。
2. 以 `docs/schemas/pass-sync-bundle-v2.schema.json` 作为导入导出协议真源。
3. 两端导入统一调用“迁移到 V2”步骤后再合并。
4. 合并逻辑变更必须同时更新跨端 fixtures 与回归测试。
