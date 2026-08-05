use crate::adb;

const PACKAGE_NAME: &str = "com.example.skywardblocker";
const DEVICE_ADMIN_COMPONENT: &str = "com.example.skywardblocker/.admin.SkywardDeviceAdmin";
const CLEAR_OWNER_ACTION: &str = "com.example.skywardblocker.CLEAR_OWNER";

/// Result of installation verification.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VerificationResult {
    pub is_installed: bool,
    pub is_device_owner: bool,
    pub success: bool,
    pub message: String,
}

/// Tauri command: Install an APK onto the target device.
/// Uses `-t` flag to allow testOnly APKs (common during development).
#[tauri::command]
pub async fn install_apk(
    app: tauri::AppHandle,
    device_id: String,
    apk_path: String,
) -> Result<String, String> {
    let output = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["install", "-r", "-t", &apk_path],
    )
    .map_err(|e| e.to_string())?;

    if output.contains("Success") {
        Ok("APK installed successfully.".to_string())
    } else {
        Err(format!("Installation failed: {}", output.trim()))
    }
}

/// Tauri command: Set SkywardBlocker as the Device Owner via Device Policy Manager (DPM).
#[tauri::command]
pub async fn set_device_owner(app: tauri::AppHandle, device_id: String) -> Result<String, String> {
    let output = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["shell", "dpm", "set-device-owner", DEVICE_ADMIN_COMPONENT],
    )
    .map_err(|e| e.to_string())?;

    // DPM returns messages like: "Success: Device owner set to package com.example.skywardblocker/.admin.SkywardDeviceAdmin"
    if output.to_lowercase().contains("success") {
        Ok("Device Owner set successfully.".to_string())
    } else {
        Err(format!("Failed to set Device Owner: {}", output.trim()))
    }
}

/// Tauri command: Send broadcast to clear Device Owner status (relinquish control for testing/uninstallation).
/// Triggers AdbCommandReceiver in the Android app.
#[tauri::command]
pub async fn clear_device_owner(app: tauri::AppHandle, device_id: String) -> Result<String, String> {
    let output = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &[
            "shell",
            "am",
            "broadcast",
            "-a",
            CLEAR_OWNER_ACTION,
            "-n",
            &format!("{}/.receiver.AdbCommandReceiver", PACKAGE_NAME),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(format!("Clear command broadcast sent: {}", output.trim()))
}

/// Tauri command: Uninstall SkywardBlocker from the device.
/// First sends the clear_device_owner broadcast, waits briefly, then uninstalls.
#[tauri::command]
pub async fn uninstall_app(app: tauri::AppHandle, device_id: String) -> Result<String, String> {
    // 1. Try to clear device owner first so uninstallation isn't blocked by OS
    let _ = clear_device_owner(app.clone(), device_id.clone()).await;

    // Give receiver a moment to process the clear command
    std::thread::sleep(std::time::Duration::from_millis(1000));

    // 2. Uninstall package
    let output = adb::run_adb_for_device(Some(&app), &device_id, &["uninstall", PACKAGE_NAME])
        .map_err(|e| e.to_string())?;

    if output.contains("Success") {
        Ok("SkywardBlocker uninstalled successfully.".to_string())
    } else {
        Err(format!("Uninstall failed: {}", output.trim()))
    }
}

/// Tauri command: Verify that SkywardBlocker is both installed and set as Device Owner.
///
/// USB debugging is intentionally left enabled by the app at all times, so this check —
/// and push_config/push_schedule/launch_app — can rely on ADB staying connected. A
/// disconnection here is a real problem, not an expected side effect to paper over.
#[tauri::command]
pub async fn verify_installation(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<VerificationResult, String> {
    // 1. Check if package is installed
    let pm_output = match adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["shell", "pm", "list", "packages", PACKAGE_NAME],
    ) {
        Err(e) => {
            return Ok(VerificationResult {
                is_installed: false,
                is_device_owner: false,
                success: false,
                message: format!("Verification failed: {}", e),
            });
        }
        Ok(output) => output,
    };

    let is_installed = pm_output.contains(PACKAGE_NAME);
    if !is_installed {
        return Ok(VerificationResult {
            is_installed: false,
            is_device_owner: false,
            success: false,
            message: "SkywardBlocker is not installed on the device.".to_string(),
        });
    }

    // 2. Check if package is device owner
    let dpm_output = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["shell", "dumpsys", "device_policy"],
    )
    .unwrap_or_default();

    let is_device_owner = dpm_output.contains(DEVICE_ADMIN_COMPONENT)
        || (dpm_output.contains("Device Owner:") && dpm_output.contains(PACKAGE_NAME));

    let success = is_installed && is_device_owner;
    let message = if success {
        "SkywardBlocker is installed and actively running as Device Owner.".to_string()
    } else {
        "SkywardBlocker is installed, but is NOT configured as Device Owner.".to_string()
    };

    Ok(VerificationResult {
        is_installed,
        is_device_owner,
        success,
        message,
    })
}

/// Tauri command: Explicitly launch SkywardBlocker MainActivity over ADB.
/// This brings the newly installed app out of Android's default "Stopped State",
/// waking up all background services, DNS rules, and blocking protections automatically
/// without requiring the user to tap the app icon on their phone.
#[tauri::command]
pub async fn launch_app(app: tauri::AppHandle, device_id: String) -> Result<String, String> {
    let output = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &[
            "shell",
            "am",
            "start",
            "-n",
            &format!("{}/.MainActivity", PACKAGE_NAME),
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
        ],
    )
    .map_err(|e| e.to_string())?;

    if output.contains("Error:") || output.contains("Exception") {
        Err(format!("Failed to launch app: {}", output.trim()))
    } else {
        Ok("SkywardBlocker launched successfully and activated!".to_string())
    }
}
