//! Main-window geometry persisted locally between launches.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

use crate::local_vault;

const STATE_FILE: &str = "window_state.json";
const STATE_SCOPE: &str = "pass.tauri.window_state.v1";
const MIN_VISIBLE_EDGE: i32 = 80;
const MAX_DIMENSION: u32 = 16_384;
const FULL_WIDTH_TOLERANCE_PX: u32 = 96;

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

    // A maximized window only needs its state. On macOS, Tauri maps maximize to
    // native zoom, which may choose a content-sized frame instead of the usable
    // display area. Restore the latter explicitly to avoid right/bottom gaps.
    if state.maximized || saved_state_uses_full_monitor_width(window, &state) {
        restore_maximized(window);
        return;
    }

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
}

#[cfg(target_os = "macos")]
fn saved_state_uses_full_monitor_width<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &WindowState,
) -> bool {
    let Some(monitor) = startup_monitor(window) else {
        return false;
    };
    let work_area = monitor.work_area();
    state.x.abs_diff(work_area.position.x) <= FULL_WIDTH_TOLERANCE_PX
        && state.width.abs_diff(work_area.size.width) <= FULL_WIDTH_TOLERANCE_PX
}

#[cfg(not(target_os = "macos"))]
fn saved_state_uses_full_monitor_width<R: Runtime>(
    _window: &WebviewWindow<R>,
    _state: &WindowState,
) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn restore_maximized<R: Runtime>(window: &WebviewWindow<R>) {
    let Some(monitor) = startup_monitor(window) else {
        let _ = window.maximize();
        return;
    };
    let work_area = monitor.work_area();
    let outer_size = window.outer_size().ok();
    let inner_size = window.inner_size().ok();
    let chrome_width = outer_size
        .zip(inner_size)
        .map(|(outer, inner)| outer.width.saturating_sub(inner.width))
        .unwrap_or(0);
    let chrome_height = outer_size
        .zip(inner_size)
        .map(|(outer, inner)| outer.height.saturating_sub(inner.height))
        .unwrap_or(0);
    let _ = window.set_size(PhysicalSize::new(
        work_area.size.width.saturating_sub(chrome_width),
        work_area.size.height.saturating_sub(chrome_height),
    ));
    let _ = window.set_position(PhysicalPosition::new(
        work_area.position.x,
        work_area.position.y,
    ));
}

#[cfg(target_os = "macos")]
fn startup_monitor<R: Runtime>(window: &WebviewWindow<R>) -> Option<tauri::Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

#[cfg(not(target_os = "macos"))]
fn restore_maximized<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.maximize();
}

pub fn save<R: Runtime>(window: &WebviewWindow<R>, data_dir: &Path) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|e| format!("读取窗口位置失败: {e}"))?;
    let size = window
        .inner_size()
        .map_err(|e| format!("读取窗口尺寸失败: {e}"))?;
    let native_maximized = window
        .is_maximized()
        .map_err(|e| format!("读取窗口最大化状态失败: {e}"))?;
    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: native_maximized || current_window_uses_full_monitor_width(window),
    };
    let raw = serde_json::to_string(&state).map_err(|e| format!("序列化窗口状态失败: {e}"))?;
    local_vault::write_text(data_dir, &state_path(data_dir), STATE_SCOPE, &raw)
}

#[cfg(target_os = "macos")]
fn current_window_uses_full_monitor_width<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let (Ok(position), Ok(size), Ok(Some(monitor))) = (
        window.outer_position(),
        window.inner_size(),
        window.current_monitor(),
    ) else {
        return false;
    };
    let work_area = monitor.work_area();
    position.x.abs_diff(work_area.position.x) <= FULL_WIDTH_TOLERANCE_PX
        && size.width.abs_diff(work_area.size.width) <= FULL_WIDTH_TOLERANCE_PX
}

#[cfg(not(target_os = "macos"))]
fn current_window_uses_full_monitor_width<R: Runtime>(_window: &WebviewWindow<R>) -> bool {
    false
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
