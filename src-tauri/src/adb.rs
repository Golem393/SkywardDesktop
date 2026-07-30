use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

/// Errors that can occur when running ADB commands.
#[derive(Debug, serde::Serialize)]
pub enum AdbError {
    /// ADB binary was not found (neither bundled nor on system PATH).
    NotFound(String),
    /// ADB command failed to execute.
    ExecutionFailed(String),
    /// ADB command returned a non-zero exit code.
    CommandFailed { code: i32, stderr: String },
    /// Failed to parse ADB output.
    ParseError(String),
}

impl std::fmt::Display for AdbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdbError::NotFound(msg) => write!(f, "ADB not found: {}", msg),
            AdbError::ExecutionFailed(msg) => write!(f, "ADB execution failed: {}", msg),
            AdbError::CommandFailed { code, stderr } => {
                write!(f, "ADB exited with code {}: {}", code, stderr)
            }
            AdbError::ParseError(msg) => write!(f, "ADB parse error: {}", msg),
        }
    }
}

/// Information about a connected Android device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Device {
    /// Device serial number (e.g. "R5CR1234567")
    pub serial: String,
    /// Device status: "device", "unauthorized", "offline", etc.
    pub status: String,
    /// Human-readable model name (e.g. "Galaxy_A54"), if available.
    pub model: Option<String>,
    /// Device product name, if available.
    pub product: Option<String>,
}

/// Resolve the path to the ADB binary.
///
/// Resolution order:
/// 1. Bundled binary in Tauri resources (for packaged builds)
/// 2. Local project resources copied by the setup script (for `tauri dev`)
/// 3. Android SDK environment variables and PATH (for existing local installs)
pub fn resolve_adb_path(app_handle: Option<&tauri::AppHandle>) -> Result<PathBuf, AdbError> {
    let platform_dir = if cfg!(target_os = "linux") {
        "platform-tools-linux"
    } else if cfg!(target_os = "windows") {
        "platform-tools-windows"
    } else if cfg!(target_os = "macos") {
        "platform-tools-macos"
    } else {
        "platform-tools-linux"
    };

    let adb_name = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };

    eprintln!("[ADB Debug] Resolving ADB binary for platform '{}'", platform_dir);

    if let Some(handle) = app_handle {
        if let Ok(resource_dir) = handle.path().resource_dir() {
            let bundled_path = resource_dir.join(platform_dir).join(adb_name);
            eprintln!("[ADB Debug] Checking bundled resource path: {}", bundled_path.display());
            if bundled_path.exists() {
                eprintln!("[ADB Debug] Using bundled ADB from resource directory: {}", bundled_path.display());
                return Ok(bundled_path);
            }
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let local_resources = PathBuf::from(manifest_dir).join("resources").join(platform_dir).join(adb_name);
        eprintln!("[ADB Debug] Checking local project resources: {}", local_resources.display());
        if local_resources.exists() {
            eprintln!("[ADB Debug] Using local project ADB bundle: {}", local_resources.display());
            return Ok(local_resources);
        }
    }

    let sdk_candidates = [
        std::env::var_os("ANDROID_HOME").map(|v| PathBuf::from(v).join("platform-tools").join(adb_name)),
        std::env::var_os("ANDROID_SDK_ROOT").map(|v| PathBuf::from(v).join("platform-tools").join(adb_name)),
    ];

    for candidate in sdk_candidates.into_iter().flatten() {
        eprintln!("[ADB Debug] Checking Android SDK path: {}", candidate.display());
        if candidate.exists() {
            eprintln!("[ADB Debug] Using ADB from Android SDK env: {}", candidate.display());
            return Ok(candidate);
        }
    }

    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    eprintln!("[ADB Debug] Checking system PATH using '{}' {}", which_cmd, adb_name);

    match Command::new(which_cmd).arg(adb_name).output() {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(first_line) = path.lines().next() {
                let path_buf = PathBuf::from(first_line.trim());
                eprintln!("[ADB Debug] Using ADB from PATH: {}", path_buf.display());
                return Ok(path_buf);
            }
        }
        Ok(output) => {
            eprintln!("[ADB Debug] PATH probe failed: {}", String::from_utf8_lossy(&output.stderr));
        }
        Err(err) => {
            eprintln!("[ADB Debug] PATH probe error: {}", err);
        }
    }

    Err(AdbError::NotFound(
        "ADB not found. The setup script should have downloaded platform-tools; if it failed, check the terminal output above."
            .to_string(),
    ))
}

/// Run an ADB command and return its stdout as a String.
pub fn run_adb(
    app_handle: Option<&tauri::AppHandle>,
    args: &[&str],
) -> Result<String, AdbError> {
    let adb_path = resolve_adb_path(app_handle)?;
    eprintln!("[ADB Debug] Executing command: {} {}", adb_path.display(), args.join(" "));

    let output = Command::new(&adb_path)
        .args(args)
        .output()
        .map_err(|e| {
            eprintln!("[ADB Error] Failed to launch ADB: {}", e);
            AdbError::ExecutionFailed(format!("{}: {}", adb_path.display(), e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        eprintln!("[ADB Error] ADB exited with code {}", output.status.code().unwrap_or(-1));
        eprintln!("[ADB Error] stdout: {}", stdout.trim());
        eprintln!("[ADB Error] stderr: {}", stderr.trim());
        return Err(AdbError::CommandFailed {
            code: output.status.code().unwrap_or(-1),
            stderr,
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    eprintln!("[ADB Debug] Command succeeded; output: {}", stdout.trim());
    Ok(stdout)
}

/// Run an ADB command targeted at a specific device.
pub fn run_adb_for_device(
    app_handle: Option<&tauri::AppHandle>,
    device_id: &str,
    args: &[&str],
) -> Result<String, AdbError> {
    let mut full_args = vec!["-s", device_id];
    full_args.extend_from_slice(args);
    run_adb(app_handle, &full_args)
}

/// Parse the output of `adb devices -l` into a list of Device structs.
///
/// Example input:
/// ```text
/// List of devices attached
/// R5CR1234567            device usb:1-1 product:a54xeea model:SM_A546B device:a54x transport_id:1
/// ABCD1234               unauthorized usb:1-2 transport_id:2
/// ```
pub fn parse_device_list(output: &str) -> Vec<Device> {
    let mut devices = Vec::new();

    for line in output.lines() {
        let line = line.trim();

        // Skip header and empty lines
        if line.is_empty() || line.starts_with("List of devices") || line.starts_with("*") {
            continue;
        }

        // Each line: <serial>\t<status> [key:value ...]
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() < 2 {
            continue;
        }

        let serial = parts[0].to_string();
        let rest = parts[1].trim();

        // Status is the first token of the rest
        let status_and_props: Vec<&str> = rest.split_whitespace().collect();
        let status = status_and_props
            .first()
            .unwrap_or(&"unknown")
            .to_string();

        // Parse key:value properties
        let mut model = None;
        let mut product = None;

        for prop in &status_and_props[1..] {
            if let Some(val) = prop.strip_prefix("model:") {
                model = Some(val.replace('_', " "));
            } else if let Some(val) = prop.strip_prefix("product:") {
                product = Some(val.to_string());
            }
        }

        devices.push(Device {
            serial,
            status,
            model,
            product,
        });
    }

    devices
}

/// Detect all connected Android devices.
pub fn detect_devices(app_handle: Option<&tauri::AppHandle>) -> Result<Vec<Device>, AdbError> {
    let output = run_adb(app_handle, &["devices", "-l"])?;
    Ok(parse_device_list(&output))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_device_list_with_device() {
        let output = "List of devices attached\nR5CR1234567            device usb:1-1 product:a54xeea model:SM_A546B device:a54x transport_id:1\n\n";
        let devices = parse_device_list(output);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].serial, "R5CR1234567");
        assert_eq!(devices[0].status, "device");
        assert_eq!(devices[0].model, Some("SM A546B".to_string()));
        assert_eq!(devices[0].product, Some("a54xeea".to_string()));
    }

    #[test]
    fn test_parse_device_list_unauthorized() {
        let output = "List of devices attached\nABCD1234               unauthorized usb:1-2 transport_id:2\n\n";
        let devices = parse_device_list(output);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].serial, "ABCD1234");
        assert_eq!(devices[0].status, "unauthorized");
        assert_eq!(devices[0].model, None);
    }

    #[test]
    fn test_parse_device_list_empty() {
        let output = "List of devices attached\n\n";
        let devices = parse_device_list(output);
        assert_eq!(devices.len(), 0);
    }

    #[test]
    fn test_parse_device_list_multiple() {
        let output = "List of devices attached\nDEVICE1  device model:Pixel_7\nDEVICE2  device model:Galaxy_S24\n\n";
        let devices = parse_device_list(output);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].model, Some("Pixel 7".to_string()));
        assert_eq!(devices[1].model, Some("Galaxy S24".to_string()));
    }
}
