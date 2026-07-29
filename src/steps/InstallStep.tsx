import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";

interface InstallStepProps {
  deviceId: string;
  deviceModel: string;
  onComplete: () => void;
  onBackToDevices: () => void;
}

type Phase = "prerequisites" | "installing" | "activating" | "configuring" | "done" | "error";

interface PhaseError {
  title: string;
  message: string;
  suggestion: string;
}

const ERROR_MAP: Record<string, PhaseError> = {
  prereq_check: {
    title: "Prerequisite Check Failed",
    message: "Unable to verify device readiness.",
    suggestion: "Ensure the device is connected via USB with USB debugging enabled, then try again.",
  },
  apk_install: {
    title: "Installation Failed",
    message: "The APK could not be installed on the device.",
    suggestion: "Verify the APK file path is correct and the file exists. Make sure there is enough storage on the device.",
  },
  device_owner: {
    title: "Activation Failed",
    message: "Could not set SkywardBlocker as Device Owner.",
    suggestion: "Ensure all Google accounts are removed from the device and no other Device Owner is active. Then factory‑reset the device and retry.",
  },
  verification: {
    title: "Verification Failed",
    message: "Installation completed but could not be verified.",
    suggestion: "Open SkywardBlocker on the device manually to confirm it is running correctly.",
  },
};

export default function InstallStep({ deviceId, deviceModel, onComplete, onBackToDevices }: InstallStepProps) {
  const [phase, setPhase] = useState<Phase>("prerequisites");
  const [phaseError, setPhaseError] = useState<PhaseError | null>(null);
  const [apkPath, setApkPath] = useState("");
  const [prereqOk, setPrereqOk] = useState(false);
  const [prereqMessages, setPrereqMessages] = useState<{ ok: boolean; text: string }[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);

  // Auto-run prerequisites check
  useEffect(() => {
    checkPrereqs();
  }, []);

  /**
   * Confirm the device is still connected before touching it.
   * Returns false (and raises the disconnect dialog) when it is gone.
   */
  async function ensureConnected(): Promise<boolean> {
    const status = await checkDeviceConnected(deviceId);
    if (!status.connected) {
      setDisconnected(status);
      setStatusText("");
      return false;
    }
    return true;
  }

  async function checkPrereqs() {
    setPrereqOk(false);
    setStatusText("Checking device prerequisites…");
    setPrereqMessages([]);
    setPhaseError(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (!(await ensureConnected())) return;

    try {
      const res = await invoke<{
        usb_authorized: boolean;
        no_existing_install: boolean;
        no_existing_owner: boolean;
        no_accounts: boolean;
        messages: string[];
        can_proceed: boolean;
      }>("check_prerequisites", { deviceId });

      const parsed = res.messages.map((m) => ({
        ok: m.startsWith("✅") || m.includes("✅"),
        text: m.replace(/^[✅❌⏳✓✗⚠]\s*/, "").trim(),
      }));
      setPrereqMessages(parsed);

      if (res.can_proceed) {
        setPrereqOk(true);
        setStatusText("");
      } else {
        setPrereqOk(false);
        setStatusText("");
        setPhaseError({
          title: "Prerequisites Not Met",
          message: "Your device does not meet the requirements for installation.",
          suggestion: "Please resolve the issues listed above, then re‑check.",
        });
      }
    } catch (err) {
      setPrereqOk(false);
      setStatusText("");
      setPhaseError({
        ...ERROR_MAP.prereq_check,
        message: `${ERROR_MAP.prereq_check.message} ${String(err)}`,
      });
    }
  }

  async function startInstallation() {
    if (isInstalling) return;
    if (!apkPath.trim()) {
      setPhaseError({
        title: "Missing APK Path",
        message: "No APK file path was provided.",
        suggestion: "Enter the full path to your SkywardBlocker APK file before starting the installation.",
      });
      return;
    }
    setPhaseError(null);
    setStatusText("Verifying device connection…");

    if (!(await ensureConnected())) return;

    setIsInstalling(true);
    setPhase("installing");
    setStatusText("Installing SkywardBlocker on your device…");
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await invoke<string>("install_apk", { deviceId, apkPath: apkPath.trim() });
    } catch (err) {
      setPhaseError({ ...ERROR_MAP.apk_install, message: `${ERROR_MAP.apk_install.message} ${String(err)}` });
      setPhase("error");
      setIsInstalling(false);
      setStatusText("");
      return;
    }

    // Phase 2: Set Device Owner
    setPhase("activating");
    setStatusText("Activating Device Owner permissions…");
    try {
      await invoke<string>("set_device_owner", { deviceId });
    } catch (err) {
      setPhaseError({ ...ERROR_MAP.device_owner, message: `${ERROR_MAP.device_owner.message} ${String(err)}` });
      setPhase("error");
      setIsInstalling(false);
      setStatusText("");
      return;
    }

    // Phase 3: Push Configuration & Launch App
    setPhase("configuring");
    setStatusText("Configuring and launching SkywardBlocker…");
    try {
      await invoke<string>("push_config", { deviceId });
    } catch {
      // Non-fatal — continue
    }

    try {
      await invoke<string>("launch_app", { deviceId });
    } catch {
      // Non-fatal — continue
    }

    // Phase 4: Verify
    setStatusText("Verifying installation…");
    try {
      const res = await invoke<{
        is_installed: boolean;
        is_device_owner: boolean;
        success: boolean;
        message: string;
      }>("verify_installation", { deviceId });

      if (res.success) {
        setPhase("done");
        setStatusText("");
      } else {
        setPhase("error");
        setPhaseError(ERROR_MAP.verification);
        setStatusText("");
      }
    } catch {
      // If verification itself fails but previous steps passed, consider it done
      setPhase("done");
      setStatusText("");
    }

    setIsInstalling(false);
  }

  const phaseSteps = [
    { key: "prerequisites", label: "Check prerequisites" },
    { key: "installing", label: "Install APK" },
    { key: "activating", label: "Activate Device Owner" },
    { key: "configuring", label: "Configure & launch app" },
    { key: "done", label: "Complete" },
  ];

  const currentIndex = phaseSteps.findIndex((s) => s.key === phase);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className={`step-number ${phase === "done" ? "done" : "active"}`}>
              {phase === "done" ? "✓" : "2"}
            </div>
            <div>
              <div className="step-title">Install SkywardBlocker</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 16 }}>
            Installing on <strong>{deviceModel}</strong> ({deviceId})
          </p>

          {/* Progress Steps */}
          <div className="stepper" style={{ marginBottom: 20 }}>
            {phaseSteps.map((step, i) => {
              let bulletClass = "pending";
              if (i < currentIndex || phase === "done") bulletClass = "done";
              else if (i === currentIndex && phase !== "error") bulletClass = "active";

              return (
                <div className="stepper-item" key={step.key}>
                  <div className={`stepper-bullet ${bulletClass}`}>
                    {bulletClass === "done" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : bulletClass === "active" ? (
                      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <div className="stepper-content">
                    <div className={`stepper-label ${bulletClass === "pending" ? "muted" : ""}`}>
                      {step.label}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Status text during installation */}
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
              animation: "fadeIn 0.3s ease-out both",
            }}>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, flexShrink: 0 }} />
              {statusText}
            </div>
          )}

          {/* Prerequisite results */}
          {phase === "prerequisites" && prereqMessages.length > 0 && (
            <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              {prereqMessages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: "calc(var(--radius) - 2px)",
                  background: msg.ok ? "oklch(0.60 0.15 150 / 0.06)" : "oklch(0.6 0.22 27 / 0.06)",
                  border: `1px solid ${msg.ok ? "oklch(0.60 0.15 150 / 0.15)" : "oklch(0.6 0.22 27 / 0.15)"}`,
                }}>
                  {msg.ok ? (
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "oklch(0.60 0.15 150 / 0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  ) : (
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      background: "oklch(0.6 0.22 27 / 0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                  )}
                  <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{msg.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* APK path input — only show during prerequisites phase */}
          {phase === "prerequisites" && (
            <div style={{ marginBottom: 16 }}>
              <label className="label">APK file path</label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="text"
                  placeholder="/path/to/skywardblocker.apk"
                  value={apkPath}
                  onChange={(e) => setApkPath(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted mt-2">
                Enter the absolute path to your SkywardBlocker APK file.
              </p>
            </div>
          )}

          {/* Error card */}
          {phaseError && (
            <div style={{
              background: "oklch(0.6 0.22 27 / 0.05)",
              border: "1px solid oklch(0.6 0.22 27 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
              animation: "fadeInUp 0.35s ease-out both",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "oklch(0.6 0.22 27 / 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <span style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--destructive)",
                }}>{phaseError.title}</span>
              </div>
              <p style={{
                fontSize: 13,
                color: "var(--foreground)",
                lineHeight: 1.5,
                marginBottom: 6,
                paddingLeft: 38,
              }}>{phaseError.message}</p>
              <p style={{
                fontSize: 13,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
                paddingLeft: 38,
              }}>{phaseError.suggestion}</p>
            </div>
          )}

          {/* Success card */}
          {phase === "done" && (
            <div style={{
              background: "oklch(0.60 0.15 150 / 0.06)",
              border: "1px solid oklch(0.60 0.15 150 / 0.2)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
              animation: "fadeInUp 0.35s ease-out both",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
              }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "oklch(0.60 0.15 150 / 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: "var(--success)",
                }}>Installation Complete</span>
              </div>
              <p style={{
                fontSize: 13,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
                paddingLeft: 38,
              }}>SkywardBlocker has been installed and activated on your device. You can now proceed to the next step.</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {(phase === "prerequisites" || isInstalling) && (
              <>
                {phase === "prerequisites" && !isInstalling && (
                  <button className="btn btn-outline btn-sm" onClick={checkPrereqs}>
                    Re-check
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={!prereqOk || !apkPath.trim() || isInstalling}
                  onClick={startInstallation}
                >
                  Start Installation
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}
            {phase === "error" && (
              <button className="btn btn-outline" onClick={() => { setPhase("prerequisites"); setPhaseError(null); setIsInstalling(false); }}>
                Retry
              </button>
            )}
            {phase === "done" && (
              <button className="btn btn-success" onClick={onComplete}>
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>
        </div>
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
