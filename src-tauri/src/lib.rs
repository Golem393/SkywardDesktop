mod adb;
mod commands;

use commands::auth::verify_subscription;
use commands::config::push_config;
use commands::device::{
    check_prerequisites, detect_devices, get_device_info, is_device_connected,
    open_account_settings,
};
use commands::install::{
    clear_device_owner, install_apk, launch_app, set_device_owner, uninstall_app,
    verify_installation,
};
use commands::schedule::push_schedule;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_devices,
            get_device_info,
            is_device_connected,
            check_prerequisites,
            open_account_settings,
            install_apk,
            set_device_owner,
            clear_device_owner,
            uninstall_app,
            verify_installation,
            verify_subscription,
            push_config,
            launch_app,
            push_schedule
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
