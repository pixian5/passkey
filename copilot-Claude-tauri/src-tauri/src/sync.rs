// Sync functionality for WebDAV and self-hosted server
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::models::PasswordAccount;
use crate::SyncConfig;

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncBundle {
    pub version: String,
    pub device_id: String,
    pub timestamp: i64,
    pub accounts: Vec<PasswordAccount>,
}

pub struct SyncManager {
    client: Client,
}

impl SyncManager {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub async fn sync_with_server(
        &self,
        config: &SyncConfig,
        local_accounts: Vec<PasswordAccount>,
    ) -> Result<Vec<PasswordAccount>, String> {
        match config.backend_type.as_str() {
            "webdav" => self.sync_webdav(config, local_accounts).await,
            "self-hosted" => self.sync_self_hosted(config, local_accounts).await,
            _ => Err("Unsupported sync backend".to_string()),
        }
    }

    async fn sync_webdav(
        &self,
        config: &SyncConfig,
        local_accounts: Vec<PasswordAccount>,
    ) -> Result<Vec<PasswordAccount>, String> {
        // WebDAV sync implementation
        let bundle = SyncBundle {
            version: "0.1.0".to_string(),
            device_id: hostname::get()
                .ok()
                .and_then(|h| h.into_string().ok())
                .unwrap_or_else(|| "unknown".to_string()),
            timestamp: chrono::Utc::now().timestamp_millis(),
            accounts: local_accounts.clone(),
        };

        let json = serde_json::to_string(&bundle).map_err(|e| e.to_string())?;

        // PUT to WebDAV server
        let mut request = self.client.put(&config.server_url).body(json);

        if let (Some(username), Some(password)) = (&config.username, &config.password) {
            request = request.basic_auth(username, Some(password));
        }

        let response = request.send().await.map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("WebDAV sync failed: {}", response.status()));
        }

        // For now, return local accounts as we need full merge logic
        Ok(local_accounts)
    }

    async fn sync_self_hosted(
        &self,
        config: &SyncConfig,
        local_accounts: Vec<PasswordAccount>,
    ) -> Result<Vec<PasswordAccount>, String> {
        // Self-hosted server sync implementation
        let bundle = SyncBundle {
            version: "0.1.0".to_string(),
            device_id: hostname::get()
                .ok()
                .and_then(|h| h.into_string().ok())
                .unwrap_or_else(|| "unknown".to_string()),
            timestamp: chrono::Utc::now().timestamp_millis(),
            accounts: local_accounts.clone(),
        };

        let mut request = self
            .client
            .post(format!("{}/sync", config.server_url))
            .json(&bundle);

        if let Some(token) = &config.bearer_token {
            request = request.bearer_auth(token);
        }

        let response = request.send().await.map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            return Err(format!("Self-hosted sync failed: {}", response.status()));
        }

        let remote_bundle: SyncBundle = response.json().await.map_err(|e| e.to_string())?;

        // For now, return remote accounts (merge logic would go here)
        Ok(remote_bundle.accounts)
    }
}

impl Default for SyncManager {
    fn default() -> Self {
        Self::new()
    }
}
