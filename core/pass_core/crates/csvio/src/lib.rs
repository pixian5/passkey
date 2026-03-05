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
}

