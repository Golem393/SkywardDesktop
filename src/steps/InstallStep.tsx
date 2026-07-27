import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface InstallStepProps {
  deviceId: string;
  deviceModel: string;
  onComplete: () => void;
}

type Phase = "prerequisites" | "installing" | "configuring" | "activating" | "done" | "error";

export default function InstallStep({ deviceId, deviceModel, onComplete }: InstallStepProps) {
  const [phase, setPhase] = useState<Phase>("prerequisites");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apkPath, setApkPath] = useState("");
  const [prereqOk, setPrereqOk] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const log = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-run prerequisites check
  useEffect(() => {
    checkPrereqs();
  }, []);

  async function checkPrereqs() {
    log("Checking device prerequisites…");
    try {
      const res = await invoke<{
        usb_authorized: boolean;
        no_existing_owner: boolean;
        no_accounts: boolean;
        messages: string[];
        can_proceed: boolean;
      }>("check_prerequisites", { deviceId });

      res.messages.forEach((m) => log(`  ${m}`));

      if (res.can_proceed) {
        log("✓ All prerequisites passed.");
        setPrereqOk(true);
      } else {
        log("✗ Prerequisites not met. Please resolve the issues above.");
        setPrereqOk(false);
      }
    } catch (err) {
      log(`✗ Failed to check prerequisites: ${err}`);
      setPrereqOk(false);
    }
  }

  async function startInstallation() {
    if (!apkPath.trim()) {
      setError("Please enter the path to the SkywardBlocker APK file.");
      return;
    }
    setError(null);

    // Phase 1: Install APK
    setPhase("installing");
    log("Installing SkywardBlocker APK…");
    try {
      const res = await invoke<string>("install_apk", { deviceId, apkPath: apkPath.trim() });
      log(`✓ ${res}`);
    } catch (err) {
      log(`✗ Installation failed: ${err}`);
      setError(String(err));
      setPhase("error");
      return;
    }

    // Phase 2: Push Configuration
    setPhase("configuring");
    log("Pushing runtime configuration…");
    try {
      const res = await invoke<string>("push_config", { deviceId });
      log(`✓ ${res}`);
    } catch (err) {
      log(`⚠ Config push warning: ${err}`);
      // Non-fatal — continue
    }

    // Phase 3: Set Device Owner
    setPhase("activating");
    log("Setting Device Owner…");
    try {
      const res = await invoke<string>("set_device_owner", { deviceId });
      log(`✓ ${res}`);
    } catch (err) {
      log(`✗ Failed to set Device Owner: ${err}`);
      setError(String(err));
      setPhase("error");
      return;
    }

    // Phase 4: Verify
    log("Verifying installation…");
    try {
      const res = await invoke<{
        is_installed: boolean;
        is_device_owner: boolean;
        success: boolean;
        message: string;
      }>("verify_installation", { deviceId });
      log(`✓ ${res.message}`);

      if (res.success) {
        setPhase("done");
        log("🎉 Installation complete! SkywardBlocker is active.");
      } else {
        log("⚠ Verification indicates incomplete setup.");
        setPhase("error");
        setError("Installation completed but verification failed. The app may need manual configuration.");
      }
    } catch (err) {
      log(`⚠ Verification check failed: ${err}`);
      setPhase("done"); // Still consider it done if previous steps passed
    }
  }

  const phaseSteps = [
    { key: "prerequisites", label: "Check prerequisites" },
    { key: "installing", label: "Install APK" },
    { key: "configuring", label: "Push configuration" },
    { key: "activating", label: "Activate Device Owner" },
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

          {/* Error */}
          {error && (
            <div
              style={{
                background: "oklch(0.6 0.22 27 / 0.08)",
                border: "1px solid oklch(0.6 0.22 27 / 0.2)",
                borderRadius: "calc(var(--radius) - 2px)",
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--destructive)",
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {phase === "prerequisites" && (
              <>
                <button className="btn btn-outline btn-sm" onClick={checkPrereqs}>
                  Re-check
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!prereqOk || !apkPath.trim()}
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
              <button className="btn btn-outline" onClick={() => { setPhase("prerequisites"); setError(null); }}>
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

      {/* Activity Log */}
      {logs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              Activity Log
            </div>
          </div>
          <div className="card-content" style={{ paddingTop: 8 }}>
            <pre className="log-box" ref={logRef}>
              {logs.join("\n")}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
