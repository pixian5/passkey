use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

static VERSION_STR: &[u8] = b"0.1.0\0";
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
    format!("\"{}\"", value.replace('"', "\"\""))
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
pub extern "C" fn pass_core_string_free(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: ptr must be allocated by CString::into_raw in this library.
    unsafe {
        let _ = CString::from_raw(ptr);
    }
}
