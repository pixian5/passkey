use chrono::{Local, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const KEY_ACCOUNTS: &str = "accounts.v1";
const KEY_DEVICE_NAME: &str = "settings.device_name";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PasswordAccount {
    id: String,
    account_id: String,
    canonical_site: String,
    sites: Vec<String>,
    username: String,
    password: String,
    totp_secret: String,
    recovery_codes: String,
    note: String,
    created_at_ms: i64,
    updated_at_ms: i64,
    created_device_name: String,
    last_operated_device_name: String,
    is_deleted: bool,
    deleted_at_ms: Option<i64>,
}

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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    csv_path: String,
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
            "csv-export"
        ]
    })
}

#[tauri::command]
fn get_app_state(app: AppHandle) -> Result<AppState, String> {
    let conn = open_db(&app)?;
    let device_name = load_device_name(&conn)?;
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);

    let active_accounts = accounts.iter().filter(|a| !a.is_deleted).cloned().collect();
    let deleted_accounts = accounts.iter().filter(|a| a.is_deleted).cloned().collect();

    Ok(AppState {
        device_name,
        active_accounts,
        deleted_accounts,
    })
}

#[tauri::command]
fn set_device_name(app: AppHandle, device_name: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let trimmed = device_name.trim();
    if trimmed.is_empty() {
        return Err("设备名不能为空".into());
    }
    write_kv(&conn, KEY_DEVICE_NAME, trimmed)?;
    Ok(())
}

#[tauri::command]
fn create_account(app: AppHandle, input: AccountInput) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();
    let sites = normalize_sites(input.sites);
    if sites.is_empty() {
        return Err("至少填写一个站点".into());
    }

    let canonical_site = sites[0].clone();
    let id = Uuid::new_v4().to_string();
    let account = PasswordAccount {
        id,
        account_id: format!("{}-{}-{}", canonical_site, now, input.username.trim()),
        canonical_site,
        sites,
        username: input.username.trim().to_string(),
        password: input.password,
        totp_secret: input.totp_secret,
        recovery_codes: input.recovery_codes,
        note: input.note,
        created_at_ms: now,
        updated_at_ms: now,
        created_device_name: device_name.clone(),
        last_operated_device_name: device_name,
        is_deleted: false,
        deleted_at_ms: None,
    };

    accounts.push(account);
    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn update_account(app: AppHandle, id: String, input: AccountInput) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();

    let sites = normalize_sites(input.sites);
    if sites.is_empty() {
        return Err("至少填写一个站点".into());
    }

    let mut found = false;
    for item in &mut accounts {
        if item.id == id {
            item.sites = sites.clone();
            item.canonical_site = sites[0].clone();
            item.username = input.username.trim().to_string();
            item.password = input.password.clone();
            item.totp_secret = input.totp_secret.clone();
            item.recovery_codes = input.recovery_codes.clone();
            item.note = input.note.clone();
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
fn soft_delete_account(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let now = now_ms();

    if let Some(item) = accounts.iter_mut().find(|a| a.id == id) {
        item.is_deleted = true;
        item.deleted_at_ms = Some(now);
        item.updated_at_ms = now;
    } else {
        return Err("未找到要删除的账号".into());
    }

    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn restore_account(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;

    if let Some(item) = accounts.iter_mut().find(|a| a.id == id) {
        item.is_deleted = false;
        item.deleted_at_ms = None;
        item.updated_at_ms = now_ms();
    } else {
        return Err("未找到要恢复的账号".into());
    }

    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn hard_delete_account(app: AppHandle, id: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let before = accounts.len();
    accounts.retain(|item| item.id != id);

    if before == accounts.len() {
        return Err("未找到要彻底删除的账号".into());
    }

    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn generate_demo_accounts(app: AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    let device_name = load_device_name(&conn)?;
    let now = now_ms();

    let samples = vec![
        (vec!["github.com", "gist.github.com"], "alice"),
        (vec!["google.com", "mail.google.com"], "alice.g"),
        (vec!["example.com", "sub.example.com"], "demo-user"),
    ];

    for (idx, (sites, username)) in samples.into_iter().enumerate() {
        let normalized_sites = normalize_sites(sites.into_iter().map(str::to_string).collect());
        let canonical_site = normalized_sites[0].clone();
        accounts.push(PasswordAccount {
            id: Uuid::new_v4().to_string(),
            account_id: format!("{}-{}-{}", canonical_site, now + idx as i64, username),
            canonical_site,
            sites: normalized_sites,
            username: username.to_string(),
            password: format!("Demo#{}!{}", now % 10_000, idx),
            totp_secret: String::new(),
            recovery_codes: String::new(),
            note: "演示账号".into(),
            created_at_ms: now,
            updated_at_ms: now,
            created_device_name: device_name.clone(),
            last_operated_device_name: device_name.clone(),
            is_deleted: false,
            deleted_at_ms: None,
        });
    }

    sync_alias_sites(&mut accounts);
    save_accounts(&conn, &accounts)?;
    Ok(())
}

#[tauri::command]
fn export_csv(app: AppHandle) -> Result<ExportResult, String> {
    let conn = open_db(&app)?;
    let mut accounts = load_accounts(&conn)?;
    sort_accounts(&mut accounts);

    let timestamp = Local::now().format("%Y%m%d-%H%M%S");
    let export_dir = app_data_dir(&app)?;
    fs::create_dir_all(&export_dir).map_err(|e| format!("创建导出目录失败: {e}"))?;
    let path = export_dir.join(format!("pass-export-{timestamp}.csv"));

    let mut csv = String::from("id,site,username,password,totp,recovery_codes,note,updated_at\n");
    for item in accounts.iter().filter(|a| !a.is_deleted) {
        csv.push_str(&format!(
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
            escape_csv(&item.id),
            escape_csv(&item.sites.join("|")),
            escape_csv(&item.username),
            escape_csv(&item.password),
            escape_csv(&item.totp_secret),
            escape_csv(&item.recovery_codes),
            escape_csv(&item.note),
            escape_csv(&format_timestamp(item.updated_at_ms))
        ));
    }

    fs::write(&path, csv).map_err(|e| format!("写入 CSV 失败: {e}"))?;
    Ok(ExportResult {
        csv_path: path.to_string_lossy().to_string(),
    })
}

fn sync_alias_sites(accounts: &mut [PasswordAccount]) {
    let mut site_to_indices: HashMap<String, Vec<usize>> = HashMap::new();
    for (idx, account) in accounts.iter().enumerate() {
        if account.is_deleted {
            continue;
        }
        for site in &account.sites {
            site_to_indices.entry(site.clone()).or_default().push(idx);
        }
    }

    let mut visited = HashSet::new();
    for start in 0..accounts.len() {
        if visited.contains(&start) || accounts[start].is_deleted {
            continue;
        }

        let mut stack = vec![start];
        let mut component = vec![];
        let mut merged_sites: HashSet<String> = HashSet::new();

        while let Some(cur) = stack.pop() {
            if !visited.insert(cur) {
                continue;
            }
            if accounts[cur].is_deleted {
                continue;
            }
            component.push(cur);

            for site in accounts[cur].sites.clone() {
                merged_sites.insert(site.clone());
                if let Some(neighbors) = site_to_indices.get(&site) {
                    for &next in neighbors {
                        if !visited.contains(&next) {
                            stack.push(next);
                        }
                    }
                }
            }
        }

        if component.is_empty() {
            continue;
        }

        let mut final_sites: Vec<String> = merged_sites.into_iter().collect();
        final_sites.sort();

        for idx in component {
            accounts[idx].sites = final_sites.clone();
            accounts[idx].canonical_site = final_sites[0].clone();
        }
    }
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn format_timestamp(ms: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&Local))
        .map(|dt| dt.format("%y-%-m-%-d %-H:%-M:%-S").to_string())
        .unwrap_or_else(|| "".into())
}

fn normalize_sites(sites: Vec<String>) -> Vec<String> {
    let mut unique = HashSet::new();
    for site in sites {
        let normalized = site.trim().to_lowercase();
        if !normalized.is_empty() {
            unique.insert(normalized);
        }
    }
    let mut final_sites: Vec<String> = unique.into_iter().collect();
    final_sites.sort();
    final_sites
}

fn sort_accounts(accounts: &mut [PasswordAccount]) {
    accounts.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
}

fn escape_csv(value: &str) -> String {
    value.replace('"', "\"\"")
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let db_path = dir.join("pass-tauri.db");

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
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
    match read_kv(conn, KEY_ACCOUNTS)? {
        Some(raw) => serde_json::from_str(&raw).map_err(|e| format!("解析账号数据失败: {e}")),
        None => Ok(vec![]),
    }
}

fn save_accounts(conn: &Connection, accounts: &[PasswordAccount]) -> Result<(), String> {
    let raw = serde_json::to_string(accounts).map_err(|e| format!("序列化账号失败: {e}"))?;
    write_kv(conn, KEY_ACCOUNTS, &raw)
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

fn main() {
    tauri::Builder::default()
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
            export_csv
        ])
        .run(tauri::generate_context!())
        .expect("error while running codex-tauri");
}
