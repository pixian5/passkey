//! Self-hosted sync: HTTP, optional AES-GCM envelope, merge pipeline.
//! Merge authority: `pass_merge::v2` only.

mod crypto;
mod http;
pub mod pipeline;
pub mod settings;

pub use crypto::{generate_sync_key, is_valid_sync_key};
