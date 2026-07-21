pub const CSV_HEADERS: &[&str] = &[
    "account_id",
    "sites",
    "username",
    "password_cipher",
    "totp_secret_cipher",
    "recovery_codes_cipher",
    "note_cipher",
    "username_updated_at",
    "password_updated_at",
    "totp_updated_at",
    "recovery_codes_updated_at",
    "note_updated_at",
    "is_deleted",
    "deleted_at",
    "last_operated_device",
    "created_at",
    "updated_at",
];

/// Headers used by the macOS full-account CSV export (plaintext fields).
pub const MACOS_EXPORT_HEADERS: &[&str] = &[
    "account_id",
    "sites",
    "username",
    "password",
    "totp_secret",
    "recovery_codes",
    "note",
    "username_updated_at_ms",
    "password_updated_at_ms",
    "totp_updated_at_ms",
    "recovery_codes_updated_at_ms",
    "note_updated_at_ms",
    "is_deleted",
    "deleted_at_ms",
    "last_operated_device_name",
    "created_at_ms",
    "updated_at_ms",
];

pub fn encode_sites(sites: &[String]) -> String {
    sites.join(";")
}

pub fn decode_sites(raw: &str) -> Vec<String> {
    let mut values: Vec<String> = raw
        .split(';')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .collect();

    values.sort();
    values.dedup();
    values
}

/// Escape a CSV cell for spreadsheet safety (macOS / Excel formula injection).
///
/// - Newlines become spaces
/// - Leading `=+-@\\t` get a leading `'`
/// - Value is always double-quoted; internal quotes doubled
pub fn escape_csv_cell(value: &str) -> String {
    let mut sanitized = value.replace('\r', " ").replace('\n', " ");
    if sanitized
        .chars()
        .next()
        .is_some_and(|c| matches!(c, '=' | '+' | '-' | '@' | '\t'))
    {
        sanitized.insert(0, '\'');
    }
    format!("\"{}\"", sanitized.replace('"', "\"\""))
}

/// Build a CSV document from header labels and row cells (already unescaped).
pub fn build_csv(headers: &[&str], rows: &[Vec<String>]) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        headers
            .iter()
            .map(|h| escape_csv_cell(h))
            .collect::<Vec<_>>()
            .join(","),
    );
    // Headers in macOS export are bare (no quotes) historically — keep bare header line.
    lines[0] = headers.join(",");
    for row in rows {
        let line = row
            .iter()
            .map(|cell| escape_csv_cell(cell))
            .collect::<Vec<_>>()
            .join(",");
        lines.push(line);
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_sites_normalizes_and_deduplicates() {
        let decoded = decode_sites(" iCloud.com ; apple.com;icloud.com ; ;APPLE.COM ");
        assert_eq!(
            decoded,
            vec!["apple.com".to_string(), "icloud.com".to_string()]
        );
    }

    #[test]
    fn encode_sites_uses_semicolon_separator() {
        let raw = encode_sites(&["apple.com".to_string(), "icloud.com".to_string()]);
        assert_eq!(raw, "apple.com;icloud.com");
    }

    #[test]
    fn escape_csv_cell_guards_formula_and_quotes() {
        assert_eq!(escape_csv_cell("plain"), "\"plain\"");
        assert_eq!(escape_csv_cell("=1+1"), "\"'=1+1\"");
        assert_eq!(escape_csv_cell("a\"b"), "\"a\"\"b\"");
        assert_eq!(escape_csv_cell("a\nb"), "\"a b\"");
    }

    #[test]
    fn build_csv_macos_shape() {
        let rows = vec![vec![
            "id1".into(),
            "a.com;b.com".into(),
            "u".into(),
            "p".into(),
            "".into(),
            "".into(),
            "n".into(),
            "1".into(),
            "2".into(),
            "3".into(),
            "4".into(),
            "5".into(),
            "false".into(),
            "".into(),
            "Mac".into(),
            "10".into(),
            "20".into(),
        ]];
        let csv = build_csv(MACOS_EXPORT_HEADERS, &rows);
        assert!(csv.starts_with("account_id,sites,username,"));
        assert!(csv.contains("\"id1\""));
        assert!(csv.contains("\"a.com;b.com\""));
    }
}
