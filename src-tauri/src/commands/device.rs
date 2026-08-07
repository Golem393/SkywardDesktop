use crate::adb::{self, Device};
use std::collections::{HashMap, HashSet};
use std::process::Command;

/// Result of prerequisite checks on a connected device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrerequisiteResult {
    /// True if the device is authorized (USB debugging accepted).
    pub usb_authorized: bool,
    /// True if Skyward is not already installed on the phone.
    pub no_existing_install: bool,
    /// True if no other app is already set as device owner.
    pub no_existing_owner: bool,
    /// True if no Google accounts are present on the device (required for set-device-owner).
    pub no_accounts: bool,
    /// Unique accounts found on the device, formatted with a friendly app
    /// label where one could be resolved (e.g. "Instagram (user@example.com)"),
    /// falling back to "name (type)" otherwise.
    pub accounts: Vec<String>,
    /// Human-readable messages for each check.
    pub messages: Vec<String>,
    /// True if all critical checks pass and installation can proceed.
    pub can_proceed: bool,
}

/// Parses `dumpsys account` output into a deduplicated, sorted list of
/// (name, type) pairs.
///
/// `dumpsys account` prints every account more than once — once in the
/// top-level summary and again inside each per-user `UserAccounts` block —
/// so naively counting `"Account {"` occurrences overcounts. This dedupes
/// by (name, type) so each real account is only reported once.
fn parse_unique_accounts(dumpsys_output: &str) -> Vec<(String, String)> {
    let mut seen = HashSet::new();

    for line in dumpsys_output.lines() {
        let line = line.trim();
        let Some(inner) = line
            .strip_prefix("Account {")
            .and_then(|s| s.strip_suffix('}'))
        else {
            continue;
        };

        let mut name = None;
        let mut account_type = None;
        for field in inner.split(',') {
            let field = field.trim();
            if let Some(v) = field.strip_prefix("name=") {
                name = Some(v.trim());
            } else if let Some(v) = field.strip_prefix("type=") {
                account_type = Some(v.trim());
            }
        }

        if let (Some(name), Some(account_type)) = (name, account_type) {
            seen.insert((name.to_string(), account_type.to_string()));
        }
    }

    let mut accounts: Vec<(String, String)> = seen.into_iter().collect();
    accounts.sort();
    accounts
}

/// Account types that are well-known enough to label without touching the
/// device again — mostly system/OEM authenticators that either aren't a
/// queryable app package (`com.google`) or are always present under the same
/// name, so it's not worth a `pm path` + APK pull round-trip for them.
const KNOWN_ACCOUNT_TYPES: &[(&str, &str)] = &[
    ("com.google", "Google"),
    ("com.google.android.gm.exchange", "Exchange (Gmail)"),
    ("com.osp.app.signin", "Samsung account"),
    ("com.samsung.android.mobileservice", "Samsung account"),
    ("com.microsoft.workaccount", "Microsoft"),
    ("com.microsoft.office.outlook", "Microsoft Outlook"),
];

/// Best-effort resolve of a friendly display name for an account's `type`
/// (an authenticator package name, e.g. `com.instagram.android`).
///
/// Tries, in order: the static list of known system account types, then the
/// installed app's real label pulled from its APK via `aapt`/`aapt2` (only
/// possible if a local Android SDK is available), caching results in `cache`
/// so repeated accounts of the same type don't re-pull the APK.
fn resolve_account_type_label(
    app: &tauri::AppHandle,
    device_id: &str,
    account_type: &str,
    cache: &mut HashMap<String, Option<String>>,
) -> Option<String> {
    if let Some((_, label)) = KNOWN_ACCOUNT_TYPES.iter().find(|(t, _)| *t == account_type) {
        return Some(label.to_string());
    }

    if let Some(cached) = cache.get(account_type) {
        return cached.clone();
    }

    let label = fetch_installed_app_label(app, device_id, account_type);
    cache.insert(account_type.to_string(), label.clone());
    label
}

/// Pulls the APK for `package` off the device and reads its application
/// label via `aapt`/`aapt2`. Returns `None` if no local SDK build-tools are
/// available, the package isn't a real installed app, or anything in the
/// pull/parse chain fails — callers should fall back to a generic display.
fn fetch_installed_app_label(app: &tauri::AppHandle, device_id: &str, package: &str) -> Option<String> {
    let aapt_path = adb::resolve_aapt_path()?;

    let path_output = adb::run_adb_for_device(
        Some(app),
        device_id,
        &["shell", "pm", "path", package],
    )
    .ok()?;
    let remote_apk_path = path_output.lines().next()?.trim().strip_prefix("package:")?;

    let local_apk_path = std::env::temp_dir().join(format!(
        "skywardblocker_label_{}.apk",
        package.replace(|c: char| !c.is_ascii_alphanumeric(), "_")
    ));
    let local_apk_str = local_apk_path.to_str()?;

    adb::run_adb_for_device(Some(app), device_id, &["pull", remote_apk_path, local_apk_str]).ok()?;

    let badging_output = Command::new(&aapt_path)
        .args(["dump", "badging", local_apk_str])
        .output()
        .ok();

    let _ = std::fs::remove_file(&local_apk_path);

    let stdout = String::from_utf8_lossy(&badging_output?.stdout).to_string();
    stdout.lines().find_map(|line| {
        line.strip_prefix("application-label:'")
            .and_then(|rest| rest.strip_suffix('\''))
            .map(|label| label.to_string())
    })
}

/// Builds the display string for one account, preferring a friendly app
/// label with the account's own name/email attached, and falling back to the
/// raw `name (type)` pair when no label could be resolved.
fn format_account_display(name: &str, account_type: &str, label: Option<&str>) -> String {
    let name_is_identifier = name.contains('@') || name.chars().any(|c| c.is_ascii_digit());
    match label {
        Some(label) if name_is_identifier => format!("{} ({})", label, name),
        Some(label) => label.to_string(),
        None => format!("{} ({})", name, account_type),
    }
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
            message: "Connect your device via USB and enable USB debugging to continue. Make sure file transferring is allowed.".to_string(),
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

/// Tauri command: open the phone's Accounts screen over ADB.
///
/// `SYNC_SETTINGS` is the Accounts dashboard (verified resolving to
/// `Settings$AccountDashboardActivity` on Samsung One UI); `ACCOUNT_SYNC_SETTINGS`
/// is the per-account sync detail page and is the wrong target here. Saves the
/// parent hunting through Settings when the account check fails.
#[tauri::command]
pub async fn open_account_settings(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<String, String> {
    adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["shell", "am", "start", "-a", "android.settings.SYNC_SETTINGS"],
    )
    .map_err(|e| e.to_string())?;

    Ok("Opened the Accounts screen on the phone.".to_string())
}

/// Tauri command: check prerequisites before installation.
///
/// Checks:
/// 1. Device is authorized (USB debugging prompt accepted)
/// 2. SkywardBlocker is not already installed on the device
/// 3. No existing device owner is active on the device
/// 4. No accounts on device (required for `dpm set-device-owner`)
///
/// Note on (4): the blocking set is every `AccountManager` account, not just Google
/// ones. Being logged into an app is not the same thing — verified on hardware, where
/// Instagram and StarMaker held live sessions with no account entry (and so did not
/// block) while Telegram and Polarsteps did register accounts. `dumpsys account` is the
/// only reliable source; never special-case a package.
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

    // 2. Check if Skyward is already installed on the phone
    let no_existing_install = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "pm", "list", "packages", "com.example.skywardblocker"],
        )
        .unwrap_or_default();

        let is_installed = output.contains("com.example.skywardblocker");
        if !is_installed {
            messages.push("✅ Skyward is not currently installed on device".to_string());
            true
        } else {
            messages.push("❌ Skyward is already installed on this phone — uninstall it before the new setup".to_string());
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
            messages.push("❌ A Device Owner is already active — contact the company who configured this device".to_string());
            false
        }
    } else {
        messages.push("⏳ Cannot check device owner (device not authorized)".to_string());
        false
    };

    // 4. Check for Google accounts on device
    let (no_accounts, accounts) = if usb_authorized {
        let output = adb::run_adb_for_device(
            Some(&app),
            &device_id,
            &["shell", "dumpsys", "account"],
        )
        .unwrap_or_default();

        // If there are accounts present, dpm set-device-owner will fail
        let raw_accounts = parse_unique_accounts(&output);

        if raw_accounts.is_empty() {
            messages.push("✅ No accounts signed in on the phone".to_string());
            (true, Vec::new())
        } else {
            messages.push(format!(
                "❌ {} account(s) signed in — you may need to sign out of these accounts",
                raw_accounts.len()
            ));
            let mut label_cache = HashMap::new();
            let accounts: Vec<String> = raw_accounts
                .iter()
                .map(|(name, account_type)| {
                    let label = resolve_account_type_label(&app, &device_id, account_type, &mut label_cache);
                    format_account_display(name, account_type, label.as_deref())
                })
                .collect();
            // The names themselves are returned in `accounts` and rendered by the UI as a
            // sign-out/sign-back-in checklist, so they are deliberately not repeated here.
            (false, accounts)
        }
    } else {
        messages.push("⏳ Cannot check accounts (device not authorized)".to_string());
        (false, Vec::new())
    };

    let can_proceed = usb_authorized && no_existing_install && no_existing_owner && no_accounts;

    Ok(PrerequisiteResult {
        usb_authorized,
        no_existing_install,
        no_existing_owner,
        no_accounts,
        accounts,
        messages,
        can_proceed,
    })
}
