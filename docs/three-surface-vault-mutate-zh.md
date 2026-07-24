# 三端共享 vault mutation

## 目标

把删除/恢复/永久删除等关键字段写入从三端复制逻辑中抽离，避免再出现一端物理删除墓碑、另一端漏写设备名的分叉。

## API

### Rust (`pass_merge::v2`)

- `soft_delete_account(account, now_ms, device_name) -> bool`
- `permanently_delete_account(account, now_ms, device_name) -> bool`
- `restore_account_fields(account, now_ms, device_name) -> Result<bool, String>`
- `set_account_pinned(account, pinned, next_pin_order, now_ms, device_name) -> Result<(), String>`
- `permanently_delete_folder(folder, now_ms, device_name) -> Result<bool, String>`
- `mark_folder_membership(account, folder_id, is_deleted, now_ms, device_name)`

### JS (`vault_mutate_core.js`)

- `softDeleteAccount(account, nowMs, deviceName)`
- `permanentlyDeleteAccount(account, nowMs, deviceName)`
- `restoreAccountFields(account, nowMs, deviceName)`
- `setAccountPinned(account, pinned, nextPinOrder, nowMs, deviceName)`
- `permanentlyDeleteFolder(folder, nowMs, deviceName)`
- `markFolderMembership(account, folderId, isDeleted, nowMs, deviceName)`

## 边界

共享层负责账号字段语义；顺序数组、快照、撤销栈、UI 刷新仍由各表面处理。
