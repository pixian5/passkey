mod app_lock;
mod sync;

use chrono::{Local, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use pass_merge::v2::{sync_alias_groups, Folder, Passkey, PasswordAccount, SyncPayload};

use app_lock::{AppLockPublicState, AppLockState};
use sync::pipeline::{local_payload_from_vault, preview_sync, run_sync};
use sync::settings::{load_sync_settings, save_sync_settings, SyncSettings};
use sync::{generate_sync_key, is_valid_sync_key};

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
fn get_app_state(app: AppHandle, state: tauri::State<AppLockState>) -> Result<AppState, String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let device_name = load_device_name(&conn)?;
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);
    let folders = load_folders(&conn)?;
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
    let canonical_site = sites[0].clone();
    let id = Uuid::new_v4().to_string();
    let username = input.username.trim().to_string();
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
    apply_automatic_folder_rules(&mut account, &folders);
    accounts.push(account);
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
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
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    if let Some(item) = accounts.iter_mut().find(|a| account_matches_id(a, &id)) {
        item.is_deleted = true;
        item.deleted_at_ms = Some(now);
        item.deleted_device_name = device_name;
        item.updated_at_ms = now;
    } else {
        return Err("未找到要删除的账号".into());
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
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    if let Some(item) = accounts.iter_mut().find(|a| account_matches_id(a, &id)) {
        item.is_deleted = false;
        item.deleted_at_ms = None;
        item.deleted_device_name.clear();
        item.updated_at_ms = now;
        item.last_operated_device_name = device_name;
    } else {
        return Err("未找到要恢复的账号".into());
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
    if !found {
        return Err("未找到要彻底删除的账号".into());
    }
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn generate_demo_accounts(app: AppHandle, state: tauri::State<AppLockState>) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    state.require_unlocked(&dir)?;

    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
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
fn sync_preview(app: AppHandle, state: tauri::State<AppLockState>) -> Result<String, String> {
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
    let (report, merged) = preview_sync(&settings, local, &device, current_platform())?;
    serde_json::to_string(&serde_json::json!({
        "report": report,
        "payload": merged,
    }))
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn sync_now(app: AppHandle, state: tauri::State<AppLockState>) -> Result<String, String> {
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
    let (report, applied) = run_sync(&settings, local, &device, current_platform())?;
    if report.applied {
        save_accounts(&conn, &applied.accounts)?;
        save_folders(&conn, &applied.folders)?;
        save_passkeys(&conn, &applied.passkeys)?;
    }
    serde_json::to_string(&serde_json::json!({ "report": report })).map_err(|e| e.to_string())
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
    accounts.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
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

fn read_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE key = ?1 LIMIT 1")
        .map_err(|e| format!("准备读取语句失败: {e}"))?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|e| format!("读取数据失败: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("读取数据行失败: {e}"))? {
        let value: String = row.get(0).map_err(|e| format!("读取字段失败: {e}"))?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn write_kv(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "
        INSERT INTO kv (key, value) VALUES (?1, ?2)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    ",
        params![key, value],
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
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.enable(&dir, &password, &confirm, idle_lock_minutes)
}

#[tauri::command]
fn lock_disable(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    password: String,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.disable(&dir, &password)
}

#[tauri::command]
fn lock_unlock(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    password: String,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.unlock(&dir, &password)
}

#[tauri::command]
fn lock_now(state: tauri::State<AppLockState>) -> AppLockPublicState {
    state.lock_now()
}

#[tauri::command]
fn lock_set_idle(
    app: AppHandle,
    state: tauri::State<AppLockState>,
    minutes: u32,
) -> Result<AppLockPublicState, String> {
    let dir = data_dir(&app)?;
    state.set_idle_minutes(&dir, minutes)?;
    Ok(state.public_state(&dir))
}

#[tauri::command]
fn lock_touch(state: tauri::State<AppLockState>) {
    state.touch();
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
    let id = id.trim().to_ascii_lowercase();
    let before = folders.len();
    folders.retain(|f| f.id.to_ascii_lowercase() != id);
    if folders.len() == before {
        return Err("未找到文件夹".into());
    }
    // Soft-remove membership references on accounts
    let mut accounts = load_accounts(&conn)?;
    for a in &mut accounts {
        a.folder_ids.retain(|fid| fid.to_ascii_lowercase() != id);
        if let Some(fid) = a.folder_id.as_ref() {
            if fid.to_ascii_lowercase() == id {
                a.folder_id = None;
            }
        }
    }
    save_accounts(&conn, &accounts)?;
    save_folders(&conn, &folders)?;
    Ok(())
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
    let device = load_device_name(&conn)?;
    let now = now_ms();
    let normalized: Vec<String> = folder_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
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
    if !found {
        return Err("未找到账号".into());
    }
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
    let folder = folders
        .iter_mut()
        .find(|folder| folder.id.eq_ignore_ascii_case(&normalized_id))
        .ok_or_else(|| "未找到文件夹".to_string())?;
    if folder.is_deleted || folder.is_permanently_deleted {
        return Err("目标文件夹已删除".into());
    }

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
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_app_state,
            set_device_name,
            create_account,
            update_account,
            soft_delete_account,
            restore_account,
            hard_delete_account,
            generate_demo_accounts,
            create_folder,
            delete_folder,
            set_account_folders,
            configure_folder_site_rules,
            get_folder_duplicate_groups,
            deduplicate_folder,
            export_csv,
            merge_sync_payloads,
            get_sync_settings,
            set_sync_settings,
            generate_sync_encryption_key,
            sync_preview,
            sync_now,
            get_lock_state,
            lock_enable,
            lock_disable,
            lock_unlock,
            lock_now,
            lock_set_idle,
            lock_touch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running codex-tauri");
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
}
