# 全部账号与文件夹的独立账号排序

> 状态：V2 已落地。本文记录当前数据模型和实际规则，不是待实施计划。实现入口包括统一 UI、Tauri/Web 适配器、Chrome Web bridge，以及 Rust/JS 合并对拍。

## 1. 数据模型

账号实体只保存一份；排序属于显示作用域：

- 顶层 `allRegularAccountIds`：全部活动账号的普通顺序。
- `Folder.regularAccountIds`：该文件夹内活动账号的普通顺序。
- 顶层 `folderOrderIds`：文件夹侧栏顺序。

每个列表配套 `...OrderUpdatedAtMs` 和 `...OrderUpdatedDeviceName`。数组位置就是排序值，第一项是普通列表最上方；不再依赖 `-1、-2` 这类稀疏序号。账号仍可保留 `regularSortOrder` 作为旧数据兼容字段，但新 UI 和同步以作用域 ID 列表为准。

```json
{
  "allRegularAccountIds": ["account-a", "account-b"],
  "allRegularOrderUpdatedAtMs": 1777777777000,
  "allRegularOrderUpdatedDeviceName": "MacBook",
  "folderOrderIds": ["folder-work"],
  "folders": [{
    "id": "folder-work",
    "regularAccountIds": ["account-b", "account-a"],
    "regularOrderUpdatedAtMs": 1777777777100,
    "regularOrderUpdatedDeviceName": "MacBook"
  }]
}
```

## 2. 规范化规则

加载、编辑、恢复、导入和同步合并后都会规范化：

1. 去重，保留第一次出现的位置；
2. 移除不存在、永久删除或不属于该文件夹的 ID；
3. 将合法但遗漏的活动实体追加到末尾；
4. 固定“新账号”文件夹始终排在文件夹列表第一；
5. 回收站和永久删除墓碑不进入活动列表。

置顶是独立显示分区，不改变普通顺序的语义；普通列表可保留置顶账号的 ID，以便取消置顶后恢复原位置。

## 3. 实际操作规则

| 操作 | 全部账号顺序 | 目标文件夹顺序 |
|---|---|---|
| 全部账号中新建 | 插入顶部 | 插入自动归属文件夹顶部 |
| 在文件夹内新建 | 插入全部列表顶部 | 插入当前文件夹顶部 |
| “添加到文件夹” | 不改变 | 新加入的账号按选中顺序插入普通区顶部；已有成员不重新排序 |
| 从文件夹移除 | 不改变 | 从该文件夹列表移除 |
| 回收站恢复 | 插入全部列表顶部 | 恢复到仍存在的原文件夹，并插入各自普通区顶部 |
| 拖拽排序 | 只更新 `allRegularAccountIds` | 只更新当前 `Folder.regularAccountIds` |

批量添加到文件夹按用户最终勾选的文件夹集合编辑归属：部分已有的关系保持原位置，不因确认操作重排；新加入关系按批量选择的原顺序插入顶部。批量操作不会改变置顶状态。

## 4. 同步裁决

- 账号内容字段与顺序列表是独立字段，分别按更新时间、设备名和值做确定性 LWW。
- 同一作用域的两个顺序列表并发修改时，胜出的完整列表作为基线；遗漏的活动 ID按规范化规则追加。
- 文件夹顺序与文件夹内账号顺序互不覆盖。
- 服务端不理解排序业务，只保存完整加密/明文载荷和 ETag 版本。
- 同步包导出、导入预览、自建服务器和 WebDAV（Tauri/Web）都保留三类顺序。

## 5. 代码与验证入口

- Rust：`core/pass_core/crates/merge/src/v2`。
- Tauri UI：`apps/codex-tauri/src/main.js`。
- Docker Web：`apps/pass-web/src/main.rs`。
- Chrome Web：`apps/extension_chrome_web/extension-bridge.js`。
- 对拍：`core/pass_core/js/check_merge_parity.mjs`。

```bash
bash scripts/core_gate.sh
node scripts/check_command_matrix.mjs
```
