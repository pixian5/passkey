use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use super::policy::DEFAULT_DEVICE_NAME;

/// Accept `null` or missing as `T::default()` (Swift optional bools often encode null).
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountFolderMembershipState {
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_deleted: bool,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub device_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PasswordAccount {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub canonical_site: String,
    #[serde(default)]
    pub username_at_create: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_sort_order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regular_sort_order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_views: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub folder_ids: Vec<String>,
    #[serde(default)]
    pub folder_membership_states: BTreeMap<String, AccountFolderMembershipState>,
    #[serde(default)]
    pub sites: Vec<String>,
    #[serde(default)]
    pub site_alias_states: BTreeMap<String, AccountFolderMembershipState>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub totp_secret: String,
    #[serde(default)]
    pub recovery_codes: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub passkey_credential_ids: Vec<String>,
    #[serde(default)]
    pub passkey_link_states: BTreeMap<String, AccountFolderMembershipState>,
    #[serde(default)]
    pub username_updated_at_ms: i64,
    #[serde(default)]
    pub username_updated_device_name: String,
    #[serde(default)]
    pub password_updated_at_ms: i64,
    #[serde(default)]
    pub password_updated_device_name: String,
    #[serde(default)]
    pub totp_updated_at_ms: i64,
    #[serde(default)]
    pub totp_updated_device_name: String,
    #[serde(default)]
    pub recovery_codes_updated_at_ms: i64,
    #[serde(default)]
    pub recovery_codes_updated_device_name: String,
    #[serde(default)]
    pub note_updated_at_ms: i64,
    #[serde(default)]
    pub note_updated_device_name: String,
    #[serde(default)]
    pub passkey_updated_at_ms: i64,
    #[serde(default)]
    pub passkey_updated_device_name: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_deleted: bool,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_permanently_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<i64>,
    #[serde(default)]
    pub deleted_device_name: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default)]
    pub last_operated_device_name: String,
    #[serde(default)]
    pub created_device_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub matched_sites: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub auto_add_matching_sites: bool,
    /// Stable account record IDs in this folder's manual order. The array
    /// position is the regular sort order; account content remains elsewhere.
    #[serde(default)]
    pub regular_account_ids: Vec<String>,
    #[serde(default)]
    pub regular_order_updated_at_ms: i64,
    #[serde(default)]
    pub regular_order_updated_device_name: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_deleted: bool,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_permanently_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<i64>,
    #[serde(default)]
    pub deleted_device_name: String,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Passkey {
    #[serde(default)]
    pub credential_id_b64u: String,
    #[serde(default)]
    pub rp_id: String,
    #[serde(default)]
    pub user_name: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub user_handle_b64u: String,
    #[serde(default = "default_alg")]
    pub alg: i64,
    #[serde(default)]
    pub sign_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_jwk: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_jwk: Option<Value>,
    #[serde(default)]
    pub created_at_ms: i64,
    #[serde(default)]
    pub updated_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at_ms: Option<i64>,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub create_compat_method: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_deleted: bool,
    #[serde(default, deserialize_with = "null_as_default")]
    pub is_permanently_deleted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<i64>,
    #[serde(default)]
    pub deleted_device_name: String,
}

fn default_alg() -> i64 {
    -7
}

fn default_mode() -> String {
    "managed".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    #[serde(default)]
    pub accounts: Vec<PasswordAccount>,
    #[serde(default)]
    pub folders: Vec<Folder>,
    #[serde(default)]
    pub passkeys: Vec<Passkey>,
    /// Manual order for the virtual "all accounts" view. It is top-level
    /// because that view is not a user-created Folder.
    #[serde(default)]
    pub all_regular_account_ids: Vec<String>,
    #[serde(default)]
    pub all_regular_order_updated_at_ms: i64,
    #[serde(default)]
    pub all_regular_order_updated_device_name: String,
}

impl PasswordAccount {
    pub fn resolved_record_id(&self) -> String {
        self.record_id
            .as_deref()
            .or(self.id.as_deref())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
    }

    pub fn activity_at_ms(&self) -> i64 {
        self.updated_at_ms.max(self.created_at_ms)
    }

    pub fn passkey_activity_at_ms(&self) -> i64 {
        if self.passkey_updated_at_ms > 0 {
            self.passkey_updated_at_ms
        } else {
            self.activity_at_ms()
        }
    }

    pub fn fallback_device(&self) -> String {
        let last = self.last_operated_device_name.trim();
        if !last.is_empty() {
            last.to_string()
        } else {
            DEFAULT_DEVICE_NAME.to_string()
        }
    }
}
