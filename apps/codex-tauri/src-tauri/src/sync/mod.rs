//! Self-hosted sync: HTTP, optional AES-GCM envelope, merge pipeline.
//! Merge authority: `pass_merge::v2` only.

pub mod crypto;
pub mod http;
pub mod pipeline;
pub mod settings;
pub mod webdav;

pub use crypto::{generate_sync_key, is_valid_sync_key};
