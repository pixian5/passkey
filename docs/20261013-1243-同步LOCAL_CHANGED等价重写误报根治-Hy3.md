# 同步 LOCAL_CHANGED 反复误报根因修复（1.9.0 → 1.9.1）

- 日期：2026-10-13 12:43
- 模型：Hy3
- 现象：用户每次点「云端覆盖本地」（及合并/本地覆盖云端）后，即使数据已成功写入并上传，仍以红字报
  `自建服务器[LOCAL_CHANGED]：同步部分完成：同步期间本地数据已变化，已保留最新编辑，请重新同步`
  （现场同步编号 8F32CA2F）。此前 1.8.9 收尾时被当作「良性措辞问题」解释，用户明确要求根治。

## 根因

业务 revision（`businessRevision`）只随业务集合写入自增（`data_store.js` 的
`BUSINESS_COLLECTIONS = [accounts, passkeys, folders, layout]`），同步管线用它做并发守卫：
`runAutoSyncInternal` 内 `assertLocalUnchanged` 在收尾时发现 revision ≠ 同步开始时基线即报 LOCAL_CHANGED。

问题在于存在**同内容等价重写**路径会在同步窗口内把 revision 顶掉 +1：

1. **Web 桥回显无等值守卫（主因）**：`applyCandidate` 写入成功后 `broadcastWebBridgeData` 通知
   Pass Web 页面；页面回发 `PASS_WEB_BRIDGE_SYNC_DATA`，`handleWebBridgeSyncData` **无条件**
   `setAllDataToDataStore`（不带 expectedRevision、无内容比较），同内容也 revision +1。
   对比：管理页自己的 `writeBusinessDataToStore` 一直有 `syncPayloadEquals` 等值守卫，唯独这条链路漏了。
2. 其他等价重写（规范化落盘、布局原样重写）同理：revision 变了但内容与同步已写入候选完全一致。

守卫只比较 revision、不比较内容，把上述无变化重写误判为「并发编辑」→ 每次同步都以失败收场。

## 修复（`apps/extension_shared/background.js`，两处独立防御）

1. `handleWebBridgeSyncData`：写入前先与当前库内容做 `syncPayloadEquals` 比较，一致则直接返回
   ok、**不落库不推进 revision**（与 `writeBusinessDataToStore` 对齐）。
2. `assertLocalUnchanged`：revision 变了先比内容——与 `lastAppliedPayload`（同步最后一次写入的候选，
   经 normalize）一致视为等价重写，重新基线 `expectedRevision` 放行；内容真正不同仍按并发冲突抛
   LOCAL_CHANGED（真实编辑保护不变，既有回归测试「上传期间的管理页编辑不会被同步回写覆盖」继续通过）。

## 回归测试（`apps/extension_shared/tests/sync_background.test.mjs`，194/194 通过）

- `上传期间的同内容等价重写（Web 桥回显）不触发 LOCAL_CHANGED`：push 前用相同内容重写本地
  （revision +1），断言 `report.ok === true` 且上传 1 次成功。
- `Web 桥同内容回显跳过落库，不推进 revision`：回显相同 payload 断言 `writes.length === 0`；
  回显不同 payload 断言正常落库 1 次。

## 收尾

- `./scripts/build-extension-chrome-web.sh` 重建 Chrome 扩展；`npm run build` 重建 shared bundle。
- 版本 1.9.0 → 1.9.1（65 处版本源一致）。
- 同弹窗修的 CSS 自动换行（`.confirm-summary` 加 `pre-wrap + overflow-wrap:anywhere`）随 1.9.0 已发。

## 验收指引（用户侧）

1. `chrome://extensions` 重载扩展（版本应显示 1.9.1）+ 硬刷新已打开的管理页。
2. 点「云端覆盖本地」：应一次程序原生弹窗（文本正常分段换行）→ 同步成功绿字，不再报 LOCAL_CHANGED。
3. 若仍出现 LOCAL_CHANGED，把同步编号发来上服务器查日志——此时剩下的只能是真实并发编辑路径。
