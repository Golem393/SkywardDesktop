mod adb;

use adb::Device;

/// Tauri command: detect all connected Android devices via ADB.
/// Returns a list of devices with serial, status, model, and product info.
#[tauri::command]
fn detect_devices(app: tauri::AppHandle) -> Result<Vec<Device>, String> {
    adb::detect_devices(Some(&app)).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_devices])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
