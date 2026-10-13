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
    permanent_account_ids: std::collections::BTreeSet<String>,
    permanent_folder_ids: std::collections::BTreeSet<String>,
    permanent_passkey_ids: std::collections::BTreeSet<String>,
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
            if account.is_permanently_deleted {
                summary
                    .permanent_account_ids
                    .insert(account_identity(account));
            }
        }
    }
    for folder in &folders {
        let id = folder_identity(folder);
        if !id.is_empty() {
            summary.folder_ids.insert(id);
            if folder.is_permanently_deleted {
                summary.permanent_folder_ids.insert(folder_identity(folder));
            }
        }
    }
    for passkey in &passkeys {
        let id = passkey_identity(passkey);
        if !id.is_empty() {
            summary.passkey_ids.insert(id);
            if passkey.is_permanently_deleted {
                summary
                    .permanent_passkey_ids
                    .insert(passkey_identity(passkey));
            }
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

    // 仅「云端覆盖本地」放宽：merged == 远端，本地独有墓碑按用户选择被弃用，不应拦截。
    // 「本地覆盖云端」与 merge 仍要求两端墓碑都保留；前者也是 WebDAV 镜像上传所用模式，
    // 镜像须忠实反映删除、不可丢远端墓碑（防复活），故不放松。
    let (use_local, use_remote) = match mode {
        "remoteOverwriteLocal" => (false, true),
        _ => (true, true),
    };
    let mut required_account_tombstones: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();
    let mut required_folder_tombstones: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();
    let mut required_passkey_tombstones: std::collections::BTreeSet<String> =
        std::collections::BTreeSet::new();
    if use_local {
        required_account_tombstones.extend(local_summary.permanent_account_ids.iter().cloned());
        required_folder_tombstones.extend(local_summary.permanent_folder_ids.iter().cloned());
        required_passkey_tombstones.extend(local_summary.permanent_passkey_ids.iter().cloned());
    }
    if use_remote {
        if let Some(remote_summary) = remote_summary.as_ref() {
            required_account_tombstones
                .extend(remote_summary.permanent_account_ids.iter().cloned());
            required_folder_tombstones.extend(remote_summary.permanent_folder_ids.iter().cloned());
            required_passkey_tombstones
                .extend(remote_summary.permanent_passkey_ids.iter().cloned());
        }
    }
    if !required_account_tombstones.is_subset(&merged_summary.permanent_account_ids)
        || !required_folder_tombstones.is_subset(&merged_summary.permanent_folder_ids)
        || !required_passkey_tombstones.is_subset(&merged_summary.permanent_passkey_ids)
    {
        reasons.push("PERMANENT_TOMBSTONES_DROPPED".to_string());
    }

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

    #[test]
    fn overwrite_modes_keep_surviving_side_tombstones_only() {
        // 场景 A：远端墓碑在「云端覆盖本地」时被丢掉（merged 不含远端墓碑）→ 拦截，防复活
        let remote_tomb = PasswordAccount {
            record_id: Some("remote-tomb".into()),
            is_deleted: true,
            is_permanently_deleted: true,
            deleted_at_ms: Some(20),
            ..Default::default()
        };
        let local_active = PasswordAccount {
            record_id: Some("remote-tomb".into()),
            password: "still here".into(),
            ..Default::default()
        };
        let remote = SyncPayload {
            accounts: vec![remote_tomb.clone()],
            ..SyncPayload::default()
        };
        let local = SyncPayload {
            accounts: vec![local_active.clone()],
            ..SyncPayload::default()
        };
        // merged 故意用 local（丢了远端墓碑）模拟被覆盖逻辑清除
        let blocked = evaluate_sync_safety(&local, Some(&remote), &local, "remoteOverwriteLocal");
        assert!(!blocked.safe, "{:?}", blocked.reasons);
        assert!(blocked
            .reasons
            .contains(&"PERMANENT_TOMBSTONES_DROPPED".to_string()));

        // 场景 B：本地独有墓碑在「云端覆盖本地」时被弃用 → 放行（用户显式选择采用云端）
        let local_tomb = PasswordAccount {
            record_id: Some("local-only-tomb".into()),
            is_deleted: true,
            is_permanently_deleted: true,
            deleted_at_ms: Some(30),
            ..Default::default()
        };
        let remote_active = PasswordAccount {
            record_id: Some("remote-active".into()),
            password: "cloud truth".into(),
            ..Default::default()
        };
        let local2 = SyncPayload {
            accounts: vec![local_tomb.clone()],
            ..SyncPayload::default()
        };
        let remote2 = SyncPayload {
            accounts: vec![remote_active.clone()],
            ..SyncPayload::default()
        };
        // merged == 远端（正确的云端覆盖本地结果）
        let ok = evaluate_sync_safety(&local2, Some(&remote2), &remote2, "remoteOverwriteLocal");
        assert!(
            ok.safe,
            "本地独有墓碑在云端覆盖本地时不应拦截：{:?}",
            ok.reasons
        );

        // 场景 C：远端独有墓碑在「本地覆盖云端」时被弃用 → 放行
        let ok_local =
            evaluate_sync_safety(&remote2, Some(&local2), &local2, "localOverwriteRemote");
        assert!(
            ok_local.safe,
            "远端独有墓碑在本地覆盖云端时不应拦截：{:?}",
            ok_local.reasons
        );

        // 场景 D：本地 + 远端墓碑一致时远端覆盖本地仍放行
        let preserved =
            evaluate_sync_safety(&local2, Some(&remote2), &remote2, "remoteOverwriteLocal");
        assert!(preserved.safe, "{:?}", preserved.reasons);
    }
}
