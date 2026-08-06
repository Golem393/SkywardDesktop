use crate::adb;
use tauri::AppHandle;

/// Tauri command: Push the locked-hours schedule to the installed Android app via ADB
/// broadcast. Kept as a sibling command to `push_config` rather than merged into it —
/// schedule and app config are independent concerns pushed at different times
/// (the schedule is pushed from the Home page, config only during enrolment).
///
/// `days_mask` is a weekday bitmask (bit 0 = Sunday … bit 6 = Saturday). `active_from` and
/// `active_until` bound the block period in epoch millis; once `active_until` passes the
/// schedule expires on-device and the phone unblocks permanently.
#[tauri::command]
pub async fn push_schedule(
    app: AppHandle,
    device_id: String,
    lock_start_hour: u8,
    lock_start_minute: u8,
    lock_end_hour: u8,
    lock_end_minute: u8,
    days_mask: u16,
    active_from: i64,
    active_until: i64,
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
        "--ei",
        "days_mask",
        &days_mask.to_string(),
        // `--el` (long) rather than `--ei` — epoch millis overflow a 32-bit int extra.
        "--el",
        "active_from",
        &active_from.to_string(),
        "--el",
        "active_until",
        &active_until.to_string(),
        "--es",
        "timezone_id",
        &timezone_id,
    ];

    let output = adb::run_adb_for_device(Some(&app), &device_id, &args)
        .map_err(|e| format!("Failed to push schedule via ADB: {}", e))?;

    Ok(format!("Schedule pushed successfully! Output: {}", output.trim()))
}
