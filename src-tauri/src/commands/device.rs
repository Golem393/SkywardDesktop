use crate::adb::{self, Device};

/// Result of prerequisite checks on a connected device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrerequisiteResult {
    /// True if the device is authorized (USB debugging accepted).
    pub usb_authorized: bool,
    /// True if SkywardBlocker is not already installed on the phone.
    pub no_existing_install: bool,
    /// True if no other app is already set as device owner.
    pub no_existing_owner: bool,
    /// True if no Google accounts are present on the device (required for set-device-owner).
    pub no_accounts: bool,
    /// Human-readable messages for each check.
    pub messages: Vec<String>,
    /// True if all critical checks pass and installation can proceed.
    pub can_proceed: bool,
}

/// Live connection state of a previously selected device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceConnectionStatus {
    /// True only when the device is present AND fully usable (`adb` status "device").
    pub connected: bool,
    /// Raw ADB status ("device", "unauthorized", "offline", …) or "disconnected" if absent.
    pub status: String,
    /// Human-readable explanation suitable for showing in a dialog.
    pub message: String,
}

/// Basic device properties retrieved via `getprop`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceInfo {
    pub serial: String,
    pub model: String,
    pub manufacturer: String,
    pub android_version: String,
    pub sdk_version: String,
}

/// Tauri command: detect all connected Android devices via ADB.
#[tauri::command]
pub async fn detect_devices(app: tauri::AppHandle) -> Result<Vec<Device>, String> {
    adb::detect_devices(Some(&app)).map_err(|e| e.to_string())
}

/// Tauri command: check whether a specific device is still connected and usable.
///
/// Called right before any destructive/long-running operation (install, update,
/// remove) so the user gets a clear dialog instead of a cryptic ADB error when
/// the cable was unplugged or the device dropped offline in the meantime.
#[tauri::command]
pub async fn is_device_connected(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<DeviceConnectionStatus, String> {
    let devices = match adb::detect_devices(Some(&app)) {
        Ok(devices) => devices,
        Err(e) => {
            // ADB itself is unavailable / failed — treat as not connected rather
            // than letting the caller proceed into a doomed operation.
            return Ok(DeviceConnectionStatus {
                connected: false,
                status: "unavailable".to_string(),
                message: format!("Could not reach ADB to verify the device: {}", e),
            });
        }
    };

    match devices.into_iter().find(|d| d.serial == device_id) {
        Some(device) if device.status == "device" => Ok(DeviceConnectionStatus {
            connected: true,
            status: device.status,
            message: "Device is connected and ready.".to_string(),
        }),
        Some(device) => {
            let message = match device.status.as_str() {
                "unauthorized" => "The device is plugged in but USB debugging has not been authorized. Accept the prompt on the phone and try again.".to_string(),
                "offline" => "The device is plugged in but reported as offline. Reconnect the USB cable and try again.".to_string(),
                other => format!("The device is in state \"{}\" and cannot be used right now.", other),
            };
            Ok(DeviceConnectionStatus {
                connected: false,
                status: device.status,
                message,
            })
        }
        None => Ok(DeviceConnectionStatus {
            connected: false,
            status: "disconnected".to_string(),
            message: "The device is no longer connected. Reconnect it via USB and search for devices again.".to_string(),
        }),
    }
}

/// Tauri command: get detailed device info via `adb shell getprop`.
#[tauri::command]
pub async fn get_device_info(app: tauri::AppHandle, device_id: String) -> Result<DeviceInfo, String> {
    let get_prop = |prop: &str| -> String {
        adb::run_adb_for_device(Some(&app), &device_id, &["shell", "getprop", prop])
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    Ok(DeviceInfo {
        serial: device_id.clone(),
        model: get_prop("ro.product.model"),
        manufacturer: get_prop("ro.product.manufacturer"),
        android_version: get_prop("ro.build.version.release"),
        sdk_version: get_prop("ro.build.version.sdk"),
    })
}

/// Tauri command: check prerequisites before installation.
///
/// Checks:
/// 1. Device is authorized (USB debugging prompt accepted)
/// 2. SkywardBlocker is not already installed on the device
/// 3. No existing device owner is active on the device
/// 4. No Google accounts on device (required for `dpm set-device-owner`)
#[tauri::command]
pub async fn check_prerequisites(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<PrerequisiteResult, String> {
    let mut messages = Vec::new();

    // 1. Check USB authorization — if we can run a shell command, it's authorized
    let usb_authorized = adb::run_adb_for_device(Some(&app), &device_id, &["shell", "echo", "ok"])
        .map(|out| out.trim() == "ok")
        .unwrap_or(false);

    if usb_authorized {
        messages.push("✅ USB debugging authorized".to_string());
    } else {
        messages.push("❌ USB debugging not authorized — accept the prompt on the phone".to_string());
    }

    // 2. Check if SkywardBlocker is already installed on the phone
    let no_existing_install = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "pm", "list", "packages", "com.example.skywardblocker"],
        )
        .unwrap_or_default();

        let is_installed = output.contains("com.example.skywardblocker");
        if !is_installed {
            messages.push("✅ SkywardBlocker is not currently installed on device".to_string());
            true
        } else {
            messages.push("❌ SkywardBlocker is already installed on this phone — remove or factory reset before new setup".to_string());
            false
        }
    } else {
        messages.push("⏳ Cannot check existing installation (device not authorized)".to_string());
        false
    };

    // 3. Check if there's already a device owner
    let no_existing_owner = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "dumpsys", "device_policy"],
        )
        .unwrap_or_default();

        let has_owner = output.contains("Device Owner:")
            && !output.contains("Device Owner: null");

        if !has_owner {
            messages.push("✅ No existing Device Owner active".to_string());
            true
        } else {
            messages.push("❌ A Device Owner is already active on this device — factory reset required".to_string());
            false
        }
    } else {
        messages.push("⏳ Cannot check device owner (device not authorized)".to_string());
        false
    };

    // 4. Check for Google accounts on device
    let no_accounts = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "dumpsys", "account"],
        )
        .unwrap_or_default();

        // Count accounts — look for "Account {" entries
        // If there are accounts present, dpm set-device-owner will fail
        let account_count = output.matches("Account {").count();

        if account_count == 0 {
            messages.push("✅ No accounts on device".to_string());
            true
        } else {
            messages.push(format!(
                "❌ {} account(s) found on device — remove all accounts before installation",
                account_count
            ));
            false
        }
    } else {
        messages.push("⏳ Cannot check accounts (device not authorized)".to_string());
        false
    };

    let can_proceed = usb_authorized && no_existing_install && no_existing_owner && no_accounts;

    Ok(PrerequisiteResult {
        usb_authorized,
        no_existing_install,
        no_existing_owner,
        no_accounts,
        messages,
        can_proceed,
    })
}
