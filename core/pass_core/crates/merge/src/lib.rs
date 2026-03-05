use std::cmp::Ordering;

use pass_domain::{Operation, TimeRange};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteDecision {
    KeepDeleted,
    KeepActive,
    NeedsReview,
}

pub fn happened_before(a: &Operation, b: &Operation) -> bool {
    b.causal_parents.iter().any(|parent| parent == &a.op_id)
}

pub fn compare_ops(a: &Operation, b: &Operation) -> Ordering {
    if happened_before(a, b) {
        return Ordering::Less;
    }
    if happened_before(b, a) {
        return Ordering::Greater;
    }

    if a.time_range.upper_ms < b.time_range.lower_ms {
        return Ordering::Less;
    }
    if b.time_range.upper_ms < a.time_range.lower_ms {
        return Ordering::Greater;
    }

    match a.hlc.cmp(&b.hlc) {
        Ordering::Equal => a.op_id.cmp(&b.op_id),
        ord => ord,
    }
}

pub fn winner<'a>(a: &'a Operation, b: &'a Operation) -> &'a Operation {
    if compare_ops(a, b).is_lt() { b } else { a }
}

pub fn resolve_delete(delete_range: TimeRange, update_ranges: &[TimeRange]) -> DeleteDecision {
    if update_ranges.is_empty() {
        return DeleteDecision::KeepDeleted;
    }

    let max_update_upper = update_ranges
        .iter()
        .map(|range| range.upper_ms)
        .max()
        .unwrap_or(i64::MIN);

    if delete_range.lower_ms > max_update_upper {
        return DeleteDecision::KeepDeleted;
    }

    let has_certainly_newer_update = update_ranges
        .iter()
        .any(|range| delete_range.upper_ms < range.lower_ms);

    if has_certainly_newer_update {
        DeleteDecision::KeepActive
    } else {
        DeleteDecision::NeedsReview
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pass_domain::{FieldName, HybridLogicalClock, OpType, Operation};

    fn op(
        op_id: &str,
        parents: Vec<&str>,
        lower_ms: i64,
        upper_ms: i64,
        hlc_physical_ms: i64,
        hlc_logical: u32,
    ) -> Operation {
        Operation::new(
            op_id,
            "device_1",
            "apple.com20260305091530alice",
            FieldName::Password,
            OpType::Set,
            HybridLogicalClock::new(hlc_physical_ms, hlc_logical),
            TimeRange::new(lower_ms, upper_ms).expect("valid range"),
            parents.into_iter().map(ToString::to_string).collect(),
        )
        .expect("valid operation")
    }

    #[test]
    fn causal_parent_loses_to_child() {
        let older = op("a-1", vec![], 1000, 1010, 1005, 0);
        let newer = op("b-2", vec!["a-1"], 900, 920, 900, 0);

        assert_eq!(compare_ops(&older, &newer), Ordering::Less);
        assert_eq!(winner(&older, &newer).op_id, "b-2");
    }

    #[test]
    fn non_overlap_uses_time_range() {
        let older = op("a-1", vec![], 1000, 1010, 5000, 9);
        let newer = op("b-2", vec![], 1020, 1030, 100, 0);

        assert_eq!(compare_ops(&older, &newer), Ordering::Less);
    }

    #[test]
    fn overlap_uses_hlc_then_op_id() {
        let a = op("a-1", vec![], 1000, 1100, 2000, 1);
        let b = op("b-2", vec![], 1005, 1110, 2000, 2);
        assert_eq!(compare_ops(&a, &b), Ordering::Less);

        let c = op("c-1", vec![], 1000, 1100, 2000, 2);
        let d = op("d-1", vec![], 1000, 1100, 2000, 2);
        assert_eq!(compare_ops(&c, &d), Ordering::Less);
    }

    #[test]
    fn delete_decision_follows_spec() {
        let delete = TimeRange::new(200, 210).expect("valid range");
        let updates = vec![
            TimeRange::new(100, 120).expect("valid range"),
            TimeRange::new(130, 150).expect("valid range"),
        ];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::KeepDeleted);

        let delete = TimeRange::new(100, 110).expect("valid range");
        let updates = vec![
            TimeRange::new(90, 95).expect("valid range"),
            TimeRange::new(200, 210).expect("valid range"),
        ];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::KeepActive);

        let delete = TimeRange::new(100, 200).expect("valid range");
        let updates = vec![TimeRange::new(150, 220).expect("valid range")];
        assert_eq!(resolve_delete(delete, &updates), DeleteDecision::NeedsReview);
    }
}

