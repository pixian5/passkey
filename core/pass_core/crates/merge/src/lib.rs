//! Shared merge primitives.
//!
//! - Legacy op-log helpers remain in this crate root for experimental HLC work.
//! - Production `pass.sync.bundle.v2` field-LWW merge lives in [`v2`].

pub mod v2;

use std::cmp::Ordering;

use pass_domain::{Operation, TimeRange};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteDecision {
    KeepDeleted,
    KeepActive,
    NeedsReview,
}

pub fn happened_before(a: &Operation, b: &Operation) -> bool {
    b.causal_parents.iter().any(|parent| parent == &a.op_id)
}

pub fn compare_ops(a: &Operation, b: &Operation) -> Ordering {
    if happened_before(a, b) {
        return Ordering::Less;
    }
    if happened_before(b, a) {
        return Ordering::Greater;
    }

    if a.time_range.upper_ms < b.time_range.lower_ms {
        return Ordering::Less;
    }
    if b.time_range.upper_ms < a.time_range.lower_ms {
        return Ordering::Greater;
    }

    match a.hlc.cmp(&b.hlc) {
        Ordering::Equal => a.op_id.cmp(&b.op_id),
        ord => ord,
    }
}

pub fn winner<'a>(a: &'a Operation, b: &'a Operation) -> &'a Operation {
    if compare_ops(a, b).is_lt() {
        b
    } else {
        a
    }
}

pub fn resolve_delete(delete_range: TimeRange, update_ranges: &[TimeRange]) -> DeleteDecision {
    if update_ranges.is_empty() {
        return DeleteDecision::KeepDeleted;
    }

    let max_update_upper = update_ranges
        .iter()
        .map(|range| range.upper_ms)
        .max()
        .unwrap_or(i64::MIN);

    if delete_range.lower_ms > max_update_upper {
        return DeleteDecision::KeepDeleted;
    }

    let has_certainly_newer_update = update_ranges
        .iter()
        .any(|range| delete_range.upper_ms < range.lower_ms);

    if has_certainly_newer_update {
        DeleteDecision::KeepActive
    } else {
        DeleteDecision::NeedsReview
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pass_domain::{FieldName, HybridLogicalClock, OpType, Operation};

    fn op(
        op_id: &str,
        parents: Vec<&str>,
        lower_ms: i64,
        upper_ms: i64,
        hlc_physical_ms: i64,
        hlc_logical: u32,
    ) -> Operation {
        Operation::new(
            op_id,
            "device_1",
            "apple.com20260305091530alice",
            FieldName::Password,
            OpType::Set,
            HybridLogicalClock::new(hlc_physical_ms, hlc_logical),
            TimeRange::new(lower_ms, upper_ms).expect("valid range"),
            parents.into_iter().map(ToString::to_string).collect(),
        )
        .expect("valid operation")
    }

    #[test]
    fn causal_parent_loses_to_child() {
        let older = op("a-1", vec![], 1000, 1010, 1005, 0);
        let newer = op("b-2", vec!["a-1"], 900, 920, 900, 0);

        assert_eq!(compare_ops(&older, &newer), Ordering::Less);
        assert_eq!(winner(&older, &newer).op_id, "b-2");
    }

    #[test]
    fn non_overlap_uses_time_range() {
        let older = op("a-1", vec![], 1000, 1010, 5000, 9);
        let newer = op("b-2", vec![], 1020, 1030, 100, 0);

        assert_eq!(compare_ops(&older, &newer), Ordering::Less);
    }

    #[test]
    fn overlap_uses_hlc_then_op_id() {
        let a = op("a-1", vec![], 1000, 1100, 2000, 1);
        let b = op("b-2", vec![], 1005, 1110, 2000, 2);
        assert_eq!(compare_ops(&a, &b), Ordering::Less);

        let c = op("c-1", vec![], 1000, 1100, 2000, 2);
        let d = op("d-1", vec![], 1000, 1100, 2000, 2);
        assert_eq!(compare_ops(&c, &d), Ordering::Less);
    }

    #[test]
    fn delete_decision_follows_spec() {
        let delete = TimeRange::new(200, 210).expect("valid range");
        let updates = vec![
            TimeRange::new(100, 120).expect("valid range"),
            TimeRange::new(130, 150).expect("valid range"),
        ];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::KeepDeleted);

        let delete = TimeRange::new(100, 110).expect("valid range");
        let updates = vec![
            TimeRange::new(90, 95).expect("valid range"),
            TimeRange::new(200, 210).expect("valid range"),
        ];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::KeepActive);

        let delete = TimeRange::new(100, 200).expect("valid range");
        let updates = vec![TimeRange::new(150, 220).expect("valid range")];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::NeedsReview);
    }
}

#[cfg(test)]
mod v2_golden_tests {
    use super::v2::{
        evaluate_sync_safety, merge_account_collections, merge_folder_collections,
        merge_passkey_collections, merge_sync_payloads, SyncPayload,
    };
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;

    fn golden_path() -> PathBuf {
        // crates/merge -> repo root docs/
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../docs/sync-golden-vectors.json")
    }

    fn load_golden() -> Value {
        let raw = fs::read_to_string(golden_path()).expect("read golden vectors");
        serde_json::from_str(&raw).expect("parse golden vectors")
    }

    fn payload_from(value: &Value) -> SyncPayload {
        serde_json::from_value(value.clone()).expect("payload shape")
    }

    #[test]
    fn golden_field_and_entity_merge() {
        let golden = load_golden();
        let case = golden["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["name"] == "field-and-entity-merge")
            .expect("case");
        let local = payload_from(&case["local"]);
        let remote = payload_from(&case["remote"]);
        let merged_accounts = merge_account_collections(local.accounts.clone(), remote.accounts.clone());
        let merged_folders = merge_folder_collections(local.folders.clone(), remote.folders.clone());
        let merged_passkeys = merge_passkey_collections(local.passkeys.clone(), remote.passkeys.clone());

        let accounts_by_account_id: std::collections::BTreeMap<_, _> = merged_accounts
            .iter()
            .map(|item| (item.account_id.clone(), item.clone()))
            .collect();
        let accounts_by_record: std::collections::BTreeMap<_, _> = merged_accounts
            .iter()
            .filter_map(|item| {
                item.record_id
                    .as_ref()
                    .map(|id| (id.clone(), item.clone()))
            })
            .collect();
        for expected in case["expected"]["accounts"].as_array().unwrap() {
            let account_id = expected
                .get("accountId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let record_id = expected
                .get("recordId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Production normalize rewrites non-UUID recordIds to stable hashes.
            // Prefer accountId lookup for golden fixtures that use stub ids.
            let actual = accounts_by_account_id
                .get(account_id)
                .or_else(|| accounts_by_record.get(record_id))
                .unwrap_or_else(|| panic!("missing account accountId={account_id} recordId={record_id}"));
            let actual_value = serde_json::to_value(actual).unwrap();
            for (key, value) in expected.as_object().unwrap() {
                if key == "recordId" && !super::v2::normalize::is_uuid_lower(value.as_str().unwrap_or("")) {
                    // Fixture stub ids are rewritten; ensure we still have some recordId.
                    assert!(
                        actual_value["recordId"].as_str().map(|s| !s.is_empty()).unwrap_or(false),
                        "account {account_id} missing rewritten recordId"
                    );
                    continue;
                }
                assert_eq!(
                    &actual_value[key], value,
                    "account {account_id} field {key}"
                );
            }
        }

        let folders_by_id: std::collections::BTreeMap<_, _> = merged_folders
            .iter()
            .map(|item| (item.id.clone(), item.clone()))
            .collect();
        for expected in case["expected"]["folders"].as_array().unwrap() {
            let mut id = expected["id"].as_str().unwrap().to_string();
            // Golden vectors authored against the JS test helper use a stub fixed
            // folder id ("fixed"). Production Rust injects the real policy UUID.
            if id == "fixed" {
                id = super::v2::FIXED_NEW_ACCOUNT_FOLDER_ID.to_string();
            }
            let actual = folders_by_id
                .get(&id)
                .unwrap_or_else(|| panic!("missing folder {id}"));
            let actual_value = serde_json::to_value(actual).unwrap();
            for (key, value) in expected.as_object().unwrap() {
                if key == "id" && expected["id"] == "fixed" {
                    assert_eq!(
                        actual_value["id"],
                        super::v2::FIXED_NEW_ACCOUNT_FOLDER_ID,
                        "folder fixed id"
                    );
                    continue;
                }
                assert_eq!(&actual_value[key], value, "folder {id} field {key}");
            }
        }

        let passkeys_by_id: std::collections::BTreeMap<_, _> = merged_passkeys
            .iter()
            .map(|item| (item.credential_id_b64u.clone(), item.clone()))
            .collect();
        for expected in case["expected"]["passkeys"].as_array().unwrap() {
            let id = expected["credentialIdB64u"].as_str().unwrap();
            let actual = passkeys_by_id
                .get(id)
                .unwrap_or_else(|| panic!("missing passkey {id}"));
            let actual_value = serde_json::to_value(actual).unwrap();
            for (key, value) in expected.as_object().unwrap() {
                assert_eq!(&actual_value[key], value, "passkey {id} field {key}");
            }
        }

        // Full payload merge should also preserve all three entity kinds.
        let merged = merge_sync_payloads(local, remote);
        assert_eq!(merged.accounts.len(), 3);
        assert!(merged.folders.iter().any(|f| f.id == "folder-main"));
        assert!(merged.passkeys.iter().any(|p| p.credential_id_b64u == "credential-local"));
    }

    #[test]
    fn golden_empty_remote_safety() {
        let golden = load_golden();
        let case = golden["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["name"] == "empty-remote-safety")
            .expect("case");
        let local = payload_from(&case["local"]);
        let remote = payload_from(&case["remote"]);
        let report = evaluate_sync_safety(&local, Some(&remote), &SyncPayload::default(), "remoteOverwriteLocal");
        assert_eq!(report.safe, case["expectedSafe"].as_bool().unwrap());
        assert_eq!(report.reasons[0], case["reason"].as_str().unwrap());
    }

    #[test]
    fn device_name_tie_break_is_deterministic() {
        let left: super::v2::PasswordAccount = serde_json::from_value(json!({
            "accountId": "a",
            "recordId": "r",
            "password": "left",
            "passwordUpdatedAtMs": 10,
            "passwordUpdatedDeviceName": "Device-A",
            "updatedAtMs": 10,
            "createdAtMs": 1
        }))
        .unwrap();
        let right: super::v2::PasswordAccount = serde_json::from_value(json!({
            "accountId": "a",
            "recordId": "r",
            "password": "right",
            "passwordUpdatedAtMs": 10,
            "passwordUpdatedDeviceName": "Device-B",
            "updatedAtMs": 10,
            "createdAtMs": 1
        }))
        .unwrap();
        let first = merge_account_collections(vec![left.clone()], vec![right.clone()]);
        let second = merge_account_collections(vec![right], vec![left]);
        assert_eq!(first[0].password, "right");
        assert_eq!(second[0].password, "right");
    }
}
