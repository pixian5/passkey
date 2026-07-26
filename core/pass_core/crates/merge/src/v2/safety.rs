use super::normalize::{
    normalize_account_shape, normalize_folder_id, normalize_folder_shape, normalize_passkey_shape,
};
use super::types::{Folder, Passkey, PasswordAccount, SyncPayload};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncSafetyReport {
    pub safe: bool,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct PayloadSummary {
    accounts: usize,
    folders: usize,
    passkeys: usize,
    account_ids: std::collections::BTreeSet<String>,
    folder_ids: std::collections::BTreeSet<String>,
    passkey_ids: std::collections::BTreeSet<String>,
}

fn account_identity(account: &PasswordAccount) -> String {
    let normalized = normalize_account_shape(account.clone());
    let record = normalized.resolved_record_id();
    if !record.is_empty() {
        record
    } else {
        normalized.account_id.trim().to_ascii_lowercase()
    }
}

fn folder_identity(folder: &Folder) -> String {
    normalize_folder_id(&normalize_folder_shape(folder.clone()).id)
}

fn passkey_identity(passkey: &Passkey) -> String {
    normalize_passkey_shape(passkey.clone())
        .credential_id_b64u
        .trim()
        .to_string()
}

fn summarize(payload: &SyncPayload) -> PayloadSummary {
    let accounts: Vec<PasswordAccount> = payload
        .accounts
        .iter()
        .cloned()
        .map(normalize_account_shape)
        .collect();
    let folders: Vec<Folder> = payload
        .folders
        .iter()
        .cloned()
        .map(normalize_folder_shape)
        .collect();
    let passkeys: Vec<Passkey> = payload
        .passkeys
        .iter()
        .cloned()
        .map(normalize_passkey_shape)
        .collect();

    let mut summary = PayloadSummary {
        // Permanent deletion records are sync tombstones, not visible data.
        // Keep their identities below so they still prevent resurrection.
        accounts: accounts
            .iter()
            .filter(|item| !item.is_permanently_deleted)
            .count(),
        folders: folders
            .iter()
            .filter(|item| !item.is_permanently_deleted)
            .count(),
        passkeys: passkeys
            .iter()
            .filter(|item| !item.is_permanently_deleted)
            .count(),
        ..PayloadSummary::default()
    };
    for account in &accounts {
        let id = account_identity(account);
        if !id.is_empty() {
            summary.account_ids.insert(id);
        }
    }
    for folder in &folders {
        let id = folder_identity(folder);
        if !id.is_empty() {
            summary.folder_ids.insert(id);
        }
    }
    for passkey in &passkeys {
        let id = passkey_identity(passkey);
        if !id.is_empty() {
            summary.passkey_ids.insert(id);
        }
    }
    summary
}

fn missing_identities(
    source: &[String],
    target: &std::collections::BTreeSet<String>,
) -> Vec<String> {
    source
        .iter()
        .filter(|id| !id.is_empty() && !target.contains(id.as_str()))
        .cloned()
        .collect()
}

fn missing_summary_ids(
    source: &std::collections::BTreeSet<String>,
    target: &std::collections::BTreeSet<String>,
) -> bool {
    source
        .iter()
        .any(|id| !id.is_empty() && !target.contains(id))
}

/// Validate a merged payload before it is written locally or uploaded.
pub fn evaluate_sync_safety(
    local: &SyncPayload,
    remote: Option<&SyncPayload>,
    merged: &SyncPayload,
    mode: &str,
) -> SyncSafetyReport {
    let local_summary = summarize(local);
    let remote_summary = remote.map(summarize);
    let merged_summary = summarize(merged);
    let mut reasons = Vec::new();

    let local_non_empty =
        local_summary.accounts + local_summary.folders + local_summary.passkeys > 0;
    let remote_non_empty = remote_summary
        .as_ref()
        .map(|s| s.accounts + s.folders + s.passkeys > 0)
        .unwrap_or(false);

    if mode == "merge" {
        if local_non_empty && remote_summary.is_some() && !remote_non_empty {
            reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL".to_string());
        }
        let local_account_ids: Vec<String> = local_summary.account_ids.iter().cloned().collect();
        let local_folder_ids: Vec<String> = local_summary.folder_ids.iter().cloned().collect();
        let local_passkey_ids: Vec<String> = local_summary.passkey_ids.iter().cloned().collect();
        if !missing_identities(&local_account_ids, &merged_summary.account_ids).is_empty() {
            reasons.push("MERGED_MISSING_LOCAL_ACCOUNT_IDS".to_string());
        }
        if !missing_identities(&local_folder_ids, &merged_summary.folder_ids).is_empty() {
            reasons.push("MERGED_MISSING_LOCAL_FOLDER_IDS".to_string());
        }
        if !missing_identities(&local_passkey_ids, &merged_summary.passkey_ids).is_empty() {
            reasons.push("MERGED_MISSING_LOCAL_PASSKEY_IDS".to_string());
        }
        if let Some(remote_summary) = remote_summary.as_ref() {
            if missing_summary_ids(&remote_summary.account_ids, &merged_summary.account_ids) {
                reasons.push("REMOTE_ACCOUNTS_DROPPED".to_string());
            }
            if missing_summary_ids(&remote_summary.folder_ids, &merged_summary.folder_ids) {
                reasons.push("REMOTE_FOLDERS_DROPPED".to_string());
            }
            if missing_summary_ids(&remote_summary.passkey_ids, &merged_summary.passkey_ids) {
                reasons.push("REMOTE_PASSKEYS_DROPPED".to_string());
            }
        }
    } else if mode == "remoteOverwriteLocal" {
        if local_non_empty && !remote_non_empty {
            reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL".to_string());
        }
    }

    SyncSafetyReport {
        safe: reasons.is_empty(),
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permanent_tombstones_do_not_count_as_visible_data() {
        let mut tombstone = PasswordAccount::default();
        tombstone.record_id = Some("record-tombstone".into());
        tombstone.is_deleted = true;
        tombstone.is_permanently_deleted = true;
        let local = SyncPayload {
            accounts: vec![tombstone.clone()],
            ..SyncPayload::default()
        };
        let remote = SyncPayload::default();
        let report = evaluate_sync_safety(&local, Some(&remote), &local, "merge");
        assert!(
            report.safe,
            "墓碑不应触发空远端安全闸门: {:?}",
            report.reasons
        );
        assert!(local.accounts[0].is_permanently_deleted);
    }

    #[test]
    fn visible_data_still_blocks_empty_remote_merge() {
        let mut account = PasswordAccount::default();
        account.record_id = Some("record-visible".into());
        let local = SyncPayload {
            accounts: vec![account],
            ..SyncPayload::default()
        };
        let remote = SyncPayload::default();
        let report = evaluate_sync_safety(&local, Some(&remote), &remote, "merge");
        assert!(!report.safe);
        assert!(report
            .reasons
            .contains(&"REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL".to_string()));
    }
}
