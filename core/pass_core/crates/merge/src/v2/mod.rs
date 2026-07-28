//! Production sync merge for `pass.sync.bundle.v2` field-LWW payloads.
//!
//! This is the shared-core authority for account / folder / passkey merge.
//! Browser JS (`sync_merge_core.js`) and macOS Swift should match these semantics
//! (and eventually call this crate via FFI/WASM instead of reimplementing).

mod alias;
mod merge;
pub mod mutate;
pub mod normalize;
mod policy;
mod report;
mod safety;
mod types;

pub use alias::sync_alias_groups;
pub use merge::{
    apply_folder_order, merge_account_collections, merge_folder_collections,
    merge_passkey_collections, merge_sync_payloads, normalize_all_regular_order,
    normalize_folder_regular_order, normalize_folder_regular_orders, reconcile_account_folders,
};
pub use policy::{
    DEFAULT_DEVICE_NAME, ETLD2_SUFFIXES, FIXED_NEW_ACCOUNT_FOLDER_ID, FIXED_NEW_ACCOUNT_FOLDER_NAME,
};
pub use report::{SyncOperationReport, SyncSafetyStatus, SYNC_REPORT_VERSION};
pub use safety::{evaluate_sync_safety, SyncSafetyReport};
pub use types::{AccountFolderMembershipState, Folder, Passkey, PasswordAccount, SyncPayload};

pub use mutate::{
    mark_folder_membership, permanently_delete_account, permanently_delete_folder,
    restore_account_fields, set_account_pinned, soft_delete_account,
};
