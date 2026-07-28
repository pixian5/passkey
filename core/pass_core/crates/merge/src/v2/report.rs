use serde::{Deserialize, Serialize};

pub const SYNC_REPORT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SyncSafetyStatus {
    Passed,
    Blocked,
    #[default]
    NotEvaluated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOperationReport {
    pub report_version: u32,
    pub ok: bool,
    pub dry_run: bool,
    pub mode: String,
    pub message: String,
    /// Backwards-compatible safety bit used by the existing shared UI.
    pub safe: bool,
    pub safety: SyncSafetyStatus,
    pub reasons: Vec<String>,
    pub local_accounts: usize,
    pub remote_accounts: usize,
    pub merged_accounts: usize,
    /// Backwards-compatible local/remote completion fields.
    pub applied: bool,
    pub pushed: bool,
    pub remote_pulled: bool,
    pub pending_retry: bool,
    pub retryable: bool,
    pub stage: String,
    pub source: String,
    pub sync_session_id: String,
    pub operation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
}

impl Default for SyncOperationReport {
    fn default() -> Self {
        Self {
            report_version: SYNC_REPORT_VERSION,
            ok: false,
            dry_run: false,
            mode: "merge".into(),
            message: String::new(),
            safe: false,
            safety: SyncSafetyStatus::NotEvaluated,
            reasons: Vec::new(),
            local_accounts: 0,
            remote_accounts: 0,
            merged_accounts: 0,
            applied: false,
            pushed: false,
            remote_pulled: false,
            pending_retry: false,
            retryable: false,
            stage: "idle".into(),
            source: String::new(),
            sync_session_id: String::new(),
            operation_id: String::new(),
            code: None,
            etag: None,
            revision: None,
        }
    }
}

impl SyncOperationReport {
    pub fn set_safety(&mut self, safe: bool) {
        self.safe = safe;
        self.safety = if safe {
            SyncSafetyStatus::Passed
        } else {
            SyncSafetyStatus::Blocked
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_keeps_legacy_and_structured_safety_in_sync() {
        let mut report = SyncOperationReport::default();
        report.set_safety(true);
        assert!(report.safe);
        assert_eq!(report.safety, SyncSafetyStatus::Passed);

        let value = serde_json::to_value(report).unwrap();
        assert_eq!(value["reportVersion"], SYNC_REPORT_VERSION);
        assert_eq!(value["safety"], "passed");
    }
}
