use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelError {
    EmptyField(&'static str),
    InvalidTimeRange { lower_ms: i64, upper_ms: i64 },
}

impl Display for ModelError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyField(name) => write!(f, "field `{name}` must not be empty"),
            Self::InvalidTimeRange { lower_ms, upper_ms } => {
                write!(
                    f,
                    "invalid time range: lower_ms ({lower_ms}) must be <= upper_ms ({upper_ms})"
                )
            }
        }
    }
}

impl std::error::Error for ModelError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldName {
    Username,
    Password,
    Totp,
    RecoveryCodes,
    Note,
    Sites,
    DeleteFlag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpType {
    Set,
    Delete,
    Undelete,
    AddAlias,
    RemoveAlias,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct HybridLogicalClock {
    pub physical_ms: i64,
    pub logical: u32,
}

impl HybridLogicalClock {
    pub fn new(physical_ms: i64, logical: u32) -> Self {
        Self {
            physical_ms,
            logical,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeRange {
    pub lower_ms: i64,
    pub upper_ms: i64,
}

impl TimeRange {
    pub fn new(lower_ms: i64, upper_ms: i64) -> Result<Self, ModelError> {
        if lower_ms > upper_ms {
            return Err(ModelError::InvalidTimeRange { lower_ms, upper_ms });
        }
        Ok(Self { lower_ms, upper_ms })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Operation {
    pub op_id: String,
    pub device_id: String,
    pub account_id: String,
    pub field_name: FieldName,
    pub op_type: OpType,
    pub hlc: HybridLogicalClock,
    pub time_range: TimeRange,
    pub causal_parents: Vec<String>,
}

impl Operation {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        op_id: impl Into<String>,
        device_id: impl Into<String>,
        account_id: impl Into<String>,
        field_name: FieldName,
        op_type: OpType,
        hlc: HybridLogicalClock,
        time_range: TimeRange,
        causal_parents: Vec<String>,
    ) -> Result<Self, ModelError> {
        let op_id = op_id.into();
        let device_id = device_id.into();
        let account_id = account_id.into();

        if op_id.is_empty() {
            return Err(ModelError::EmptyField("op_id"));
        }
        if device_id.is_empty() {
            return Err(ModelError::EmptyField("device_id"));
        }
        if account_id.is_empty() {
            return Err(ModelError::EmptyField("account_id"));
        }

        Ok(Self {
            op_id,
            device_id,
            account_id,
            field_name,
            op_type,
            hlc,
            time_range,
            causal_parents,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_time_range() {
        let result = TimeRange::new(10, 9);
        assert!(matches!(result, Err(ModelError::InvalidTimeRange { .. })));
    }

    #[test]
    fn rejects_empty_operation_fields() {
        let range = TimeRange::new(1, 1).expect("valid range");
        let op = Operation::new(
            "",
            "ios_1",
            "apple.com20260305091530alice",
            FieldName::Password,
            OpType::Set,
            HybridLogicalClock::new(100, 0),
            range,
            vec![],
        );

        assert!(matches!(op, Err(ModelError::EmptyField("op_id"))));
    }
}

