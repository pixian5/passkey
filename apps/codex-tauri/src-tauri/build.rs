use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=resources/pass_biometric_helper.swift");
    #[cfg(target_os = "macos")]
    {
        let output = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("resources/pass-biometric-helper");
        let status = Command::new("swiftc")
            .args(["-O", "-o"])
            .arg(&output)
            .arg("resources/pass_biometric_helper.swift")
            .status()
            .expect("编译 macOS 生物识别助手失败：找不到 swiftc");
        assert!(status.success(), "编译 macOS 生物识别助手失败");
    }
    tauri_build::build()
}
