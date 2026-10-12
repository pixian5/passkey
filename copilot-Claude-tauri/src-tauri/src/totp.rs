// TOTP generation utilities
use totp_lite::{totp_custom, Sha1};

const TOTP_DIGITS: u32 = 6;
const TOTP_PERIOD: u64 = 30;

pub fn generate_totp(secret: &str) -> Result<String, String> {
    let secret_bytes = base32_decode(secret)?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let code = totp_custom::<Sha1>(TOTP_PERIOD, TOTP_DIGITS, &secret_bytes, timestamp);
    Ok(format!("{:0width$}", code, width = TOTP_DIGITS as usize))
}

pub fn get_totp_remaining_seconds() -> u64 {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    TOTP_PERIOD - (timestamp % TOTP_PERIOD)
}

fn base32_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base32 decoder (RFC 4648)
    let input = input.to_uppercase().replace(&[' ', '-', '='][..], "");
    const BASE32_ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    let mut bits = String::new();
    for ch in input.chars() {
        if let Some(pos) = BASE32_ALPHABET.find(ch) {
            bits.push_str(&format!("{:05b}", pos));
        } else {
            return Err(format!("Invalid base32 character: {}", ch));
        }
    }

    let mut bytes = Vec::new();
    for chunk in bits.as_bytes().chunks(8) {
        if chunk.len() == 8 {
            let byte_str = std::str::from_utf8(chunk).unwrap();
            bytes.push(u8::from_str_radix(byte_str, 2).unwrap());
        }
    }

    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_totp_generation() {
        // This is a test secret, actual implementation would use user's secret
        let secret = "JBSWY3DPEHPK3PXP";
        let result = generate_totp(secret);
        assert!(result.is_ok());
        let code = result.unwrap();
        assert_eq!(code.len(), 6);
    }
}
