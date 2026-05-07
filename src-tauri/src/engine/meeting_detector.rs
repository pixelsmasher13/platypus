use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use log::{debug, info};
use sysinfo::System;
use tauri::{AppHandle, Manager};

/// Runtime toggle — set from settings, read by the detection loop.
pub static MEETING_DETECTION_ENABLED: AtomicBool = AtomicBool::new(false);

/// Don't re-notify for the same app within this window.
const NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(300); // 5 minutes

/// Number of consecutive "not detected" polls before we consider a meeting ended.
/// Prevents flapping when transient mic drops happen mid-call.
const LEAVE_GRACE_POLLS: u8 = 3;

/// Check if Zoom is in an active meeting.
/// CptHost is a process that only runs during an active Zoom meeting on macOS.
/// Important: "caphost" is a DIFFERENT process that runs whenever Zoom is open
/// (even without a meeting) — do NOT match it, or you get false positives.
fn is_zoom_in_meeting(system: &System) -> bool {
    for (_pid, process) in system.processes() {
        let name = process.name();
        if name == "CptHost" {
            debug!("Zoom active meeting process found: {}", name);
            return true;
        }
    }
    false
}

/// True when any running process looks like Microsoft Teams (Classic or New).
fn is_teams_running(system: &System) -> bool {
    for (_pid, process) in system.processes() {
        let name = process.name();
        // New Teams binary is "MSTeams"; Classic Teams binary is "Teams".
        if name == "MSTeams" {
            return true;
        }
        let cmd_joined = process.cmd().join(" ");
        if cmd_joined.contains("Microsoft Teams") {
            return true;
        }
    }
    false
}

/// macOS CoreAudio FFI: query whether the default input device is in use by
/// any process. This is the same property that drives the orange-dot mic
/// indicator in the menu bar — the strongest possible "someone is recording
/// right now" signal.
#[cfg(target_os = "macos")]
mod core_audio_ffi {
    use std::os::raw::c_void;

    pub type AudioObjectID = u32;
    pub type OSStatus = i32;

    #[repr(C)]
    pub struct AudioObjectPropertyAddress {
        pub m_selector: u32,
        pub m_scope: u32,
        pub m_element: u32,
    }

    pub const K_AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;
    // FourCC literals from <CoreAudio/AudioHardware.h>.
    pub const K_DEFAULT_INPUT_DEVICE: u32 = 0x6449_6e20; // 'dIn '
    pub const K_DEVICE_IS_RUNNING_SOMEWHERE: u32 = 0x676f_6e65; // 'gone'
    pub const K_SCOPE_GLOBAL: u32 = 0x676c_6f62; // 'glob'
    pub const K_ELEMENT_MAIN: u32 = 0;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        pub fn AudioObjectGetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            io_data_size: *mut u32,
            out_data: *mut c_void,
        ) -> OSStatus;
    }
}

/// Returns `true` when something (anything) is actively reading from the
/// default input device — i.e. the orange mic dot is currently on. We
/// subtract Platypus's own recording state so our own recorder doesn't
/// trigger false positives.
#[cfg(target_os = "macos")]
fn is_external_mic_active() -> bool {
    use core_audio_ffi::*;
    use std::ffi::c_void;

    if crate::engine::audio_engine::IS_RECORDING.load(Ordering::Relaxed) {
        // Platypus is recording — we can't distinguish "us only" from "us +
        // Teams" via this property, so suppress detection while we record.
        return false;
    }

    unsafe {
        let mut device_id: AudioObjectID = 0;
        let mut size = std::mem::size_of::<AudioObjectID>() as u32;
        let addr = AudioObjectPropertyAddress {
            m_selector: K_DEFAULT_INPUT_DEVICE,
            m_scope: K_SCOPE_GLOBAL,
            m_element: K_ELEMENT_MAIN,
        };
        let status = AudioObjectGetPropertyData(
            K_AUDIO_OBJECT_SYSTEM_OBJECT,
            &addr,
            0,
            std::ptr::null(),
            &mut size,
            &mut device_id as *mut _ as *mut c_void,
        );
        if status != 0 || device_id == 0 {
            return false;
        }

        let mut is_running: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let addr2 = AudioObjectPropertyAddress {
            m_selector: K_DEVICE_IS_RUNNING_SOMEWHERE,
            m_scope: K_SCOPE_GLOBAL,
            m_element: K_ELEMENT_MAIN,
        };
        let status = AudioObjectGetPropertyData(
            device_id,
            &addr2,
            0,
            std::ptr::null(),
            &mut size,
            &mut is_running as *mut _ as *mut c_void,
        );
        status == 0 && is_running != 0
    }
}

#[cfg(not(target_os = "macos"))]
fn is_external_mic_active() -> bool {
    false
}

/// Optional macOS window-title scan for Teams meeting windows. Used only to
/// pick a nicer display label ("Meeting in 'Channel X'" vs the generic
/// "Microsoft Teams"); never used as a fallback signal — having a window
/// open is NOT the same as being in a meeting. Reading window titles
/// requires Screen Recording on macOS 10.15+; without it we get an empty
/// title and just return None.
#[cfg(target_os = "macos")]
fn teams_meeting_window_title() -> Option<String> {
    use core_foundation::{
        array::CFArray, base::TCFType, dictionary::CFDictionary, string::CFString,
    };
    use core_graphics::display::{
        kCGNullWindowID, kCGWindowListExcludeDesktopElements,
        kCGWindowListOptionOnScreenOnly, CGWindowListCopyWindowInfo,
    };

    unsafe {
        let opts = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let list_ref = CGWindowListCopyWindowInfo(opts, kCGNullWindowID);
        if list_ref.is_null() {
            return None;
        }
        let arr: CFArray<CFDictionary<CFString, core_foundation::base::CFType>> =
            CFArray::wrap_under_create_rule(list_ref);

        let owner_key = CFString::new("kCGWindowOwnerName");
        let title_key = CFString::new("kCGWindowName");

        for i in 0..arr.len() {
            let Some(dict) = arr.get(i) else { continue };

            let owner = dict
                .find(&owner_key)
                .and_then(|v| v.downcast::<CFString>())
                .map(|s| s.to_string())
                .unwrap_or_default();

            let owner_is_teams = owner == "Microsoft Teams"
                || owner == "MSTeams"
                || owner.starts_with("Teams");
            if !owner_is_teams {
                continue;
            }

            let title = dict
                .find(&title_key)
                .and_then(|v| v.downcast::<CFString>())
                .map(|s| s.to_string())
                .unwrap_or_default();

            if title.contains("Meeting")
                || title.contains("Call")
                || title.contains("| Microsoft Teams")
            {
                return Some(title);
            }
        }
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn teams_meeting_window_title() -> Option<String> {
    None
}

/// Teams is in a meeting iff the system mic is active AND Teams is running.
/// "Teams running" alone is not enough — that's where the previous
/// implementation got false positives. The mic-active gate matches what the
/// macOS orange-dot indicator already shows the user.
fn is_teams_in_meeting(system: &System) -> bool {
    if !is_external_mic_active() {
        return false;
    }
    if !is_teams_running(system) {
        return false;
    }
    if let Some(title) = teams_meeting_window_title() {
        debug!("Teams meeting window: {}", title);
    }
    true
}

struct MeetingDetector {
    system: System,
    previously_detected: HashSet<String>,
    /// Per-app cooldown tracking: app_name → last notification time
    cooldowns: HashMap<String, Instant>,
    /// Counts consecutive polls where a previously-detected app was NOT seen.
    /// Once this reaches LEAVE_GRACE_POLLS, we actually remove it.
    absent_counts: HashMap<String, u8>,
}

impl MeetingDetector {
    fn new() -> Self {
        Self {
            system: System::new_all(),
            previously_detected: HashSet::new(),
            cooldowns: HashMap::new(),
            absent_counts: HashMap::new(),
        }
    }

    /// Poll running processes. Returns newly-detected meeting app names
    /// (only those not already detected and not in cooldown).
    fn poll(&mut self) -> Vec<String> {
        self.system.refresh_processes();

        let mut current_raw: HashSet<String> = HashSet::new();

        if is_zoom_in_meeting(&self.system) {
            current_raw.insert("Zoom".to_string());
        }
        if is_teams_in_meeting(&self.system) {
            current_raw.insert("Microsoft Teams".to_string());
        }

        // Apply grace period: apps that were previously detected but aren't
        // in current_raw need to be absent for LEAVE_GRACE_POLLS consecutive
        // polls before we actually remove them.
        let mut current_meeting_apps = current_raw.clone();

        for app in &self.previously_detected {
            if !current_raw.contains(app) {
                let count = self.absent_counts.entry(app.clone()).or_insert(0);
                *count += 1;
                if *count < LEAVE_GRACE_POLLS {
                    debug!("{} not detected this poll ({}/{}), keeping in detected set",
                        app, count, LEAVE_GRACE_POLLS);
                    current_meeting_apps.insert(app.clone());
                } else {
                    info!("{} absent for {} polls, marking as left meeting", app, count);
                }
            }
        }

        // Clear absent counts for apps that ARE detected this poll
        for app in &current_raw {
            self.absent_counts.remove(app);
        }

        // Find apps that just entered a meeting (weren't detected in previous poll)
        let new_apps: Vec<String> = current_meeting_apps
            .difference(&self.previously_detected)
            .cloned()
            .collect();

        self.previously_detected = current_meeting_apps;

        // Filter out apps still in cooldown
        let now = Instant::now();
        let notifiable: Vec<String> = new_apps
            .into_iter()
            .filter(|app| {
                if let Some(last_time) = self.cooldowns.get(app) {
                    if now.duration_since(*last_time) < NOTIFICATION_COOLDOWN {
                        debug!("Skipping notification for {} (cooldown active)", app);
                        return false;
                    }
                }
                true
            })
            .collect();

        // Record cooldown for apps we're about to notify
        for app in &notifiable {
            self.cooldowns.insert(app.clone(), now);
        }

        notifiable
    }
}

/// Show the floating top-right popup window (Granola-style card). This is a
/// custom Tauri window — not a real macOS notification — so it doesn't need
/// `UNUserNotificationCenter` permission and works in `tauri dev`.
fn show_corner_notification(app_handle: &AppHandle, app_name: &str) {
    crate::engine::meeting_popup::show_meeting_popup(app_handle.clone(), app_name.to_string());
}

/// Spawns a background thread that polls for meeting processes and emits
/// events when a new meeting is detected. Call once from setup().
pub fn start_meeting_detection(app_handle: AppHandle) {
    std::thread::spawn(move || {
        info!("Meeting detection thread started");

        // Wait for the frontend to fully mount before polling,
        // otherwise the first event fires before the listener is ready.
        std::thread::sleep(Duration::from_secs(10));

        let mut detector = MeetingDetector::new();

        loop {
            if !MEETING_DETECTION_ENABLED.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }

            let new_apps = detector.poll();

            for app_name in &new_apps {
                info!("Meeting detected on: {}", app_name);

                // Quiet macOS corner notification (no focus steal).
                show_corner_notification(&app_handle, app_name);

                // In-app banner via frontend event (independent path —
                // shown if Platypus is already focused).
                if let Some(window) = app_handle.get_window("main") {
                    let _ = window.emit("meeting-detected", app_name.clone());
                }
            }

            std::thread::sleep(Duration::from_secs(5));
        }
    });
}
