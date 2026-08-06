/**
 * Getting the current SkywardBlocker APK onto this machine.
 *
 * Shared by the install and update flows, which differ in what they do with the file but
 * not in how they obtain it.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetchLatestRelease, Release } from "./api";

/** What SkywardBlocker reports on a connected device. Mirrors the Rust `InstalledVersion`. */
export interface InstalledVersion {
  is_installed: boolean;
  version_code: number | null;
  version_name: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Download `release` and return the path to the verified local file.
 *
 * The signed URL on a `Release` expires within minutes, so this deliberately re-fetches the
 * release rather than trusting the one a screen loaded on mount — a parent who leaves the
 * install screen open while signing out of accounts would otherwise hit an expired link at
 * the worst possible moment. The version is re-checked too: if a new build was published in
 * the meantime, installing the newer one is strictly better than failing.
 */
export async function downloadCurrentRelease(
  onProgress?: (progress: DownloadProgress) => void
): Promise<{ release: Release; apkPath: string }> {
  const release = await fetchLatestRelease();

  // Registered before the download starts so no early chunk is missed, and torn down in
  // `finally` so a failed download doesn't leak a listener into the next attempt.
  const unlisten = onProgress
    ? await listen<DownloadProgress>("apk-download-progress", (event) => onProgress(event.payload))
    : null;

  try {
    const apkPath = await invoke<string>("download_apk", {
      url: release.download_url,
      sha256: release.sha256,
      versionCode: release.version_code,
      sizeBytes: release.size_bytes,
    });
    return { release, apkPath };
  } finally {
    unlisten?.();
  }
}

/** What SkywardBlocker version the device is running, if any. */
export function getInstalledVersion(deviceId: string): Promise<InstalledVersion> {
  return invoke<InstalledVersion>("get_installed_version", { deviceId });
}
