import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";

interface RemoveStepProps {
  deviceId: string;
  deviceModel: string;
  onComplete: () => void;
  onCancel: () => void;
  onBackToDevices: () => void;
}

export default function RemoveStep({ deviceId, deviceModel, onComplete, onCancel, onBackToDevices }: RemoveStepProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);

  async function handleRemoveConfirm() {
    setShowWarningModal(false);
    setIsRemoving(true);
    setError(null);
    setSuccess(false);
    setStatusText("Verifying device connection…");

    // A half-executed removal (owner cleared, app left installed) is worse than
    // no removal at all — confirm the device is still there first.
    const connection = await checkDeviceConnected(deviceId);
    if (!connection.connected) {
      setDisconnected(connection);
      setStatusText("");
      setIsRemoving(false);
      return;
    }

    setStatusText("Releasing Device Owner privileges and uninstalling app…");

    try {
      await invoke<string>("uninstall_app", { deviceId });
      setSuccess(true);
      setStatusText("");
    } catch (err) {
      setError(String(err));
      setStatusText("");
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="space-y-4 relative">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className={`step-number ${success ? "done" : "active"}`} style={{ background: success ? "var(--success)" : "var(--destructive)" }}>
              {success ? "✓" : "✖"}
            </div>
            <div>
              <div className="step-title">Remove Skyward Protection</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 16 }}>
            Removing protection from <strong>{deviceModel}</strong> ({deviceId}). This will relinquish Device Owner administration and uninstall SkywardBlocker completely.
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

          {!success && !isRemoving && (
            <div style={{
              padding: "16px 20px",
              background: "oklch(0.6 0.22 27 / 0.05)",
              border: "1px solid oklch(0.6 0.22 27 / 0.18)",
              borderRadius: "var(--radius)",
              marginBottom: 16,
            }}>
              <h4 style={{ margin: "0 0 8px 0", color: "var(--destructive)", fontSize: 14 }}>Decommission Notice</h4>
              <p style={{ fontSize: 13, color: "var(--foreground)", margin: 0, lineHeight: 1.5 }}>
                To execute uninstallation securely, you must log into SkywardBlocker on your device and tap <strong>"Turn on Dev Mode for 10 minutes"</strong>. Once unlocked, clicking Remove will transmit an authorization intent to release Device Owner status before uninstalling.
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
                <span style={{ fontWeight: 600, fontSize: 14, color: "var(--destructive)" }}>Removal Failed</span>
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
                ✓ SkywardBlocker has been successfully decommissioned and uninstalled from your device.
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isRemoving}>
          Back to Dashboard
        </button>
        {!success ? (
          <button className="btn btn-outline" style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }} onClick={() => setShowWarningModal(true)} disabled={isRemoving}>
            {isRemoving ? "Removing…" : "Remove App"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onComplete}>
            Done
          </button>
        )}
      </div>

      {/* Warning Confirmation Modal */}
      {showWarningModal && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: 20,
        }}>
          <div className="card" style={{ maxWidth: 460, width: "100%", margin: 0 }}>
            <div className="card-header">
              <h3 style={{ margin: 0, color: "var(--destructive)", fontSize: 18 }}>Confirm Decommission & Removal</h3>
            </div>
            <div className="card-content">
              <p style={{ fontSize: 14, color: "var(--foreground)", marginTop: 0, lineHeight: 1.5 }}>
                Are you absolutely sure? This will remove all parental control and digital minimalism protections from this phone.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button className="btn btn-outline" onClick={() => setShowWarningModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" style={{ background: "var(--destructive)" }} onClick={handleRemoveConfirm}>
                  Yes, Remove Protection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
