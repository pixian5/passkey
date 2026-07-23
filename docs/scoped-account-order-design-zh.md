# 将账号顺序作为文件夹字段的设计

## 1. 目标

当前 `regularSortOrder` 存在于账号对象中，只有一套全局顺序。账号同时属于多个文件夹时，无法表达以下情况：

```text
全部账号：账号 A、账号 B、账号 C
工作文件夹：账号 B、账号 A
个人文件夹：账号 C、账号 A
```

本方案将普通账号排序改为“保存在文件夹对象的字段中”。

作用域包括：

- `all`：全部活动账号；
- `folder:<folder-id>`：某个文件夹中的活动账号。

每个文件夹保存一套独立顺序。同一个账号可以在不同文件夹中拥有不同位置。

“全部账号”不是用户文件夹，因此不伪造一个可见的系统文件夹，而是在 Vault/SyncPayload 顶层保存一个等价的 `allRegularAccountIds` 字段。逻辑上它也是一个列表作用域，但物理归属不同。

本方案只改变普通账号排序。置顶状态和置顶顺序在第一阶段继续沿用当前全局字段，不借此需求扩大为“每个文件夹独立置顶”。

## 2. 推荐模型

### 2.1 顺序是文件夹字段，不是账号字段

每个 `Folder` 增加普通账号顺序字段：

```json
{
  "id": "folder-work",
  "name": "工作",
  "regularAccountIds": ["account-b", "account-a"],
  "regularOrderUpdatedAtMs": 1777777777100,
  "regularOrderUpdatedDeviceName": "MacBook"
}
```

数组索引就是普通排序值：第一个账号等价于 `regularSortOrder = 0`。不再使用 `-1、-2`，也不需要维护稀疏序号。

`SyncPayload` 顶层另有：

```json
{
  "allRegularAccountIds": ["account-a", "account-b", "account-c"],
  "allRegularOrderUpdatedAtMs": 1777777777000,
  "allRegularOrderUpdatedDeviceName": "MacBook"
}
```

账号实体仍然只保存一次，文件夹字段只保存稳定的 `recordId`。不能把完整账号对象复制到文件夹中，否则编辑密码、删除账号和同步时会产生多份事实来源。

### 2.2 推荐的数据类型

在共享 Core 的 `Folder` 中增加字段：

```rust
pub struct Folder {
    // 现有字段省略
    pub regular_account_ids: Vec<String>,
    pub regular_order_updated_at_ms: i64,
    pub regular_order_updated_device_name: String,
}
```

`SyncPayload` 增加“全部账号”字段：

```rust
pub all_regular_account_ids: Vec<String>,
pub all_regular_order_updated_at_ms: i64,
pub all_regular_order_updated_device_name: String,
```

同时保留现有 `regularSortOrder` 一段过渡期，作为旧客户端的 `all` 作用域兼容字段。新客户端显示排序优先使用 `allRegularAccountIds` 和 `Folder.regularAccountIds`。

### 2.3 为什么不推荐“每个账号保存 folder -> order 映射”

例如：

```json
{
  "folder:work": 0,
  "folder:personal": 3
}
```

这种结构可以实现功能，但有三个问题：

1. 一个文件夹拖动一次，通常要修改文件夹内所有账号的映射；
2. 同一个文件夹的排序信息分散在多个账号对象中，容易出现部分更新；
3. 同步时要合并大量账号字段，无法明确表示“这是一次文件夹排序操作”。

文件夹顺序本质上是列表属性，因此把有序 ID 列表作为 `Folder` 字段更符合领域模型。全部账号虽然不是实体文件夹，但仍使用同样的列表语义。

## 3. 排序语义

### 3.1 全部账号

`allRegularAccountIds` 保存所有未删除、未永久删除账号的普通位置。置顶账号的 ID 也保留在数组中，取消置顶后可回到原位置。

显示时：

1. 置顶账号仍先显示；
2. 普通账号按 `allRegularAccountIds` 的顺序显示；
3. 列表中不存在的合法普通账号追加到末尾；
4. 已删除或永久删除账号不参与活动列表。

### 3.2 文件夹

`Folder.regularAccountIds` 只保存属于该文件夹的活动账号位置；置顶账号同样保留其位置，但显示时先进入置顶区。

同一个账号属于多个文件夹时，在每个文件夹列表中分别保存一个位置。

文件夹列表不复制账号资料，只通过账号稳定 ID 引用账号。

### 3.3 缺失、重复和无效 ID

每次加载或合并后都执行规范化：

1. 删除重复 ID，保留第一次出现的位置；
2. 删除不存在的账号 ID；
3. 删除不属于该文件夹的账号 ID；
4. 将合法但未出现在列表中的账号追加到末尾；
5. 重新生成连续的内存索引 `0..N-1`。

规范化不能改变账号内容字段，也不能把回收站账号重新加入活动列表。

### 3.4 新建和加入文件夹

推荐规则：

| 操作 | `allRegularAccountIds` | `Folder.regularAccountIds` |
|---|---|---|
| 全部账号中新建 | 插入普通列表顶部 | 插入其自动归属文件夹顶部 |
| 在文件夹内新建 | 插入 `all` 顶部 | 插入当前文件夹顶部 |
| 已有账号添加到文件夹 | 不改变 | 插入目标文件夹顶部 |
| 网站规则自动加入 | 不改变 | 插入匹配文件夹顶部 |
| 从文件夹移除 | 不改变 | 从该文件夹列表移除 |

“添加到文件夹”不会改变置顶状态。

如果产品最终希望“在文件夹内新建账号只影响文件夹，不影响全部账号”，只需把第二行的 `all` 改为“保持原位置”；该行为需要在实现前固定，不能由 UI 当前筛选状态隐式决定。

### 3.5 拖拽

- 在“全部账号”中拖动，只更新 `allRegularAccountIds`；
- 在文件夹中拖动，只更新对应 `Folder.regularAccountIds`；
- 跨置顶区拖动不改变置顶状态；
- 每次成功拖动后立即规范化为连续列表；
- 搜索、通行密钥和验证码筛选只影响显示，不应创建新的排序作用域；
- 在筛选结果中拖动时，必须基于完整作用域列表合并可见子集，不能只给可见账号写局部序号。

## 4. 置顶处理边界

第一阶段继续使用现有：

- `isPinned`；
- `pinnedSortOrder`。

置顶账号不出现在普通列表的显示区域，但普通列表可以保留它的 ID，便于取消置顶后恢复原普通位置。若要保持当前“取消置顶后清空普通顺序”的行为，则取消置顶时将账号插入当前作用域顶部，并在迁移测试中固定该行为。

推荐采用“保留普通位置”：置顶只是改变显示分区，不丢失账号在各作用域的普通位置。这对多文件夹场景更容易理解，但属于行为变化，需要在 UI 验收中明确提示。

本需求不改变文件夹本身的 `folderOrder`，账号排序和文件夹排序是两套独立数据。

## 5. 同步设计

### 5.1 同步粒度

账号内容仍按现有字段级时间戳合并。排序不再借用账号的 `updatedAtMs`，而是作为 `Folder` 或顶层“全部账号”字段的独立元数据合并：

```text
(`allRegularAccountIds` 或 `Folder.regularAccountIds`, 独立更新时间, 独立设备名)
```

账号密码被修改，不应导致文件夹顺序变化；文件夹排序变化，也不应覆盖账号密码、备注或通行密钥。

### 5.2 同一作用域的并发修改

两个设备同时重排同一个文件夹（或同时重排“全部账号”）时，第一阶段采用该列表级最后写入者胜出：

1. 比较 `updatedAtMs`；
2. 时间相同则比较规范化的设备 ID/设备名，保证确定性；
3. 采用胜出的完整顺序列表；
4. 将两端都存在但胜出列表遗漏的合法账号追加到末尾，避免排序冲突造成账号消失。

这意味着同一文件夹的同时拖拽不会自动做复杂的操作级交织，但不会丢失账号实体。

### 5.3 不同作用域的并发修改

不同列表独立合并：

- 设备 A 重排 `folder:work`；
- 设备 B 重排 `folder:personal`；
- 两个修改都保留。

这正是从账号字段映射改为作用域列表的主要收益。

### 5.4 文件夹和账号变化的合并顺序

合并顺序固定为：

1. 合并账号集合及账号字段；
2. 合并文件夹集合及文件夹墓碑；
3. 合并账号文件夹成员关系；
4. 合并 `allRegularAccountIds` 和每个 `Folder.regularAccountIds`；
5. 按最终成员关系清理和补全每个列表；
6. 输出规范化后的连续顺序。

文件夹永久删除后，随文件夹删除其 `regularAccountIds` 字段。恢复文件夹时可以新建空列表，再按当前成员关系追加账号；不恢复已经永久删除的旧顺序引用。

### 5.5 同步包版本

本次保持 `pass.sync.bundle.v2` 和 `formatVersion: 2`。三个排序字段作为 V2 的可选扩展，并已写入机器 Schema：

- 顶层 `allRegularAccountIds`、`allRegularOrderUpdatedAtMs`、`allRegularOrderUpdatedDeviceName`；
- `Folder.regularAccountIds`、`regularOrderUpdatedAtMs`、`regularOrderUpdatedDeviceName`；
- 缺少这些字段的旧 V2 包照常导入，首次规范化时从旧 `regularSortOrder` 生成全部账号的初始顺序。

旧客户端不会理解文件夹独立顺序，因此它们的后续写回不会携带该字段；新客户端会保留自己已知的文件夹顺序，且以列表独立时间戳裁决。若未来需要承诺“旧客户端也能编辑文件夹独立顺序”，再另行升级为 V3，而不是把不兼容语义伪装成 V2。

## 6. 本地存储

### 6.1 Tauri

Tauri 的账号与文件夹都以加密 JSON 存在 SQLite `kv` 记录中，因此直接扩展 `Folder` JSON；全部账号排序保存在独立的加密键 `all_regular_order.v1`：

```text
all_regular_order.v1 = {
  accountIds: [...],
  updatedAtMs: 0,
  updatedDeviceName: ""
}
```

约束：

- 文件夹 JSON 数组只能包含稳定账号 ID；
- `all_regular_order.v1` 只代表全部账号列表；
- 写入采用事务；
- 账号、文件夹成员关系和对应排序字段的更新必须在同一事务中完成。

### 6.2 Web/Docker

在 `Folder`/`VaultData` 中增加：

```rust
// Folder.regularAccountIds 由每个文件夹自身保存
all_regular_account_ids: Vec<String>,
all_regular_order_updated_at_ms: i64,
all_regular_order_updated_device_name: String,
```

由于整个 Web Vault 已经加密保存，排序作用域与账号数据一起写入，不新增明文文件。

### 6.3 内存状态

`AppState` 需要返回全部账号排序字段和每个 Folder 自身的排序字段，前端不再从账号对象的顶层 `regularSortOrder` 推断文件夹排序。旧数据迁移完成后，顶层字段只作为兼容导出字段，不作为新 UI 的权威来源。

## 7. 迁移方案

### 7.1 迁移前备份

迁移前自动创建本地安全快照，记录：

- 迁移前账号数；
- 文件夹数；
- 通行密钥数；
- 旧排序字段数量；
- 新建作用域数量。

### 7.2 生成 `all`

按当前显示规则排序：

1. 置顶和普通分区保持当前语义；
2. 普通区按 `regularSortOrder` 升序；
3. 无序账号按当前更新时间和稳定 ID；
4. 生成连续的 `allRegularAccountIds`。

### 7.3 生成文件夹作用域

对每个未删除文件夹：

1. 从 `allRegularAccountIds` 中筛选属于该文件夹的普通账号；
2. 保持筛选后的相对顺序；
3. 追加遗漏的合法账号；
4. 保存到该文件夹的 `regularAccountIds` 字段。

这样迁移不会改变用户当前看到的顺序，只是把一套全局顺序拆成多套初始顺序。

### 7.4 过渡字段

迁移后新 UI 和同步的权威数据是排序数组。`accounts[].regularSortOrder` 仅用于导入没有新字段的旧 V2 数据时的初始顺序；新客户端不再将它作为文件夹排序来源，也不会让账号内容更新时间覆盖列表更新时间。

## 8. API 和 UI 改造

### 8.1 Core API

新增纯函数：

- `normalize_order_scope(scope, accounts, folders)`；
- `merge_order_scopes(local, remote, accounts, folders)`；
- `insert_account_at_top(scope_id, account_id)`；
- `remove_account_from_scope(scope_id, account_id)`；
- `reorder_order_scope(scope_id, ordered_ids)`。

所有端只能调用 Core 规则，不能各自实现一套排序合并。

### 8.2 Tauri/Web 命令

将现有无作用域命令：

```text
reorder_accounts(orderedIds, pinned)
```

改为：

```text
reorder_accounts(scopeId, orderedIds, pinned)
```

`pinned` 第一阶段继续兼容现有全局置顶逻辑；普通排序必须传入 `scopeId`。

创建账号建议接受初始文件夹列表，在一个事务内完成创建、归属和排序插入，避免当前“先创建、再设置文件夹”的中间状态。

### 8.3 前端渲染

排序函数接收 `scopeId`：

```text
sortAccounts(accounts, scopeId)
```

进入全部账号使用 `all`，进入文件夹使用 `folder:<id>`。搜索、通行密钥、验证码筛选都只做当前作用域的可见子集，不新增排序数据。

## 9. 测试计划

### 9.1 单元测试

- 一个账号在两个文件夹中拥有不同顺序；
- 新账号同时写入 `all` 和目标文件夹顶部；
- 已有账号加入文件夹只改变目标文件夹；
- 从文件夹移除不改变 `all`；
- 文件夹删除清理对应作用域；
- 重复 ID、无效 ID、非成员 ID 被清理；
- 永久删除账号不会通过排序列表复活；
- 置顶/取消置顶不改变其他作用域顺序；
- 搜索后拖拽仍然保留不可见账号的相对位置；
- 同一作用域并发排序采用确定性胜出；
- 不同作用域并发排序互不覆盖。

### 9.2 同步黄金向量

至少增加以下向量：

1. v2 旧包迁移到 v3；
2. 全部账号排序与工作文件夹排序不同；
3. A 设备重排工作文件夹、B 设备修改个人文件夹；
4. A 设备重排工作文件夹、B 设备修改账号密码；
5. 一端删除账号，另一端仍保留旧排序引用；
6. 一端删除文件夹，另一端在该文件夹排序；
7. 两端同一时间重排同一文件夹。

### 9.3 端到端验收

- Tauri 创建、拖拽、重启后顺序一致；
- Docker Web 创建、拖拽、刷新后顺序一致；
- Tauri 与 Docker Web 互相同步后顺序一致；
- 同步包导出/导入保留全部作用域；
- 旧 v2 包导入不丢账号、不丢密码，只生成全局初始顺序；
- 回收站、永久删除、恢复后列表没有幽灵账号。

## 10. 分阶段实施

### 阶段一：Core 和格式

- 增加 `AccountOrderScope`；
- 增加 v3 schema 和迁移；
- 编写合并函数和黄金向量；
- 保留旧字段兼容导出。

### 阶段二：Tauri

- SQLite 表和事务写入；
- 初始化迁移；
- 全部账号、文件夹独立拖拽；
- 新建/添加/移除文件夹更新作用域；
- 完成桌面端测试后重新构建并启动 `.app`。

### 阶段三：Web/Docker

- VaultData 和 API 接入；
- Docker Web 使用相同 Core 合并；
- 更新镜像、重启容器；
- Playwright/API 验证全部账号和多个文件夹的独立顺序。

### 阶段四：旧数据和旧客户端观察

- 检查旧字段仍可导出；
- 显示旧客户端能力提示；
- 观察同步包往返是否丢失作用域；
- 确认后再决定是否移除顶层 `regularSortOrder`。

## 11. 明确不做的事情

- 不复制账号完整对象到文件夹；
- 不让同步服务器理解排序业务；
- 不用账号 `updatedAtMs` 伪装排序更新时间；
- 不把搜索结果当成新的持久化排序列表；
- 不把回收站账号自动加入活动文件夹顺序；
- 不在本阶段同时改造每个文件夹独立置顶，除非另行确认。

## 12. 推荐结论

采用“文件夹/全部账号保存有序账号 ID 列表”的第二种模型。

核心原则是：

```text
账号资料只有一份；
每个显示作用域有一份普通账号顺序；
排序变化只更新对应作用域；
同步按作用域合并，账号内容按字段时间戳合并。
```

这比在每个账号内保存大量 `folder -> regularSortOrder` 映射更容易维护，也能真正实现“全部账号”和每个文件夹独立排序。
