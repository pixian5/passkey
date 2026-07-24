//! Shared local vault mutation helpers.
//! Surfaces should call these instead of hand-rolling delete/restore field writes.

use super::types::PasswordAccount;

/// Soft-delete an account into recycle bin. Returns false if already deleted/permanent.
pub fn soft_delete_account(
    account: &mut PasswordAccount,
    now_ms: i64,
    device_name: &str,
) -> bool {
    if account.is_deleted || account.is_permanently_deleted {
        return false;
    }
    account.is_deleted = true;
    account.deleted_at_ms = Some(now_ms);
    account.deleted_device_name = device_name.to_string();
    account.updated_at_ms = now_ms;
    account.last_operated_device_name = device_name.to_string();
    true
}

/// Permanent-delete tombstone. Clears sensitive secrets but keeps stable IDs.
pub fn permanently_delete_account(
    account: &mut PasswordAccount,
    now_ms: i64,
    device_name: &str,
) -> bool {
    if account.is_permanently_deleted {
        return false;
    }
    account.is_deleted = true;
    account.is_permanently_deleted = true;
    account.deleted_at_ms = Some(now_ms);
    account.deleted_device_name = device_name.to_string();
    account.updated_at_ms = now_ms;
    account.last_operated_device_name = device_name.to_string();
    account.password.clear();
    account.totp_secret.clear();
    account.recovery_codes.clear();
    true
}

/// Restore a non-permanent deleted account. Does not reorder lists.
pub fn restore_account_fields(
    account: &mut PasswordAccount,
    now_ms: i64,
    device_name: &str,
) -> Result<bool, String> {
    if account.is_permanently_deleted {
        return Err("已永久删除的账号不能恢复".into());
    }
    if !account.is_deleted {
        return Ok(false);
    }
    account.is_deleted = false;
    account.deleted_at_ms = None;
    account.deleted_device_name.clear();
    account.updated_at_ms = now_ms;
    account.last_operated_device_name = device_name.to_string();
    Ok(true)
}

/// Apply pin/unpin with stable max+1 order for newly pinned accounts.
pub fn set_account_pinned(
    account: &mut PasswordAccount,
    pinned: bool,
    next_pin_order: Option<i64>,
    now_ms: i64,
    device_name: &str,
) -> Result<(), String> {
    if account.is_deleted || account.is_permanently_deleted {
        return Err("回收站账号不支持置顶".into());
    }
    if pinned {
        if !account.is_pinned {
            account.pinned_sort_order = next_pin_order.or(Some(0));
        }
        account.is_pinned = true;
    } else {
        account.is_pinned = false;
        account.pinned_sort_order = None;
    }
    account.updated_at_ms = now_ms;
    account.last_operated_device_name = device_name.to_string();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PasswordAccount {
        PasswordAccount {
            record_id: Some("acc-1".into()),
            password: "secret".into(),
            totp_secret: "totp".into(),
            recovery_codes: "codes".into(),
            ..Default::default()
        }
    }

    #[test]
    fn soft_then_permanent_keeps_id_and_clears_secrets() {
        let mut account = sample();
        assert!(soft_delete_account(&mut account, 10, "A"));
        assert!(account.is_deleted);
        assert!(!account.is_permanently_deleted);
        assert_eq!(account.deleted_at_ms, Some(10));
        assert!(permanently_delete_account(&mut account, 20, "B"));
        assert!(account.is_permanently_deleted);
        assert_eq!(account.resolved_record_id(), "acc-1");
        assert!(account.password.is_empty());
        assert!(account.totp_secret.is_empty());
        assert!(account.recovery_codes.is_empty());
        assert_eq!(account.deleted_device_name, "B");
    }

    #[test]
    fn restore_clears_delete_markers_but_rejects_permanent() {
        let mut account = sample();
        soft_delete_account(&mut account, 10, "A");
        assert_eq!(restore_account_fields(&mut account, 11, "A").unwrap(), true);
        assert!(!account.is_deleted);
        assert_eq!(account.deleted_at_ms, None);
        permanently_delete_account(&mut account, 12, "A");
        assert!(restore_account_fields(&mut account, 13, "A").is_err());
    }

    #[test]
    fn pin_sets_order_and_rejects_deleted() {
        let mut account = sample();
        set_account_pinned(&mut account, true, Some(3), 30, "C").unwrap();
        assert!(account.is_pinned);
        assert_eq!(account.pinned_sort_order, Some(3));
        set_account_pinned(&mut account, false, None, 31, "C").unwrap();
        assert!(!account.is_pinned);
        assert_eq!(account.pinned_sort_order, None);
        soft_delete_account(&mut account, 32, "C");
        assert!(set_account_pinned(&mut account, true, Some(1), 33, "C").is_err());
    }
}
