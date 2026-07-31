use crate::adb;
use tauri::AppHandle;

/// Tauri command: Push a daily locked-hours schedule to the installed Android app via
/// ADB broadcast. Kept as a sibling command to `push_config` rather than merged into it —
/// schedule and network/DNS config are independent concerns pushed at different times
/// (the schedule can be re-pushed via "Adjust Locked Hours" without touching
/// base_url/api_key/dns_hostname).
#[tauri::command]
pub async fn push_schedule(
    app: AppHandle,
    device_id: String,
    lock_start_hour: u8,
    lock_start_minute: u8,
    lock_end_hour: u8,
    lock_end_minute: u8,
    timezone_id: String,
) -> Result<String, String> {
    let args = [
        "shell",
        "am",
        "broadcast",
        "-a",
        "com.example.skywardblocker.PUSH_SCHEDULE",
        "-n",
        "com.example.skywardblocker/.receiver.AdbCommandReceiver",
        "--ei",
        "lock_start_hour",
        &lock_start_hour.to_string(),
        "--ei",
        "lock_start_minute",
        &lock_start_minute.to_string(),
        "--ei",
        "lock_end_hour",
        &lock_end_hour.to_string(),
        "--ei",
        "lock_end_minute",
        &lock_end_minute.to_string(),
        "--es",
        "timezone_id",
        &timezone_id,
    ];

    let output = adb::run_adb_for_device(Some(&app), &device_id, &args)
        .map_err(|e| format!("Failed to push schedule via ADB: {}", e))?;

    Ok(format!("Schedule pushed successfully! Output: {}", output.trim()))
}
