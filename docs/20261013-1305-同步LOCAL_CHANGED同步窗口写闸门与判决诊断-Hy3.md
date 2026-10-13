# 同步 LOCAL_CHANGED 仍未根治：同步窗口写闸门 + 判决性诊断（1.9.2）

- 时间：2026-10-13 13:05
- 模型：Hy3
- 前置：`20261013-1243-同步LOCAL_CHANGED等价重写误报根治-Hy3.md`（1.9.1 内容感知守卫，用户实测仍复现）

## 现象

用户在 1.9.0 标题构建上执行「云端覆盖本地」，仍报
`LOCAL_CHANGED`（同步编号 EF2DD0AF，推送本身成功，收尾守卫失败）。

## 根因分析

1.9.1 的内容感知守卫（`assertLocalUnchanged` 比较 `lastAppliedPayload`）依赖
「回显内容与同步写入内容在归一化后一致」。但管理页（`web-options.html` 加载
`extension-bridge.js`）的 `normalizeData` 会**实质性改写内容**：

- 无条件覆盖 `lastOperatedDeviceName` 为页面设备名；
- 缺失的 `xxxUpdatedAtMs` 用 `now()` 回填；
- 过滤 `folderIds` 指向已不存在文件夹的项并重排；
- 重建 `allRegularAccountIds` / `folderOrderIds`（过滤 + 追加，顺序可变）。

这些差异能穿过后台 `normalizeSyncPayloadShape` 存活，于是回显被判定为
「真实变化」→ 落库 revision +1 → 收尾守卫比较 `lastAppliedPayload`（同步写入的
原始形态）也判不同 → `LOCAL_CHANGED`。逐字段猜测不可收敛，改为结构性修复。

## 修复（三层，全部在 `apps/extension_shared/background.js`）

1. **同步窗口写闸门**：`beginSyncWindow()/endSyncWindow()/waitSyncWindowEnd()`。
   `runManagedSync` 在同步全程开窗；`handleWebBridgeSyncData` 落库前先
   `await waitSyncWindowEnd()`——窗口内任何回显写入都推迟到同步结束后，
   revision 在守卫检查区间内不可能被顶掉。窗口结束后等价回显被等值守卫跳过，
   真实编辑推迟落库、留给下一轮同步。
2. **LOCAL_CHANGED 判决性诊断**（复用 1.8.6 诊断增强的成功经验）：
   新增 `describeSyncPayloadDiff`，报错携带
   `版本 A→B；账号 X→Y / 样例 … / 排序表不同 / 设备名不同`。
   若仍有残余写入路径，一次报错即可定位改写来源。
3. **版本戳缺口修复**（`scripts/version.mjs`）：Chrome dist 5 个 bundle 的
   `PASS_EXTENSION_VERSION` 与 `apps/extension_chrome_web/app_version.js` 的
   `APP_VERSION` 纳入 bump + check（65 → 71 处版本源）。此前构建先于 bump 执行，
   dist 烙旧版本号，导致「标题 v1.9.0 无法区分是否含 1.9.1 修复」的验证混乱。

## 验证

- `apps/extension_shared`：196/196（新增 2 个回归：同步窗口内 Web 桥写入推迟
  落库；LOCAL_CHANGED 报错含 revision 与差异诊断）。
- `node scripts/version.mjs check`：71 处一致 @1.9.2。
- 产物：`extension_shared npm run build` → `build-extension-chrome-web.sh` 全链重建，
  dist 含闸门代码且版本戳 1.9.2。

## 用户操作

`chrome://extensions` 重载扩展 → 硬刷新管理页 → 标题应显示 **v1.9.2**
（版本戳缺口已修，标题从此可信）。再执行「云端覆盖本地」：预期一次弹窗、
分段换行正常、绿字成功；若仍报错，错误文本自带差异判决信息，发截图即可一次定位。
