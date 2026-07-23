//! CLI for the shared pass-merge v2 engine.
//!
//! Usage:
//!   pass-merge-cli merge --local local.json --remote remote.json
//!   pass-merge-cli safety --local local.json --remote remote.json --merged merged.json --mode merge
//!
//! stdin mode:
//!   echo '{"local":{...},"remote":{...}}' | pass-merge-cli merge --stdin

use std::env;
use std::fs;
use std::io::{self, Read};
use std::process::ExitCode;

use pass_merge::v2::{evaluate_sync_safety, merge_sync_payloads, SyncPayload};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
struct MergeInput {
    local: SyncPayload,
    remote: SyncPayload,
}

#[derive(Debug, Deserialize)]
struct SafetyInput {
    local: SyncPayload,
    #[serde(default)]
    remote: Option<SyncPayload>,
    merged: SyncPayload,
    #[serde(default = "default_mode")]
    mode: String,
}

fn default_mode() -> String {
    "merge".to_string()
}

fn read_json_file(path: &str) -> Result<serde_json::Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse {path}: {e}"))
}

fn read_stdin_json() -> Result<serde_json::Value, String> {
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .map_err(|e| format!("read stdin: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse stdin: {e}"))
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "-h" || a == "--help") {
        eprintln!(
            "pass-merge-cli — shared pass.sync.bundle.v2 merge engine\n\n\
             Commands:\n\
             \tmerge  --local L.json --remote R.json\n\
             \tmerge  --stdin   # JSON: {{\"local\":...,\"remote\":...}}\n\
             \tsafety --local L.json --remote R.json --merged M.json [--mode merge|remoteOverwriteLocal]\n\
             \tsafety --stdin"
        );
        return ExitCode::SUCCESS;
    }

    let result = match args[0].as_str() {
        "merge" => cmd_merge(&args[1..]),
        "safety" => cmd_safety(&args[1..]),
        other => Err(format!("unknown command: {other}")),
    };

    match result {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(1)
        }
    }
}

fn cmd_merge(args: &[String]) -> Result<serde_json::Value, String> {
    let input = if args.iter().any(|a| a == "--stdin") {
        let value = read_stdin_json()?;
        serde_json::from_value::<MergeInput>(value).map_err(|e| e.to_string())?
    } else {
        let local_path = flag_value(args, "--local").ok_or("missing --local")?;
        let remote_path = flag_value(args, "--remote").ok_or("missing --remote")?;
        let local = serde_json::from_value(read_json_file(&local_path)?)
            .map_err(|e| format!("local payload: {e}"))?;
        let remote = serde_json::from_value(read_json_file(&remote_path)?)
            .map_err(|e| format!("remote payload: {e}"))?;
        MergeInput { local, remote }
    };
    let merged = merge_sync_payloads(input.local, input.remote);
    Ok(serde_json::to_value(merged).unwrap())
}

fn cmd_safety(args: &[String]) -> Result<serde_json::Value, String> {
    let input = if args.iter().any(|a| a == "--stdin") {
        let value = read_stdin_json()?;
        serde_json::from_value::<SafetyInput>(value).map_err(|e| e.to_string())?
    } else {
        let local_path = flag_value(args, "--local").ok_or("missing --local")?;
        let merged_path = flag_value(args, "--merged").ok_or("missing --merged")?;
        let remote = match flag_value(args, "--remote") {
            Some(path) => Some(
                serde_json::from_value(read_json_file(&path)?)
                    .map_err(|e| format!("remote payload: {e}"))?,
            ),
            None => None,
        };
        let local = serde_json::from_value(read_json_file(&local_path)?)
            .map_err(|e| format!("local payload: {e}"))?;
        let merged = serde_json::from_value(read_json_file(&merged_path)?)
            .map_err(|e| format!("merged payload: {e}"))?;
        let mode = flag_value(args, "--mode").unwrap_or_else(|| "merge".to_string());
        SafetyInput {
            local,
            remote,
            merged,
            mode,
        }
    };
    let report = evaluate_sync_safety(
        &input.local,
        input.remote.as_ref(),
        &input.merged,
        &input.mode,
    );
    Ok(json!({
        "safe": report.safe,
        "reasons": report.reasons,
    }))
}

fn flag_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2).find_map(|pair| {
        if pair[0] == name {
            Some(pair[1].clone())
        } else {
            None
        }
    })
}
