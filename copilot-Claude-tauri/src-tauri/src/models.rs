// Data models for the password manager
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordAccount {
    pub id: String,
    pub account_id: String,
    pub canonical_site: String,
    pub sites: Vec<String>,
    pub username: String,
    pub password: String,
    pub totp_secret: Option<String>,
    pub recovery_codes: Option<String>,
    pub note: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountFolder {
    pub id: String,
    pub name: String,
    pub matched_sites: Vec<String>,
    pub auto_add_matching: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyRecord {
    pub credential_id: String,
    pub rp_id: String,
    pub user_name: String,
    pub display_name: Option<String>,
    pub user_handle: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}
