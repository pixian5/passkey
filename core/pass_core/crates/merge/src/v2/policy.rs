/// Cross-client sync policy constants. Keep in sync with
/// `core/pass_core/js/sync_policy.js` and `PassSyncPolicy.swift`.
pub const DEFAULT_DEVICE_NAME: &str = "PassDevice";

pub const FIXED_NEW_ACCOUNT_FOLDER_ID: &str = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
pub const FIXED_NEW_ACCOUNT_FOLDER_NAME: &str = "新账号";

/// Multi-label public suffixes used by etld_plus_one (not a full PSL).
pub const ETLD2_SUFFIXES: &[&str] = &[
    "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "ac.uk", "gov.uk",
    "com.au", "net.au", "org.au", "com.br", "com.mx", "co.jp", "or.jp", "ne.jp", "co.kr",
    "co.in", "com.hk", "com.tw", "com.sg", "co.nz", "org.nz", "com.ar", "com.tr", "co.za",
    "com.ua",
];
