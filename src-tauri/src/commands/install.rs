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

/// Global settings that pre-answer Play Protect's package verifier, and the values that
/// silence it: skip verification for ADB-installed packages, and record the upload
/// consent question as already declined.
const PLAY_PROTECT_SETTINGS: [(&str, &str); 2] = [
    ("verifier_verify_adb_installs", "0"),
    ("package_verifier_user_consent", "-1"),
];

/// Pre-answer Play Protect so it can't interrupt provisioning with its upload prompt.
///
/// The verifier asks for consent to upload any APK whose (package, signing certificate,
/// hash) triple Google has never seen — which is every build we sideload, and a fresh
/// one every time we rebuild. Most installs happen on a device with no accounts, where
/// GMS never gets around to asking; but when accounts are present or were just re-added
/// it fires as a full-screen "Send app for a security check?" dialog on top of setup.
/// A parent who taps "Don't send" can leave the install visibly stalled.
///
/// `adb shell` holds WRITE_SECURE_SETTINGS, so we can set both keys ourselves. They are
/// global settings that survive reboots, so writing them once per install keeps holding.
///
/// Best-effort on purpose. Some OEM builds refuse these keys or let a GMS update reset
/// them, and a device that still shows the prompt is a far better outcome than one we
/// refuse to install on — so failures are logged and the install proceeds.
fn suppress_play_protect_prompt(app: &tauri::AppHandle, device_id: &str) {
    for (key, value) in PLAY_PROTECT_SETTINGS {
        if let Err(e) = adb::run_adb_for_device(
            Some(app),
            device_id,
            &["shell", "settings", "put", "global", key, value],
        ) {
            eprintln!("[Play Protect] Could not set {} = {}: {}", key, value, e);
        }
    }
}

/// Tauri command: Install an APK onto the target device.
/// Uses `-t` flag to allow testOnly APKs (common during development).
#[tauri::command]
pub async fn install_apk(
    app: tauri::AppHandle,
    device_id: String,
    apk_path: String,
) -> Result<String, String> {
    // Must happen before the push: the verifier runs as part of the install itself, so
    // setting these afterwards would be one install too late.
    suppress_play_protect_prompt(&app, &device_id);

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

/// Marker in the DPM failure for the ACCOUNTS_NOT_EMPTY precondition. Matched on the
/// distinctive tail of "Not allowed to set the device owner because there are already
/// some accounts on the device." so it survives minor wording drift between OS versions.
const ACCOUNTS_NOT_EMPTY: &str = "some accounts on the device";

/// How long to keep retrying while DPM still believes accounts exist.
///
/// Measured generously on purpose. Observed on a Samsung A17: `dumpsys account` reported
/// zero accounts, the ~10s APK push happened, and DPM still rejected provisioning for
/// several more attempts — succeeding only tens of seconds later. So the settle is not a
/// one-second race and a short window just produces a confusing hard failure.
///
/// Only the accounts rejection waits this out, and only a parent who genuinely just
/// signed out can hit it — anyone with accounts still on the phone is stopped by
/// `check_prerequisites` long before this runs. Nobody else pays the wait.
const OWNER_RETRY_ATTEMPTS: usize = 30;
const OWNER_RETRY_DELAY_MS: u64 = 3000;

/// Tauri command: Set SkywardBlocker as the Device Owner via Device Policy Manager (DPM).
///
/// Removing the last account is not instantaneous. Observed on hardware: immediately
/// after the parent removes their accounts, `dumpsys account` already reports zero — so
/// `check_prerequisites` passes — while DPM still rejects provisioning with
/// ACCOUNTS_NOT_EMPTY. Retrying the identical command a couple of seconds later
/// succeeds. Since setup now asks for account removal right before this call, a single
/// attempt would hand the parent a hard failure blaming accounts they just removed.
///
/// Only that specific rejection is retried; every other failure is real and returns at
/// once rather than making the parent wait out the backoff.
#[tauri::command]
pub async fn set_device_owner(app: tauri::AppHandle, device_id: String) -> Result<String, String> {
    let mut last_failure = String::new();

    for attempt in 0..OWNER_RETRY_ATTEMPTS {
        // A rejected provisioning exits 255 and prints the Java exception on stderr, so the
        // reason arrives as CommandFailed rather than as Ok output — checking the success
        // path alone would never see it.
        let failure = match adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "dpm", "set-device-owner", DEVICE_ADMIN_COMPONENT],
        ) {
            // DPM prints "Success: Device owner set to package ..." on stdout.
            Ok(output) if output.to_lowercase().contains("success") => {
                return Ok("Device Owner set successfully.".to_string());
            }
            // Exit 0 without the success marker shouldn't happen, but treat it as a
            // failure rather than silently reporting a Device Owner that isn't set.
            Ok(output) => output.trim().to_string(),
            Err(adb::AdbError::CommandFailed { stderr, .. }) => stderr.trim().to_string(),
            // Missing binary, dead device: not something a retry can fix.
            Err(other) => return Err(other.to_string()),
        };

        last_failure = failure;

        let accounts_still_settling = last_failure.contains(ACCOUNTS_NOT_EMPTY);
        if !accounts_still_settling || attempt + 1 == OWNER_RETRY_ATTEMPTS {
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(OWNER_RETRY_DELAY_MS));
    }

    Err(format!("Failed to set Device Owner: {}", last_failure))
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
