import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";
import { errorMessage, fetchLatestRelease, Release, SessionExpiredError, withRetry } from "../lib/api";
import {
  downloadCurrentRelease,
  DownloadProgress,
  formatBytes,
  getInstalledVersion,
  InstalledVersion,
} from "../lib/release";

interface UpdateStepProps {
  deviceId: string;
  deviceModel: string;
  onComplete: () => void;
  onCancel: () => void;
  onBackToDevices: () => void;
  signOut: (reason?: string) => void;
}

/**
 * What the two version numbers add up to.
 *
 * `unknown` covers a phone whose dump didn't yield a version code. It's treated as
 * updatable rather than as an error: reinstalling the current build over itself is
 * harmless, whereas refusing to act would strand a phone we simply couldn't read.
 */
type UpdateState = "checking" | "up-to-date" | "available" | "unknown" | "failed";

export default function UpdateStep({ deviceId, deviceModel, onComplete, onCancel, onBackToDevices, signOut }: UpdateStepProps) {
  const [release, setRelease] = useState<Release | null>(null);
  const [installed, setInstalled] = useState<InstalledVersion | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>("checking");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);

  useEffect(() => {
    checkForUpdate();
  }, []);

  /**
   * Compare what's published against what's on the phone.
   *
   * Both halves are needed to say anything useful, so a failure in either lands in the same
   * `failed` state — there is no partial answer worth showing.
   */
  async function checkForUpdate() {
    setUpdateState("checking");
    setCheckError(null);
    setError(null);

    try {
      const [latest, current] = await Promise.all([
        withRetry(fetchLatestRelease),
        getInstalledVersion(deviceId),
      ]);
      setRelease(latest);
      setInstalled(current);

      if (current.version_code === null) {
        setUpdateState("unknown");
      } else if (current.version_code >= latest.version_code) {
        setUpdateState("up-to-date");
      } else {
        setUpdateState("available");
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        signOut("Your session expired. Please sign in again to check for updates.");
        return;
      }
      setUpdateState("failed");
      setCheckError(errorMessage(err));
    }
  }

  async function handleStartUpdate() {
    setIsUpdating(true);
    setError(null);
    setSuccess(false);
    setDownloadProgress(null);
    setStatusText("Verifying device connection…");

    // The device may have been unplugged since it was selected — never push an APK blindly.
    const connection = await checkDeviceConnected(deviceId);
    if (!connection.connected) {
      setDisconnected(connection);
      setStatusText("");
      setIsUpdating(false);
      return;
    }

    setStatusText("Downloading the latest version…");
    let apkPath: string;
    let installedRelease: Release;
    try {
      const downloaded = await downloadCurrentRelease(setDownloadProgress);
      apkPath = downloaded.apkPath;
      installedRelease = downloaded.release;
      setRelease(downloaded.release);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setIsUpdating(false);
        setStatusText("");
        signOut("Your session expired before the update started. Please sign in and try again — the phone is unchanged.");
        return;
      }
      setError(`The download failed (${errorMessage(err)}). The app on the phone is untouched — check your connection and try again.`);
      setStatusText("");
      setIsUpdating(false);
      return;
    }

    setDownloadProgress(null);
    setStatusText("Installing the update on your device…");

    try {
      await invoke<string>("install_apk", { deviceId, apkPath });
      // Re-read rather than assuming: this is what proves the new build is actually the one
      // running, and it leaves the screen showing a true version number afterwards.
      setInstalled(
        await getInstalledVersion(deviceId).catch(() => ({
          is_installed: true,
          version_code: installedRelease.version_code,
          version_name: installedRelease.version_name,
        }))
      );
      setUpdateState("up-to-date");
      setSuccess(true);
      setStatusText("");
    } catch (err) {
      setError(String(err));
      setStatusText("");
    } finally {
      setIsUpdating(false);
    }
  }

  const canUpdate = updateState === "available" || updateState === "unknown";

  return (
    <div className="space-y-4 relative">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className={`step-number ${success ? "done" : "active"}`}>
              {success ? "✓" : "⬆"}
            </div>
            <div>
              <div className="step-title">Update SkywardBlocker</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 16 }}>
            Updating application on <strong>{deviceModel}</strong> ({deviceId}). This in-place update preserves your existing Device Owner security policies and configuration.
          </p>

          {statusText && (
            <div className="install-status-banner" style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              background: "oklch(0.71 0.08 247 / 0.06)",
              border: "1px solid oklch(0.71 0.08 247 / 0.15)",
              borderRadius: "calc(var(--radius) - 2px)",
              marginBottom: 16,
              fontSize: 14,
              color: "var(--foreground)",
            }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              <span>{statusText}</span>
            </div>
          )}

          {downloadProgress && downloadProgress.total > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                height: 6,
                borderRadius: 3,
                background: "oklch(0.71 0.08 247 / 0.12)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100)}%`,
                  background: "var(--primary)",
                  transition: "width 0.2s ease-out",
                }} />
              </div>
              <p className="text-xs text-muted mt-2">
                {formatBytes(downloadProgress.downloaded)} of {formatBytes(downloadProgress.total)}
              </p>
            </div>
          )}

          {updateState === "checking" && !statusText && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, fontSize: 14 }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              <span>Checking for updates…</span>
            </div>
          )}

          {updateState === "failed" && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.5 }}>
                ⚠️ Couldn't check for updates ({checkError}). The phone hasn't been changed.
              </p>
              <button className="btn btn-outline" onClick={checkForUpdate}>
                Check again
              </button>
            </div>
          )}

          {/* Already current. Saying so — and stopping — is the whole point of reading the
              installed version: the old screen would happily reinstall the same build. */}
          {updateState === "up-to-date" && release && (
            <div style={{
              background: "oklch(0.60 0.15 150 / 0.06)",
              border: "1px solid oklch(0.60 0.15 150 / 0.2)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
              <p style={{ margin: 0, color: "var(--success)", fontWeight: 600, fontSize: 14 }}>
                {success
                  ? `✓ Updated to SkywardBlocker ${release.version_name}`
                  : `✓ SkywardBlocker ${installed?.version_name ?? release.version_name} is up to date`}
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                This is the latest version. Nothing needs to be done.
              </p>
            </div>
          )}

          {updateState === "available" && release && (
            <div style={{
              background: "oklch(0.71 0.08 247 / 0.06)",
              border: "1px solid oklch(0.71 0.08 247 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <h4 style={{ margin: 0, fontSize: 14, color: "var(--foreground)" }}>
                  Update available: {installed?.version_name ?? "current"} → {release.version_name}
                </h4>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                  {formatBytes(release.size_bytes)}
                </span>
              </div>
              {release.release_notes && (
                <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--foreground)", lineHeight: 1.5 }}>
                  {release.release_notes}
                </p>
              )}
            </div>
          )}

          {/* Couldn't read a version off the phone. Reinstalling over the top is safe, so
              this offers the update rather than blocking on a diagnosis. */}
          {updateState === "unknown" && release && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                ⚠️ We couldn't read which version is on the phone
                {installed?.is_installed === false ? " (SkywardBlocker may not be installed)" : ""}.
                Installing SkywardBlocker {release.version_name} is safe either way — it won't
                affect Device Owner or your schedule.
              </p>
            </div>
          )}

          {error && (
            <div style={{
              background: "oklch(0.6 0.22 27 / 0.05)",
              border: "1px solid oklch(0.6 0.22 27 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--destructive)" }}>Update Failed</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--foreground)", margin: 0 }}>{error}</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isUpdating}>
          Back to Dashboard
        </button>
        {canUpdate && !success ? (
          <button className="btn btn-primary" onClick={handleStartUpdate} disabled={isUpdating}>
            {isUpdating ? "Updating…" : "Install Update"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onComplete} disabled={isUpdating}>
            Done
          </button>
        )}
      </div>

      {disconnected && (
        <DeviceDisconnectedModal
          status={disconnected}
          onBackToDevices={onBackToDevices}
          onClose={() => setDisconnected(null)}
        />
      )}
    </div>
  );
}
