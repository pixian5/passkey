use std::path::PathBuf;
use std::process::Command;
use std::time::SystemTime;

fn main() {
    println!("cargo:rerun-if-changed=resources/pass_biometric_helper.swift");
    #[cfg(target_os = "macos")]
    {
        let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let source = manifest.join("resources/pass_biometric_helper.swift");
        let output = manifest.join("resources/pass-biometric-helper");
        let needs_build = match (source.metadata(), output.metadata()) {
            (Ok(src), Ok(out)) => {
                let src_mtime = src.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                let out_mtime = out.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                src_mtime > out_mtime || out.len() == 0
            }
            (Ok(_), Err(_)) => true,
            _ => true,
        };
        if needs_build {
            let status = Command::new("swiftc")
                .args(["-O", "-o"])
                .arg(&output)
                .arg(&source)
                .status()
                .expect("编译 macOS 生物识别助手失败：找不到 swiftc");
            assert!(status.success(), "编译 macOS 生物识别助手失败");
        }
    }
    tauri_build::build()
}
