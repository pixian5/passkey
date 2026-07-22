mod app_lock;
mod exchange;
mod local_snapshots;
mod local_vault;
mod operation_history;
mod provision;
mod provision_settings;
mod sync;
mod ui_prefs;
mod window_state;

use chrono::{Local, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use pass_merge::v2::{sync_alias_groups, Folder, Passkey, PasswordAccount, SyncPayload};

use app_lock::{AppLockPolicy, AppLockPublicState, AppLockState};
use exchange::{
    browser_entries_from_csv, build_bundle_bytes, build_csv_string, export_browser_csv,
    import_bundle_content, list_sync_versions, local_from_parts, merge_imported_accounts,
    restore_sync_version, run_sync_with_mode, ImportResult, PathResult, SyncVersionSummary,
};
use local_snapshots::LocalSnapshotSummary;
use operation_history::HistoryEntry;
use provision::{
    detect_existing_service, host_from_server_url, load_ssh_credential, provision_server,
    save_ssh_credential, verify_public_endpoint, ExistingServiceReport, ProvisionResult,
    SshCredential,
};
use provision_settings::ProvisionDraft;
use sync::crypto::key_id;
use sync::pipeline::{
    local_payload_from_vault, preview_sync, run_sync, visible_account_count, visible_folder_count,
    visible_passkey_count, SyncMode,
};
use sync::settings::{load_sync_settings, save_sync_settings, SyncSettings};
use sync::webdav::{self, WebDavSettings};
use sync::{generate_sync_key, is_valid_sync_key};
use ui_prefs::{load_ui_prefs, save_ui_prefs, UiPrefs};

const KEY_ACCOUNTS: &str = "accounts.v2";
const KEY_ACCOUNTS_LEGACY: &str = "accounts.v1";
const KEY_FOLDERS: &str = "folders.v1";
const KEY_PASSKEYS: &str = "passkeys.v1";
const KEY_DEVICE_NAME: &str = "settings.device_name";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountInput {
    sites: Vec<String>,
    username: String,
    password: String,
    totp_secret: String,
    recovery_codes: String,
    note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TotpImportInput {
    site: String,
    username: String,
    secret: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TotpImportResult {
    created: usize,
    updated: usize,
    skipped: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    device_name: String,
    active_accounts: Vec<PasswordAccount>,
    deleted_accounts: Vec<PasswordAccount>,
    folders: Vec<Folder>,
    passkeys: Vec<Passkey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    csv_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoStatus {
    title: String,
    created_at_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistorySummary {
    id: String,
    title: String,
    created_at_ms: i64,
    stack: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderRuleResult {
    folder: Folder,
    matched_count: usize,
    added_count: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderDuplicateGroup {
    id: String,
    site_aliases: Vec<String>,
    username: String,
    accounts: Vec<PasswordAccount>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeduplicateResult {
    deleted_count: usize,
    kept_count: usize,
    group_count: usize,
    message: String,
}

#[tauri::command]
fn health_check() -> serde_json::Value {
    serde_json::json!({
        "app": "codex-tauri",
        "rustBackend": "ok",
        "supportedPlatforms": ["windows", "ubuntu-linux", "macos"],
        "featureParityTarget": [
            "device-name",
            "account-crud",
            "alias-domain-sync",
            "recycle-bin",
            "demo-data",
            "csv-export",
            "merge-preview-core",
            "self-hosted-sync"
        ],
        "sharedCore": ["pass-merge", "pass-csvio"]
    })
}

#[tauri::command]
fn get_undo_status(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<Option<UndoStatus>, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    Ok(
        operation_history::latest_undo(&dir).map(|entry| UndoStatus {
            title: entry.title,
            created_at_ms: entry.created_at_ms,
        }),
    )
}

#[tauri::command]
fn get_redo_status(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<Option<UndoStatus>, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    Ok(
        operation_history::latest_redo(&dir).map(|entry| UndoStatus {
            title: entry.title,
            created_at_ms: entry.created_at_ms,
        }),
    )
}

#[tauri::command]
fn get_operation_history(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<Vec<HistorySummary>, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let mut entries = operation_history::undo_entries(&dir)
        .into_iter()
        .map(|entry| HistorySummary {
            id: entry.id,
            title: entry.title,
            created_at_ms: entry.created_at_ms,
            stack: "undo".into(),
        })
        .collect::<Vec<_>>();
    entries.extend(
        operation_history::redo_entries(&dir)
            .into_iter()
            .map(|entry| HistorySummary {
                id: entry.id,
                title: entry.title,
                created_at_ms: entry.created_at_ms,
                stack: "redo".into(),
            }),
    );
    entries.sort_by_key(|entry| entry.created_at_ms);
    Ok(entries)
}

#[tauri::command]
fn undo_last_operation(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let entry: HistoryEntry =
        operation_history::latest_undo(&dir).ok_or_else(|| "没有可撤销的本地操作".to_string())?;
    let mut conn = open_db(&app)?;
    let current_device = load_device_name(&conn)?;
    let current = local_payload_from_vault(
        &load_accounts(&conn)?,
        &load_folders(&conn)?,
        &load_passkeys(&conn)?,
        &current_device,
    );
    local_snapshots::create(&dir, &current, "撤销本地操作前自动备份")?;
    save_payload_atomic(&mut conn, &entry.payload)?;
    operation_history::move_undo_to_redo(&dir, &entry.id, current)?;
    Ok(format!("已撤销：{}", entry.title))
}

#[tauri::command]
fn redo_last_operation(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let entry: HistoryEntry =
        operation_history::latest_redo(&dir).ok_or_else(|| "没有可重做的本地操作".to_string())?;
    let mut conn = open_db(&app)?;
    let current_device = load_device_name(&conn)?;
    let current = local_payload_from_vault(
        &load_accounts(&conn)?,
        &load_folders(&conn)?,
        &load_passkeys(&conn)?,
        &current_device,
    );
    local_snapshots::create(&dir, &current, "重做本地操作前自动备份")?;
    save_payload_atomic(&mut conn, &entry.payload)?;
    operation_history::move_redo_to_undo(&dir, &entry.id, current)?;
    Ok(format!("已重做：{}", entry.title))
}

#[tauri::command]
fn get_app_state(app: AppHandle, state: tauri::State<AppLockState>) -> Result<AppState, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let device_name = load_device_name(&conn)?;
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);
    let mut folders = load_folders(&conn)?;
    let (folders_changed, legacy_folder_ids) = ensure_fixed_new_account_folder(&mut folders);
    let accounts_changed =
        migrate_legacy_new_account_folder_ids(&mut accounts, &folders, &legacy_folder_ids);
    if folders_changed {
        save_folders(&conn, &folders)?;
    }
    if accounts_changed {
        save_accounts(&conn, &accounts)?;
    }
    let prefs = load_ui_prefs(&dir);
    apply_folder_order(&mut folders, &prefs.folder_order);
    let passkeys = load_passkeys(&conn)?;
    let active_accounts = accounts
        .iter()
        .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
        .cloned()
        .collect();
    let deleted_accounts = accounts
        .iter()
        .filter(|a| a.is_deleted && !a.is_permanently_deleted)
        .cloned()
        .collect();
    Ok(AppState {
        device_name,
        active_accounts,
        deleted_accounts,
        folders,
        passkeys,
    })
}

#[tauri::command]
fn set_device_name(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    device_name: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let trimmed = device_name.trim();
    if trimmed.is_empty() {
        return Err("设备名不能为空".into());
    }
    write_kv(&conn, KEY_DEVICE_NAME, trimmed)?;
    Ok(())
}

#[tauri::command]
fn create_account(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    input: AccountInput,
) -> Result<PasswordAccount, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let mut folders = load_folders(&conn)?;
    let (folders_changed, legacy_folder_ids) = ensure_fixed_new_account_folder(&mut folders);
    let accounts_changed =
        migrate_legacy_new_account_folder_ids(&mut accounts, &folders, &legacy_folder_ids);
    if folders_changed {
        save_folders(&conn, &folders)?;
    }
    if accounts_changed {
        save_accounts(&conn, &accounts)?;
    }
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let sites = normalize_sites(input.sites);
    if sites.is_empty() {
        return Err("至少填写一个站点".into());
    }
    let username = input.username.trim().to_string();
    if username.is_empty() {
        return Err("用户名不能为空".into());
    }
    if input.password.is_empty() {
        return Err("密码不能为空".into());
    }
    let canonical_site = sites[0].clone();
    let id = Uuid::new_v4().to_string();
    let created_id = id.clone();
    let mut account = PasswordAccount {
        record_id: Some(id.clone()),
        id: Some(id),
        account_id: format!("{canonical_site}-{now}-{username}"),
        canonical_site,
        username_at_create: username.clone(),
        sites,
        username: username.clone(),
        password: input.password,
        totp_secret: input.totp_secret,
        recovery_codes: input.recovery_codes,
        note: input.note,
        username_updated_at_ms: now,
        username_updated_device_name: device_name.clone(),
        password_updated_at_ms: now,
        password_updated_device_name: device_name.clone(),
        totp_updated_at_ms: now,
        totp_updated_device_name: device_name.clone(),
        recovery_codes_updated_at_ms: now,
        recovery_codes_updated_device_name: device_name.clone(),
        note_updated_at_ms: now,
        note_updated_device_name: device_name.clone(),
        created_at_ms: now,
        updated_at_ms: now,
        created_device_name: device_name.clone(),
        last_operated_device_name: device_name,
        ..Default::default()
    };
    snapshot_current_vault(&conn, &dir, "新建账号前自动备份")?;
    add_account_to_folder(&mut account, pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID);
    apply_automatic_folder_rules(&mut account, &folders);
    accounts.push(account);
    sync_alias_sites(&mut accounts);
    let created = accounts
        .iter()
        .find(|item| item.resolved_record_id() == created_id)
        .cloned()
        .ok_or_else(|| "创建账号后未找到记录".to_string())?;
    save_accounts(&conn, &accounts)?;
    Ok(created)
}

#[tauri::command]
fn update_account(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
    input: AccountInput,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let sites = normalize_sites(input.sites);
    if sites.is_empty() {
        return Err("至少填写一个站点".into());
    }
    if !accounts.iter().any(|item| account_matches_id(item, &id)) {
        return Err("未找到要更新的账号".into());
    }
    snapshot_current_vault(&conn, &dir, "编辑账号前自动备份")?;
    let mut found = false;
    for item in &mut accounts {
        if account_matches_id(item, &id) {
            if item.username != input.username.trim() {
                item.username = input.username.trim().to_string();
                item.username_updated_at_ms = now;
                item.username_updated_device_name = device_name.clone();
            }
            if item.password != input.password {
                item.password = input.password.clone();
                item.password_updated_at_ms = now;
                item.password_updated_device_name = device_name.clone();
            }
            if item.totp_secret != input.totp_secret {
                item.totp_secret = input.totp_secret.clone();
                item.totp_updated_at_ms = now;
                item.totp_updated_device_name = device_name.clone();
            }
            if item.recovery_codes != input.recovery_codes {
                item.recovery_codes = input.recovery_codes.clone();
                item.recovery_codes_updated_at_ms = now;
                item.recovery_codes_updated_device_name = device_name.clone();
            }
            if item.note != input.note {
                item.note = input.note.clone();
                item.note_updated_at_ms = now;
                item.note_updated_device_name = device_name.clone();
            }
            item.sites = sites.clone();
            item.canonical_site = sites[0].clone();
            apply_automatic_folder_rules(item, &folders);
            item.updated_at_ms = now;
            item.last_operated_device_name = device_name.clone();
            found = true;
            break;
        }
    }
    if !found {
        return Err("未找到要更新的账号".into());
    }
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn soft_delete_account(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    if !accounts.iter().any(|item| account_matches_id(item, &id)) {
        return Err("未找到要删除的账号".into());
    }
    snapshot_current_vault(&conn, &dir, "移入回收站前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    if let Some(item) = accounts.iter_mut().find(|a| account_matches_id(a, &id)) {
        item.is_deleted = true;
        item.deleted_at_ms = Some(now);
        item.deleted_device_name = device_name;
        item.updated_at_ms = now;
    }
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn restore_account(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    if !accounts.iter().any(|item| account_matches_id(item, &id)) {
        return Err("未找到要恢复的账号".into());
    }
    snapshot_current_vault(&conn, &dir, "恢复账号前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    if let Some(item) = accounts.iter_mut().find(|a| account_matches_id(a, &id)) {
        item.is_deleted = false;
        item.deleted_at_ms = None;
        item.deleted_device_name.clear();
        item.updated_at_ms = now;
        item.last_operated_device_name = device_name;
    }
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn hard_delete_account(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    if !accounts.iter().any(|item| account_matches_id(item, &id)) {
        return Err("未找到要彻底删除的账号".into());
    }
    snapshot_current_vault(&conn, &dir, "彻底删除账号前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let mut found = false;
    for item in &mut accounts {
        if account_matches_id(item, &id) {
            item.is_deleted = true;
            item.is_permanently_deleted = true;
            item.deleted_at_ms = Some(now);
            item.deleted_device_name = device_name.clone();
            item.updated_at_ms = now;
            item.password.clear();
            item.totp_secret.clear();
            item.recovery_codes.clear();
            found = true;
            break;
        }
    }
    debug_assert!(found);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn restore_all_deleted_accounts(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<usize, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let count = accounts
        .iter()
        .filter(|account| account.is_deleted && !account.is_permanently_deleted)
        .count();
    if count == 0 {
        return Ok(0);
    }
    snapshot_current_vault(&conn, &dir, "批量恢复回收站前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    for account in &mut accounts {
        if account.is_deleted && !account.is_permanently_deleted {
            account.is_deleted = false;
            account.deleted_at_ms = None;
            account.deleted_device_name.clear();
            account.updated_at_ms = now;
            account.last_operated_device_name = device_name.clone();
        }
    }
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(count)
}

#[tauri::command]
fn hard_delete_all_deleted_accounts(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<usize, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let count = accounts
        .iter()
        .filter(|account| account.is_deleted && !account.is_permanently_deleted)
        .count();
    if count == 0 {
        return Ok(0);
    }
    snapshot_current_vault(&conn, &dir, "批量彻底删除回收站前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    for account in &mut accounts {
        if account.is_deleted && !account.is_permanently_deleted {
            account.is_permanently_deleted = true;
            account.deleted_at_ms = Some(now);
            account.deleted_device_name = device_name.clone();
            account.updated_at_ms = now;
            account.password.clear();
            account.totp_secret.clear();
            account.recovery_codes.clear();
        }
    }
    save_accounts(&conn, &accounts)?;
    Ok(count)
}

#[tauri::command]
fn generate_demo_accounts(app: AppHandle, state: tauri::State<AppLockState>) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    snapshot_current_vault(&conn, &dir, "生成演示账号前自动备份")?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let samples = [
        (vec!["github.com", "gist.github.com"], "alice"),
        (vec!["google.com", "mail.google.com"], "alice.g"),
        (vec!["example.com", "sub.example.com"], "demo-user"),
    ];
    for (idx, (sites, username)) in samples.into_iter().enumerate() {
        let normalized_sites = normalize_sites(sites.into_iter().map(str::to_string).collect());
        let canonical_site = normalized_sites[0].clone();
        let id = Uuid::new_v4().to_string();
        accounts.push(PasswordAccount {
            record_id: Some(id.clone()),
            id: Some(id),
            account_id: format!("{}-{}-{}", canonical_site, now + idx as i64, username),
            canonical_site,
            username_at_create: username.to_string(),
            sites: normalized_sites,
            username: username.to_string(),
            password: format!("Demo#{}!{}", now % 10_000, idx),
            note: "演示账号".into(),
            username_updated_at_ms: now,
            username_updated_device_name: device_name.clone(),
            password_updated_at_ms: now,
            password_updated_device_name: device_name.clone(),
            created_at_ms: now,
            updated_at_ms: now,
            created_device_name: device_name.clone(),
            last_operated_device_name: device_name.clone(),
            ..Default::default()
        });
    }
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn export_csv(app: AppHandle, state: tauri::State<AppLockState>) -> Result<ExportResult, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);
    let timestamp = Local::now().format("%Y%m%d-%H%M%S");
    let export_dir = app_data_dir(&app)?;
    fs::create_dir_all(&export_dir).map_err(|e| format!("创建导出目录失败: {e}"))?;
    let path = export_dir.join(format!("pass-export-{timestamp}.csv"));
    let rows: Vec<Vec<String>> = accounts
        .iter()
        .filter(|a| !a.is_deleted)
        .map(|item| {
            vec![
                item.resolved_record_id(),
                item.sites.join(";"),
                item.username.clone(),
                item.password.clone(),
                item.totp_secret.clone(),
                item.recovery_codes.clone(),
                item.note.clone(),
                format_timestamp(item.updated_at_ms),
            ]
        })
        .collect();
    let headers = [
        "id",
        "sites",
        "username",
        "password",
        "totp",
        "recovery_codes",
        "note",
        "updated_at",
    ];
    let csv = pass_csvio::build_csv(&headers, &rows);
    fs::write(&path, csv).map_err(|e| format!("写入 CSV 失败: {e}"))?;
    Ok(ExportResult {
        csv_path: path.to_string_lossy().to_string(),
    })
}

/// Manual JSON merge preview (paste payloads). Does not write vault.
#[tauri::command]
fn merge_sync_payloads(local_json: String, remote_json: String) -> Result<String, String> {
    let local: SyncPayload =
        serde_json::from_str(&local_json).map_err(|e| format!("invalid local payload: {e}"))?;
    let remote: SyncPayload =
        serde_json::from_str(&remote_json).map_err(|e| format!("invalid remote payload: {e}"))?;
    let merged = pass_merge::v2::merge_sync_payloads(local.clone(), remote.clone());
    let report = pass_merge::v2::evaluate_sync_safety(&local, Some(&remote), &merged, "merge");
    serde_json::to_string(&serde_json::json!({
        "payload": merged,
        "safe": report.safe,
        "reasons": report.reasons,
    }))
    .map_err(|e| format!("serialize merge result failed: {e}"))
}

#[tauri::command]
fn get_sync_settings(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<SyncSettings, String> {
    let dir = app_data_dir(&app)?;
    let mut s = load_sync_settings(&dir);
    let pub_lock = state.public_state(&dir);
    if pub_lock.locked {
        s.auth_token.clear();
        s.encryption_key.clear();
        return Ok(s);
    }
    state.touch();
    if let Ok((token, key)) = state.open_sync_secrets(&dir) {
        if !token.is_empty() {
            s.auth_token = token;
        }
        if !key.is_empty() {
            s.encryption_key = key;
        }
    }
    Ok(s)
}

#[tauri::command]
fn set_sync_settings(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    settings: SyncSettings,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    if !is_valid_sync_key(&settings.encryption_key) {
        return Err("同步加密密钥无效，必须是 256 位密钥或留空".into());
    }
    if settings.enabled || !settings.base_url.trim().is_empty() {
        sync::http::validate_base_url(&settings.base_url)?;
    }
    let mut to_store = settings.clone();
    // When lock enabled, keep secrets out of plaintext settings file.
    let lock = state.public_state(&dir);
    if lock.enabled && lock.has_password {
        state.seal_sync_secrets(&dir, &settings.auth_token, &settings.encryption_key)?;
        to_store.auth_token.clear();
        to_store.encryption_key.clear();
    }
    save_sync_settings(&dir, &to_store)
}

#[tauri::command]
fn generate_sync_encryption_key() -> String {
    generate_sync_key()
}

#[tauri::command]
async fn sync_preview(
    app: AppHandle,
    state: tauri::State<'_, AppLockState>,
) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let dir = app_data_dir(&app)?;
    let mut settings = load_sync_settings(&dir);
    if let Ok((token, key)) = state.open_sync_secrets(&dir) {
        if !token.is_empty() {
            settings.auth_token = token;
        }
        if !key.is_empty() {
            settings.encryption_key = key;
        }
    }
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_payload_from_vault(&accounts, &folders, &passkeys, &device);
    let platform = current_platform().to_string();
    let local_for_preview = local.clone();
    let (report, merged) = tauri::async_runtime::spawn_blocking(move || {
        preview_sync(&settings, local_for_preview, &device, &platform)
    })
    .await
    .map_err(|e| format!("预览合并任务异常: {e}"))??;
    serde_json::to_string(&serde_json::json!({
        "report": report,
        "localPayload": local,
        "payload": merged,
    }))
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_now(app: AppHandle, state: tauri::State<'_, AppLockState>) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let dir = app_data_dir(&app)?;
    let mut settings = load_sync_settings(&dir);
    if let Ok((token, key)) = state.open_sync_secrets(&dir) {
        if !token.is_empty() {
            settings.auth_token = token;
        }
        if !key.is_empty() {
            settings.encryption_key = key;
        }
    }
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_payload_from_vault(&accounts, &folders, &passkeys, &device);
    let platform = current_platform().to_string();
    let worker_app = app.clone();
    let worker_dir = dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db(&worker_app)?;
        let (report, applied) = run_sync(&settings, local.clone(), &device, &platform)?;
        if report.applied {
            local_snapshots::create(&worker_dir, &local, "同步写入本地前自动备份")?;
            save_payload_atomic(&mut conn, &applied)?;
        }
        serde_json::to_string(&serde_json::json!({ "report": report })).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("同步任务异常: {e}"))??;
    Ok(result)
}

fn load_settings_unlocked(
    app: &AppHandle,
    state: &AppLockState,
) -> Result<(PathBuf, SyncSettings, Connection), String> {
    let dir = app_data_dir(app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(app)?;
    let mut settings = load_sync_settings(&dir);
    if let Ok((token, key)) = state.open_sync_secrets(&dir) {
        if !token.is_empty() {
            settings.auth_token = token;
        }
        if !key.is_empty() {
            settings.encryption_key = key;
        }
    }
    Ok((dir, settings, conn))
}

#[tauri::command]
async fn sync_now_mode(
    app: AppHandle,
    state: tauri::State<'_, AppLockState>,
    mode: String,
) -> Result<String, String> {
    let (dir, settings, conn) = load_settings_unlocked(&app, &state)?;
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_payload_from_vault(&accounts, &folders, &passkeys, &device);
    let mode = SyncMode::parse(&mode);
    let platform = current_platform().to_string();
    let worker_app = app.clone();
    let worker_dir = dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db(&worker_app)?;
        let (report, applied) =
            run_sync_with_mode(&settings, local.clone(), &device, &platform, mode)?;
        if report.applied {
            local_snapshots::create(&worker_dir, &local, "同步写入本地前自动备份")?;
            save_payload_atomic(&mut conn, &applied)?;
        }
        serde_json::to_string(&serde_json::json!({ "report": report })).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("同步任务异常: {e}"))??;
    Ok(result)
}

#[tauri::command]
async fn sync_webdav_now_mode(
    app: AppHandle,
    state: tauri::State<'_, AppLockState>,
    mode: String,
) -> Result<String, String> {
    let (dir, settings, conn) = load_settings_unlocked(&app, &state)?;
    let prefs = load_ui_prefs(&dir);
    let webdav_settings = WebDavSettings {
        enabled: prefs.webdav_enabled,
        base_url: prefs.webdav_base_url,
        remote_path: prefs.webdav_remote_path,
        username: prefs.webdav_username,
        password: prefs.webdav_password,
    };
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_payload_from_vault(&accounts, &folders, &passkeys, &device);
    let parsed_mode = SyncMode::parse(&mode);
    let platform = current_platform().to_string();
    let encryption_key = settings.encryption_key.clone();
    let worker_app = app.clone();
    let worker_dir = dir.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db(&worker_app)?;
        let (report, applied) = webdav::run_sync(
            &webdav_settings,
            parsed_mode,
            local.clone(),
            &device,
            &platform,
            &encryption_key,
        )?;
        if report.applied {
            local_snapshots::create(&worker_dir, &local, "WebDAV 同步写入本地前自动备份")?;
            save_payload_atomic(&mut conn, &applied)?;
        }
        serde_json::to_string(&serde_json::json!({ "report": report })).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("WebDAV 同步任务异常: {e}"))??;
    Ok(result)
}

#[tauri::command]
fn get_ui_prefs(app: AppHandle, state: tauri::State<AppLockState>) -> Result<UiPrefs, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    Ok(load_ui_prefs(&dir))
}

#[tauri::command]
fn set_ui_prefs(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    prefs: UiPrefs,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    // Allow reading locked, but writing only when unlocked if lock enabled.
    let lock = state.public_state(&dir);
    if lock.enabled && lock.locked {
        return Err("应用已锁定".into());
    }
    let mut prefs = prefs;
    prefs.text_font_size = prefs.text_font_size.clamp(12.0, 40.0);
    prefs.button_font_size = prefs.button_font_size.clamp(12.0, 52.0);
    prefs.toast_duration_seconds = prefs.toast_duration_seconds.clamp(1.0, 10.0);
    if ![0, 1, 5, 15, 30, 60].contains(&prefs.auto_sync_interval_minutes) {
        prefs.auto_sync_interval_minutes = 0;
    }
    save_ui_prefs(&dir, &prefs)
}

#[tauri::command]
fn sync_key_id(key: String) -> String {
    key_id(&key)
}

#[tauri::command]
fn export_sync_bundle(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    path: Option<String>,
) -> Result<PathResult, String> {
    let (dir, settings, conn) = load_settings_unlocked(&app, &state)?;
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_from_parts(&accounts, &folders, &passkeys, &device);
    let bytes = build_bundle_bytes(
        &local,
        &device,
        current_platform(),
        &settings.encryption_key,
    )?;
    let ts = Local::now().format("%Y%m%d-%H%M%S");
    let default_name = format!("pass-sync-bundle-{ts}.json");
    let out = match path.filter(|s| !s.trim().is_empty()) {
        Some(p) => {
            let selected = PathBuf::from(p);
            if selected.is_dir() {
                selected.join(&default_name)
            } else {
                selected
            }
        }
        None => dir.join(default_name),
    };
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&out, bytes).map_err(|e| format!("写入同步包失败: {e}"))?;
    Ok(PathResult {
        path: out.to_string_lossy().to_string(),
        message: format!(
            "已导出同步包：{}（账号 {}，文件夹 {}，通行密钥 {}）",
            out.display(),
            visible_account_count(&local),
            visible_folder_count(&local),
            visible_passkey_count(&local)
        ),
    })
}

#[tauri::command]
async fn choose_export_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("选择同步包导出文件夹")
            .pick_folder()
            .map(|path| path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| format!("选择导出文件夹任务异常: {e}"))?
}

#[tauri::command]
fn import_sync_bundle(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    path: String,
    apply: bool,
) -> Result<String, String> {
    let (dir, settings, mut conn) = load_settings_unlocked(&app, &state)?;
    let prefs = load_ui_prefs(&dir);
    let content = fs::read(&path).map_err(|e| format!("读取同步包失败: {e}"))?;
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_from_parts(&accounts, &folders, &passkeys, &device);
    let result = import_bundle_content(
        local.clone(),
        &content,
        &settings.encryption_key,
        &prefs.previous_encryption_key,
    )?;
    if apply && result.safe {
        local_snapshots::create(&dir, &local, "导入同步包前自动备份")?;
        save_payload_atomic(&mut conn, &result.payload)?;
    }
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_sync_bundle_text(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    content: String,
    apply: bool,
) -> Result<String, String> {
    let (dir, settings, mut conn) = load_settings_unlocked(&app, &state)?;
    let prefs = load_ui_prefs(&dir);
    let device = load_device_name(&conn)?;
    let accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let passkeys = load_passkeys(&conn)?;
    let local = local_from_parts(&accounts, &folders, &passkeys, &device);
    let result = import_bundle_content(
        local.clone(),
        content.as_bytes(),
        &settings.encryption_key,
        &prefs.previous_encryption_key,
    )?;
    if apply && result.safe {
        local_snapshots::create(&dir, &local, "导入同步包前自动备份")?;
        save_payload_atomic(&mut conn, &result.payload)?;
    }
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_browser_csv_cmd(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    format: String,
    path: Option<String>,
) -> Result<PathResult, String> {
    let (dir, _settings, conn) = load_settings_unlocked(&app, &state)?;
    let accounts = load_accounts(&conn)?;
    let (headers, rows) = export_browser_csv(&accounts, &format)?;
    let header_refs: Vec<&str> = headers.iter().copied().collect();
    let csv = build_csv_string(&header_refs, &rows);
    let out = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else {
        let ts = Local::now().format("%Y%m%d-%H%M%S");
        dir.join(format!("pass-{format}-passwords-{ts}.csv"))
    };
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&out, csv).map_err(|e| format!("写入 CSV 失败: {e}"))?;
    Ok(PathResult {
        path: out.to_string_lossy().to_string(),
        message: format!("已导出 {} 密码 CSV：{}", format, out.display()),
    })
}

#[tauri::command]
fn import_browser_csv(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    path: String,
) -> Result<ImportResult, String> {
    let (dir, _settings, conn) = load_settings_unlocked(&app, &state)?;
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 CSV 失败: {e}"))?;
    let imported = browser_entries_from_csv(&text)?;
    let device = load_device_name(&conn)?;
    let existing = load_accounts(&conn)?;
    snapshot_current_vault(&conn, &dir, "导入浏览器密码前自动备份")?;
    let before = existing.len();
    let merged = merge_imported_accounts(existing, imported.clone(), &device);
    save_accounts(&conn, &merged)?;
    Ok(ImportResult {
        format: "browser".into(),
        imported: imported.len(),
        skipped: 0,
        message: format!(
            "已导入 {} 条浏览器密码；账号 {} → {}",
            imported.len(),
            before,
            merged.len()
        ),
    })
}

#[tauri::command]
fn import_browser_csv_text(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    content: String,
) -> Result<ImportResult, String> {
    let (dir, _settings, conn) = load_settings_unlocked(&app, &state)?;
    let imported = browser_entries_from_csv(&content)?;
    let device = load_device_name(&conn)?;
    let existing = load_accounts(&conn)?;
    snapshot_current_vault(&conn, &dir, "导入浏览器密码前自动备份")?;
    let before = existing.len();
    let merged = merge_imported_accounts(existing, imported.clone(), &device);
    save_accounts(&conn, &merged)?;
    Ok(ImportResult {
        format: "browser".into(),
        imported: imported.len(),
        skipped: 0,
        message: format!(
            "已导入 {} 条浏览器密码；账号 {} → {}",
            imported.len(),
            before,
            merged.len()
        ),
    })
}

#[tauri::command]
fn import_google_authenticator_totp(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    entries: Vec<TotpImportInput>,
) -> Result<TotpImportResult, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let folders = load_folders(&conn)?;
    let values: Vec<_> = entries
        .into_iter()
        .filter_map(|entry| {
            let sites = normalize_sites(vec![entry.site]);
            let secret = entry.secret.trim().to_ascii_uppercase().replace(' ', "");
            (!sites.is_empty() && !secret.is_empty()).then_some((
                sites[0].clone(),
                entry.username.trim().to_string(),
                secret,
            ))
        })
        .collect();
    if values.is_empty() {
        return Ok(TotpImportResult {
            created: 0,
            updated: 0,
            skipped: 0,
        });
    }
    snapshot_current_vault(&conn, &dir, "导入谷歌验证器二维码前自动备份")?;
    let device = load_device_name(&conn)?;
    let start = now_ms();
    let mut created = 0;
    let mut updated = 0;
    let mut skipped = 0;
    for (offset, (site, username, secret)) in values.into_iter().enumerate() {
        let now = start + offset as i64;
        if let Some(account) = accounts.iter_mut().find(|account| {
            !account.is_deleted
                && account
                    .sites
                    .iter()
                    .any(|value| value.eq_ignore_ascii_case(&site))
                && account.username == username
        }) {
            if account.totp_secret == secret {
                skipped += 1;
            } else {
                account.totp_secret = secret;
                account.totp_updated_at_ms = now;
                account.totp_updated_device_name = device.clone();
                account.updated_at_ms = now;
                account.last_operated_device_name = device.clone();
                updated += 1;
            }
            continue;
        }
        let id = Uuid::new_v4().to_string();
        let mut account = PasswordAccount {
            record_id: Some(id.clone()),
            id: Some(id),
            account_id: format!("{site}-{now}-{username}"),
            canonical_site: site.clone(),
            username_at_create: username.clone(),
            sites: vec![site],
            username,
            password: String::new(),
            totp_secret: secret,
            totp_updated_at_ms: now,
            totp_updated_device_name: device.clone(),
            created_at_ms: now,
            updated_at_ms: now,
            created_device_name: device.clone(),
            last_operated_device_name: device.clone(),
            ..Default::default()
        };
        add_account_to_folder(&mut account, pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID);
        apply_automatic_folder_rules(&mut account, &folders);
        accounts.push(account);
        created += 1;
    }
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(TotpImportResult {
        created,
        updated,
        skipped,
    })
}

#[tauri::command]
fn export_csv_to_path(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    path: Option<String>,
) -> Result<PathResult, String> {
    let (dir, _settings, conn) = load_settings_unlocked(&app, &state)?;
    let prefs = load_ui_prefs(&dir);
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);
    let timestamp = Local::now().format("%Y%m%d-%H%M%S");
    let out = if let Some(p) = path.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else if !prefs.export_directory.trim().is_empty() {
        PathBuf::from(prefs.export_directory.trim()).join(format!("pass-export-{timestamp}.csv"))
    } else {
        dir.join(format!("pass-export-{timestamp}.csv"))
    };
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建导出目录失败: {e}"))?;
    }
    let rows: Vec<Vec<String>> = accounts
        .iter()
        .filter(|a| !a.is_deleted)
        .map(|item| {
            vec![
                item.resolved_record_id(),
                item.sites.join(";"),
                item.username.clone(),
                item.password.clone(),
                item.totp_secret.clone(),
                item.recovery_codes.clone(),
                item.note.clone(),
                format_timestamp(item.updated_at_ms),
            ]
        })
        .collect();
    let headers = [
        "id",
        "sites",
        "username",
        "password",
        "totp",
        "recovery_codes",
        "note",
        "updated_at",
    ];
    let csv = pass_csvio::build_csv(&headers, &rows);
    fs::write(&out, csv).map_err(|e| format!("写入 CSV 失败: {e}"))?;
    Ok(PathResult {
        path: out.to_string_lossy().to_string(),
        message: format!("已导出全部账号 CSV：{}", out.display()),
    })
}

#[tauri::command]
fn list_server_versions(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<Vec<SyncVersionSummary>, String> {
    let (_dir, settings, _conn) = load_settings_unlocked(&app, &state)?;
    list_sync_versions(&settings)
}

#[tauri::command]
fn restore_server_version(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    version_id: String,
) -> Result<String, String> {
    let (dir, settings, mut conn) = load_settings_unlocked(&app, &state)?;
    let device = load_device_name(&conn)?;
    let local = local_payload_from_vault(
        &load_accounts(&conn)?,
        &load_folders(&conn)?,
        &load_passkeys(&conn)?,
        &device,
    );
    let (payload, _) = restore_sync_version(&settings, &version_id)?;
    local_snapshots::create(&dir, &local, "恢复服务器快照前自动备份")?;
    save_payload_atomic(&mut conn, &payload)?;
    Ok(format!(
        "已恢复快照 {}：账号 {}，文件夹 {}，通行密钥 {}",
        version_id,
        visible_account_count(&payload),
        visible_folder_count(&payload),
        visible_passkey_count(&payload)
    ))
}

fn snapshot_current_vault(
    conn: &Connection,
    data_dir: &std::path::Path,
    reason: &str,
) -> Result<(), String> {
    let device = load_device_name(conn)?;
    let payload = local_payload_from_vault(
        &load_accounts(conn)?,
        &load_folders(conn)?,
        &load_passkeys(conn)?,
        &device,
    );
    local_snapshots::create(data_dir, &payload, reason)?;
    operation_history::push(&data_dir.to_path_buf(), reason, payload)
}

#[tauri::command]
fn list_local_snapshots(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<Vec<LocalSnapshotSummary>, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    local_snapshots::list(&dir)
}

#[tauri::command]
fn restore_local_snapshot(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    snapshot_id: String,
) -> Result<String, String> {
    let (dir, _settings, mut conn) = load_settings_unlocked(&app, &state)?;
    let device = load_device_name(&conn)?;
    let current = local_payload_from_vault(
        &load_accounts(&conn)?,
        &load_folders(&conn)?,
        &load_passkeys(&conn)?,
        &device,
    );
    let payload = local_snapshots::get(&dir, &snapshot_id)?;
    local_snapshots::create(&dir, &current, "恢复本地安全快照前自动备份")?;
    save_payload_atomic(&mut conn, &payload)?;
    Ok(format!(
        "已恢复本地安全快照：账号 {}，文件夹 {}，通行密钥 {}",
        visible_account_count(&payload),
        visible_folder_count(&payload),
        visible_passkey_count(&payload)
    ))
}

#[tauri::command]
fn get_ssh_credential(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    server_url: String,
) -> Result<SshCredential, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let host = host_from_server_url(&server_url).unwrap_or_default();
    Ok(load_ssh_credential(&dir, &host).unwrap_or_default())
}

#[tauri::command]
fn save_ssh_credential_cmd(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    server_url: String,
    credential: SshCredential,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let host = host_from_server_url(&server_url)
        .ok_or_else(|| "服务器地址无效，无法保存 SSH 凭据".to_string())?;
    save_ssh_credential(&dir, &host, &credential)
}

#[tauri::command]
fn get_provision_draft(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<ProvisionDraft, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    Ok(provision_settings::load(&dir))
}

#[tauri::command]
fn save_provision_draft(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    draft: ProvisionDraft,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    provision_settings::save(&dir, &draft)
}

#[tauri::command]
async fn detect_existing_sync_service(
    app: AppHandle,
    state: tauri::State<'_, AppLockState>,
    server_url: String,
    credential: SshCredential,
) -> Result<ExistingServiceReport, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        detect_existing_service(&dir, &server_url, &credential)
    })
    .await
    .map_err(|e| format!("检测服务任务异常: {e}"))?
}

#[tauri::command]
async fn provision_self_hosted_server(
    app: AppHandle,
    state: tauri::State<'_, AppLockState>,
    server_url: String,
    credential: SshCredential,
    access_token: String,
    sync_encryption_key: String,
    tls_certificate: String,
    tls_private_key: String,
    remove_existing: Option<bool>,
) -> Result<ProvisionResult, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let worker_dir = dir.clone();
    let worker_server_url = server_url.clone();
    let worker_access_token = access_token.clone();
    let worker_sync_encryption_key = sync_encryption_key.clone();
    let worker_tls_certificate = tls_certificate.clone();
    let worker_tls_private_key = tls_private_key.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        provision_server(
            &worker_dir,
            &worker_server_url,
            credential,
            &worker_access_token,
            &worker_sync_encryption_key,
            &worker_tls_certificate,
            &worker_tls_private_key,
            remove_existing.unwrap_or(false),
        )
    })
    .await
    .map_err(|e| format!("创建服务任务异常: {e}"))??;
    // Persist sync settings used for this endpoint.
    let mut settings = load_sync_settings(&dir);
    settings.enabled = true;
    settings.base_url = result.endpoint.clone();
    settings.auth_token = access_token.trim().to_string();
    settings.encryption_key = sync_encryption_key.trim().to_string();
    let lock = state.public_state(&dir);
    if lock.enabled && lock.has_password {
        state.seal_sync_secrets(&dir, &settings.auth_token, &settings.encryption_key)?;
        let mut stored = settings.clone();
        stored.auth_token.clear();
        stored.encryption_key.clear();
        save_sync_settings(&dir, &stored)?;
    } else {
        save_sync_settings(&dir, &settings)?;
    }
    Ok(result)
}

#[tauri::command]
async fn verify_sync_endpoint(endpoint: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || verify_public_endpoint(&endpoint))
        .await
        .unwrap_or(false)
}

fn account_matches_id(account: &PasswordAccount, id: &str) -> bool {
    let id = id.trim().to_ascii_lowercase();
    account.resolved_record_id() == id
        || account
            .id
            .as_deref()
            .map(|v| v.eq_ignore_ascii_case(id.as_str()))
            .unwrap_or(false)
        || account.account_id.eq_ignore_ascii_case(&id)
}

fn sync_alias_sites(accounts: &mut [PasswordAccount]) {
    let device = accounts
        .iter()
        .find(|a| !a.last_operated_device_name.trim().is_empty())
        .map(|a| a.last_operated_device_name.clone())
        .unwrap_or_else(|| "Desktop".into());
    let _ = sync_alias_groups(accounts, now_ms(), &device);
}

fn normalize_rule_sites(site_inputs: Vec<String>) -> Vec<String> {
    let expanded = site_inputs
        .into_iter()
        .flat_map(|input| {
            input
                .split([',', '，', '\n'])
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect();
    normalize_sites(expanded)
}

fn account_matches_site_rule(account: &PasswordAccount, rule_sites: &[String]) -> bool {
    if rule_sites.is_empty() {
        return false;
    }
    let account_sites = normalize_sites(account.sites.clone());
    let canonical = pass_merge::v2::normalize::normalize_domain(&account.canonical_site);
    rule_sites.iter().any(|site| {
        account_sites
            .iter()
            .any(|account_site| account_site == site)
            || canonical == *site
    })
}

fn account_in_folder(account: &PasswordAccount, folder_id: &str) -> bool {
    account
        .folder_ids
        .iter()
        .any(|id| id.eq_ignore_ascii_case(folder_id))
        || account
            .folder_id
            .as_deref()
            .map(|id| id.eq_ignore_ascii_case(folder_id))
            .unwrap_or(false)
}

fn add_account_to_folder(account: &mut PasswordAccount, folder_id: &str) -> bool {
    if account_in_folder(account, folder_id) {
        return false;
    }
    account.folder_ids.push(folder_id.to_string());
    if account.folder_id.is_none() {
        account.folder_id = Some(folder_id.to_string());
    }
    true
}

fn apply_automatic_folder_rules(account: &mut PasswordAccount, folders: &[Folder]) {
    if account.is_deleted || account.is_permanently_deleted {
        return;
    }
    for folder in folders.iter().filter(|folder| {
        folder.auto_add_matching_sites && !folder.is_deleted && !folder.is_permanently_deleted
    }) {
        let matched_sites = normalize_sites(folder.matched_sites.clone());
        if account_matches_site_rule(account, &matched_sites) {
            add_account_to_folder(account, &folder.id);
        }
    }
}

fn folder_duplicate_groups(
    accounts: &[PasswordAccount],
    folder_id: &str,
) -> Vec<FolderDuplicateGroup> {
    let mut grouped: BTreeMap<String, Vec<PasswordAccount>> = BTreeMap::new();
    for account in accounts.iter().filter(|account| {
        !account.is_deleted
            && !account.is_permanently_deleted
            && account_in_folder(account, folder_id)
    }) {
        let site_aliases = {
            let aliases = normalize_sites(account.sites.clone());
            if aliases.is_empty() {
                let canonical =
                    pass_merge::v2::normalize::normalize_domain(&account.canonical_site);
                if canonical.is_empty() {
                    vec![]
                } else {
                    vec![canonical]
                }
            } else {
                aliases
            }
        };
        let username_key = account.username.trim().to_ascii_lowercase();
        let key = format!("{}\n{}", site_aliases.join("|"), username_key);
        grouped.entry(key).or_default().push(account.clone());
    }

    let mut result: Vec<FolderDuplicateGroup> = grouped
        .into_iter()
        .filter_map(|(id, mut grouped_accounts)| {
            if grouped_accounts.len() < 2 {
                return None;
            }
            grouped_accounts.sort_by(|left, right| {
                right
                    .updated_at_ms
                    .cmp(&left.updated_at_ms)
                    .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
                    .then_with(|| left.account_id.cmp(&right.account_id))
            });
            let first = grouped_accounts.first()?;
            let site_aliases = {
                let aliases = normalize_sites(first.sites.clone());
                if aliases.is_empty() {
                    vec![pass_merge::v2::normalize::normalize_domain(
                        &first.canonical_site,
                    )]
                    .into_iter()
                    .filter(|site| !site.is_empty())
                    .collect()
                } else {
                    aliases
                }
            };
            let username = {
                let display = first.username.trim();
                if display.is_empty() {
                    "(空用户名)".to_string()
                } else {
                    display.to_string()
                }
            };
            Some(FolderDuplicateGroup {
                id,
                site_aliases,
                username,
                accounts: grouped_accounts,
            })
        })
        .collect();
    result.sort_by(|left, right| {
        let left_time = left
            .accounts
            .first()
            .map(|account| account.updated_at_ms)
            .unwrap_or(0);
        let right_time = right
            .accounts
            .first()
            .map(|account| account.updated_at_ms)
            .unwrap_or(0);
        right_time
            .cmp(&left_time)
            .then_with(|| left.id.cmp(&right.id))
    });
    result
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn format_timestamp(ms: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&Local))
        .map(|dt| dt.format("%y-%-m-%-d %-H:%-M:%-S").to_string())
        .unwrap_or_default()
}

fn normalize_sites(sites: Vec<String>) -> Vec<String> {
    pass_merge::v2::normalize::normalize_sites(&sites)
}

fn sort_accounts(accounts: &mut [PasswordAccount]) {
    accounts.sort_by(|a, b| match (a.is_pinned, b.is_pinned) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        (true, true) => match (a.pinned_sort_order, b.pinned_sort_order) {
            (Some(lo), Some(ro)) if lo != ro => lo.cmp(&ro),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => b
                .updated_at_ms
                .cmp(&a.updated_at_ms)
                .then_with(|| a.account_id.cmp(&b.account_id)),
        },
        (false, false) => match (a.regular_sort_order, b.regular_sort_order) {
            (Some(lo), Some(ro)) if lo != ro => lo.cmp(&ro),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => b
                .updated_at_ms
                .cmp(&a.updated_at_ms)
                .then_with(|| a.account_id.cmp(&b.account_id)),
        },
    });
}

fn apply_folder_order(folders: &mut [Folder], order: &[String]) {
    if order.is_empty() || folders.is_empty() {
        return;
    }
    let rank: BTreeMap<String, usize> = order
        .iter()
        .enumerate()
        .map(|(i, id)| (id.to_ascii_lowercase(), i))
        .collect();
    folders.sort_by(|a, b| {
        let ra = rank
            .get(&a.id.to_ascii_lowercase())
            .copied()
            .unwrap_or(usize::MAX);
        let rb = rank
            .get(&b.id.to_ascii_lowercase())
            .copied()
            .unwrap_or(usize::MAX);
        ra.cmp(&rb)
            .then_with(|| {
                a.name
                    .to_ascii_lowercase()
                    .cmp(&b.name.to_ascii_lowercase())
            })
            .then_with(|| a.id.to_ascii_lowercase().cmp(&b.id.to_ascii_lowercase()))
    });
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let db_path = dir.join("pass-tauri.db");
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| format!("初始化数据库失败: {e}"))?;
    Ok(conn)
}

fn load_device_name(conn: &Connection) -> Result<String, String> {
    read_kv(conn, KEY_DEVICE_NAME).map(|v| v.unwrap_or_else(|| "CodexDesktop".into()))
}

fn load_accounts(conn: &Connection) -> Result<Vec<PasswordAccount>, String> {
    if let Some(raw) = read_kv(conn, KEY_ACCOUNTS)? {
        return serde_json::from_str(&raw).map_err(|e| format!("解析账号数据失败: {e}"));
    }
    // Migrate legacy v1 thin model if present.
    if let Some(raw) = read_kv(conn, KEY_ACCOUNTS_LEGACY)? {
        let legacy: Vec<serde_json::Value> =
            serde_json::from_str(&raw).map_err(|e| format!("解析旧版账号失败: {e}"))?;
        let mut out = Vec::new();
        for v in legacy {
            let mut acc = PasswordAccount::default();
            let id = v
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.id = Some(id.clone());
            acc.record_id = Some(id);
            acc.account_id = v
                .get("accountId")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.canonical_site = v
                .get("canonicalSite")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.sites = v
                .get("sites")
                .and_then(|x| x.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.as_str().map(|t| t.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            acc.username = v
                .get("username")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.password = v
                .get("password")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.totp_secret = v
                .get("totpSecret")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.recovery_codes = v
                .get("recoveryCodes")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.note = v
                .get("note")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.created_at_ms = v.get("createdAtMs").and_then(|x| x.as_i64()).unwrap_or(0);
            acc.updated_at_ms = v.get("updatedAtMs").and_then(|x| x.as_i64()).unwrap_or(0);
            acc.created_device_name = v
                .get("createdDeviceName")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.last_operated_device_name = v
                .get("lastOperatedDeviceName")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            acc.is_deleted = v
                .get("isDeleted")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            acc.deleted_at_ms = v.get("deletedAtMs").and_then(|x| x.as_i64());
            let act = acc.updated_at_ms.max(acc.created_at_ms);
            acc.username_updated_at_ms = act;
            acc.password_updated_at_ms = act;
            acc.username_updated_device_name = acc.last_operated_device_name.clone();
            acc.password_updated_device_name = acc.last_operated_device_name.clone();
            out.push(acc);
        }
        save_accounts(conn, &out)?;
        return Ok(out);
    }
    Ok(vec![])
}

fn save_accounts(conn: &Connection, accounts: &[PasswordAccount]) -> Result<(), String> {
    let raw = serde_json::to_string(accounts).map_err(|e| format!("序列化账号失败: {e}"))?;
    write_kv(conn, KEY_ACCOUNTS, &raw)
}

fn load_folders(conn: &Connection) -> Result<Vec<Folder>, String> {
    match read_kv(conn, KEY_FOLDERS)? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("解析文件夹失败: {e}")),
        None => Ok(vec![]),
    }
}

fn save_folders(conn: &Connection, folders: &[Folder]) -> Result<(), String> {
    let raw = serde_json::to_string(folders).map_err(|e| format!("序列化文件夹失败: {e}"))?;
    write_kv(conn, KEY_FOLDERS, &raw)
}

fn ensure_fixed_new_account_folder(folders: &mut Vec<Folder>) -> (bool, BTreeSet<String>) {
    let fixed_id = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID;
    let fixed_name = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_NAME;
    let legacy_ids: BTreeSet<String> = folders
        .iter()
        .filter(|folder| {
            !folder.id.eq_ignore_ascii_case(fixed_id)
                && folder.name.trim().eq_ignore_ascii_case(fixed_name)
        })
        .map(|folder| folder.id.to_ascii_lowercase())
        .collect();
    let existing_fixed = folders
        .iter()
        .find(|folder| folder.id.eq_ignore_ascii_case(fixed_id));
    let created_at_ms = existing_fixed
        .map(|folder| folder.created_at_ms)
        .or_else(|| {
            folders
                .iter()
                .filter(|folder| legacy_ids.contains(&folder.id.to_ascii_lowercase()))
                .map(|folder| folder.created_at_ms)
                .min()
        })
        .filter(|value| *value > 0)
        .unwrap_or_else(now_ms);
    let updated_at_ms = existing_fixed
        .map(|folder| folder.updated_at_ms)
        .or_else(|| {
            folders
                .iter()
                .filter(|folder| legacy_ids.contains(&folder.id.to_ascii_lowercase()))
                .map(|folder| folder.updated_at_ms)
                .max()
        })
        .filter(|value| *value > 0)
        .unwrap_or(created_at_ms);
    let fixed_folder = Folder {
        id: fixed_id.to_string(),
        name: fixed_name.to_string(),
        matched_sites: existing_fixed
            .map(|folder| folder.matched_sites.clone())
            .unwrap_or_default(),
        auto_add_matching_sites: existing_fixed
            .map(|folder| folder.auto_add_matching_sites)
            .unwrap_or(false),
        created_at_ms,
        updated_at_ms,
        ..Default::default()
    };
    let original = folders.clone();
    let mut normalized = vec![fixed_folder];
    let mut seen_ids = BTreeSet::from([fixed_id.to_ascii_lowercase()]);
    for folder in original.iter() {
        let normalized_id = folder.id.to_ascii_lowercase();
        if legacy_ids.contains(&normalized_id) || !seen_ids.insert(normalized_id) {
            continue;
        }
        normalized.push(folder.clone());
    }
    let changed = *folders != normalized;
    *folders = normalized;
    (changed, legacy_ids)
}

fn migrate_legacy_new_account_folder_ids(
    accounts: &mut [PasswordAccount],
    folders: &[Folder],
    legacy_ids: &BTreeSet<String>,
) -> bool {
    if legacy_ids.is_empty() {
        return false;
    }
    let fixed_id = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID.to_string();
    let valid_ids: BTreeSet<String> = folders
        .iter()
        .filter(|folder| !folder.is_deleted && !folder.is_permanently_deleted)
        .map(|folder| folder.id.to_ascii_lowercase())
        .collect();
    let mut changed = false;
    for account in accounts {
        let original = account.folder_ids.clone();
        let mut next = account.folder_ids.clone();
        if let Some(folder_id) = account.folder_id.clone() {
            next.push(folder_id);
        }
        next = next
            .into_iter()
            .map(|folder_id| {
                if legacy_ids.contains(&folder_id.to_ascii_lowercase()) {
                    fixed_id.clone()
                } else {
                    folder_id
                }
            })
            .filter(|folder_id| valid_ids.contains(&folder_id.to_ascii_lowercase()))
            .fold(Vec::new(), |mut ids, folder_id| {
                if !ids
                    .iter()
                    .any(|id: &String| id.eq_ignore_ascii_case(&folder_id))
                {
                    ids.push(folder_id);
                }
                ids
            });
        if next != original || account.folder_id.as_deref() != next.first().map(String::as_str) {
            account.folder_ids = next.clone();
            account.folder_id = next.first().cloned();
            changed = true;
        }
    }
    changed
}

fn load_passkeys(conn: &Connection) -> Result<Vec<Passkey>, String> {
    match read_kv(conn, KEY_PASSKEYS)? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("解析通行密钥失败: {e}")),
        None => Ok(vec![]),
    }
}

fn save_passkeys(conn: &Connection, passkeys: &[Passkey]) -> Result<(), String> {
    let raw = serde_json::to_string(passkeys).map_err(|e| format!("序列化通行密钥失败: {e}"))?;
    write_kv(conn, KEY_PASSKEYS, &raw)
}

/// Replaces all sync collections as one SQLite transaction so a failed write
/// never leaves accounts, folders, and passkeys from different payloads.
fn save_payload_atomic(conn: &mut Connection, payload: &SyncPayload) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("开始数据写入事务失败: {e}"))?;
    save_accounts(&tx, &payload.accounts)?;
    save_folders(&tx, &payload.folders)?;
    save_passkeys(&tx, &payload.passkeys)?;
    tx.commit()
        .map_err(|e| format!("提交数据写入事务失败: {e}"))
}

fn read_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE key = ?1 LIMIT 1")
        .map_err(|e| format!("准备读取语句失败: {e}"))?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|e| format!("读取数据失败: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("读取数据行失败: {e}"))? {
        let stored: String = row.get(0).map_err(|e| format!("读取字段失败: {e}"))?;
        let db_path = conn
            .path()
            .ok_or_else(|| "无法确定本地数据库路径".to_string())?;
        let data_dir = PathBuf::from(db_path)
            .parent()
            .ok_or_else(|| "本地数据库路径无父目录".to_string())?
            .to_path_buf();
        match local_vault::decrypt_text(&data_dir, "pass.tauri.sqlite.kv.v1", &stored)? {
            Some(value) => Ok(Some(value)),
            None => {
                // Existing plaintext rows migrate immediately after a successful read.
                write_kv(conn, key, &stored)?;
                Ok(Some(stored))
            }
        }
    } else {
        Ok(None)
    }
}

fn write_kv(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    let db_path = conn
        .path()
        .ok_or_else(|| "无法确定本地数据库路径".to_string())?;
    let db_path = PathBuf::from(db_path);
    let data_dir = db_path
        .parent()
        .ok_or_else(|| "本地数据库路径无父目录".to_string())?;
    let encrypted = local_vault::encrypt_text(data_dir, "pass.tauri.sqlite.kv.v1", value)?;
    conn.execute(
        "
        INSERT INTO kv (key, value) VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    ",
        params![key, encrypted],
    )
    .map_err(|e| format!("写入数据失败: {e}"))?;
    Ok(())
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("解析应用数据目录失败: {e}"))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app)
}

#[tauri::command]
fn get_lock_state(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_enable(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    password: String,
    confirm: String,
    idle_lock_minutes: u32,
    lock_policy: AppLockPolicy,
    prefer_biometrics: bool,
    background_lock_delay_seconds: Option<u32>,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    let _ = state.enable(
        &dir,
        &password,
        &confirm,
        idle_lock_minutes,
        lock_policy,
        prefer_biometrics,
        background_lock_delay_seconds.unwrap_or(60),
    )?;

    // Move any existing sync credentials behind the newly-derived session key
    // immediately. The frontend also saves its current form, but doing this in
    // the command closes the gap if it is interrupted before that callback.
    let mut settings = load_sync_settings(&dir);
    state.seal_sync_secrets(&dir, &settings.auth_token, &settings.encryption_key)?;
    settings.auth_token.clear();
    settings.encryption_key.clear();
    save_sync_settings(&dir, &settings)?;

    if prefer_biometrics {
        let _ = state.store_biometric_key(&app);
    } else {
        let _ = state.clear_biometric_key(&app);
    }
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_change_password(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    old_password: String,
    new_password: String,
    confirm: String,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let updated = state.change_password(&dir, &old_password, &new_password, &confirm)?;
    if updated.prefer_biometrics {
        let _ = state.store_biometric_key(&app);
    }
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_disable(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    password: String,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    // Validate before exposing the settings, then move secrets back into the
    // standard encrypted settings vault. Without this conversion a disabled
    // lock could leave secrets encrypted with a session key that is unavailable
    // after restarting the app.
    let _ = state.unlock(&dir, &password)?;
    let (token, key) = state.open_sync_secrets(&dir)?;
    let mut settings = load_sync_settings(&dir);
    if !token.is_empty() {
        settings.auth_token = token;
    }
    if !key.is_empty() {
        settings.encryption_key = key;
    }
    save_sync_settings(&dir, &settings)?;
    let _ = state.disable_unlocked(&dir)?;
    let _ = state.clear_sync_secrets(&dir);
    let _ = state.clear_biometric_key(&app);
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_unlock(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    password: String,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    let _ = state.unlock(&dir, &password)?;
    if state.public_state(&dir).prefer_biometrics {
        let _ = state.store_biometric_key(&app);
    }
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_unlock_biometric(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.unlock_biometric(&app, &dir)
}

#[tauri::command]
fn lock_biometric_available(app: AppHandle) -> bool {
    app_lock::biometric_available(&app)
}

#[tauri::command]
fn lock_now(
    app: AppHandle,
    state: tauri::State<AppLockState>,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    Ok(state.lock_now(&dir))
}

#[tauri::command]
fn lock_save_preferences(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    lock_policy: AppLockPolicy,
    idle_lock_minutes: u32,
    prefer_biometrics: bool,
    background_lock_delay_seconds: Option<u32>,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.require_unlocked(&dir)?;
    state.set_preferences(
        &dir,
        lock_policy,
        idle_lock_minutes,
        prefer_biometrics,
        background_lock_delay_seconds.unwrap_or(60),
    )?;
    if prefer_biometrics {
        let _ = state.store_biometric_key(&app);
    } else {
        let _ = state.clear_biometric_key(&app);
    }
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_touch(state: tauri::State<AppLockState>) {
    state.touch();
}

#[tauri::command(rename_all = "camelCase")]
fn reorder_folders(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let folders = load_folders(&conn)?;
    let known: BTreeSet<String> = folders
        .iter()
        .filter(|f| !f.is_deleted && !f.is_permanently_deleted)
        .map(|f| f.id.to_ascii_lowercase())
        .collect();
    let mut prefs = load_ui_prefs(&dir);
    let mut seen = BTreeSet::new();
    let mut order = Vec::new();
    for id in ordered_ids {
        let key = id.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let lower = key.to_ascii_lowercase();
        if !known.contains(&lower) {
            continue;
        }
        if seen.insert(lower) {
            order.push(key);
        }
    }
    // Append any folders missing from the payload (keep relative append order).
    for folder in &folders {
        if folder.is_deleted || folder.is_permanently_deleted {
            continue;
        }
        let lower = folder.id.to_ascii_lowercase();
        if seen.insert(lower) {
            order.push(folder.id.clone());
        }
    }
    prefs.folder_order = order;
    save_ui_prefs(&dir, &prefs)
}

#[tauri::command(rename_all = "camelCase")]
fn toggle_account_pin(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
) -> Result<PasswordAccount, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let target = accounts
        .iter()
        .find(|item| account_matches_id(item, &id))
        .cloned()
        .ok_or_else(|| "未找到账号".to_string())?;
    if target.is_deleted || target.is_permanently_deleted {
        return Err("回收站账号不支持置顶".into());
    }
    snapshot_current_vault(&conn, &dir, "置顶状态变更前自动备份")?;
    let next_pinned = !target.is_pinned;
    let next_pinned_order = if next_pinned {
        let max = accounts
            .iter()
            .filter(|a| !a.is_deleted && !a.is_permanently_deleted && a.is_pinned)
            .filter_map(|a| a.pinned_sort_order)
            .max()
            .unwrap_or(-1);
        Some(max + 1)
    } else {
        None
    };
    for item in &mut accounts {
        if account_matches_id(item, &id) {
            item.is_pinned = next_pinned;
            item.pinned_sort_order = next_pinned_order;
            if !next_pinned {
                item.regular_sort_order = None;
            }
            item.updated_at_ms = now;
            item.last_operated_device_name = device_name.clone();
            break;
        }
    }
    save_accounts(&conn, &accounts)?;
    accounts
        .into_iter()
        .find(|item| account_matches_id(item, &id))
        .ok_or_else(|| "置顶后未找到账号".into())
}

#[tauri::command(rename_all = "camelCase")]
fn reorder_accounts(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    ordered_ids: Vec<String>,
    pinned: bool,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;

    let mut requested = Vec::new();
    let mut seen = BTreeSet::new();
    for id in ordered_ids {
        let key = id.trim().to_string();
        if key.is_empty() {
            continue;
        }
        let lower = key.to_ascii_lowercase();
        if !seen.insert(lower.clone()) {
            continue;
        }
        if accounts
            .iter()
            .any(|a| account_matches_id(a, &key) && a.is_pinned == pinned && !a.is_deleted)
        {
            // Normalize to resolved record id for stable matching.
            if let Some(rec) = accounts
                .iter()
                .find(|a| account_matches_id(a, &key))
                .map(|a| a.resolved_record_id())
            {
                requested.push(rec);
            }
        }
    }
    if requested.is_empty() {
        return Err("没有可排序的账号".into());
    }

    let mut full_group: Vec<String> = accounts
        .iter()
        .filter(|a| !a.is_deleted && !a.is_permanently_deleted && a.is_pinned == pinned)
        .map(|a| a.resolved_record_id())
        .collect();
    full_group.sort_by(|left, right| {
        let a = accounts
            .iter()
            .find(|item| item.resolved_record_id() == *left);
        let b = accounts
            .iter()
            .find(|item| item.resolved_record_id() == *right);
        match (a, b) {
            (Some(a), Some(b)) => {
                let lo = if pinned {
                    a.pinned_sort_order
                } else {
                    a.regular_sort_order
                };
                let ro = if pinned {
                    b.pinned_sort_order
                } else {
                    b.regular_sort_order
                };
                match (lo, ro) {
                    (Some(x), Some(y)) if x != y => x.cmp(&y),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    _ => b
                        .updated_at_ms
                        .cmp(&a.updated_at_ms)
                        .then_with(|| a.account_id.cmp(&b.account_id)),
                }
            }
            _ => left.cmp(right),
        }
    });

    let requested_set: BTreeSet<String> = requested.iter().cloned().collect();
    let mut merged = Vec::with_capacity(full_group.len());
    let mut cursor = 0usize;
    for id in &full_group {
        if requested_set.contains(id) {
            if let Some(next) = requested.get(cursor) {
                merged.push(next.clone());
                cursor += 1;
            }
        } else {
            merged.push(id.clone());
        }
    }
    while cursor < requested.len() {
        let id = &requested[cursor];
        if !merged.iter().any(|x| x == id) {
            merged.push(id.clone());
        }
        cursor += 1;
    }

    // Skip snapshot on pure reorder for snappier UX (order fields only).
    let mut changed = false;
    for (order, id) in merged.iter().enumerate() {
        let order_i = order as i64;
        for item in &mut accounts {
            if item.resolved_record_id() == *id && item.is_pinned == pinned {
                if pinned {
                    if item.pinned_sort_order != Some(order_i) {
                        item.pinned_sort_order = Some(order_i);
                        // Do not bump updated_at_ms — keeps manual order authoritative.
                        item.last_operated_device_name = device_name.clone();
                        changed = true;
                    }
                } else if item.regular_sort_order != Some(order_i) {
                    item.regular_sort_order = Some(order_i);
                    item.last_operated_device_name = device_name.clone();
                    changed = true;
                }
                break;
            }
        }
    }
    if changed {
        save_accounts(&conn, &accounts)?;
    }
    Ok(())
}

#[tauri::command]
fn create_folder(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    name: String,
) -> Result<Folder, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut folders = load_folders(&conn)?;
    let (folders_changed, _) = ensure_fixed_new_account_folder(&mut folders);
    if folders_changed {
        save_folders(&conn, &folders)?;
    }
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件夹名不能为空".into());
    }
    let now = now_ms();
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        matched_sites: vec![],
        auto_add_matching_sites: false,
        is_deleted: false,
        is_permanently_deleted: false,
        deleted_at_ms: None,
        deleted_device_name: String::new(),
        created_at_ms: now,
        updated_at_ms: now,
    };
    snapshot_current_vault(&conn, &dir, "新建文件夹前自动备份")?;
    folders.push(folder.clone());
    save_folders(&conn, &folders)?;
    Ok(folder)
}

#[tauri::command]
fn delete_folder(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut folders = load_folders(&conn)?;
    let mut accounts = load_accounts(&conn)?;
    let (folders_changed, legacy_folder_ids) = ensure_fixed_new_account_folder(&mut folders);
    let accounts_changed =
        migrate_legacy_new_account_folder_ids(&mut accounts, &folders, &legacy_folder_ids);
    let id = id.trim().to_ascii_lowercase();
    if folders_changed || accounts_changed {
        if folders_changed {
            save_folders(&conn, &folders)?;
        }
        if accounts_changed {
            save_accounts(&conn, &accounts)?;
        }
    }
    let folder = folders
        .iter()
        .find(|folder| folder.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| "未找到文件夹".to_string())?;
    if folder
        .id
        .eq_ignore_ascii_case(pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID)
    {
        return Err("固定文件夹不可删除".into());
    }
    if folder.is_deleted || folder.is_permanently_deleted {
        return Err("文件夹已删除".into());
    }
    snapshot_current_vault(&conn, &dir, "删除文件夹前自动备份")?;
    let device = load_device_name(&conn)?;
    let now = now_ms();
    let folder = folders
        .iter_mut()
        .find(|folder| folder.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| "未找到文件夹".to_string())?;
    folder.is_deleted = true;
    folder.is_permanently_deleted = true;
    folder.deleted_at_ms = Some(now);
    folder.deleted_device_name = device.clone();
    folder.updated_at_ms = now;

    for a in &mut accounts {
        let was_in_folder = account_in_folder(a, &id);
        a.folder_ids.retain(|fid| fid.to_ascii_lowercase() != id);
        if let Some(fid) = a.folder_id.as_ref() {
            if fid.to_ascii_lowercase() == id {
                a.folder_id = a.folder_ids.first().cloned();
            }
        }
        if was_in_folder {
            a.updated_at_ms = now;
            a.last_operated_device_name = device.clone();
        }
    }
    save_accounts(&conn, &accounts)?;
    save_folders(&conn, &folders)?;
    Ok(())
}

fn canonical_active_folder_ids(
    folders: &[Folder],
    folder_ids: &[String],
) -> Result<Vec<String>, String> {
    let mut active_folders: BTreeMap<String, String> = BTreeMap::new();
    for folder in folders
        .iter()
        .filter(|folder| !folder.is_deleted && !folder.is_permanently_deleted)
    {
        let key = folder.id.to_ascii_lowercase();
        if active_folders.insert(key, folder.id.clone()).is_some() {
            return Err("文件夹 ID 存在大小写冲突，无法安全解析".into());
        }
    }
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();
    for raw_id in folder_ids {
        let id = raw_id.trim().to_ascii_lowercase();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let canonical = active_folders
            .get(&id)
            .ok_or_else(|| "包含不存在或已删除的文件夹".to_string())?;
        normalized.push(canonical.clone());
    }
    Ok(normalized)
}

#[tauri::command]
fn set_account_folders(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    id: String,
    folder_ids: Vec<String>,
) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    if !accounts
        .iter()
        .any(|account| account_matches_id(account, &id))
    {
        return Err("未找到账号".into());
    }
    let folders = load_folders(&conn)?;
    let normalized = canonical_active_folder_ids(&folders, &folder_ids)?;
    snapshot_current_vault(&conn, &dir, "调整账号文件夹前自动备份")?;
    let device = load_device_name(&conn)?;
    let now = now_ms();
    let mut found = false;
    for a in &mut accounts {
        if account_matches_id(a, &id) {
            a.folder_ids = normalized.clone();
            a.folder_id = normalized.first().cloned();
            a.updated_at_ms = now;
            a.last_operated_device_name = device.clone();
            found = true;
            break;
        }
    }
    debug_assert!(found);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn configure_folder_site_rules(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    folder_id: String,
    site_inputs: Vec<String>,
    auto_add: bool,
) -> Result<FolderRuleResult, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let mut folders = load_folders(&conn)?;
    let normalized_id = folder_id.trim().to_ascii_lowercase();
    let existing = folders
        .iter()
        .find(|folder| folder.id.eq_ignore_ascii_case(&normalized_id))
        .ok_or_else(|| "未找到文件夹".to_string())?;
    if existing.is_deleted || existing.is_permanently_deleted {
        return Err("目标文件夹已删除".into());
    }
    snapshot_current_vault(&conn, &dir, "调整文件夹规则前自动备份")?;
    let folder = folders
        .iter_mut()
        .find(|folder| folder.id.eq_ignore_ascii_case(&normalized_id))
        .ok_or_else(|| "未找到文件夹".to_string())?;

    let normalized_sites = normalize_rule_sites(site_inputs);
    folder.matched_sites = normalized_sites.clone();
    folder.auto_add_matching_sites = auto_add;
    folder.updated_at_ms = now_ms();
    let folder_snapshot = folder.clone();

    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let mut matched_count = 0;
    let mut added_count = 0;
    for account in accounts
        .iter_mut()
        .filter(|account| !account.is_deleted && !account.is_permanently_deleted)
    {
        if account_matches_site_rule(account, &normalized_sites) {
            matched_count += 1;
            if add_account_to_folder(account, &normalized_id) {
                account.updated_at_ms = now;
                account.last_operated_device_name = device_name.clone();
                added_count += 1;
            }
        }
    }
    save_accounts(&conn, &accounts)?;
    save_folders(&conn, &folders)?;
    Ok(FolderRuleResult {
        folder: folder_snapshot,
        matched_count,
        added_count,
        message: format!(
            "已保存文件夹规则，匹配 {} 个账号，新增加入 {} 个账号",
            matched_count, added_count
        ),
    })
}

#[tauri::command]
fn get_folder_duplicate_groups(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    folder_id: String,
) -> Result<Vec<FolderDuplicateGroup>, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let folders = load_folders(&conn)?;
    let normalized_id = folder_id.trim().to_ascii_lowercase();
    if !folders.iter().any(|folder| {
        folder.id.eq_ignore_ascii_case(&normalized_id)
            && !folder.is_deleted
            && !folder.is_permanently_deleted
    }) {
        return Err("未找到文件夹".into());
    }
    let accounts = load_accounts(&conn)?;
    Ok(folder_duplicate_groups(&accounts, &normalized_id))
}

#[tauri::command]
fn deduplicate_folder(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    folder_id: String,
    mode: String,
    account_id: Option<String>,
) -> Result<DeduplicateResult, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;
    let conn = open_db(&app)?;
    let folders = load_folders(&conn)?;
    let normalized_id = folder_id.trim().to_ascii_lowercase();
    if !folders.iter().any(|folder| {
        folder.id.eq_ignore_ascii_case(&normalized_id)
            && !folder.is_deleted
            && !folder.is_permanently_deleted
    }) {
        return Err("未找到文件夹".into());
    }

    let accounts = load_accounts(&conn)?;
    let groups = folder_duplicate_groups(&accounts, &normalized_id);
    if groups.is_empty() {
        return Ok(DeduplicateResult {
            deleted_count: 0,
            kept_count: 0,
            group_count: 0,
            message: "当前文件夹暂无重复账号".into(),
        });
    }

    let mut keep_ids = BTreeSet::new();
    match mode.trim().to_ascii_lowercase().as_str() {
        "latest" => {
            for group in &groups {
                if let Some(account) = group.accounts.first() {
                    keep_ids.insert(account.resolved_record_id());
                }
            }
        }
        "earliest" => {
            for group in &groups {
                if let Some(account) = group.accounts.last() {
                    keep_ids.insert(account.resolved_record_id());
                }
            }
        }
        "account" => {
            let requested_id = account_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "未指定要保留的账号".to_string())?;
            let group = groups.iter().find(|group| {
                group
                    .accounts
                    .iter()
                    .any(|account| account_matches_id(account, requested_id))
            });
            let group = group.ok_or_else(|| "当前重复分组中未找到指定账号".to_string())?;
            keep_ids.insert(
                group
                    .accounts
                    .iter()
                    .find(|account| account_matches_id(account, requested_id))
                    .map(|account| account.resolved_record_id())
                    .unwrap_or_default(),
            );
        }
        _ => return Err("未知去重方式".into()),
    }

    snapshot_current_vault(&conn, &dir, "文件夹去重前自动备份")?;

    let duplicate_ids: BTreeSet<String> = groups
        .iter()
        .flat_map(|group| {
            group
                .accounts
                .iter()
                .map(PasswordAccount::resolved_record_id)
        })
        .collect();
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let mut accounts = accounts;
    let mut deleted_count = 0;
    for account in accounts.iter_mut() {
        let id = account.resolved_record_id();
        if duplicate_ids.contains(&id) && !keep_ids.contains(&id) && !account.is_deleted {
            account.is_deleted = true;
            account.deleted_at_ms = Some(now);
            account.deleted_device_name = device_name.clone();
            account.updated_at_ms = now;
            account.last_operated_device_name = device_name.clone();
            deleted_count += 1;
        }
    }
    if deleted_count > 0 {
        save_accounts(&conn, &accounts)?;
    }
    Ok(DeduplicateResult {
        deleted_count,
        kept_count: keep_ids.len(),
        group_count: groups.len(),
        message: format!(
            "去重完成，已移入回收站 {} 个重复账号，保留 {} 个账号",
            deleted_count,
            keep_ids.len()
        ),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(AppLockState::default())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let state_window = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        if let Ok(data_dir) = app_data_dir(&state_window.app_handle()) {
                            let _ = window_state::save(&state_window, &data_dir);
                        }
                    }
                    if let tauri::WindowEvent::Focused(focused) = event {
                        let handle = state_window.app_handle();
                        if let Ok(data_dir) = app_data_dir(&handle) {
                            let state = handle.state::<AppLockState>();
                            if *focused {
                                let _ = state.note_window_focused(&data_dir);
                            } else {
                                let _ = state.note_window_blurred(&data_dir);
                            }
                        }
                    }
                });
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
                // Native app menu with Settings (⌘,) for macOS parity with PassMac.
                let app_submenu = SubmenuBuilder::new(app, "Pass Desktop")
                    .item(&PredefinedMenuItem::about(
                        app,
                        Some("关于 Pass Desktop"),
                        None,
                    )?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, Some("隐藏 Pass Desktop"))?)
                    .item(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)
                    .item(&PredefinedMenuItem::show_all(app, Some("全部显示"))?)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, Some("退出 Pass Desktop"))?)
                    .build()?;
                // Custom Settings item with accelerator
                use tauri::menu::MenuItemBuilder;
                let settings_item = MenuItemBuilder::with_id("open_settings", "设置...")
                    .accelerator("CmdOrCtrl+,")
                    .build(app)?;
                let edit_submenu = SubmenuBuilder::new(app, "编辑")
                    .item(&PredefinedMenuItem::undo(app, Some("撤销"))?)
                    .item(&PredefinedMenuItem::redo(app, Some("重做"))?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(app, Some("剪切"))?)
                    .item(&PredefinedMenuItem::copy(app, Some("拷贝"))?)
                    .item(&PredefinedMenuItem::paste(app, Some("粘贴"))?)
                    .item(&PredefinedMenuItem::select_all(app, Some("全选"))?)
                    .build()?;
                let window_submenu = SubmenuBuilder::new(app, "窗口")
                    .item(&PredefinedMenuItem::minimize(app, Some("最小化"))?)
                    .item(&PredefinedMenuItem::maximize(app, Some("缩放"))?)
                    .separator()
                    .item(&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?)
                    .build()?;
                let app_menu = MenuBuilder::new(app)
                    .item(&app_submenu)
                    .item(
                        &SubmenuBuilder::new(app, "Pass")
                            .item(&settings_item)
                            .build()?,
                    )
                    .item(&edit_submenu)
                    .item(&window_submenu)
                    .build()?;
                app.set_menu(app_menu)?;
                let handle = app.handle().clone();
                app.on_menu_event(move |_app, event| {
                    if event.id() == "open_settings" {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.eval(
                                "window.dispatchEvent(new CustomEvent('pass-open-settings'));",
                            );
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_undo_status,
            get_redo_status,
            get_operation_history,
            undo_last_operation,
            redo_last_operation,
            get_app_state,
            set_device_name,
            create_account,
            update_account,
            soft_delete_account,
            restore_account,
            hard_delete_account,
            restore_all_deleted_accounts,
            hard_delete_all_deleted_accounts,
            generate_demo_accounts,
            create_folder,
            delete_folder,
            set_account_folders,
            configure_folder_site_rules,
            get_folder_duplicate_groups,
            deduplicate_folder,
            export_csv,
            export_csv_to_path,
            merge_sync_payloads,
            get_sync_settings,
            set_sync_settings,
            generate_sync_encryption_key,
            sync_key_id,
            sync_preview,
            sync_now,
            sync_now_mode,
            sync_webdav_now_mode,
            get_ui_prefs,
            set_ui_prefs,
            export_sync_bundle,
            choose_export_directory,
            import_sync_bundle,
            import_sync_bundle_text,
            export_browser_csv_cmd,
            import_browser_csv,
            import_browser_csv_text,
            import_google_authenticator_totp,
            list_server_versions,
            restore_server_version,
            list_local_snapshots,
            restore_local_snapshot,
            get_ssh_credential,
            save_ssh_credential_cmd,
            get_provision_draft,
            save_provision_draft,
            detect_existing_sync_service,
            provision_self_hosted_server,
            verify_sync_endpoint,
            get_lock_state,
            lock_enable,
            lock_change_password,
            lock_disable,
            lock_unlock,
            lock_unlock_biometric,
            lock_biometric_available,
            lock_now,
            lock_save_preferences,
            lock_touch,
            reorder_folders,
            toggle_account_pin,
            reorder_accounts,
        ])
        .build(tauri::generate_context!())
        .expect("error while building codex-tauri")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready) {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(data_dir) = app_data_dir(app) {
                        window_state::restore(&window, &data_dir);
                        let _ = window.show();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_account(id: &str, site: &str, username: &str, updated_at_ms: i64) -> PasswordAccount {
        PasswordAccount {
            record_id: Some(id.to_string()),
            id: Some(id.to_string()),
            account_id: id.to_string(),
            canonical_site: site.to_string(),
            sites: vec![site.to_string()],
            username: username.to_string(),
            folder_ids: vec!["folder-1".to_string()],
            folder_id: Some("folder-1".to_string()),
            updated_at_ms,
            created_at_ms: updated_at_ms,
            ..Default::default()
        }
    }

    #[test]
    fn automatic_folder_rule_adds_matching_account() {
        let folder = Folder {
            id: "folder-1".into(),
            matched_sites: vec!["example.com".into()],
            auto_add_matching_sites: true,
            ..Default::default()
        };
        let mut account = test_account("account-1", "https://example.com/login", "demo", 1);
        account.folder_ids.clear();
        account.folder_id = None;

        apply_automatic_folder_rules(&mut account, &[folder]);

        assert_eq!(account.folder_ids, vec!["folder-1"]);
        assert_eq!(account.folder_id.as_deref(), Some("folder-1"));
    }

    #[test]
    fn duplicate_groups_match_aliases_and_username_and_sort_newest_first() {
        let accounts = vec![
            test_account("account-old", "example.com", "Demo", 10),
            test_account("account-new", "https://example.com/path", "demo", 20),
            test_account("account-other", "example.com", "other", 30),
        ];

        let groups = folder_duplicate_groups(&accounts, "folder-1");

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].accounts[0].resolved_record_id(), "account-new");
        assert_eq!(groups[0].accounts[1].resolved_record_id(), "account-old");
    }

    #[test]
    fn fixed_new_account_folder_is_created_and_legacy_name_is_migrated() {
        let mut folders = vec![Folder {
            id: "legacy-folder".into(),
            name: "新账号".into(),
            created_at_ms: 10,
            updated_at_ms: 20,
            ..Default::default()
        }];
        let mut accounts = vec![test_account("account-1", "example.com", "demo", 10)];
        accounts[0].folder_ids = vec!["legacy-folder".into()];
        accounts[0].folder_id = Some("legacy-folder".into());

        let (changed, legacy_ids) = ensure_fixed_new_account_folder(&mut folders);
        assert!(changed);
        assert_eq!(folders[0].id, pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID);
        assert_eq!(
            folders[0].name,
            pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_NAME
        );
        assert!(migrate_legacy_new_account_folder_ids(
            &mut accounts,
            &folders,
            &legacy_ids
        ));
        assert_eq!(
            accounts[0].folder_ids,
            vec![pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID]
        );
        assert_eq!(
            accounts[0].folder_id.as_deref(),
            Some(pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID)
        );
    }

    #[test]
    fn account_folder_ids_must_reference_active_folders() {
        let folders = vec![
            Folder {
                id: "active-folder".into(),
                ..Default::default()
            },
            Folder {
                id: "deleted-folder".into(),
                is_deleted: true,
                ..Default::default()
            },
            Folder {
                id: "perm-gone".into(),
                is_permanently_deleted: true,
                ..Default::default()
            },
        ];
        let ids = vec![" ACTIVE-FOLDER ".into(), "active-folder".into()];
        assert_eq!(
            canonical_active_folder_ids(&folders, &ids).unwrap(),
            vec!["active-folder"]
        );
        assert!(canonical_active_folder_ids(&folders, &["deleted-folder".into()]).is_err());
        assert!(canonical_active_folder_ids(&folders, &["perm-gone".into()]).is_err());
        assert!(canonical_active_folder_ids(&folders, &["missing-folder".into()]).is_err());
    }

    #[test]
    fn account_folder_ids_reject_case_only_collisions() {
        let folders = vec![
            Folder {
                id: "Work".into(),
                ..Default::default()
            },
            Folder {
                id: "work".into(),
                ..Default::default()
            },
        ];
        assert!(canonical_active_folder_ids(&folders, &["work".into()]).is_err());
    }
}
