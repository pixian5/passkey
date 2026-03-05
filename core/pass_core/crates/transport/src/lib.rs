#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
    pub public_key_b64: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Macos,
    Linux,
    Ios,
    Android,
    Extension,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VectorEntry {
    pub device_id: String,
    pub max_counter: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VectorClock {
    pub entries: Vec<VectorEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairStartRequest {
    pub initiator_device_id: String,
    pub initiator_name: String,
    pub requested_by: PairRequester,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairRequester {
    Extension,
    DesktopUi,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairStartResponse {
    pub session_id: String,
    pub one_time_token: String,
    pub expires_at_ms: i64,
    pub agent_endpoint: String,
    pub agent_pubkey_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairConfirmRequest {
    pub session_id: String,
    pub one_time_token: String,
    pub device: DeviceInfo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairConfirmResponse {
    pub session_token: String,
    pub expires_at_ms: i64,
    pub peer_device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncPullRequest {
    pub vector_clock: VectorClock,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncPushRequest<T> {
    pub sync_session_id: String,
    pub ops: Vec<T>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncPullResponse<T> {
    pub sync_session_id: String,
    pub ops: Vec<T>,
    pub has_more: bool,
    pub server_vector_clock: VectorClock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncPushResponse {
    pub accepted_op_ids: Vec<String>,
    pub duplicated_op_ids: Vec<String>,
    pub rejected_op_ids: Vec<String>,
    pub conflicts: Vec<ConflictItem>,
    pub server_vector_clock: VectorClock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictItem {
    pub account_id: String,
    pub field_name: String,
    pub reason: String,
    pub review_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractError {
    EmptyField(&'static str),
    InvalidLimit(u32),
}

pub fn validate_pair_start(input: &PairStartRequest) -> Result<(), ContractError> {
    if input.initiator_device_id.is_empty() {
        return Err(ContractError::EmptyField("initiator_device_id"));
    }
    if input.initiator_name.is_empty() {
        return Err(ContractError::EmptyField("initiator_name"));
    }
    Ok(())
}

pub fn validate_sync_pull(input: &SyncPullRequest) -> Result<(), ContractError> {
    if input.limit == 0 {
        return Err(ContractError::InvalidLimit(0));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_pair_start_fields() {
        let request = PairStartRequest {
            initiator_device_id: String::new(),
            initiator_name: "ChromeMac".to_string(),
            requested_by: PairRequester::Extension,
        };

        let result = validate_pair_start(&request);
        assert!(matches!(
            result,
            Err(ContractError::EmptyField("initiator_device_id"))
        ));
    }

    #[test]
    fn rejects_zero_sync_pull_limit() {
        let request = SyncPullRequest {
            vector_clock: VectorClock { entries: vec![] },
            limit: 0,
        };

        let result = validate_sync_pull(&request);
        assert!(matches!(result, Err(ContractError::InvalidLimit(0))));
    }
}

