import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";

interface UpdateStepProps {
  deviceId: string;
  deviceModel: string;
  onComplete: () => void;
  onCancel: () => void;
  onBackToDevices: () => void;
}

export default function UpdateStep({ deviceId, deviceModel, onComplete, onCancel, onBackToDevices }: UpdateStepProps) {
  const [apkPath, setApkPath] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);

  async function handleStartUpdate() {
    if (!apkPath.trim()) {
      setError("Please provide the full absolute path to the updated APK file.");
      return;
    }
    setIsUpdating(true);
    setError(null);
    setSuccess(false);
    setStatusText("Verifying device connection…");

    // The device may have been unplugged since it was selected — never push an APK blindly.
    const connection = await checkDeviceConnected(deviceId);
    if (!connection.connected) {
      setDisconnected(connection);
      setStatusText("");
      setIsUpdating(false);
      return;
    }

    setStatusText("Pushing update APK to connected device…");

    try {
      await invoke<string>("install_apk", { deviceId, apkPath: apkPath.trim() });
      setSuccess(true);
      setStatusText("");
    } catch (err) {
      setError(String(err));
      setStatusText("");
    } finally {
      setIsUpdating(false);
    }
  }

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

          {!success && (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Updated APK file path</label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="text"
                  placeholder="/path/to/skywardblocker_v2.apk"
                  value={apkPath}
                  onChange={(e) => setApkPath(e.target.value)}
                  disabled={isUpdating}
                />
              </div>
              <p className="text-xs text-muted mt-2">
                Enter the absolute path to your updated SkywardBlocker APK file.
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

          {success && (
            <div style={{
              background: "oklch(0.60 0.15 150 / 0.06)",
              border: "1px solid oklch(0.60 0.15 150 / 0.2)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
              <p style={{ margin: 0, color: "oklch(0.5 0.15 150)", fontWeight: 600 }}>
                ✓ SkywardBlocker has been successfully updated on your device!
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isUpdating}>
          Back to Dashboard
        </button>
        {!success ? (
          <button className="btn btn-primary" onClick={handleStartUpdate} disabled={isUpdating || !apkPath.trim()}>
            {isUpdating ? "Updating…" : "Start Update"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onComplete}>
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
