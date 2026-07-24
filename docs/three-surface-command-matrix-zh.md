# 三端命令矩阵与契约（阶段 D）
> 生成来源：`apps/codex-tauri/src/main.js` 的 `invoke(...)`，对照 Tauri `generate_handler`、`pass-web` match arm、扩展 `extension-bridge.js` case。
> 目标：防止命令漏实现、伪成功、返回形状分叉。

## 1. 覆盖摘要
- UI 命令数：68
- 扩展覆盖：68/68
- Docker Web 覆盖：68/68
- Tauri 覆盖：68/68
- UI 缺失扩展：无
- UI 缺失 Web：无
- UI 缺失 Tauri：无

## 2. 返回形状约定（本阶段强制）
| 命令 | 返回形状 | 说明 |
|---|---|---|
| `health_check` | `object(capabilities)` | UI 依赖或跨端关键 |
| `get_undo_status` | `object|null` | UI 依赖或跨端关键 |
| `get_redo_status` | `object|null` | UI 依赖或跨端关键 |
| `toggle_account_pin` | `account-object` | UI 依赖或跨端关键 |
| `set_accounts_pinned` | `void-like (true/null)` | UI 依赖或跨端关键 |
| `soft_delete_accounts` | `count-number (target)` | UI 依赖或跨端关键 |
| `restore_all_deleted_accounts` | `count-number` | UI 依赖或跨端关键 |
| `hard_delete_all_deleted_accounts` | `count-number` | UI 依赖或跨端关键 |
| `hard_delete_account` | `void-like` | UI 依赖或跨端关键 |
| `create_folder` | `folder-object` | UI 依赖或跨端关键 |
| `create_account` | `account-object` | UI 依赖或跨端关键 |
| `export_csv` | `object({csvPath|download*})` | UI 依赖或跨端关键 |
| `export_csv_to_path` | `object({csvPath|download*})` | UI 依赖或跨端关键 |
| `sync_preview` | `object(report,...)` | UI 依赖或跨端关键 |
| `sync_now_mode` | `object(report,...)` | UI 依赖或跨端关键 |

规则：
1. `restore_all_deleted_accounts` / `hard_delete_all_deleted_accounts` 必须返回数字 count。
2. `soft_delete_accounts` 统一返回数字 count（被移入回收站数量）。
3. `toggle_account_pin` 返回更新后的账号对象。
4. `set_accounts_pinned` 可返回 void-like（`true`/`null`），但不得伪成功。
5. 平台不支持命令：明确中文错误，或列表类返回空数组；禁止静默成功。
6. `health_check.capabilities` 必须反映真实能力。

## 3. 平台专属 / 降级命令
| 命令 | Tauri | Docker Web | Chrome 扩展 |
|---|---|---|---|
| `lock_unlock_biometric` | macos-only | error | error |
| `sync_webdav_now_mode` | full | full | error |
| `list_server_versions` | full | full | empty-list |
| `restore_server_version` | full | full | error |
| `provision_self_hosted_server` | full | error/draft | error/draft |
| `detect_existing_sync_service` | full | limited | limited |
| `choose_export_directory` | full | null | null |
| `get_ssh_credential` | full | empty | empty |
| `save_ssh_credential_cmd` | full | true | true |
| `lock_biometric_available` | macos | false | false |

## 4. 全量 UI 命令覆盖表
| 命令 | Tauri | Web | Extension | 返回形状/备注 |
|---|---|---|---|---|
| `choose_export_directory` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "null", "ext": "null"} |
| `configure_folder_site_rules` | ✅ | ✅ | ✅ |  |
| `create_account` | ✅ | ✅ | ✅ | account-object |
| `create_folder` | ✅ | ✅ | ✅ | folder-object |
| `deduplicate_folder` | ✅ | ✅ | ✅ |  |
| `delete_folder` | ✅ | ✅ | ✅ |  |
| `detect_existing_sync_service` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "limited", "ext": "limited"} |
| `export_browser_csv_cmd` | ✅ | ✅ | ✅ |  |
| `export_csv` | ✅ | ✅ | ✅ | object({csvPath|download*}) |
| `export_csv_to_path` | ✅ | ✅ | ✅ | object({csvPath|download*}) |
| `export_sync_bundle` | ✅ | ✅ | ✅ |  |
| `generate_demo_accounts` | ✅ | ✅ | ✅ |  |
| `generate_sync_encryption_key` | ✅ | ✅ | ✅ |  |
| `get_app_state` | ✅ | ✅ | ✅ |  |
| `get_folder_duplicate_groups` | ✅ | ✅ | ✅ |  |
| `get_lock_state` | ✅ | ✅ | ✅ |  |
| `get_operation_history` | ✅ | ✅ | ✅ |  |
| `get_provision_draft` | ✅ | ✅ | ✅ |  |
| `get_redo_status` | ✅ | ✅ | ✅ | object|null |
| `get_ssh_credential` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "empty", "ext": "empty"} |
| `get_sync_settings` | ✅ | ✅ | ✅ |  |
| `get_ui_prefs` | ✅ | ✅ | ✅ |  |
| `get_undo_status` | ✅ | ✅ | ✅ | object|null |
| `hard_delete_account` | ✅ | ✅ | ✅ | void-like |
| `hard_delete_all_deleted_accounts` | ✅ | ✅ | ✅ | count-number |
| `health_check` | ✅ | ✅ | ✅ | object(capabilities) |
| `import_browser_csv_text` | ✅ | ✅ | ✅ |  |
| `import_google_authenticator_totp` | ✅ | ✅ | ✅ |  |
| `import_sync_bundle_text` | ✅ | ✅ | ✅ |  |
| `list_local_snapshots` | ✅ | ✅ | ✅ |  |
| `list_server_versions` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "full", "ext": "empty-list"} |
| `lock_biometric_available` | ✅ | ✅ | ✅ | platform={"tauri": "macos", "web": "false", "ext": "false"} |
| `lock_change_password` | ✅ | ✅ | ✅ |  |
| `lock_disable` | ✅ | ✅ | ✅ |  |
| `lock_enable` | ✅ | ✅ | ✅ |  |
| `lock_now` | ✅ | ✅ | ✅ |  |
| `lock_save_preferences` | ✅ | ✅ | ✅ |  |
| `lock_touch` | ✅ | ✅ | ✅ |  |
| `lock_unlock` | ✅ | ✅ | ✅ |  |
| `lock_unlock_biometric` | ✅ | ✅ | ✅ | platform={"tauri": "macos-only", "web": "error", "ext": "error"} |
| `merge_sync_payloads` | ✅ | ✅ | ✅ |  |
| `provision_self_hosted_server` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "error/draft", "ext": "error/draft"} |
| `redo_last_operation` | ✅ | ✅ | ✅ |  |
| `rename_folder` | ✅ | ✅ | ✅ |  |
| `reorder_accounts` | ✅ | ✅ | ✅ |  |
| `reorder_folders` | ✅ | ✅ | ✅ |  |
| `restore_account` | ✅ | ✅ | ✅ |  |
| `restore_all_deleted_accounts` | ✅ | ✅ | ✅ | count-number |
| `restore_local_snapshot` | ✅ | ✅ | ✅ |  |
| `restore_server_version` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "full", "ext": "error"} |
| `save_provision_draft` | ✅ | ✅ | ✅ |  |
| `save_ssh_credential_cmd` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "true", "ext": "true"} |
| `set_account_folders` | ✅ | ✅ | ✅ |  |
| `set_accounts_folders` | ✅ | ✅ | ✅ |  |
| `set_accounts_pinned` | ✅ | ✅ | ✅ | void-like (true/null) |
| `set_device_name` | ✅ | ✅ | ✅ |  |
| `set_sync_settings` | ✅ | ✅ | ✅ |  |
| `set_ui_prefs` | ✅ | ✅ | ✅ |  |
| `soft_delete_account` | ✅ | ✅ | ✅ |  |
| `soft_delete_accounts` | ✅ | ✅ | ✅ | count-number (target) |
| `sync_key_id` | ✅ | ✅ | ✅ |  |
| `sync_now_mode` | ✅ | ✅ | ✅ | object(report,...) |
| `sync_preview` | ✅ | ✅ | ✅ | object(report,...) |
| `sync_webdav_now_mode` | ✅ | ✅ | ✅ | platform={"tauri": "full", "web": "full", "ext": "error"} |
| `toggle_account_pin` | ✅ | ✅ | ✅ | account-object |
| `undo_last_operation` | ✅ | ✅ | ✅ |  |
| `update_account` | ✅ | ✅ | ✅ |  |
| `verify_sync_endpoint` | ✅ | ✅ | ✅ |  |

## 5. 自动检查
```bash
node scripts/check_command_matrix.mjs
cd apps/extension_shared && npm test -- tests/command_matrix.test.mjs
```

失败条件：
- UI 命令任一端缺失实现
- 扩展对 WebDAV/服务器版本等返回伪成功
- 关键计数命令返回非数字
