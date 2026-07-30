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
/// 1. Bundled binary in Tauri resources (for distribution)
/// 2. Local project development resources (for `tauri dev`)
/// 3. Common system directories (e.g. C:\platform-tools, Android SDK)
/// 4. System PATH via `which`/`where`
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

    // 1. Try bundled binary from Tauri resources
    if let Some(handle) = app_handle {
        if let Ok(resource_dir) = handle.path().resource_dir() {
            let bundled_path = resource_dir.join(platform_dir).join(adb_name);
            eprintln!("[ADB Debug] Checking Tauri resource_dir: {}", bundled_path.display());
            if bundled_path.exists() {
                eprintln!("[ADB Debug] Found ADB at: {}", bundled_path.display());
                return Ok(bundled_path);
            }
        }
    }

    // 2. Try local project resource folders (for `tauri dev` running from source)
    let mut candidate_paths = vec![
        PathBuf::from(format!("resources/{}/{}", platform_dir, adb_name)),
        PathBuf::from(format!("src-tauri/resources/{}/{}", platform_dir, adb_name)),
        PathBuf::from(format!("../src-tauri/resources/{}/{}", platform_dir, adb_name)),
    ];

    // Check relative to current executable in target/debug
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            // target/debug/../../src-tauri/resources/...
            candidate_paths.push(parent.join("../../src-tauri/resources").join(platform_dir).join(adb_name));
            // target/debug/resources/...
            candidate_paths.push(parent.join("resources").join(platform_dir).join(adb_name));
        }
    }

    // 3. Common standalone and Android SDK installation folders (especially useful on Windows/Mac)
    if cfg!(target_os = "windows") {
        candidate_paths.push(PathBuf::from(r#"C:\platform-tools\adb.exe"#));
        candidate_paths.push(PathBuf::from(r#"C:\Android\platform-tools\adb.exe"#));
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            candidate_paths.push(PathBuf::from(format!(r#"{}\Android\Sdk\platform-tools\adb.exe"#, appdata)));
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            candidate_paths.push(PathBuf::from(format!(r#"{}\AppData\Local\Android\Sdk\platform-tools\adb.exe"#, userprofile)));
            candidate_paths.push(PathBuf::from(format!(r#"{}\Android\Sdk\platform-tools\adb.exe"#, userprofile)));
        }
    } else {
        if let Ok(home) = std::env::var("HOME") {
            candidate_paths.push(PathBuf::from(format!("{}/Library/Android/sdk/platform-tools/adb", home)));
            candidate_paths.push(PathBuf::from(format!("{}/Android/Sdk/platform-tools/adb", home)));
        }
        candidate_paths.push(PathBuf::from("/usr/bin/adb"));
        candidate_paths.push(PathBuf::from("/usr/local/bin/adb"));
        candidate_paths.push(PathBuf::from("/opt/homebrew/bin/adb"));
    }

    for path in &candidate_paths {
        if path.exists() {
            eprintln!("[ADB Debug] Found ADB at fallback path: {}", path.display());
            return Ok(path.clone());
        }
    }

    // 4. Fall back to system PATH via `where` or `which`
    let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    eprintln!("[ADB Debug] Checking system PATH using '{} {}'", which_cmd, adb_name);

    match Command::new(which_cmd).arg(adb_name).output() {
        Ok(output) if output.status.success() => {
            let output_str = String::from_utf8_lossy(&output.stdout);
            // Importantly: take only the first line! On Windows `where` outputs all matches separated by newlines.
            if let Some(first_line) = output_str.lines().next() {
                let path = first_line.trim().to_string();
                if !path.is_empty() {
                    let pb = PathBuf::from(&path);
                    eprintln!("[ADB Debug] Found ADB on system PATH: {}", pb.display());
                    return Ok(pb);
                }
            }
            Err(AdbError::NotFound("ADB command found on PATH but returned empty path string.".to_string()))
        }
        _ => {
            eprintln!("[ADB Debug] ADB binary could not be found anywhere!");
            Err(AdbError::NotFound(
                "ADB not found. Ensure adb is in C:\\platform-tools or on your system PATH.".to_string(),
            ))
        }
    }
}

/// Run an ADB command and return its stdout as a String.
pub fn run_adb(
    app_handle: Option<&tauri::AppHandle>,
    args: &[&str],
) -> Result<String, AdbError> {
    let adb_path = resolve_adb_path(app_handle)?;
    eprintln!("[ADB Debug] Executing: {} {}", adb_path.display(), args.join(" "));

    let output = Command::new(&adb_path)
        .args(args)
        .output()
        .map_err(|e| {
            let err_msg = format!("{}: {}", adb_path.display(), e);
            eprintln!("[ADB Error] Execution failed: {}", err_msg);
            AdbError::ExecutionFailed(err_msg)
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        eprintln!("[ADB Error] Command failed (code {}): {}", output.status.code().unwrap_or(-1), stderr.trim());
        return Err(AdbError::CommandFailed {
            code: output.status.code().unwrap_or(-1),
            stderr,
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
