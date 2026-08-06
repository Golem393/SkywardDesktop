use crate::adb;
use tauri::AppHandle;

pub const DEFAULT_BACKEND_URL: &str = "https://mdm-backend-i4b0.onrender.com/api";
pub const DEFAULT_API_KEY: &str = "api_3d9a7c1f5b824e9aa4d6f7c8b1e2a3d4";

/// Tauri command: Push runtime configuration (base_url, api_key) to the installed Android app via ADB broadcast.
/// If arguments are None or omitted by the frontend, defaults automatically to the central constants above.
#[tauri::command]
pub async fn push_config(
    app: AppHandle,
    device_id: String,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let final_url = base_url.as_deref().unwrap_or(DEFAULT_BACKEND_URL);
    let final_key = api_key.as_deref().unwrap_or(DEFAULT_API_KEY);

    let args = [
        "shell",
        "am",
        "broadcast",
        "-a",
        "com.example.skywardblocker.PUSH_CONFIG",
        "-n",
        "com.example.skywardblocker/.receiver.AdbCommandReceiver",
        "--es",
        "base_url",
        final_url,
        "--es",
        "api_key",
        final_key,
    ];

    let output = adb::run_adb_for_device(Some(&app), &device_id, &args)
        .map_err(|e| format!("Failed to push configuration via ADB: {}", e))?;

    Ok(format!("Configuration pushed successfully! Output: {}", output.trim()))
}
