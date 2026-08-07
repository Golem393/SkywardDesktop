import { invoke } from "@tauri-apps/api/core";

export interface DeviceConnectionStatus {
  connected: boolean;
  status: string;
  message: string;
}

/**
 * Ask the backend whether `deviceId` is still connected and usable.
 * Any unexpected failure is reported as "not connected" so callers never
 * start an install/update/remove against a device that just vanished.
 */
export async function checkDeviceConnected(deviceId: string): Promise<DeviceConnectionStatus> {
  try {
    return await invoke<DeviceConnectionStatus>("is_device_connected", { deviceId });
  } catch (err) {
    return {
      connected: false,
      status: "unknown",
      message: `Could not verify the device connection: ${String(err)}`,
    };
  }
}

interface DeviceDisconnectedModalProps {
  status: DeviceConnectionStatus;
  /** Optional return to device search */
  onBackToDevices?: () => void;
  /** Dismiss the dialog and stay on the current screen. */
  onClose: () => void;
}

export default function DeviceDisconnectedModal({
  status,
  onClose,
}: DeviceDisconnectedModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div className="card" style={{ maxWidth: 460, width: "100%", margin: 0 }}>
        <div className="card-header">
          <h3 style={{ margin: 0, color: "var(--destructive)", fontSize: 18 }}>
            Device Not Connected
          </h3>
        </div>
        <div className="card-content">
          <p style={{ fontSize: 14, color: "var(--foreground)", marginTop: 0, lineHeight: 1.5 }}>
            {status.message}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
            <button className="btn btn-outline" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
