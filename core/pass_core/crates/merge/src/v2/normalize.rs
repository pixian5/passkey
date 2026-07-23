use super::policy::{
    DEFAULT_DEVICE_NAME, ETLD2_SUFFIXES, FIXED_NEW_ACCOUNT_FOLDER_ID, FIXED_NEW_ACCOUNT_FOLDER_NAME,
};
use super::types::{AccountFolderMembershipState, Folder, Passkey, PasswordAccount};

pub fn first_non_empty(candidates: &[&str], fallback: &str) -> String {
    for candidate in candidates {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    fallback.to_string()
}

pub fn stable_tie_value(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn normalize_domain(input: &str) -> String {
    let mut value = input.trim().to_ascii_lowercase();
    if value.starts_with("http://") || value.starts_with("https://") {
        if let Ok(url) = url_host(&value) {
            value = url;
        } else {
            return String::new();
        }
    }
    while value.ends_with('.') {
        value.pop();
    }
    value
}

fn url_host(value: &str) -> Result<String, ()> {
    // Minimal host extraction without pulling the `url` crate.
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))
        .ok_or(())?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").trim();
    if host.is_empty() {
        return Err(());
    }
    // Drop userinfo and port.
    let host = host.rsplit('@').next().unwrap_or(host);
    let host = if host.starts_with('[') {
        host.trim_matches(|c| c == '[' || c == ']').to_string()
    } else {
        host.split(':').next().unwrap_or(host).to_string()
    };
    Ok(host.to_ascii_lowercase())
}

pub fn is_ip_host(domain: &str) -> bool {
    let normalized = normalize_domain(domain);
    if normalized.is_empty() {
        return false;
    }
    let ipv4_parts: Vec<&str> = normalized.split('.').collect();
    if ipv4_parts.len() == 4
        && ipv4_parts.iter().all(|part| {
            !part.is_empty()
                && part.chars().all(|c| c.is_ascii_digit())
                && part.parse::<u32>().map(|v| v <= 255).unwrap_or(false)
        })
    {
        return true;
    }
    if normalized.contains(':') {
        return normalized
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == ':');
    }
    false
}

pub fn etld_plus_one(domain: &str) -> String {
    let normalized = normalize_domain(domain);
    if normalized.is_empty() {
        return String::new();
    }
    if is_ip_host(&normalized) {
        return normalized;
    }
    let labels: Vec<&str> = normalized.split('.').collect();
    if labels.len() < 2 {
        return normalized;
    }
    let tail2 = labels[labels.len() - 2..].join(".");
    if ETLD2_SUFFIXES.contains(&tail2.as_str()) && labels.len() >= 3 {
        return labels[labels.len() - 3..].join(".");
    }
    tail2
}

pub fn normalize_sites(sites: &[String]) -> Vec<String> {
    let mut values: Vec<String> = sites
        .iter()
        .map(|site| normalize_domain(site))
        .filter(|site| !site.is_empty())
        .collect();
    values.sort();
    values.dedup();
    values
}

pub fn normalize_folder_id(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub fn normalize_folder_id_list(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = values
        .iter()
        .map(|v| normalize_folder_id(v))
        .filter(|v| !v.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn normalize_passkey_credential_ids(values: &[String]) -> Vec<String> {
    let mut out: Vec<String> = values
        .iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn is_uuid_lower(value: &str) -> bool {
    let re = value.as_bytes();
    if re.len() != 36 {
        return false;
    }
    let s = value.to_ascii_lowercase();
    let b = s.as_bytes();
    for (i, ch) in b.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            if *ch != b'-' {
                return false;
            }
        } else if !ch.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

/// Match extension `stableUuidFromText`.
pub fn stable_uuid_from_text(input: &str) -> String {
    let mut seed_parts: [u32; 4] = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
    for (i, code) in input.bytes().enumerate() {
        let idx = i % 4;
        let mut value = seed_parts[idx];
        value ^= u32::from(code);
        value = value.wrapping_mul(0x45d9f3b);
        value ^= value >> 16;
        seed_parts[idx] = value;
    }
    let hex: String = seed_parts
        .iter()
        .map(|v| format!("{v:08x}"))
        .collect::<String>()
        .chars()
        .take(32)
        .collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

pub fn normalize_passkey_create_compat_method(raw: &str, alg: i64) -> String {
    let normalized = raw.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "standard"
        | "user_name_fallback"
        | "rs256"
        | "user_name_fallback+rs256"
        | "unknown_linked" => normalized,
        _ if alg == -257 => "rs256".to_string(),
        _ => "standard".to_string(),
    }
}

pub fn normalize_account_shape(mut account: PasswordAccount) -> PasswordAccount {
    let sites = normalize_sites(&account.sites);
    let created_at_ms = if account.created_at_ms > 0 {
        account.created_at_ms
    } else if account.updated_at_ms > 0 {
        account.updated_at_ms
    } else {
        0
    };
    let username = account.username.trim().to_string();
    let canonical_site = if !account.canonical_site.trim().is_empty() {
        normalize_domain(&account.canonical_site)
    } else {
        etld_plus_one(sites.first().map(String::as_str).unwrap_or(""))
    };
    let account_id = if !account.account_id.trim().is_empty() {
        account.account_id.trim().to_string()
    } else {
        format!(
            "{}-{}-{}",
            canonical_site,
            format_yymmddhhmmss(created_at_ms),
            username
        )
    };
    let passkey_credential_ids = normalize_passkey_credential_ids(&account.passkey_credential_ids);
    let record_id = {
        let direct = account
            .record_id
            .as_deref()
            .or(account.id.as_deref())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if is_uuid_lower(&direct) {
            Some(direct)
        } else {
            let username_seed = first_non_empty(&[&account.username_at_create, &username], "");
            Some(stable_uuid_from_text(&format!(
                "{account_id}|{created_at_ms}|{username_seed}"
            )))
        }
    };

    let fallback_device = first_non_empty(
        &[
            &account.last_operated_device_name,
            &account.created_device_name,
        ],
        DEFAULT_DEVICE_NAME,
    );

    account.record_id = record_id.clone();
    account.id = record_id;
    account.account_id = account_id;
    account.canonical_site = canonical_site;
    account.username_at_create = first_non_empty(&[&account.username_at_create, &username], "");
    account.username = username;
    account.sites = sites;
    account.folder_ids = normalize_folder_id_list(&account.folder_ids);
    if let Some(folder_id) = account.folder_id.take() {
        let normalized = normalize_folder_id(&folder_id);
        if !normalized.is_empty() && !account.folder_ids.contains(&normalized) {
            account.folder_ids.insert(0, normalized.clone());
        }
        account.folder_id = account.folder_ids.first().cloned();
    } else {
        account.folder_id = account.folder_ids.first().cloned();
    }
    account.passkey_credential_ids = passkey_credential_ids;
    account.created_at_ms = created_at_ms;
    account.updated_at_ms = if account.updated_at_ms > 0 {
        account.updated_at_ms
    } else {
        created_at_ms
    };
    account.username_updated_at_ms = if account.username_updated_at_ms > 0 {
        account.username_updated_at_ms
    } else {
        created_at_ms
    };
    account.password_updated_at_ms = if account.password_updated_at_ms > 0 {
        account.password_updated_at_ms
    } else {
        created_at_ms
    };
    account.totp_updated_at_ms = if account.totp_updated_at_ms > 0 {
        account.totp_updated_at_ms
    } else {
        created_at_ms
    };
    account.recovery_codes_updated_at_ms = if account.recovery_codes_updated_at_ms > 0 {
        account.recovery_codes_updated_at_ms
    } else {
        created_at_ms
    };
    account.note_updated_at_ms = if account.note_updated_at_ms > 0 {
        account.note_updated_at_ms
    } else {
        created_at_ms
    };
    account.passkey_updated_at_ms = if account.passkey_updated_at_ms > 0 {
        account.passkey_updated_at_ms
    } else {
        created_at_ms
    };
    account.username_updated_device_name =
        first_non_empty(&[&account.username_updated_device_name], &fallback_device);
    account.password_updated_device_name =
        first_non_empty(&[&account.password_updated_device_name], &fallback_device);
    account.totp_updated_device_name =
        first_non_empty(&[&account.totp_updated_device_name], &fallback_device);
    account.recovery_codes_updated_device_name = first_non_empty(
        &[&account.recovery_codes_updated_device_name],
        &fallback_device,
    );
    account.note_updated_device_name =
        first_non_empty(&[&account.note_updated_device_name], &fallback_device);
    account.passkey_updated_device_name =
        first_non_empty(&[&account.passkey_updated_device_name], &fallback_device);
    account.last_operated_device_name = fallback_device.clone();
    account.created_device_name =
        first_non_empty(&[&account.created_device_name], &fallback_device);
    account.deleted_device_name = account.deleted_device_name.trim().to_string();
    account.site_alias_states = rekey_states(&account.site_alias_states, |k| normalize_domain(k));
    account.folder_membership_states = rekey_states(&account.folder_membership_states, |k| {
        normalize_folder_id(k)
    });
    account.passkey_link_states =
        rekey_states(&account.passkey_link_states, |k| k.trim().to_string());
    account
}

fn rekey_states(
    source: &std::collections::BTreeMap<String, AccountFolderMembershipState>,
    normalize_key: impl Fn(&str) -> String,
) -> std::collections::BTreeMap<String, AccountFolderMembershipState> {
    let mut out = std::collections::BTreeMap::new();
    for (raw, state) in source {
        let key = normalize_key(raw);
        if key.is_empty() {
            continue;
        }
        if let Some(existing) = out.get(&key) {
            if should_prefer_relation_state(state, existing) {
                out.insert(key, state.clone());
            }
        } else {
            out.insert(key, state.clone());
        }
    }
    out
}

pub fn should_prefer_relation_state(
    incoming: &AccountFolderMembershipState,
    current: &AccountFolderMembershipState,
) -> bool {
    if incoming.updated_at_ms > current.updated_at_ms {
        return true;
    }
    if incoming.updated_at_ms < current.updated_at_ms {
        return false;
    }
    if incoming.is_deleted && !current.is_deleted {
        return true;
    }
    if incoming.is_deleted == current.is_deleted {
        return stable_tie_value(&incoming.device_name) > stable_tie_value(&current.device_name);
    }
    false
}

pub fn normalize_folder_shape(mut folder: Folder) -> Folder {
    let id = normalize_folder_id(&folder.id);
    let created_at_ms = folder.created_at_ms; // preserve 0
    let updated_at_ms = if folder.updated_at_ms != 0 {
        folder.updated_at_ms
    } else {
        created_at_ms
    };
    let name = if id == FIXED_NEW_ACCOUNT_FOLDER_ID {
        FIXED_NEW_ACCOUNT_FOLDER_NAME.to_string()
    } else if !folder.name.trim().is_empty() {
        folder.name.trim().to_string()
    } else {
        format!("未命名文件夹 {}", &id.chars().take(8).collect::<String>())
    };
    folder.id = id;
    folder.name = name;
    folder.matched_sites = normalize_sites(&folder.matched_sites);
    let mut seen = std::collections::BTreeSet::new();
    folder.regular_account_ids = folder
        .regular_account_ids
        .into_iter()
        .map(|id| id.trim().to_ascii_lowercase())
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect();
    folder.regular_order_updated_at_ms = folder.regular_order_updated_at_ms.max(0);
    folder.regular_order_updated_device_name =
        folder.regular_order_updated_device_name.trim().to_string();
    folder.created_at_ms = created_at_ms;
    folder.updated_at_ms = updated_at_ms;
    folder.deleted_device_name = folder.deleted_device_name.trim().to_string();
    folder
}

pub fn normalize_passkey_shape(mut passkey: Passkey) -> Passkey {
    let created_at = passkey.created_at_ms.max(0);
    let updated_at = passkey.updated_at_ms.max(created_at);
    let alg = if passkey.alg == 0 { -7 } else { passkey.alg };
    passkey.credential_id_b64u = passkey.credential_id_b64u.trim().to_string();
    passkey.rp_id = normalize_domain(&passkey.rp_id);
    passkey.user_name = passkey.user_name.trim().to_string();
    passkey.display_name = passkey.display_name.trim().to_string();
    passkey.user_handle_b64u = passkey.user_handle_b64u.trim().to_string();
    passkey.alg = alg;
    passkey.sign_count = passkey.sign_count.max(0);
    passkey.created_at_ms = created_at;
    passkey.updated_at_ms = updated_at;
    passkey.last_used_at_ms = passkey.last_used_at_ms.map(|v| v.max(0));
    passkey.mode = if passkey.mode.trim().is_empty() {
        "managed".to_string()
    } else {
        passkey.mode.trim().to_string()
    };
    passkey.create_compat_method =
        normalize_passkey_create_compat_method(&passkey.create_compat_method, alg);
    passkey.deleted_device_name = passkey.deleted_device_name.trim().to_string();
    passkey
}

pub fn sort_folders_for_display(mut folders: Vec<Folder>) -> Vec<Folder> {
    folders.sort_by(|lhs, rhs| {
        let lhs_fixed = lhs.id == FIXED_NEW_ACCOUNT_FOLDER_ID;
        let rhs_fixed = rhs.id == FIXED_NEW_ACCOUNT_FOLDER_ID;
        if lhs_fixed != rhs_fixed {
            return if lhs_fixed {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        let name = lhs
            .name
            .to_ascii_lowercase()
            .cmp(&rhs.name.to_ascii_lowercase());
        if name != std::cmp::Ordering::Equal {
            return name;
        }
        lhs.id.cmp(&rhs.id)
    });
    folders
}

fn format_yymmddhhmmss(ms: i64) -> String {
    // UTC formatting without chrono dependency.
    if ms <= 0 {
        return "000000000000".to_string();
    }
    let secs = ms / 1000;
    // 1970-01-01 baseline civil date via days algorithm.
    let days = secs.div_euclid(86_400);
    let day_secs = secs.rem_euclid(86_400) as u32;
    let hour = day_secs / 3600;
    let minute = (day_secs % 3600) / 60;
    let second = day_secs % 60;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{:02}{:02}{:02}{:02}{:02}{:02}",
        year % 100,
        month,
        day,
        hour,
        minute,
        second
    )
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    // Howard Hinnant public-domain algorithm.
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ip_hosts_are_not_collapsed() {
        assert_eq!(etld_plus_one("192.168.1.1"), "192.168.1.1");
        assert_eq!(etld_plus_one("10.0.1.1"), "10.0.1.1");
        assert_ne!(etld_plus_one("192.168.1.1"), etld_plus_one("10.0.1.1"));
    }

    #[test]
    fn multi_label_suffixes() {
        assert_eq!(etld_plus_one("bank.com.au"), "bank.com.au");
        assert_eq!(etld_plus_one("a.b.example.com.cn"), "example.com.cn");
    }

    #[test]
    fn normalize_domain_strips_scheme_and_path() {
        assert_eq!(
            normalize_domain("https://Login.Example.com/path?q=1"),
            "login.example.com"
        );
        assert_eq!(normalize_domain("  APPLE.COM.  "), "apple.com");
        assert_eq!(
            normalize_domain("http://user@host.example:8080/x"),
            "host.example"
        );
    }

    #[test]
    fn stable_uuid_is_deterministic() {
        let a = stable_uuid_from_text("example|1|alice");
        let b = stable_uuid_from_text("example|1|alice");
        assert_eq!(a, b);
        assert!(is_uuid_lower(&a));
    }
}
