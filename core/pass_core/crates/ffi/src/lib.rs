use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

static VERSION_STR: &[u8] = b"1.2.8\0";
static HEALTH_STR_OK: &[u8] = b"ok\0";
static HEALTH_STR_NOT_READY: &[u8] = b"not_initialized\0";
static INITIALIZED: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: OnceLock<Mutex<Option<CString>>> = OnceLock::new();

fn last_error_slot() -> &'static Mutex<Option<CString>> {
    LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_last_error(msg: impl Into<String>) {
    if let Ok(mut slot) = last_error_slot().lock() {
        let normalized = msg.into().replace('\0', "\\0");
        if let Ok(c) = CString::new(normalized) {
            *slot = Some(c);
        }
    }
}

fn clear_last_error() {
    if let Ok(mut slot) = last_error_slot().lock() {
        *slot = None;
    }
}

fn cstr_to_str(ptr: *const c_char, name: &str) -> Result<String, String> {
    if ptr.is_null() {
        return Err(format!("{name} is null"));
    }
    // SAFETY: caller must pass a valid NUL terminated string.
    let s = unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .map_err(|e| format!("{name} is invalid utf8: {e}"))?;
    Ok(s.to_string())
}

fn into_raw_c_string(value: String) -> *mut c_char {
    match CString::new(value) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    sites: Vec<String>,
    username: String,
    password: String,
    #[serde(default)]
    totp: String,
    #[serde(default)]
    recovery: String,
    #[serde(default)]
    note: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    device_name: String,
    accounts: Vec<Account>,
}

fn parse_state(state_json: &str) -> Result<AppState, String> {
    serde_json::from_str::<AppState>(state_json).map_err(|e| format!("invalid state json: {e}"))
}

fn parse_account(account_json: &str) -> Result<Account, String> {
    serde_json::from_str::<Account>(account_json).map_err(|e| format!("invalid account json: {e}"))
}

fn serialize_state(state: &AppState) -> Result<String, String> {
    serde_json::to_string_pretty(state).map_err(|e| format!("serialize state failed: {e}"))
}

fn escape_csv(value: &str) -> String {
    pass_csvio::escape_csv_cell(value)
}

fn sync_alias(accounts: &mut [Account]) {
    use std::collections::{HashMap, HashSet};

    let mut parent: HashMap<String, String> = HashMap::new();
    for site in accounts.iter().flat_map(|a| a.sites.iter()) {
        parent.entry(site.clone()).or_insert_with(|| site.clone());
    }

    fn find(x: &str, parent: &mut std::collections::HashMap<String, String>) -> String {
        let mut cur = x.to_string();
        while parent.get(&cur).is_some_and(|p| p != &cur) {
            cur = parent.get(&cur).cloned().unwrap_or(cur);
        }
        let root = cur.clone();
        let mut cur2 = x.to_string();
        while parent.get(&cur2).is_some_and(|p| p != &cur2) {
            let next = parent.get(&cur2).cloned().unwrap_or(cur2.clone());
            parent.insert(cur2.clone(), root.clone());
            cur2 = next;
        }
        root
    }

    fn union(a: &str, b: &str, parent: &mut std::collections::HashMap<String, String>) {
        let pa = find(a, parent);
        let pb = find(b, parent);
        if pa != pb {
            parent.insert(pb, pa);
        }
    }

    for account in accounts.iter() {
        if account.sites.len() <= 1 {
            continue;
        }
        let first = account.sites[0].clone();
        for site in account.sites.iter().skip(1) {
            union(&first, site, &mut parent);
        }
    }

    let mut groups: HashMap<String, HashSet<String>> = HashMap::new();
    let sites: Vec<String> = parent.keys().cloned().collect();
    for site in sites {
        let root = find(&site, &mut parent);
        groups.entry(root).or_default().insert(site);
    }

    for account in accounts.iter_mut() {
        if account.sites.is_empty() {
            continue;
        }
        let mut merged = HashSet::new();
        for site in account.sites.clone() {
            let root = find(&site, &mut parent);
            if let Some(group) = groups.get(&root) {
                merged.extend(group.iter().cloned());
            } else {
                merged.insert(site);
            }
        }
        let mut list: Vec<String> = merged.into_iter().collect();
        list.sort();
        account.sites = list;
    }
}

fn wrap_result(result: Result<String, String>) -> *mut c_char {
    match result {
        Ok(value) => {
            clear_last_error();
            into_raw_c_string(value)
        }
        Err(err) => {
            set_last_error(err);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "C" fn pass_core_init() -> i32 {
    INITIALIZED.store(true, Ordering::SeqCst);
    clear_last_error();
    0
}

#[no_mangle]
pub extern "C" fn pass_core_shutdown() {
    INITIALIZED.store(false, Ordering::SeqCst);
}

#[no_mangle]
pub extern "C" fn pass_core_health() -> *const c_char {
    if INITIALIZED.load(Ordering::SeqCst) {
        HEALTH_STR_OK.as_ptr().cast()
    } else {
        HEALTH_STR_NOT_READY.as_ptr().cast()
    }
}

#[no_mangle]
pub extern "C" fn pass_core_version() -> *const c_char {
    VERSION_STR.as_ptr().cast()
}

#[no_mangle]
pub extern "C" fn pass_core_ping() -> i32 {
    if INITIALIZED.load(Ordering::SeqCst) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn pass_core_compare_bounds(
    a_lower_ms: i64,
    a_upper_ms: i64,
    b_lower_ms: i64,
    b_upper_ms: i64,
) -> i32 {
    if a_upper_ms < b_lower_ms {
        -1
    } else if b_upper_ms < a_lower_ms {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn pass_core_state_upsert_account(
    state_json: *const c_char,
    account_json: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let account_json = cstr_to_str(account_json, "account_json")?;
        let mut state = parse_state(&state_json)?;
        let mut account = parse_account(&account_json)?;
        account.sites = account
            .sites
            .into_iter()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        if account.sites.is_empty() {
            return Err("account.sites must not be empty".to_string());
        }

        if let Some(idx) = state.accounts.iter().position(|a| a.id == account.id) {
            state.accounts[idx] = account;
        } else {
            state.accounts.push(account);
        }
        sync_alias(&mut state.accounts);
        serialize_state(&state)
    })();

    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_state_soft_delete_account(
    state_json: *const c_char,
    account_id: *const c_char,
    deleted_at_iso: *const c_char,
    updated_at_iso: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let account_id = cstr_to_str(account_id, "account_id")?;
        let deleted_at_iso = cstr_to_str(deleted_at_iso, "deleted_at_iso")?;
        let updated_at_iso = cstr_to_str(updated_at_iso, "updated_at_iso")?;
        let mut state = parse_state(&state_json)?;
        let Some(account) = state.accounts.iter_mut().find(|a| a.id == account_id) else {
            return Err(format!("account not found: {account_id}"));
        };
        account.deleted_at = Some(deleted_at_iso);
        account.updated_at = updated_at_iso;
        serialize_state(&state)
    })();

    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_state_restore_account(
    state_json: *const c_char,
    account_id: *const c_char,
    updated_at_iso: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let account_id = cstr_to_str(account_id, "account_id")?;
        let updated_at_iso = cstr_to_str(updated_at_iso, "updated_at_iso")?;
        let mut state = parse_state(&state_json)?;
        let Some(account) = state.accounts.iter_mut().find(|a| a.id == account_id) else {
            return Err(format!("account not found: {account_id}"));
        };
        account.deleted_at = None;
        account.updated_at = updated_at_iso;
        serialize_state(&state)
    })();

    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_state_hard_delete_account(
    state_json: *const c_char,
    account_id: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let account_id = cstr_to_str(account_id, "account_id")?;
        let mut state = parse_state(&state_json)?;
        let before = state.accounts.len();
        state.accounts.retain(|a| a.id != account_id);
        if state.accounts.len() == before {
            return Err(format!("account not found: {account_id}"));
        }
        serialize_state(&state)
    })();

    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_state_sync_alias(state_json: *const c_char) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let mut state = parse_state(&state_json)?;
        sync_alias(&mut state.accounts);
        serialize_state(&state)
    })();

    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_export_accounts_csv(state_json: *const c_char) -> *mut c_char {
    let result = (|| {
        let state_json = cstr_to_str(state_json, "state_json")?;
        let state = parse_state(&state_json)?;
        let mut lines = vec![
            "id,sites,username,password,totp,recovery,note,created_at,updated_at,deleted_at"
                .to_string(),
        ];

        for account in state.accounts.iter().filter(|a| a.deleted_at.is_none()) {
            let row = vec![
                account.id.clone(),
                account.sites.join("|"),
                account.username.clone(),
                account.password.clone(),
                account.totp.clone(),
                account.recovery.clone(),
                account.note.clone(),
                account.created_at.clone(),
                account.updated_at.clone(),
                account.deleted_at.clone().unwrap_or_default(),
            ]
            .into_iter()
            .map(|v| escape_csv(&v))
            .collect::<Vec<_>>()
            .join(",");
            lines.push(row);
        }

        Ok(lines.join("\n"))
    })();

    wrap_result(result)
}

/// Export accounts as macOS-compatible full CSV (includes deleted rows).
///
/// Input: `{"accounts":[...]}` using v2 account JSON fields.
#[no_mangle]
pub extern "C" fn pass_core_export_macos_csv_json(accounts_json: *const c_char) -> *mut c_char {
    let result = (|| {
        let accounts_json = cstr_to_str(accounts_json, "accounts_json")?;
        let accounts: Vec<pass_merge::v2::PasswordAccount> =
            if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(&accounts_json) {
                if let Some(arr) = wrapper.get("accounts") {
                    serde_json::from_value(arr.clone())
                        .map_err(|e| format!("invalid accounts array: {e}"))?
                } else if wrapper.is_array() {
                    serde_json::from_value(wrapper)
                        .map_err(|e| format!("invalid accounts array: {e}"))?
                } else {
                    return Err("accounts_json must be an array or {\"accounts\":[...]}".into());
                }
            } else {
                return Err("invalid accounts json".into());
            };

        let rows: Vec<Vec<String>> = accounts
            .iter()
            .map(|a| {
                vec![
                    a.account_id.clone(),
                    a.sites.join(";"),
                    a.username.clone(),
                    a.password.clone(),
                    a.totp_secret.clone(),
                    a.recovery_codes.clone(),
                    a.note.clone(),
                    a.username_updated_at_ms.to_string(),
                    a.password_updated_at_ms.to_string(),
                    a.totp_updated_at_ms.to_string(),
                    a.recovery_codes_updated_at_ms.to_string(),
                    a.note_updated_at_ms.to_string(),
                    if a.is_deleted { "true" } else { "false" }.to_string(),
                    a.deleted_at_ms.map(|v| v.to_string()).unwrap_or_default(),
                    a.last_operated_device_name.clone(),
                    a.created_at_ms.to_string(),
                    a.updated_at_ms.to_string(),
                ]
            })
            .collect();
        Ok(pass_csvio::build_csv(
            pass_csvio::MACOS_EXPORT_HEADERS,
            &rows,
        ))
    })();
    wrap_result(result)
}

#[no_mangle]
pub extern "C" fn pass_core_last_error_message() -> *const c_char {
    if let Ok(slot) = last_error_slot().lock() {
        if let Some(message) = slot.as_ref() {
            return message.as_ptr();
        }
    }
    std::ptr::null()
}

#[no_mangle]
/// Releases a string returned by a `pass_core_*` FFI function.
///
/// # Safety
///
/// `ptr` must be null or a pointer returned by this library through
/// `CString::into_raw`, and it must not have been freed previously.
pub unsafe extern "C" fn pass_core_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: upheld by the caller as required by this function's contract.
    unsafe {
        let _ = CString::from_raw(ptr);
    }
}

/// Merge two `pass.sync.bundle.v2` payload JSON objects (accounts/folders/passkeys).
///
/// Input may be either:
/// - a wrapper: `{"local":{...},"remote":{...}}`
/// - or callers can pass local/remote via dedicated functions below.
///
/// Returns merged payload JSON on success, or null with `pass_core_last_error_message`.
#[no_mangle]
pub extern "C" fn pass_core_merge_sync_payloads_json(
    local_json: *const c_char,
    remote_json: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let local_json = cstr_to_str(local_json, "local_json")?;
        let remote_json = cstr_to_str(remote_json, "remote_json")?;
        let local: pass_merge::v2::SyncPayload =
            serde_json::from_str(&local_json).map_err(|e| format!("invalid local payload: {e}"))?;
        let remote: pass_merge::v2::SyncPayload = serde_json::from_str(&remote_json)
            .map_err(|e| format!("invalid remote payload: {e}"))?;
        let merged = pass_merge::v2::merge_sync_payloads(local, remote);
        serde_json::to_string(&merged).map_err(|e| format!("serialize merged payload failed: {e}"))
    })();
    wrap_result(result)
}

/// Sync site alias groups across accounts (macOS `syncAliasGroups` semantics).
///
/// `accounts_json` is a JSON array of account objects (or `{"accounts":[...]}`).
/// Returns JSON `{"accounts":[...],"changed":bool}` on success.
#[no_mangle]
pub extern "C" fn pass_core_sync_alias_groups_json(
    accounts_json: *const c_char,
    device_name: *const c_char,
    now_ms: i64,
) -> *mut c_char {
    let result = (|| {
        let accounts_json = cstr_to_str(accounts_json, "accounts_json")?;
        let device_name =
            cstr_to_str(device_name, "device_name").unwrap_or_else(|_| "".to_string());
        let mut accounts: Vec<pass_merge::v2::PasswordAccount> =
            if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(&accounts_json) {
                if let Some(arr) = wrapper.get("accounts") {
                    serde_json::from_value(arr.clone())
                        .map_err(|e| format!("invalid accounts array: {e}"))?
                } else if wrapper.is_array() {
                    serde_json::from_value(wrapper)
                        .map_err(|e| format!("invalid accounts array: {e}"))?
                } else {
                    return Err("accounts_json must be an array or {\"accounts\":[...]}".into());
                }
            } else {
                return Err("invalid accounts json".into());
            };
        let changed = pass_merge::v2::sync_alias_groups(&mut accounts, now_ms, &device_name);
        serde_json::to_string(&serde_json::json!({
            "accounts": accounts,
            "changed": changed,
        }))
        .map_err(|e| format!("serialize alias result failed: {e}"))
    })();
    wrap_result(result)
}

/// Normalize a domain/host string (trim, lower, strip scheme/path).
#[no_mangle]
pub extern "C" fn pass_core_normalize_domain(input: *const c_char) -> *mut c_char {
    let result = (|| {
        let input = cstr_to_str(input, "input")?;
        Ok(pass_merge::v2::normalize::normalize_domain(&input))
    })();
    wrap_result(result)
}

/// eTLD+1 for a domain (IP hosts returned as-is).
#[no_mangle]
pub extern "C" fn pass_core_etld_plus_one(input: *const c_char) -> *mut c_char {
    let result = (|| {
        let input = cstr_to_str(input, "input")?;
        Ok(pass_merge::v2::normalize::etld_plus_one(&input))
    })();
    wrap_result(result)
}

/// Deterministic UUID string from text (matches extension + Swift PassStableUUID).
#[no_mangle]
pub extern "C" fn pass_core_stable_uuid_from_text(input: *const c_char) -> *mut c_char {
    let result = (|| {
        let input = cstr_to_str(input, "input")?;
        Ok(pass_merge::v2::normalize::stable_uuid_from_text(&input))
    })();
    wrap_result(result)
}

/// Evaluate merge safety. Inputs are payload JSON strings.
/// `mode` is "merge" or "remoteOverwriteLocal".
#[no_mangle]
pub extern "C" fn pass_core_evaluate_sync_safety_json(
    local_json: *const c_char,
    remote_json: *const c_char,
    merged_json: *const c_char,
    mode: *const c_char,
) -> *mut c_char {
    let result = (|| {
        let local_json = cstr_to_str(local_json, "local_json")?;
        let merged_json = cstr_to_str(merged_json, "merged_json")?;
        let mode = cstr_to_str(mode, "mode").unwrap_or_else(|_| "merge".to_string());
        let local: pass_merge::v2::SyncPayload =
            serde_json::from_str(&local_json).map_err(|e| format!("invalid local payload: {e}"))?;
        let merged: pass_merge::v2::SyncPayload = serde_json::from_str(&merged_json)
            .map_err(|e| format!("invalid merged payload: {e}"))?;
        let remote = if remote_json.is_null() {
            None
        } else {
            let remote_json = cstr_to_str(remote_json, "remote_json")?;
            if remote_json.trim().is_empty() || remote_json == "null" {
                None
            } else {
                Some(
                    serde_json::from_str::<pass_merge::v2::SyncPayload>(&remote_json)
                        .map_err(|e| format!("invalid remote payload: {e}"))?,
                )
            }
        };
        let report = pass_merge::v2::evaluate_sync_safety(&local, remote.as_ref(), &merged, &mode);
        serde_json::to_string(&serde_json::json!({
            "safe": report.safe,
            "reasons": report.reasons,
        }))
        .map_err(|e| format!("serialize safety report failed: {e}"))
    })();
    wrap_result(result)
}
