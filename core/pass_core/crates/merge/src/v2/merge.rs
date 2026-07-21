use std::collections::BTreeMap;

use super::normalize::{
    etld_plus_one, first_non_empty, normalize_account_shape, normalize_folder_id,
    normalize_folder_id_list, normalize_folder_shape, normalize_passkey_credential_ids,
    normalize_passkey_create_compat_method, normalize_passkey_shape, normalize_sites,
    should_prefer_relation_state, sort_folders_for_display, stable_tie_value, stable_uuid_from_text,
};
use super::policy::{DEFAULT_DEVICE_NAME, FIXED_NEW_ACCOUNT_FOLDER_ID, FIXED_NEW_ACCOUNT_FOLDER_NAME};
use super::types::{
    AccountFolderMembershipState, Folder, Passkey, PasswordAccount, SyncPayload,
};

#[derive(Debug, Clone)]
struct FieldWinner {
    value: String,
    updated_at_ms: i64,
    device_name: String,
}

fn newer_field(
    lhs_value: &str,
    lhs_updated_at: i64,
    lhs_device_name: &str,
    lhs_account_updated_at: i64,
    rhs_value: &str,
    rhs_updated_at: i64,
    rhs_device_name: &str,
    rhs_account_updated_at: i64,
) -> FieldWinner {
    if lhs_updated_at > rhs_updated_at {
        return FieldWinner {
            value: lhs_value.to_string(),
            updated_at_ms: lhs_updated_at,
            device_name: lhs_device_name.to_string(),
        };
    }
    if rhs_updated_at > lhs_updated_at {
        return FieldWinner {
            value: rhs_value.to_string(),
            updated_at_ms: rhs_updated_at,
            device_name: rhs_device_name.to_string(),
        };
    }
    if lhs_value == rhs_value {
        return FieldWinner {
            value: lhs_value.to_string(),
            updated_at_ms: lhs_updated_at,
            device_name: first_non_empty(&[lhs_device_name, rhs_device_name], DEFAULT_DEVICE_NAME),
        };
    }
    // Field clocks tied: never let an empty credential erase a non-empty one.
    if lhs_value.is_empty() && !rhs_value.is_empty() {
        return FieldWinner {
            value: rhs_value.to_string(),
            updated_at_ms: rhs_updated_at,
            device_name: rhs_device_name.to_string(),
        };
    }
    if rhs_value.is_empty() && !lhs_value.is_empty() {
        return FieldWinner {
            value: lhs_value.to_string(),
            updated_at_ms: lhs_updated_at,
            device_name: lhs_device_name.to_string(),
        };
    }
    if lhs_account_updated_at > rhs_account_updated_at {
        return FieldWinner {
            value: lhs_value.to_string(),
            updated_at_ms: lhs_updated_at,
            device_name: lhs_device_name.to_string(),
        };
    }
    if rhs_account_updated_at > lhs_account_updated_at {
        return FieldWinner {
            value: rhs_value.to_string(),
            updated_at_ms: rhs_updated_at,
            device_name: rhs_device_name.to_string(),
        };
    }
    let left_device = stable_tie_value(lhs_device_name);
    let right_device = stable_tie_value(rhs_device_name);
    if left_device != right_device {
        return if left_device > right_device {
            FieldWinner {
                value: lhs_value.to_string(),
                updated_at_ms: lhs_updated_at,
                device_name: lhs_device_name.to_string(),
            }
        } else {
            FieldWinner {
                value: rhs_value.to_string(),
                updated_at_ms: rhs_updated_at,
                device_name: rhs_device_name.to_string(),
            }
        };
    }
    // Raw lexicographic order matches Swift `lhsValue >= rhsValue`.
    if lhs_value >= rhs_value {
        FieldWinner {
            value: lhs_value.to_string(),
            updated_at_ms: lhs_updated_at,
            device_name: lhs_device_name.to_string(),
        }
    } else {
        FieldWinner {
            value: rhs_value.to_string(),
            updated_at_ms: rhs_updated_at,
            device_name: rhs_device_name.to_string(),
        }
    }
}

fn merge_relation_states(
    left: &PasswordAccount,
    right: &PasswordAccount,
    left_map: &BTreeMap<String, AccountFolderMembershipState>,
    right_map: &BTreeMap<String, AccountFolderMembershipState>,
    left_values: &[String],
    right_values: &[String],
    normalize_key: impl Fn(&str) -> String,
) -> BTreeMap<String, AccountFolderMembershipState> {
    let collect = |account: &PasswordAccount,
                   map: &BTreeMap<String, AccountFolderMembershipState>,
                   values: &[String]| {
        let mut result = BTreeMap::new();
        for (raw_id, raw_state) in map {
            let id = normalize_key(raw_id);
            if id.is_empty() {
                continue;
            }
            let state = AccountFolderMembershipState {
                is_deleted: raw_state.is_deleted,
                updated_at_ms: if raw_state.updated_at_ms > 0 {
                    raw_state.updated_at_ms
                } else {
                    account.activity_at_ms()
                },
                device_name: first_non_empty(
                    &[&raw_state.device_name, &account.last_operated_device_name],
                    DEFAULT_DEVICE_NAME,
                ),
            };
            if let Some(current) = result.get(&id) {
                if should_prefer_relation_state(&state, current) {
                    result.insert(id, state);
                }
            } else {
                result.insert(id, state);
            }
        }
        for raw_id in values {
            let id = normalize_key(raw_id);
            if id.is_empty() || result.contains_key(&id) {
                continue;
            }
            result.insert(
                id,
                AccountFolderMembershipState {
                    is_deleted: false,
                    updated_at_ms: account.activity_at_ms(),
                    device_name: first_non_empty(
                        &[&account.last_operated_device_name],
                        DEFAULT_DEVICE_NAME,
                    ),
                },
            );
        }
        result
    };

    let mut merged = collect(left, left_map, left_values);
    for (id, incoming) in collect(right, right_map, right_values) {
        if let Some(current) = merged.get(&id) {
            if should_prefer_relation_state(&incoming, current) {
                merged.insert(id, incoming);
            }
        } else {
            merged.insert(id, incoming);
        }
    }
    merged
}

fn merge_folder_membership_states(
    left: &PasswordAccount,
    right: &PasswordAccount,
) -> BTreeMap<String, AccountFolderMembershipState> {
    merge_relation_states(
        left,
        right,
        &left.folder_membership_states,
        &right.folder_membership_states,
        &left.folder_ids,
        &right.folder_ids,
        |id| normalize_folder_id(id),
    )
}

fn merge_same_account(lhs: PasswordAccount, rhs: PasswordAccount) -> PasswordAccount {
    let left = normalize_account_shape(lhs);
    let right = normalize_account_shape(rhs);
    let (primary, secondary) = if left.created_at_ms <= right.created_at_ms {
        (&left, &right)
    } else {
        (&right, &left)
    };

    let site_alias_states = merge_relation_states(
        &left,
        &right,
        &left.site_alias_states,
        &right.site_alias_states,
        &left.sites,
        &right.sites,
        |id| id.trim().to_ascii_lowercase(),
    );
    let merged_sites = normalize_sites(
        &site_alias_states
            .iter()
            .filter(|(_, state)| !state.is_deleted)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
    );
    let canonical_by_sites = etld_plus_one(merged_sites.first().map(String::as_str).unwrap_or(""));
    let canonical_site = if !canonical_by_sites.is_empty() {
        canonical_by_sites
    } else if !primary.canonical_site.is_empty() {
        primary.canonical_site.clone()
    } else {
        secondary.canonical_site.clone()
    };

    let folder_membership_states = merge_folder_membership_states(&left, &right);
    let merged_folder_ids = normalize_folder_id_list(
        &folder_membership_states
            .iter()
            .filter(|(_, state)| !state.is_deleted)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
    );

    let username_field = newer_field(
        &left.username,
        left.username_updated_at_ms,
        &left.username_updated_device_name,
        left.updated_at_ms,
        &right.username,
        right.username_updated_at_ms,
        &right.username_updated_device_name,
        right.updated_at_ms,
    );
    let password_field = newer_field(
        &left.password,
        left.password_updated_at_ms,
        &left.password_updated_device_name,
        left.updated_at_ms,
        &right.password,
        right.password_updated_at_ms,
        &right.password_updated_device_name,
        right.updated_at_ms,
    );
    let totp_field = newer_field(
        &left.totp_secret,
        left.totp_updated_at_ms,
        &left.totp_updated_device_name,
        left.updated_at_ms,
        &right.totp_secret,
        right.totp_updated_at_ms,
        &right.totp_updated_device_name,
        right.updated_at_ms,
    );
    let recovery_field = newer_field(
        &left.recovery_codes,
        left.recovery_codes_updated_at_ms,
        &left.recovery_codes_updated_device_name,
        left.updated_at_ms,
        &right.recovery_codes,
        right.recovery_codes_updated_at_ms,
        &right.recovery_codes_updated_device_name,
        right.updated_at_ms,
    );
    let note_field = newer_field(
        &left.note,
        left.note_updated_at_ms,
        &left.note_updated_device_name,
        left.updated_at_ms,
        &right.note,
        right.note_updated_at_ms,
        &right.note_updated_device_name,
        right.updated_at_ms,
    );

    let passkey_link_states = merge_relation_states(
        &left,
        &right,
        &left.passkey_link_states,
        &right.passkey_link_states,
        &left.passkey_credential_ids,
        &right.passkey_credential_ids,
        |id| id.trim().to_string(),
    );
    let merged_passkey_ids = normalize_passkey_credential_ids(
        &passkey_link_states
            .iter()
            .filter(|(_, state)| !state.is_deleted)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
    );
    let left_passkey_at = left.passkey_activity_at_ms();
    let right_passkey_at = right.passkey_activity_at_ms();
    let passkey_updated_at_ms = left_passkey_at.max(right_passkey_at);
    let passkey_updated_device_name = if left_passkey_at >= right_passkey_at {
        first_non_empty(
            &[&left.passkey_updated_device_name, &left.last_operated_device_name],
            DEFAULT_DEVICE_NAME,
        )
    } else {
        first_non_empty(
            &[
                &right.passkey_updated_device_name,
                &right.last_operated_device_name,
            ],
            DEFAULT_DEVICE_NAME,
        )
    };

    let latest_content_updated_at = username_field
        .updated_at_ms
        .max(password_field.updated_at_ms)
        .max(totp_field.updated_at_ms)
        .max(recovery_field.updated_at_ms)
        .max(note_field.updated_at_ms)
        .max(passkey_updated_at_ms);

    let left_deleted_at = if left.is_deleted {
        left.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let right_deleted_at = if right.is_deleted {
        right.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let latest_deleted_at = left_deleted_at.max(right_deleted_at);
    let latest_activity_at = latest_content_updated_at
        .max(left.updated_at_ms)
        .max(right.updated_at_ms);
    let keep_deleted = latest_deleted_at > 0 && latest_deleted_at >= latest_activity_at;
    let keep_permanently_deleted = left.is_permanently_deleted || right.is_permanently_deleted;
    let deleted_device_name = if left_deleted_at >= right_deleted_at {
        left.deleted_device_name.trim().to_string()
    } else {
        right.deleted_device_name.trim().to_string()
    };

    let (newer_account, older_account) = if left.updated_at_ms >= right.updated_at_ms {
        (&left, &right)
    } else {
        (&right, &left)
    };

    let created_at_ms = left.created_at_ms.min(right.created_at_ms);
    let updated_at_ms = left
        .updated_at_ms
        .max(right.updated_at_ms)
        .max(latest_content_updated_at)
        .max(latest_deleted_at)
        .max(created_at_ms);

    let username_at_create = first_non_empty(
        &[
            &primary.username_at_create,
            &secondary.username_at_create,
            &primary.username,
            &secondary.username,
        ],
        "",
    );
    let created_device_name = first_non_empty(
        &[
            &primary.created_device_name,
            &secondary.created_device_name,
            &primary.last_operated_device_name,
            &secondary.last_operated_device_name,
        ],
        DEFAULT_DEVICE_NAME,
    );
    let last_operated_device_name = first_non_empty(
        &[
            &newer_account.last_operated_device_name,
            &older_account.last_operated_device_name,
        ],
        DEFAULT_DEVICE_NAME,
    );

    let record_id = primary
        .record_id
        .clone()
        .or_else(|| left.record_id.clone())
        .or_else(|| right.record_id.clone())
        .unwrap_or_else(|| {
            stable_uuid_from_text(&format!("{}|{}", primary.account_id, created_at_ms))
        });

    PasswordAccount {
        record_id: Some(record_id.clone()),
        id: Some(record_id),
        account_id: primary.account_id.clone(),
        canonical_site,
        username_at_create,
        is_pinned: newer_account.is_pinned,
        pinned_sort_order: newer_account.pinned_sort_order,
        regular_sort_order: newer_account.regular_sort_order,
        pinned_views: newer_account
            .pinned_views
            .clone()
            .or_else(|| older_account.pinned_views.clone()),
        folder_id: merged_folder_ids.first().cloned().or_else(|| {
            newer_account
                .folder_id
                .as_ref()
                .map(|id| normalize_folder_id(id))
                .filter(|id| !id.is_empty())
        }),
        folder_ids: merged_folder_ids,
        folder_membership_states,
        sites: merged_sites,
        site_alias_states,
        username: username_field.value,
        password: password_field.value,
        totp_secret: totp_field.value,
        recovery_codes: recovery_field.value,
        note: note_field.value,
        passkey_credential_ids: merged_passkey_ids,
        passkey_link_states,
        username_updated_at_ms: username_field.updated_at_ms,
        username_updated_device_name: username_field.device_name,
        password_updated_at_ms: password_field.updated_at_ms,
        password_updated_device_name: password_field.device_name,
        totp_updated_at_ms: totp_field.updated_at_ms,
        totp_updated_device_name: totp_field.device_name,
        recovery_codes_updated_at_ms: recovery_field.updated_at_ms,
        recovery_codes_updated_device_name: recovery_field.device_name,
        note_updated_at_ms: note_field.updated_at_ms,
        note_updated_device_name: note_field.device_name,
        passkey_updated_at_ms,
        passkey_updated_device_name,
        is_deleted: keep_permanently_deleted || keep_deleted,
        is_permanently_deleted: keep_permanently_deleted,
        deleted_at_ms: if keep_permanently_deleted || keep_deleted {
            Some(if latest_deleted_at == 0 {
                updated_at_ms
            } else {
                latest_deleted_at
            })
        } else {
            None
        },
        deleted_device_name: if keep_permanently_deleted || keep_deleted {
            first_non_empty(&[&deleted_device_name, &last_operated_device_name], DEFAULT_DEVICE_NAME)
        } else {
            String::new()
        },
        created_at_ms,
        updated_at_ms,
        last_operated_device_name,
        created_device_name,
    }
}

fn merge_same_passkey(lhs: Passkey, rhs: Passkey) -> Passkey {
    let left = normalize_passkey_shape(lhs);
    let right = normalize_passkey_shape(rhs);
    let left_updated = if left.updated_at_ms > 0 {
        left.updated_at_ms
    } else {
        left.created_at_ms
    };
    let right_updated = if right.updated_at_ms > 0 {
        right.updated_at_ms
    } else {
        right.created_at_ms
    };
    let left_deleted_at = if left.is_deleted {
        left.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let right_deleted_at = if right.is_deleted {
        right.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let latest_deleted_at = left_deleted_at.max(right_deleted_at);
    let keep_permanently_deleted = left.is_permanently_deleted || right.is_permanently_deleted;
    let keep_deleted = keep_permanently_deleted
        || (latest_deleted_at > 0 && latest_deleted_at >= left_updated.max(right_updated));
    let deleted_device_name = if left_deleted_at >= right_deleted_at {
        left.deleted_device_name.trim().to_string()
    } else {
        right.deleted_device_name.trim().to_string()
    };
    let (newer, older) = if left_updated >= right_updated {
        (&left, &right)
    } else {
        (&right, &left)
    };
    let resolved_alg = if newer.alg != 0 {
        newer.alg
    } else if older.alg != 0 {
        older.alg
    } else {
        -7
    };

    Passkey {
        credential_id_b64u: if !newer.credential_id_b64u.is_empty() {
            newer.credential_id_b64u.clone()
        } else {
            older.credential_id_b64u.clone()
        },
        rp_id: if !newer.rp_id.is_empty() {
            newer.rp_id.clone()
        } else {
            older.rp_id.clone()
        },
        user_name: if !newer.user_name.is_empty() {
            newer.user_name.clone()
        } else {
            older.user_name.clone()
        },
        display_name: if !newer.display_name.is_empty() {
            newer.display_name.clone()
        } else {
            older.display_name.clone()
        },
        user_handle_b64u: if !newer.user_handle_b64u.is_empty() {
            newer.user_handle_b64u.clone()
        } else {
            older.user_handle_b64u.clone()
        },
        alg: if newer.alg != 0 { newer.alg } else { older.alg },
        sign_count: left.sign_count.max(right.sign_count),
        private_jwk: newer.private_jwk.clone().or_else(|| older.private_jwk.clone()),
        public_jwk: newer.public_jwk.clone().or_else(|| older.public_jwk.clone()),
        created_at_ms: left.created_at_ms.min(right.created_at_ms),
        updated_at_ms: left_updated.max(right_updated),
        last_used_at_ms: {
            let max = left
                .last_used_at_ms
                .unwrap_or(0)
                .max(right.last_used_at_ms.unwrap_or(0));
            if max > 0 {
                Some(max)
            } else {
                None
            }
        },
        mode: if !newer.mode.is_empty() {
            newer.mode.clone()
        } else if !older.mode.is_empty() {
            older.mode.clone()
        } else {
            "managed".to_string()
        },
        create_compat_method: normalize_passkey_create_compat_method(
            if !newer.create_compat_method.is_empty() {
                &newer.create_compat_method
            } else {
                &older.create_compat_method
            },
            resolved_alg,
        ),
        is_deleted: keep_deleted,
        is_permanently_deleted: keep_permanently_deleted,
        deleted_at_ms: if keep_deleted {
            Some(if latest_deleted_at == 0 {
                left_updated.max(right_updated)
            } else {
                latest_deleted_at
            })
        } else {
            None
        },
        deleted_device_name: if keep_deleted {
            first_non_empty(&[&deleted_device_name], DEFAULT_DEVICE_NAME)
        } else {
            String::new()
        },
    }
}

fn merge_same_folder(lhs: Folder, rhs: Folder) -> Folder {
    let left = normalize_folder_shape(lhs);
    let right = normalize_folder_shape(rhs);
    let id = if !left.id.is_empty() {
        left.id.clone()
    } else {
        right.id.clone()
    };
    let left_updated_at = if left.updated_at_ms != 0 {
        left.updated_at_ms
    } else {
        left.created_at_ms
    };
    let right_updated_at = if right.updated_at_ms != 0 {
        right.updated_at_ms
    } else {
        right.created_at_ms
    };
    let left_deleted_at = if left.is_deleted {
        left.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let right_deleted_at = if right.is_deleted {
        right.deleted_at_ms.unwrap_or(0)
    } else {
        0
    };
    let latest_deleted_at = left_deleted_at.max(right_deleted_at);
    let keep_permanently_deleted = left.is_permanently_deleted || right.is_permanently_deleted;
    let keep_deleted = keep_permanently_deleted
        || (latest_deleted_at > 0 && latest_deleted_at >= left_updated_at.max(right_updated_at));
    let deleted_device_name = if left_deleted_at >= right_deleted_at {
        left.deleted_device_name.trim().to_string()
    } else {
        right.deleted_device_name.trim().to_string()
    };

    if id == FIXED_NEW_ACCOUNT_FOLDER_ID {
        return Folder {
            id,
            name: FIXED_NEW_ACCOUNT_FOLDER_NAME.to_string(),
            matched_sites: if right_updated_at >= left_updated_at {
                right.matched_sites
            } else {
                left.matched_sites
            },
            auto_add_matching_sites: if right_updated_at >= left_updated_at {
                right.auto_add_matching_sites
            } else {
                left.auto_add_matching_sites
            },
            is_deleted: false,
            is_permanently_deleted: false,
            deleted_at_ms: None,
            deleted_device_name: String::new(),
            created_at_ms: left.created_at_ms.min(right.created_at_ms),
            updated_at_ms: left_updated_at.max(right_updated_at),
        };
    }

    let left_name = left.name.trim().to_string();
    let right_name = right.name.trim().to_string();
    let mut name = if !left_name.is_empty() {
        left_name.clone()
    } else if !right_name.is_empty() {
        right_name.clone()
    } else {
        format!("未命名文件夹 {}", &id.chars().take(8).collect::<String>())
    };
    if right_updated_at > left_updated_at && !right_name.is_empty() {
        name = right_name;
    } else if left_updated_at > right_updated_at && !left_name.is_empty() {
        name = left_name;
    }

    Folder {
        id,
        name,
        matched_sites: if right_updated_at > left_updated_at {
            right.matched_sites
        } else {
            left.matched_sites
        },
        auto_add_matching_sites: if right_updated_at > left_updated_at {
            right.auto_add_matching_sites
        } else {
            left.auto_add_matching_sites
        },
        is_deleted: keep_deleted,
        is_permanently_deleted: keep_permanently_deleted,
        deleted_at_ms: if keep_deleted {
            Some(if latest_deleted_at == 0 {
                left_updated_at.max(right_updated_at)
            } else {
                latest_deleted_at
            })
        } else {
            None
        },
        deleted_device_name: if keep_deleted {
            first_non_empty(&[&deleted_device_name], DEFAULT_DEVICE_NAME)
        } else {
            String::new()
        },
        created_at_ms: left.created_at_ms.min(right.created_at_ms),
        updated_at_ms: left_updated_at.max(right_updated_at),
    }
}

pub fn merge_account_collections(
    local: Vec<PasswordAccount>,
    remote: Vec<PasswordAccount>,
) -> Vec<PasswordAccount> {
    let mut merged: Vec<PasswordAccount> = Vec::new();
    for account in local.into_iter().chain(remote.into_iter()) {
        let normalized = normalize_account_shape(account);
        let account_id = normalized.account_id.trim().to_string();
        let record_id = normalized.resolved_record_id();
        if account_id.is_empty() && record_id.is_empty() {
            continue;
        }
        if let Some(existing_index) = merged.iter().position(|candidate| {
            let candidate_account_id = candidate.account_id.trim();
            let candidate_record_id = candidate.resolved_record_id();
            (!account_id.is_empty() && candidate_account_id == account_id)
                || (!record_id.is_empty() && candidate_record_id == record_id)
        }) {
            let existing = merged[existing_index].clone();
            merged[existing_index] = merge_same_account(existing, normalized);
        } else {
            merged.push(normalized);
        }
    }
    merged
}

pub fn merge_passkey_collections(local: Vec<Passkey>, remote: Vec<Passkey>) -> Vec<Passkey> {
    let mut merged_by_id: BTreeMap<String, Passkey> = BTreeMap::new();
    for passkey in local.into_iter().chain(remote.into_iter()) {
        let normalized = normalize_passkey_shape(passkey);
        let id = normalized.credential_id_b64u.trim().to_string();
        if id.is_empty() {
            continue;
        }
        if let Some(existing) = merged_by_id.remove(&id) {
            merged_by_id.insert(id, merge_same_passkey(existing, normalized));
        } else {
            merged_by_id.insert(id, normalized);
        }
    }
    let mut values: Vec<Passkey> = merged_by_id.into_values().collect();
    values.sort_by(|a, b| {
        let left = if a.updated_at_ms > 0 {
            a.updated_at_ms
        } else {
            a.created_at_ms
        };
        let right = if b.updated_at_ms > 0 {
            b.updated_at_ms
        } else {
            b.created_at_ms
        };
        right
            .cmp(&left)
            .then_with(|| a.credential_id_b64u.cmp(&b.credential_id_b64u))
    });
    values
}

pub fn merge_folder_collections(local: Vec<Folder>, remote: Vec<Folder>) -> Vec<Folder> {
    let mut merged: BTreeMap<String, Folder> = BTreeMap::new();
    for folder in local.into_iter().chain(remote.into_iter()) {
        let normalized = normalize_folder_shape(folder);
        let id = normalize_folder_id(&normalized.id);
        if id.is_empty() {
            continue;
        }
        if let Some(existing) = merged.remove(&id) {
            merged.insert(id, merge_same_folder(existing, normalized));
        } else {
            merged.insert(id, normalized);
        }
    }

    let fixed_id = FIXED_NEW_ACCOUNT_FOLDER_ID.to_string();
    if let Some(existing) = merged.remove(&fixed_id) {
        merged.insert(
            fixed_id.clone(),
            Folder {
                id: fixed_id.clone(),
                name: FIXED_NEW_ACCOUNT_FOLDER_NAME.to_string(),
                matched_sites: existing.matched_sites,
                auto_add_matching_sites: existing.auto_add_matching_sites,
                is_deleted: existing.is_deleted,
                is_permanently_deleted: existing.is_permanently_deleted,
                deleted_at_ms: existing.deleted_at_ms,
                deleted_device_name: existing.deleted_device_name,
                created_at_ms: existing.created_at_ms,
                updated_at_ms: existing.updated_at_ms,
            },
        );
    } else {
        merged.insert(
            fixed_id.clone(),
            normalize_folder_shape(Folder {
                id: fixed_id,
                name: FIXED_NEW_ACCOUNT_FOLDER_NAME.to_string(),
                created_at_ms: 0,
                updated_at_ms: 0,
                ..Folder::default()
            }),
        );
    }

    sort_folders_for_display(merged.into_values().collect())
}

pub fn reconcile_account_folders(
    accounts: Vec<PasswordAccount>,
    folders: &[Folder],
    now_ms: i64,
) -> Vec<PasswordAccount> {
    let valid_ids: std::collections::BTreeSet<String> = folders
        .iter()
        .filter(|folder| !folder.is_deleted)
        .map(|folder| normalize_folder_id(&folder.id))
        .filter(|id| !id.is_empty())
        .collect();

    accounts
        .into_iter()
        .map(|account| {
            let mut normalized = normalize_account_shape(account);
            let previous_ids = normalize_folder_id_list(&normalized.folder_ids);
            let resolved: Vec<String> = previous_ids
                .iter()
                .cloned()
                .filter(|id| valid_ids.contains(id))
                .collect();
            let previous_set: std::collections::BTreeSet<_> =
                previous_ids.iter().cloned().collect();
            let resolved_set: std::collections::BTreeSet<_> = resolved.iter().cloned().collect();
            let tombstone_at = normalized
                .updated_at_ms
                .max(normalized.created_at_ms)
                .max(now_ms);
            let device_name = first_non_empty(
                &[&normalized.last_operated_device_name],
                DEFAULT_DEVICE_NAME,
            );
            for id in &previous_set {
                if id.is_empty() || resolved_set.contains(id) {
                    continue;
                }
                let existing = normalized.folder_membership_states.get(id).cloned();
                normalized.folder_membership_states.insert(
                    id.clone(),
                    AccountFolderMembershipState {
                        is_deleted: true,
                        updated_at_ms: existing
                            .as_ref()
                            .map(|s| s.updated_at_ms)
                            .unwrap_or(0)
                            .max(tombstone_at),
                        device_name: first_non_empty(
                            &[
                                existing
                                    .as_ref()
                                    .map(|s| s.device_name.as_str())
                                    .unwrap_or(""),
                                &device_name,
                            ],
                            DEFAULT_DEVICE_NAME,
                        ),
                    },
                );
            }
            for id in &resolved_set {
                if id.is_empty() {
                    continue;
                }
                let existing = normalized.folder_membership_states.get(id).cloned();
                if existing.as_ref().map(|s| s.is_deleted).unwrap_or(true) {
                    normalized.folder_membership_states.insert(
                        id.clone(),
                        AccountFolderMembershipState {
                            is_deleted: false,
                            updated_at_ms: existing
                                .as_ref()
                                .map(|s| s.updated_at_ms)
                                .unwrap_or(0)
                                .max(tombstone_at),
                            device_name: first_non_empty(
                                &[
                                    existing
                                        .as_ref()
                                        .map(|s| s.device_name.as_str())
                                        .unwrap_or(""),
                                    &device_name,
                                ],
                                DEFAULT_DEVICE_NAME,
                            ),
                        },
                    );
                }
            }
            normalized.folder_ids = resolved.clone();
            normalized.folder_id = resolved.first().cloned();
            normalized
        })
        .collect()
}

pub fn merge_sync_payloads(local: SyncPayload, remote: SyncPayload) -> SyncPayload {
    let accounts = merge_account_collections(local.accounts, remote.accounts);
    let folders = merge_folder_collections(local.folders, remote.folders);
    let passkeys = merge_passkey_collections(local.passkeys, remote.passkeys);
    // Reconcile without wall-clock so pure merge stays deterministic for golden vectors.
    let accounts = reconcile_account_folders(accounts, &folders, 0);
    SyncPayload {
        accounts,
        folders,
        passkeys,
    }
}
