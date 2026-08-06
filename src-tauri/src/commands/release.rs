//! Fetching the SkywardBlocker APK from cloud storage, and reading back what's installed.
//!
//! The parent used to type an absolute path to an APK they had to obtain themselves. Now
//! the backend names the current release and hands over a signed URL, and this module
//! turns that into a verified local file that `install_apk` can consume unchanged.

use std::io::Write;
use std::path::PathBuf;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};

use crate::adb;

/// Progress of an APK download, emitted as `apk-download-progress` so the UI can show a
/// real bar rather than an indeterminate spinner — this is the slowest step of setup on a
/// poor connection, and an unmoving spinner reads as a hang.
#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    /// Total size from the release record, so the bar is accurate even when the response
    /// carries no Content-Length.
    pub total: u64,
}

/// What SkywardBlocker reports on the device, if it is installed at all.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledVersion {
    pub is_installed: bool,
    /// Android's upgrade comparison key. `None` when not installed, or when the dump
    /// couldn't be parsed.
    pub version_code: Option<i64>,
    /// The human-readable string, e.g. "1.2".
    pub version_name: Option<String>,
}

const PACKAGE_NAME: &str = "com.example.skywardblocker";

/// Where downloaded APKs are kept, named by version code.
///
/// The cache directory rather than app data: these are reproducible downloads, and a user
/// or OS that clears the cache costs one re-download, not any state.
fn apk_cache_path(app: &tauri::AppHandle, version_code: i64) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Could not resolve the cache directory: {}", e))?
        .join("apks");

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create the download directory: {}", e))?;

    Ok(dir.join(format!("skywardblocker-{}.apk", version_code)))
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// SHA-256 of a file already on disk, for validating the cache.
fn hash_file(path: &PathBuf) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex_digest(&hasher.finalize()))
}

/// Tauri command: fetch the release APK and return a path to the verified local file.
///
/// The hash is checked before the file is ever handed back, and a mismatch deletes the
/// download rather than leaving it in place. That matters more than it looks: a truncated
/// APK that survives on disk would be found by the cache check on every subsequent attempt,
/// turning one bad network moment into a permanent, self-healing-proof failure.
#[tauri::command]
pub async fn download_apk(
    app: tauri::AppHandle,
    url: String,
    sha256: String,
    version_code: i64,
    size_bytes: u64,
) -> Result<String, String> {
    let expected = sha256.trim().to_lowercase();
    let target = apk_cache_path(&app, version_code)?;

    // Already downloaded and intact — skip the network entirely. This is what makes the
    // Retry button after a failed *install* instant, and what stops a parent setting up a
    // second phone from paying for the download twice.
    if target.exists() {
        match hash_file(&target) {
            Ok(actual) if actual == expected => {
                let _ = app.emit(
                    "apk-download-progress",
                    DownloadProgress { downloaded: size_bytes, total: size_bytes },
                );
                return Ok(target.to_string_lossy().to_string());
            }
            // Stale or corrupt: fall through and re-download over it.
            _ => {
                let _ = std::fs::remove_file(&target);
            }
        }
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Could not reach the download server: {}", e))?;

    if !response.status().is_success() {
        // A 400 here is almost always an expired signed URL, which is recoverable by
        // re-fetching the release — say so rather than printing a bare status code.
        return Err(format!(
            "Download failed (HTTP {}). The download link may have expired — try again.",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(size_bytes);

    // Downloaded to a temporary name and renamed only once verified, so an interrupted
    // download can never be mistaken for a cached one by the check above.
    let partial = target.with_extension("apk.part");
    let mut file = std::fs::File::create(&partial)
        .map_err(|e| format!("Could not open the download file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    // Emitted at most every 256 KB rather than per chunk: the UI only needs enough events
    // to animate, and a per-chunk emit on a fast connection floods the webview.
    const EMIT_EVERY_BYTES: u64 = 256 * 1024;
    let mut last_emit: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let _ = std::fs::remove_file(&partial);
            format!("The download was interrupted: {}", e)
        })?;

        file.write_all(&chunk).map_err(|e| {
            let _ = std::fs::remove_file(&partial);
            format!("Could not write the download to disk: {}", e)
        })?;

        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        if downloaded - last_emit >= EMIT_EVERY_BYTES {
            last_emit = downloaded;
            let _ = app.emit("apk-download-progress", DownloadProgress { downloaded, total });
        }
    }

    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Could not finish writing the download: {}", e))?;
    drop(file);

    let actual = hex_digest(&hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&partial);
        return Err(format!(
            "The downloaded file is damaged and was discarded (expected {}…, got {}…). \
             Check your connection and try again.",
            &expected[..8.min(expected.len())],
            &actual[..8.min(actual.len())]
        ));
    }

    std::fs::rename(&partial, &target)
        .map_err(|e| format!("Could not finalise the download: {}", e))?;

    let _ = app.emit("apk-download-progress", DownloadProgress { downloaded: total, total });

    Ok(target.to_string_lossy().to_string())
}

/// Pull `versionCode=N` and `versionName=X` out of a `dumpsys package` dump.
///
/// The dump lists every install of the package (a system copy plus an updated one, on some
/// OEM builds), so the highest versionCode is taken rather than the first — the highest is
/// the one Android actually runs and the one an update has to beat.
fn parse_version(dump: &str) -> (Option<i64>, Option<String>) {
    let mut best_code: Option<i64> = None;
    let mut best_name: Option<String> = None;

    for line in dump.lines() {
        let line = line.trim();

        if let Some(rest) = line.strip_prefix("versionCode=") {
            // The field is followed by others on the same line, e.g.
            // "versionCode=2 minSdk=24 targetSdk=36".
            if let Ok(code) = rest.split_whitespace().next().unwrap_or("").parse::<i64>() {
                if best_code.map_or(true, |current| code > current) {
                    best_code = Some(code);
                    // versionName is printed on its own line just after, so clear the
                    // previous one and let the next match below fill it in.
                    best_name = None;
                }
            }
        } else if let Some(rest) = line.strip_prefix("versionName=") {
            if best_name.is_none() {
                let name = rest.split_whitespace().next().unwrap_or("").to_string();
                if !name.is_empty() {
                    best_name = Some(name);
                }
            }
        }
    }

    (best_code, best_name)
}

/// Tauri command: what version of SkywardBlocker is on the device right now.
///
/// Answering "is an update needed?" without this would mean reinstalling the current build
/// every time the parent opens the update screen.
#[tauri::command]
pub async fn get_installed_version(
    app: tauri::AppHandle,
    device_id: String,
) -> Result<InstalledVersion, String> {
    let dump = adb::run_adb_for_device(
        Some(&app),
        &device_id,
        &["shell", "dumpsys", "package", PACKAGE_NAME],
    )
    .map_err(|e| e.to_string())?;

    // `dumpsys package` on a package that isn't installed prints a "Unable to find
    // package" line and exits 0, so absence has to be detected from the content.
    let is_installed = dump.contains("versionCode=");
    if !is_installed {
        return Ok(InstalledVersion {
            is_installed: false,
            version_code: None,
            version_name: None,
        });
    }

    let (version_code, version_name) = parse_version(&dump);
    Ok(InstalledVersion {
        is_installed: true,
        version_code,
        version_name,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn reads_version_from_a_dump() {
        let dump = "
  Packages:
    Package [com.example.skywardblocker] (a1b2c3):
      versionCode=2 minSdk=24 targetSdk=36
      versionName=1.2
      flags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]
";
        assert_eq!(parse_version(dump), (Some(2), Some("1.2".to_string())));
    }

    /// A system copy plus an update: the higher code is the one that runs.
    #[test]
    fn prefers_the_highest_version_code() {
        let dump = "
    Package [com.example.skywardblocker] (aaa):
      versionCode=1 minSdk=24
      versionName=1.1
    Hidden system packages:
    Package [com.example.skywardblocker] (bbb):
      versionCode=4 minSdk=24
      versionName=1.4
";
        assert_eq!(parse_version(dump), (Some(4), Some("1.4".to_string())));
    }

    #[test]
    fn survives_a_dump_with_no_version() {
        assert_eq!(parse_version("Unable to find package: com.example.skywardblocker"), (None, None));
    }
}
