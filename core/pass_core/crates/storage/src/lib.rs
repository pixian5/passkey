pub const INITIAL_SCHEMA_SQL: &str = include_str!("../migrations/0001_initial.sql");

pub fn required_table_names() -> &'static [&'static str] {
    &[
        "devices",
        "alias_groups",
        "accounts",
        "op_logs",
        "account_field_winners",
        "version_vectors",
        "sync_sessions",
        "csv_jobs",
        "schema_migrations",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_contains_required_tables() {
        for table in required_table_names() {
            let token = format!("CREATE TABLE IF NOT EXISTS {table}");
            assert!(
                INITIAL_SCHEMA_SQL.contains(&token),
                "missing table definition: {table}"
            );
        }
    }
}

