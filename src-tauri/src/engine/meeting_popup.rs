//! Floating "meeting detected" popup window styled to mimic a native macOS
//! notification (rounded white card, drop shadow, top-right corner).
//!
//! This is intentionally a custom Tauri window rather than a real
//! `UNUserNotificationCenter` notification:
//!
//!   * Doesn't require the app to be inside a properly bundled `.app`
//!     (so `tauri dev` works fine — UNC traps in `currentNotificationCenter`
//!     when `mainBundle.bundleURL` resolves outside an app bundle).
//!   * Bypasses the macOS notification permission system entirely. Zoom,
//!     Granola, etc. take this same approach precisely so their meeting
//!     popups still appear when the user has globally muted the app.
//!   * Full styling control — the window is just a transparent borderless
//!     `NSWindow`; the React component inside it draws the card.
//!
//! The popup window is opened with `WindowUrl::App("index.html#popup")` so
//! the existing dist/dev bundle is reused. `main.tsx` reads the URL hash
//! and routes to `<MeetingPopup />` instead of the main shell.
//!
//! Communication:
//!   * On open: emit `meeting-popup-data` to the popup window with the app
//!     name (Microsoft Teams / Zoom).
//!   * From the popup, the user clicks the action button which invokes the
//!     `meeting_popup_start_recording` Tauri command. That emits
//!     `toggle_recording` on the *main* window (existing recording-toggle
//!     pathway) and closes the popup. Dismiss closes the window without
//!     emitting anything.

use std::time::Duration;

use log::{info, warn};
use tauri::{AppHandle, Manager, PhysicalPosition, WindowBuilder, WindowUrl};

const POPUP_LABEL: &str = "meeting-popup";
const POPUP_WIDTH: f64 = 380.0;
const POPUP_HEIGHT: f64 = 88.0;
/// Logical pixels of inset from the screen's top-right corner. The macOS
/// menu bar is ~24px on standard density; we add a bit more so the popup
/// sits visually like a real notification.
const TOP_INSET: f64 = 36.0;
const RIGHT_INSET: f64 = 14.0;
/// Auto-dismiss after this many seconds if the user takes no action.
const AUTO_DISMISS_SECS: u64 = 30;

#[derive(Clone, serde::Serialize)]
struct MeetingPopupPayload {
    app_name: String,
}

/// Show (or refresh) the floating meeting-detected popup.
pub fn show_meeting_popup(app_handle: AppHandle, app_name: String) {
    // If a popup window from a previous detection is still open, just
    // update its content rather than stacking another window.
    if let Some(existing) = app_handle.get_window(POPUP_LABEL) {
        let _ = existing.show();
        let _ = existing.emit(
            "meeting-popup-data",
            MeetingPopupPayload {
                app_name: app_name.clone(),
            },
        );
        return;
    }

    let window = match WindowBuilder::new(
        &app_handle,
        POPUP_LABEL,
        WindowUrl::App("index.html#popup".into()),
    )
    .title("Platypus Meeting Detected")
    .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()
    {
        Ok(w) => w,
        Err(e) => {
            warn!("Failed to create meeting popup window: {}", e);
            return;
        }
    };

    // Position in the top-right of the monitor that contains the popup.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let x = (size.width as f64) - (POPUP_WIDTH * scale) - (RIGHT_INSET * scale);
        let y = TOP_INSET * scale;
        let _ = window.set_position(PhysicalPosition::new(x as i32, y as i32));
    }

    if let Err(e) = window.show() {
        warn!("Failed to show meeting popup: {}", e);
    }

    // Emit the payload after a short tick so the React component has had
    // time to mount its event listener.
    let app_handle_data = app_handle.clone();
    let app_name_for_emit = app_name.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(180)).await;
        if let Some(w) = app_handle_data.get_window(POPUP_LABEL) {
            let _ = w.emit(
                "meeting-popup-data",
                MeetingPopupPayload {
                    app_name: app_name_for_emit,
                },
            );
        }
    });

    // Auto-dismiss timer. Cancelled implicitly if the user closes the
    // window first (the get_window call below returns None).
    let app_handle_dismiss = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(AUTO_DISMISS_SECS)).await;
        if let Some(w) = app_handle_dismiss.get_window(POPUP_LABEL) {
            let _ = w.close();
        }
    });

    info!("Meeting popup shown for: {}", app_name);
}

#[tauri::command]
pub fn meeting_popup_dismiss(app_handle: AppHandle) {
    if let Some(w) = app_handle.get_window(POPUP_LABEL) {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn meeting_popup_start_recording(app_handle: AppHandle) {
    if let Some(main) = app_handle.get_window("main") {
        let _ = main.emit("toggle_recording", serde_json::json!({ "data": true }));
    }
    if let Some(popup) = app_handle.get_window(POPUP_LABEL) {
        let _ = popup.close();
    }
}
