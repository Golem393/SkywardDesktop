import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";

export interface ScheduleConfig {
  lockStartHour: number;
  lockStartMinute: number;
  lockEndHour: number;
  lockEndMinute: number;
  timezoneId: string;
}

interface Preset {
  id: string;
  label: string;
  description: string;
  lockStartHour: number;
  lockStartMinute: number;
  lockEndHour: number;
  lockEndMinute: number;
}

const PRESETS: Preset[] = [
  {
    id: "school",
    label: "School Hours",
    description: "Locked 8:00 AM – 3:00 PM",
    lockStartHour: 8,
    lockStartMinute: 0,
    lockEndHour: 15,
    lockEndMinute: 0,
  },
  {
    id: "study",
    label: "Study Time",
    description: "Locked 4:00 PM – 6:00 PM",
    lockStartHour: 16,
    lockStartMinute: 0,
    lockEndHour: 18,
    lockEndMinute: 0,
  },
  {
    id: "dinner",
    label: "Family Dinner",
    description: "Locked 6:00 PM – 7:30 PM",
    lockStartHour: 18,
    lockStartMinute: 0,
    lockEndHour: 19,
    lockEndMinute: 30,
  },
  {
    id: "bedtime",
    label: "Bedtime / Overnight",
    description: "Locked 9:00 PM – 7:00 AM (spans midnight)",
    lockStartHour: 21,
    lockStartMinute: 0,
    lockEndHour: 7,
    lockEndMinute: 0,
  },
  {
    id: "fullday",
    label: "Full-Day Restriction",
    description: "Locked 24 hours, no automatic unlock",
    lockStartHour: 0,
    lockStartMinute: 0,
    lockEndHour: 0,
    lockEndMinute: 0,
  },
];

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function formatHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour} ${period}`;
}

function formatTime(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
}

interface ScheduleStepProps {
  deviceId: string;
  deviceModel: string;
  mode: "initial" | "edit";
  onContinue: (config: ScheduleConfig) => void;
  onCancel: () => void;
  onBackToDevices: () => void;
}

export default function ScheduleStep({
  deviceId,
  deviceModel,
  mode,
  onContinue,
  onCancel,
  onBackToDevices,
}: ScheduleStepProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customStartHour, setCustomStartHour] = useState(8);
  const [customStartMinute, setCustomStartMinute] = useState(0);
  const [customEndHour, setCustomEndHour] = useState(22);
  const [customEndMinute, setCustomEndMinute] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<ScheduleConfig | null>(null);

  function buildConfig(): ScheduleConfig | null {
    const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (selectedId === "custom") {
      return {
        lockStartHour: customStartHour,
        lockStartMinute: customStartMinute,
        lockEndHour: customEndHour,
        lockEndMinute: customEndMinute,
        timezoneId,
      };
    }

    const preset = PRESETS.find((p) => p.id === selectedId);
    if (!preset) return null;
    return {
      lockStartHour: preset.lockStartHour,
      lockStartMinute: preset.lockStartMinute,
      lockEndHour: preset.lockEndHour,
      lockEndMinute: preset.lockEndMinute,
      timezoneId,
    };
  }

  function handleContinue() {
    const config = buildConfig();
    if (!config) {
      setError("Please choose a schedule option first.");
      return;
    }
    setError(null);

    if (mode === "initial") {
      onContinue(config);
      return;
    }

    // mode === "edit": device is already provisioned, and USB debugging is normally
    // locked down except during the phone's 10-minute Dev Mode window — same
    // requirement as Update/Remove. Confirm that's been done before attempting the push.
    setPendingConfig(config);
    setShowWarningModal(true);
  }

  async function handlePushConfirmed() {
    setShowWarningModal(false);
    const config = pendingConfig;
    if (!config) return;

    setIsSaving(true);
    setSuccess(false);

    const connection = await checkDeviceConnected(deviceId);
    if (!connection.connected) {
      setDisconnected(connection);
      setIsSaving(false);
      return;
    }

    try {
      await invoke<string>("push_schedule", {
        deviceId,
        lockStartHour: config.lockStartHour,
        lockStartMinute: config.lockStartMinute,
        lockEndHour: config.lockEndHour,
        lockEndMinute: config.lockEndMinute,
        timezoneId: config.timezoneId,
      });
      setSuccess(true);
      onContinue(config);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">🕒</div>
            <div>
              <div className="step-title">
                {mode === "initial" ? "Set Locked Hours" : "Adjust Locked Hours"}
              </div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 20 }}>
            Choose the daily time window during which <strong>{deviceModel}</strong> ({deviceId}) will be
            locked down. Outside this window the device unlocks automatically.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 16 }}>
            {PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="device-card"
                style={{
                  padding: 20,
                  cursor: "pointer",
                  border: selectedId === preset.id ? "2px solid var(--primary)" : undefined,
                }}
                onClick={() => setSelectedId(preset.id)}
              >
                <div className="device-name" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                  {preset.label}
                </div>
                <div className="device-serial" style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                  {preset.description}
                </div>
              </div>
            ))}

            <div
              className="device-card"
              style={{
                padding: 20,
                cursor: "pointer",
                gridColumn: selectedId === "custom" ? "1 / -1" : undefined,
                border: selectedId === "custom" ? "2px solid var(--primary)" : undefined,
              }}
              onClick={() => setSelectedId("custom")}
            >
              <div className="device-name" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                Custom
              </div>
              <div className="device-serial" style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.4, marginBottom: selectedId === "custom" ? 16 : 0 }}>
                Set your own start and end time.
              </div>
              {selectedId === "custom" && (
                <div onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <label className="label">Locked from</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <select
                          className="input"
                          style={{ flex: 1 }}
                          value={customStartHour}
                          onChange={(e) => setCustomStartHour(Number(e.target.value))}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h}>{formatHourLabel(h)}</option>
                          ))}
                        </select>
                        <select
                          className="input"
                          style={{ flex: 1 }}
                          value={customStartMinute}
                          onChange={(e) => setCustomStartMinute(Number(e.target.value))}
                        >
                          {MINUTES.map((m) => (
                            <option key={m} value={m}>:{String(m).padStart(2, "0")}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div style={{ flex: "1 1 200px" }}>
                      <label className="label">Locked until</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <select
                          className="input"
                          style={{ flex: 1 }}
                          value={customEndHour}
                          onChange={(e) => setCustomEndHour(Number(e.target.value))}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h}>{formatHourLabel(h)}</option>
                          ))}
                        </select>
                        <select
                          className="input"
                          style={{ flex: 1 }}
                          value={customEndMinute}
                          onChange={(e) => setCustomEndMinute(Number(e.target.value))}
                        >
                          {MINUTES.map((m) => (
                            <option key={m} value={m}>:{String(m).padStart(2, "0")}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 12, marginBottom: 0 }}>
                    Locked from <strong>{formatTime(customStartHour, customStartMinute)}</strong> to{" "}
                    <strong>{formatTime(customEndHour, customEndMinute)}</strong>
                    {(customEndHour * 60 + customEndMinute) <= (customStartHour * 60 + customStartMinute) &&
                      " (spans midnight)"}
                  </p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div style={{
              background: "oklch(0.6 0.22 27 / 0.05)",
              border: "1px solid oklch(0.6 0.22 27 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
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
                ✓ Schedule saved and pushed to the device!
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isSaving}>
          {mode === "initial" ? "Back to Dashboard" : "Cancel"}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleContinue}
          disabled={isSaving || !selectedId}
        >
          {isSaving ? "Saving…" : mode === "initial" ? "Continue" : "Save Schedule"}
        </button>
      </div>

      {/* Warning Modal */}
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
              <h3 style={{ margin: 0, color: "var(--foreground)", fontSize: 18 }}>Confirm Maintenance Mode</h3>
            </div>
            <div className="card-content">
              <div style={{
                padding: "12px 16px",
                background: "oklch(0.75 0.15 85 / 0.1)",
                border: "1px solid oklch(0.75 0.15 85 / 0.3)",
                borderRadius: "var(--radius)",
                marginBottom: 16,
                fontSize: 13,
                color: "var(--foreground)",
                lineHeight: 1.5,
              }}>
                ⚠️ <strong>Requirement:</strong> Because USB Debugging is locked by default in Device Owner mode, ensure you have opened SkywardBlocker on your phone, logged in, and activated the <strong>10-minute Developer Mode window</strong> before continuing.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="btn btn-outline" onClick={() => setShowWarningModal(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handlePushConfirmed}>
                  Proceed to Save
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
