use crate::adb::{self, AdbError, Device};

/// Result of prerequisite checks on a connected device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrerequisiteResult {
    /// True if the device is authorized (USB debugging accepted).
    pub usb_authorized: bool,
    /// True if no other app is already set as device owner.
    pub no_existing_owner: bool,
    /// True if no Google accounts are present on the device (required for set-device-owner).
    pub no_accounts: bool,
    /// Human-readable messages for each check.
    pub messages: Vec<String>,
    /// True if all critical checks pass and installation can proceed.
    pub can_proceed: bool,
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
pub fn detect_devices(app: tauri::AppHandle) -> Result<Vec<Device>, String> {
    adb::detect_devices(Some(&app)).map_err(|e| e.to_string())
}

/// Tauri command: get detailed device info via `adb shell getprop`.
#[tauri::command]
pub fn get_device_info(app: tauri::AppHandle, device_id: String) -> Result<DeviceInfo, String> {
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
/// 2. No existing device owner
/// 3. No Google accounts on device (required for `dpm set-device-owner`)
#[tauri::command]
pub fn check_prerequisites(
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

    // 2. Check if there's already a device owner
    let no_existing_owner = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "dumpsys", "device_policy"],
        )
        .unwrap_or_default();

        // If "Device Owner" section exists with a non-empty admin, there's an existing owner
        // But if it's OUR app, that's fine for re-installation
        let has_owner = output.contains("Device Owner:")
            && !output.contains("Device Owner: null");
        let is_our_app = output.contains("com.example.skywardblocker");

        if !has_owner {
            messages.push("✅ No existing device owner".to_string());
            true
        } else if is_our_app {
            messages.push("✅ SkywardBlocker is already device owner".to_string());
            true
        } else {
            messages.push("❌ Another app is already device owner — factory reset required".to_string());
            false
        }
    } else {
        messages.push("⏳ Cannot check device owner (device not authorized)".to_string());
        false
    };

    // 3. Check for Google accounts on device
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

    let can_proceed = usb_authorized && no_existing_owner && no_accounts;

    Ok(PrerequisiteResult {
        usb_authorized,
        no_existing_owner,
        no_accounts,
        messages,
        can_proceed,
    })
}
