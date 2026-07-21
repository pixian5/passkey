//! Main-window geometry persisted locally between launches.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

use crate::local_vault;

const STATE_FILE: &str = "window_state.json";
const STATE_SCOPE: &str = "pass.tauri.window_state.v1";
const MIN_VISIBLE_EDGE: i32 = 80;
const MAX_DIMENSION: u32 = 16_384;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

fn state_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(STATE_FILE)
}

fn load(data_dir: &Path) -> Option<WindowState> {
    local_vault::read_text(data_dir, &state_path(data_dir), STATE_SCOPE)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .filter(valid_dimensions)
}

fn valid_dimensions(state: &WindowState) -> bool {
    state.width > 0
        && state.height > 0
        && state.width <= MAX_DIMENSION
        && state.height <= MAX_DIMENSION
}

fn position_is_visible(state: &WindowState, monitors: &[(i32, i32, u32, u32)]) -> bool {
    let right = state
        .x
        .saturating_add(state.width.min(i32::MAX as u32) as i32);
    let bottom = state
        .y
        .saturating_add(state.height.min(i32::MAX as u32) as i32);
    monitors.iter().any(|(x, y, width, height)| {
        let monitor_right = x.saturating_add((*width).min(i32::MAX as u32) as i32);
        let monitor_bottom = y.saturating_add((*height).min(i32::MAX as u32) as i32);
        right > x.saturating_add(MIN_VISIBLE_EDGE)
            && state.x < monitor_right.saturating_sub(MIN_VISIBLE_EDGE)
            && bottom > y.saturating_add(MIN_VISIBLE_EDGE)
            && state.y < monitor_bottom.saturating_sub(MIN_VISIBLE_EDGE)
    })
}

pub fn restore<R: Runtime>(window: &WebviewWindow<R>, data_dir: &Path) {
    let Some(state) = load(data_dir) else {
        return;
    };

    let _ = window.set_size(PhysicalSize::new(state.width, state.height));
    if let Ok(monitors) = window.available_monitors() {
        let monitor_bounds = monitors
            .iter()
            .map(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                (position.x, position.y, size.width, size.height)
            })
            .collect::<Vec<_>>();
        if position_is_visible(&state, &monitor_bounds) {
            let _ = window.set_position(PhysicalPosition::new(state.x, state.y));
        }
    }
    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn save<R: Runtime>(window: &WebviewWindow<R>, data_dir: &Path) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|e| format!("读取窗口位置失败: {e}"))?;
    let size = window
        .inner_size()
        .map_err(|e| format!("读取窗口尺寸失败: {e}"))?;
    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: window
            .is_maximized()
            .map_err(|e| format!("读取窗口最大化状态失败: {e}"))?,
    };
    let raw = serde_json::to_string(&state).map_err(|e| format!("序列化窗口状态失败: {e}"))?;
    local_vault::write_text(data_dir, &state_path(data_dir), STATE_SCOPE, &raw)
}

#[cfg(test)]
mod tests {
    use super::{position_is_visible, valid_dimensions, WindowState};

    #[test]
    fn accepts_visible_state() {
        let state = WindowState {
            x: 200,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
        };
        assert!(valid_dimensions(&state));
        assert!(position_is_visible(&state, &[(0, 0, 2560, 1440)]));
    }

    #[test]
    fn rejects_invalid_or_offscreen_state() {
        let invalid = WindowState {
            x: 0,
            y: 0,
            width: 0,
            height: 800,
            maximized: false,
        };
        let offscreen = WindowState {
            x: 4000,
            y: 100,
            width: 1280,
            height: 800,
            maximized: false,
        };
        assert!(!valid_dimensions(&invalid));
        assert!(!position_is_visible(&offscreen, &[(0, 0, 2560, 1440)]));
    }
}
