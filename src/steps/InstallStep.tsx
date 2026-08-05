import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";
import {
  errorMessage,
  markDeviceFinalized,
  markSchedulePushed,
  registerDevice,
  Schedule,
  SessionExpiredError,
  withRetry,
} from "../lib/api";

interface InstallStepProps {
  deviceId: string;
  deviceModel: string;
  /**
   * The account's schedule, if one has been created. Pushed here while USB debugging is
   * still open — after `finalize_setup` seals it, pushing requires the parent to open the
   * phone's 10-minute Developer Mode window, so doing it now saves them that entirely.
   */
  schedule: Schedule | null;
  onComplete: () => void;
  onCancel: () => void;
  onBackToDevices: () => void;
  signOut: (reason?: string) => void;
}

type Phase = "prerequisites" | "installing" | "activating" | "configuring" | "done" | "error";

interface PhaseError {
  title: string;
  message: string;
  suggestion: string;
}

interface VerificationResult {
  is_installed: boolean;
  is_device_owner: boolean;
  success: boolean;
  message: string;
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

/**
 * What failed to save when the session died mid-install, most severe first.
 *
 * Only one is ever shown. A dead token fails every write in the run, but the recovery
 * paths cascade — re-linking the device brings back both the "Finish securing" action and
 * the schedule badge — so the parent only needs to be told the worst of it.
 */
const EXPIRY_SEVERITY = ["enrolment", "seal", "schedule"] as const;
type ExpiryKind = (typeof EXPIRY_SEVERITY)[number];

const EXPIRY_MESSAGES: Record<ExpiryKind, string> = {
  enrolment:
    "Your session expired during setup. The phone is fully protected, but it wasn't saved " +
    'to your account. After signing in, go to Devices → Add Device → "Link existing ' +
    'device" to attach it — nothing on the phone needs redoing.',
  seal:
    "Your session expired during setup. The phone is protected and locked down, but we " +
    'couldn\'t record the final step, so it will show as "Not secured". Use "Finish ' +
    'securing" on the Devices page after signing in — it\'s safe to run again.',
  schedule:
    "Your session expired during setup. The phone is protected and has the schedule, but " +
    'we couldn\'t record the push, so it will show as "Not pushed yet". That\'s cosmetic — ' +
    "the phone is already enforcing it.",
};

export default function InstallStep({ deviceId, deviceModel, schedule, onComplete, onCancel, onBackToDevices, signOut }: InstallStepProps) {
  const [phase, setPhase] = useState<Phase>("prerequisites");
  const [phaseError, setPhaseError] = useState<PhaseError | null>(null);
  const [apkPath, setApkPath] = useState("");
  const [prereqOk, setPrereqOk] = useState(false);
  const [prereqMessages, setPrereqMessages] = useState<{ ok: boolean; text: string }[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null);
  const [enrolmentWarning, setEnrolmentWarning] = useState<string | null>(null);
  const [sealWarning, setSealWarning] = useState<string | null>(null);

  /**
   * Session expiry mid-install is recorded here and acted on at the very end, rather than
   * immediately. Every remaining step talks to the phone over ADB and needs no token, so
   * finishing is always better than dropping the parent onto the login screen with a
   * half-provisioned phone in their hand.
   */
  const pendingExpiry = useRef<ExpiryKind | null>(null);

  function noteExpiry(kind: ExpiryKind) {
    const current = pendingExpiry.current;
    if (current === null || EXPIRY_SEVERITY.indexOf(kind) < EXPIRY_SEVERITY.indexOf(current)) {
      pendingExpiry.current = kind;
    }
  }

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

  /**
   * Persist the enrolment so Devices still shows this phone after a restart. Failing here
   * doesn't undo a successful provisioning, so it's reported as a warning rather than
   * flipping the whole flow into an error state.
   *
   * Retried, because the cost of losing this call is high: the phone ends up provisioned
   * but absent from the account, and since Prerequisites rejects an already-provisioned
   * phone, the normal Add Device path can't recover it. (The "Link existing device" option
   * on the scan screen is the deliberate escape hatch for when this still fails.)
   */
  async function recordEnrolment() {
    try {
      await withRetry(() => registerDevice(deviceId, deviceModel));
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        noteExpiry("enrolment");
        return;
      }
      setEnrolmentWarning(
        `The phone is protected, but we couldn't save it to your account ` +
          `(${errorMessage(err)}). Nothing is lost — go to Devices → Add Device → ` +
          `"Link existing device" to attach this phone to your account without reinstalling.`
      );
    }
  }

  /**
   * Seal USB debugging, then record that it happened.
   *
   * Previously this was a bare `catch {}`. That was a real hole: FINALIZE_SETUP applies
   * DISALLOW_DEBUGGING_FEATURES, so when it silently failed the phone stayed ADB-reachable
   * — and since AdbCommandReceiver is exported, anyone could broadcast CLEAR_OWNER and
   * uninstall. Nothing recorded it and no UI could re-send it.
   *
   * Now it retries, and on exhaustion says so loudly and leaves `finalized = false` on the
   * device record so the Devices page can offer "Finish securing".
   */
  async function sealDevice() {
    try {
      await withRetry(() => invoke<string>("finalize_setup", { deviceId }));
    } catch {
      setSealWarning(
        "The phone is protected, but USB debugging could not be locked down. Until that's " +
          "done it can still be removed over USB. Reconnect the phone and use " +
          '"Finish securing" on the Devices page before handing it over.'
      );
      return;
    }

    // Sealed. Recording it is bookkeeping — leaving the flag false only costs the parent a
    // "Finish securing" click, which re-runs both halves safely, so this never undoes the
    // seal. It does need saying, though: silently swallowing it is what hid the original
    // hole this whole flag exists to expose.
    try {
      await withRetry(() => markDeviceFinalized(deviceId));
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        noteExpiry("seal");
        return;
      }
      setSealWarning(
        `The phone was secured, but we couldn't record it (${errorMessage(err)}). It will ` +
          `show as "Not secured" on the Devices page — use "Finish securing" there to ` +
          `clear it, it's safe to run again.`
      );
    }
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
        accounts: string[];
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
    pendingExpiry.current = null;

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

    // Confirm Device Owner activation actually took effect over ADB before spending
    // time pushing config/schedule. USB debugging is intentionally left enabled by the
    // app until finalize_setup runs at the very end of this flow, so a real failure here
    // means activation genuinely didn't work — not an expected disconnect to work around.
    setStatusText("Confirming Device Owner activation…");
    try {
      const check = await invoke<VerificationResult>("verify_installation", { deviceId });
      if (!check.is_installed || !check.is_device_owner) {
        setPhaseError({ ...ERROR_MAP.device_owner, message: check.message });
        setPhase("error");
        setIsInstalling(false);
        setStatusText("");
        return;
      }
    } catch (err) {
      setPhaseError({ ...ERROR_MAP.device_owner, message: `${ERROR_MAP.device_owner.message} ${String(err)}` });
      setPhase("error");
      setIsInstalling(false);
      setStatusText("");
      return;
    }

    // Phase 3: Push Configuration & Schedule
    setPhase("configuring");
    setStatusText("Configuring and launching SkywardBlocker…");
    try {
      await invoke<string>("push_config", { deviceId });
    } catch {
      // Non-fatal — continue
    }

    setScheduleWarning(null);
    if (schedule) {
      let reachedPhone = true;
      try {
        await withRetry(() =>
          invoke<string>("push_schedule", {
            deviceId,
            lockStartHour: schedule.lock_start_hour,
            lockStartMinute: schedule.lock_start_minute,
            lockEndHour: schedule.lock_end_hour,
            lockEndMinute: schedule.lock_end_minute,
            daysMask: schedule.days_mask,
            activeFrom: new Date(schedule.active_from).getTime(),
            activeUntil: new Date(schedule.active_until).getTime(),
            timezoneId: schedule.timezone_id,
          })
        );
      } catch (err) {
        reachedPhone = false;
        // Non-fatal to the overall install (device is still protected), but the parent
        // needs to know the schedule specifically didn't land — surfaced in the success
        // card below rather than silently swallowed.
        setScheduleWarning(
          `The schedule could not be applied (${errorMessage(err)}). ` +
            `Use "Push Schedule" on the Home page afterwards — you'll need the phone's ` +
            `10-minute Developer Mode window for that.`
        );
      }

      if (reachedPhone) {
        try {
          await withRetry(() => markSchedulePushed(schedule.id));
        } catch (err) {
          if (err instanceof SessionExpiredError) {
            noteExpiry("schedule");
          } else {
            setScheduleWarning(
              `The schedule is on the phone and is being enforced, but we couldn't record ` +
                `that (${errorMessage(err)}). It will show as "Not pushed yet" on the Home ` +
                `page — cosmetic only, nothing needs re-pushing.`
            );
          }
        }
      }
    }

    try {
      await invoke<string>("launch_app", { deviceId });
    } catch {
      // Non-fatal — continue
    }

    // Phase 4: Verify, then seal USB debugging now that config/schedule/launch are done
    setStatusText("Verifying installation…");
    try {
      const res = await invoke<VerificationResult>("verify_installation", { deviceId });

      if (res.success) {
        // Save BEFORE sealing. finalize_setup closes USB debugging, so if the save were
        // to fail afterwards the phone would be unreachable without the parent opening the
        // phone's 10-minute Developer Mode window. Saving first means a failure here is
        // recoverable with just a re-login and "Link existing device".
        await recordEnrolment();
        setStatusText("Securing the device…");
        await sealDevice();
        setPhase("done");
        setStatusText("");
      } else {
        setPhase("error");
        setPhaseError(ERROR_MAP.verification);
        setStatusText("");
      }
    } catch {
      // If verification itself fails but previous steps passed, consider it done.
      // Device is provisioned either way — save it, then seal it.
      await recordEnrolment();
      setStatusText("Securing the device…");
      await sealDevice();
      setPhase("done");
      setStatusText("");
    }

    setIsInstalling(false);

    // Every phone-side step is finished, so it's finally safe to end the session. The
    // message names the one recovery path that matters; the warning cards above would be
    // unmounted by the sign-out, so it has to carry itself.
    const expiry = pendingExpiry.current;
    if (expiry) {
      pendingExpiry.current = null;
      signOut(EXPIRY_MESSAGES[expiry]);
    }
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

          {/* No schedule yet — warn before we seal USB debugging, because pushing one
              afterwards costs the parent a trip through the Developer Mode window. */}
          {phase === "prerequisites" && !schedule && (
            <div className="alert alert-warning" style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, lineHeight: 1.6 }}>
                ⚠️ You haven't created a schedule yet. You can still set this device up, but the
                schedule will have to be pushed later using the phone's 10-minute Developer Mode
                window. Creating it on the Home page first avoids that.
              </p>
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

          {/* Installation still succeeded, but the schedule push or the account record
              didn't land — both need saying rather than silently swallowing. */}
          {/* An unsealed device is a security problem, not a bookkeeping one — it gets a
              red alert of its own rather than sharing the amber warning block. */}
          {phase === "done" && sealWarning && (
            <div className="alert alert-error" style={{ marginBottom: 16, animation: "fadeInUp 0.35s ease-out both" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--destructive)", margin: "0 0 6px" }}>
                Device not fully secured
              </p>
              <p style={{ fontSize: 13, color: "var(--foreground)", margin: 0, lineHeight: 1.5 }}>
                {sealWarning}
              </p>
            </div>
          )}

          {phase === "done" && (scheduleWarning || enrolmentWarning) && (
            <div className="alert alert-warning" style={{ marginBottom: 16, animation: "fadeInUp 0.35s ease-out both" }}>
              {scheduleWarning && (
                <p style={{ fontSize: 13, color: "var(--foreground)", margin: 0, lineHeight: 1.5 }}>
                  ⚠️ {scheduleWarning}
                </p>
              )}
              {enrolmentWarning && (
                <p style={{ fontSize: 13, color: "var(--foreground)", margin: scheduleWarning ? "10px 0 0" : 0, lineHeight: 1.5 }}>
                  ⚠️ {enrolmentWarning}
                </p>
              )}
            </div>
          )}

        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={isInstalling}>
          Back to Dashboard
        </button>
        <div className="flex gap-2">
          {(phase === "prerequisites" || isInstalling) && (
            <>
              {phase === "prerequisites" && !isInstalling && (
                <button className="btn btn-outline" onClick={checkPrereqs}>
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
