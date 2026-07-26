//! Shared CSV helpers for Pass surfaces.
//! Keep JS (`core/pass_core/js/csv_core.js`) aligned with these rules.

use std::collections::BTreeMap;

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

pub const BROWSER_EXPORT_HEADERS: &[&str] = &["name", "username", "password", "url", "note"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserAccountDraft {
    pub sites: Vec<String>,
    pub username: String,
    pub password: String,
    pub note: String,
    pub totp_secret: String,
}

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
    // Headers in macOS export are bare (no quotes) historically — keep bare header line.
    lines.push(headers.join(","));
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

/// Parse CSV text into rows, supporting quotes and escaped quotes.
pub fn parse_csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => row.push(std::mem::take(&mut field)),
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    if row.iter().any(|c| !c.trim().is_empty()) {
                        rows.push(std::mem::take(&mut row));
                    } else {
                        row.clear();
                    }
                }
                '\r' => {}
                other => field.push(other),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|c| !c.trim().is_empty()) {
            rows.push(row);
        }
    }
    rows
}

pub fn normalize_header(h: &str) -> String {
    h.trim()
        .trim_start_matches('\u{feff}')
        .to_ascii_lowercase()
        .replace([' ', '_', '-'], "")
}

/// Extract a site host from url/website/name style values.
pub fn host_from_site_value(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let without_scheme = t
        .strip_prefix("https://")
        .or_else(|| t.strip_prefix("http://"))
        .or_else(|| t.strip_prefix("HTTPS://"))
        .or_else(|| t.strip_prefix("HTTP://"))
        .unwrap_or(t);
    let host = without_scheme
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or(without_scheme)
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_start_matches("www.")
        .trim_start_matches("WWW.")
        .to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn map_get<'a>(map: &'a BTreeMap<String, String>, names: &[&str]) -> Option<&'a String> {
    names.iter().find_map(|name| map.get(*name))
}

/// Convert browser/password-manager CSV text into portable account drafts.
///
/// Username/password are optional; a recognizable site is required.
pub fn browser_csv_to_account_drafts(text: &str) -> Result<Vec<BrowserAccountDraft>, String> {
    let rows = parse_csv_rows(text);
    if rows.is_empty() {
        return Err("CSV 为空".into());
    }
    let headers: Vec<String> = rows[0].iter().map(|h| normalize_header(h)).collect();
    if headers.iter().all(|h| h.is_empty()) {
        return Err("CSV 表头无效".into());
    }
    let mut out = Vec::new();
    for row in rows.iter().skip(1) {
        let mut map: BTreeMap<String, String> = BTreeMap::new();
        for (i, h) in headers.iter().enumerate() {
            if h.is_empty() {
                continue;
            }
            let v = row.get(i).map(|s| s.trim().to_string()).unwrap_or_default();
            map.insert(h.clone(), v);
        }
        let site_raw = map_get(
            &map,
            &[
                "url", "origin", "website", "hostname", "loginuri", "loginurl", "sites", "name",
            ],
        )
        .cloned()
        .unwrap_or_default();
        let Some(site) = host_from_site_value(&site_raw) else {
            continue;
        };
        let username = map_get(
            &map,
            &["username", "user", "loginusername", "login", "user_name"],
        )
        .cloned()
        .unwrap_or_default();
        let password = map_get(&map, &["password", "pass", "loginpassword", "passwd"])
            .cloned()
            .unwrap_or_default();
        let mut note = map_get(&map, &["note", "notes", "extra", "comments", "comment"])
            .cloned()
            .unwrap_or_default();
        if note.trim().is_empty() {
            if let Some(name) = map.get("name").filter(|s| !s.trim().is_empty()) {
                let name_host = host_from_site_value(name).unwrap_or_default();
                if !name.eq_ignore_ascii_case(&site) && name_host != site {
                    note = name.clone();
                }
            }
        }
        let totp_secret = map_get(&map, &["totp", "totpsecret", "otpauth", "otp", "otpsecre"])
            .cloned()
            .unwrap_or_default();
        out.push(BrowserAccountDraft {
            sites: vec![site],
            username,
            password,
            note,
            totp_secret,
        });
    }
    Ok(out)
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

    #[test]
    fn browser_csv_supports_common_headers_and_optional_credentials() {
        let csv = "url,username,password,note\nhttps://www.Example.com/login,alice,secret,hello\nhttps://github.com,,,\n";
        let drafts = browser_csv_to_account_drafts(csv).unwrap();
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].sites, vec!["example.com".to_string()]);
        assert_eq!(drafts[0].username, "alice");
        assert_eq!(drafts[0].password, "secret");
        assert_eq!(drafts[0].note, "hello");
        assert_eq!(drafts[1].sites, vec!["github.com".to_string()]);
        assert!(drafts[1].username.is_empty());
        assert!(drafts[1].password.is_empty());
    }

    #[test]
    fn browser_csv_parses_quoted_commas_and_totp() {
        let csv = "login_uri,login_username,login_password,notes,otpAuth\n\"https://a.com/x\",\"u,1\",\"p,2\",\"n,3\",\"otp-secret\"\n";
        let drafts = browser_csv_to_account_drafts(csv).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].sites, vec!["a.com".to_string()]);
        assert_eq!(drafts[0].username, "u,1");
        assert_eq!(drafts[0].password, "p,2");
        assert_eq!(drafts[0].note, "n,3");
        assert_eq!(drafts[0].totp_secret, "otp-secret");
    }
}
