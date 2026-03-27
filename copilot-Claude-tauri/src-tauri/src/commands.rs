// Tauri commands for frontend communication
use tauri::State;
use std::path::PathBuf;

use crate::{AppConfig, AppState, PasswordAccount, AccountFolder, SyncConfig};
use crate::crypto::{hash_password, verify_password};
use crate::database::Database;
use crate::sync::SyncManager;
use crate::totp;

#[tauri::command]
pub async fn initialize_database(
    state: State<'_, AppState>,
    db_path: String,
    master_password: String,
) -> Result<(), String> {
    let path = PathBuf::from(db_path);

    // Create database
    let db = Database::new(path).map_err(|e| e.to_string())?;

    // Hash and store master password
    let password_hash = hash_password(&master_password)?;

    *state.db.lock().unwrap() = Some(db);
    *state.master_password_hash.lock().unwrap() = Some(password_hash);
    *state.locked.lock().unwrap() = false;

    Ok(())
}

#[tauri::command]
pub async fn unlock_app(
    state: State<'_, AppState>,
    master_password: String,
) -> Result<bool, String> {
    let hash_guard = state.master_password_hash.lock().unwrap();
    let hash = hash_guard
        .as_ref()
        .ok_or("Database not initialized")?;

    let valid = verify_password(&master_password, hash)?;

    if valid {
        *state.locked.lock().unwrap() = false;
    }

    Ok(valid)
}

#[tauri::command]
pub async fn lock_app(state: State<'_, AppState>) -> Result<(), String> {
    *state.locked.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
pub async fn is_locked(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(*state.locked.lock().unwrap())
}

fn check_locked(state: &State<AppState>) -> Result<(), String> {
    if *state.locked.lock().unwrap() {
        return Err("Application is locked".to_string());
    }
    Ok(())
}

fn get_db(state: &State<AppState>) -> Result<std::sync::MutexGuard<Option<Database>>, String> {
    check_locked(state)?;
    Ok(state.db.lock().unwrap())
}

#[tauri::command]
pub async fn get_all_accounts(
    state: State<'_, AppState>,
    include_deleted: bool,
) -> Result<Vec<PasswordAccount>, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_all_accounts(include_deleted)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_account_by_id(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<Option<PasswordAccount>, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_account_by_id(&account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_account(
    state: State<'_, AppState>,
    account: PasswordAccount,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.create_account(&account).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_account(
    state: State<'_, AppState>,
    account: PasswordAccount,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.update_account(&account).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.delete_account(&account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.restore_account(&account_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn permanently_delete_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.permanently_delete_account(&account_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_accounts(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<PasswordAccount>, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.search_accounts(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_folders(state: State<'_, AppState>) -> Result<Vec<AccountFolder>, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_all_folders().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    folder: AccountFolder,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.create_folder(&folder).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_folder(
    state: State<'_, AppState>,
    folder: AccountFolder,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.update_folder(&folder).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_folder(state: State<'_, AppState>, folder_id: String) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.delete_folder(&folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_totp_code(secret: String) -> Result<String, String> {
    totp::generate_totp(&secret)
}

#[tauri::command]
pub async fn export_to_csv(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let accounts = db.get_all_accounts(false).map_err(|e| e.to_string())?;

    // Simple CSV export
    let mut csv_content = "site,username,password,totp_secret,note\n".to_string();

    for account in accounts {
        let totp = account.totp_secret.unwrap_or_default();
        let note = account.note.unwrap_or_default().replace('\n', " ");

        csv_content.push_str(&format!(
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
            account.canonical_site.replace('"', "\"\""),
            account.username.replace('"', "\"\""),
            account.password.replace('"', "\"\""),
            totp.replace('"', "\"\""),
            note.replace('"', "\"\"")
        ));
    }

    std::fs::write(file_path, csv_content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn import_from_csv(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<usize, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let content = std::fs::read_to_string(file_path).map_err(|e| e.to_string())?;

    let mut count = 0;
    for (i, line) in content.lines().enumerate() {
        if i == 0 {
            continue; // Skip header
        }

        let fields: Vec<&str> = line.split(',').collect();
        if fields.len() >= 3 {
            let account = PasswordAccount {
                id: uuid::Uuid::new_v4().to_string(),
                account_id: uuid::Uuid::new_v4().to_string(),
                canonical_site: fields[0].trim_matches('"').to_string(),
                sites: vec![fields[0].trim_matches('"').to_string()],
                username: fields[1].trim_matches('"').to_string(),
                password: fields[2].trim_matches('"').to_string(),
                totp_secret: fields.get(3).map(|s| s.trim_matches('"').to_string()),
                recovery_codes: None,
                note: fields.get(4).map(|s| s.trim_matches('"').to_string()),
                folder_id: None,
                created_at: chrono::Utc::now().timestamp_millis(),
                updated_at: chrono::Utc::now().timestamp_millis(),
                deleted: false,
            };

            db.create_account(&account).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

#[tauri::command]
pub async fn sync_with_server(state: State<'_, AppState>) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    let sync_config = db
        .get_sync_config()
        .map_err(|e| e.to_string())?
        .ok_or("Sync not configured")?;

    let local_accounts = db.get_all_accounts(false).map_err(|e| e.to_string())?;

    let sync_manager = SyncManager::new();
    let _remote_accounts = sync_manager
        .sync_with_server(&sync_config, local_accounts)
        .await?;

    // TODO: Implement proper merge logic using pass-merge crate

    Ok(())
}

#[tauri::command]
pub async fn get_sync_config(state: State<'_, AppState>) -> Result<Option<SyncConfig>, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_sync_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_sync_config(
    state: State<'_, AppState>,
    config: SyncConfig,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.save_sync_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_app_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.get_app_config().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_app_config(
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<(), String> {
    let db_guard = get_db(&state)?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;

    db.save_app_config(&config).map_err(|e| e.to_string())
}
