import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";
import {
  errorMessage,
  fetchLatestRelease,
  markSchedulePushed,
  registerDevice,
  Release,
  Schedule,
  SessionExpiredError,
  withRetry,
} from "../lib/api";
import { downloadCurrentRelease, DownloadProgress, formatBytes } from "../lib/release";

interface InstallStepProps {
  deviceId: string;
  deviceModel: string;
  /** The account's schedule, if one has been created. Pushed here as part of setup so the
   *  parent doesn't have to come back and push it separately afterwards. */
  schedule: Schedule | null;
  onComplete: () => void;
  onCancel: () => void;
  onBackToDevices: () => void;
  signOut: (reason?: string) => void;
}

type Phase =
  | "prerequisites"
  | "downloading"
  | "installing"
  | "activating"
  | "configuring"
  | "done"
  | "error";

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
  download: {
    title: "Download Failed",
    message: "Skyward could not be downloaded.",
    suggestion:
      "Check your internet connection and press Retry. Nothing has been changed on the phone yet.",
  },
  apk_install: {
    title: "Installation Failed",
    message: "The app could not be installed on the device.",
    suggestion:
      "Make sure the phone has enough free storage and stays connected, then press Retry. " +
      "If the phone already has a version of Skyward installed that was signed " +
      "differently, it must be uninstalled first.",
  },
  device_owner: {
    title: "Activation Failed",
    message: "Could not set Skyward as an admin.",
    suggestion:
      "If you just signed out of accounts, give the phone another minute and click Re-check — " +
      "If it keeps failing, reach out to our support email.",
  },
  verification: {
    title: "Verification Failed",
    message: "Installation completed but could not be verified.",
    suggestion: "Open Skyward on the device manually to confirm it is running correctly.",
  },
};

/**
 * What failed to save when the session died mid-install, most severe first.
 *
 * Only one is ever shown. A dead token fails every write in the run, but the recovery
 * paths cascade — re-linking the device brings back the schedule badge too — so the
 * parent only needs to be told the worst of it.
 */
const EXPIRY_SEVERITY = ["enrolment", "schedule"] as const;
type ExpiryKind = (typeof EXPIRY_SEVERITY)[number];

const EXPIRY_MESSAGES: Record<ExpiryKind, string> = {
  enrolment:
    "Your session expired during setup. The phone is fully protected, but it wasn't saved " +
    'to your account. After signing in, go to Devices → Add Device → "Link existing ' +
    'device" to attach it — nothing on the phone needs redoing.',
  schedule:
    "Your session expired during setup. The phone is protected and has the schedule, but " +
    'we couldn\'t record the push, so it will show as "Not pushed yet". That\'s cosmetic — ' +
    "the phone is already enforcing it.",
};

/**
 * The accounts the parent had to sign out of, remembered for the duration of setup so the
 * success screen can hand back the exact list to sign into again. Keyed by device, since
 * one parent may set up several phones.
 *
 * Held in localStorage rather than component state because the list is captured before
 * sign-out and needed after provisioning — a reload or a trip back to the dashboard in
 * between must not lose it. Only non-empty lists are written, so the re-check that
 * follows a successful sign-out (which legitimately returns zero accounts) doesn't
 * erase the very thing being remembered.
 */
const accountsKey = (deviceId: string) => `skyward.accountsToRestore.${deviceId}`;

function rememberAccounts(deviceId: string, accounts: string[]) {
  if (accounts.length === 0) return;
  try {
    localStorage.setItem(accountsKey(deviceId), JSON.stringify(accounts));
  } catch {
    // Storage unavailable — the checklist is a convenience, not worth failing setup for.
  }
}

function recallAccounts(deviceId: string): string[] {
  try {
    const raw = localStorage.getItem(accountsKey(deviceId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export default function InstallStep({ deviceId, deviceModel, schedule, onComplete, onCancel, onBackToDevices, signOut }: InstallStepProps) {
  const [phase, setPhase] = useState<Phase>("prerequisites");
  const [phaseError, setPhaseError] = useState<PhaseError | null>(null);
  /** The build to install, fetched for display. The bytes are fetched at install time. */
  const [release, setRelease] = useState<Release | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [prereqOk, setPrereqOk] = useState(false);
  const [prereqMessages, setPrereqMessages] = useState<{ ok: boolean; text: string }[]>([]);
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null);
  const [enrolmentWarning, setEnrolmentWarning] = useState<string | null>(null);
  /** Accounts still signed in as of the last check — the sign-out checklist. */
  const [pendingAccounts, setPendingAccounts] = useState<string[]>([]);
  /** Accounts seen at any point during setup — the sign-back-in checklist. */
  const [accountsToRestore, setAccountsToRestore] = useState<string[]>(() => recallAccounts(deviceId));
  const [openingSettings, setOpeningSettings] = useState(false);

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
    loadRelease();
  }, []);

  /**
   * Look up which build will be installed, so the parent can see it before committing.
   *
   * Only the metadata — the download itself waits until they press Start, since the signed
   * URL attached here expires in minutes and account sign-out can sit between the two.
   * A failure is recorded but doesn't block the prerequisites display; it's re-surfaced on
   * the Start button, which stays disabled until this succeeds.
   */
  async function loadRelease() {
    setReleaseError(null);
    try {
      setRelease(await withRetry(fetchLatestRelease));
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        signOut("Your session expired. Please sign in again to continue setup.");
        return;
      }
      setRelease(null);
      setReleaseError(errorMessage(err));
    }
  }

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

      setPendingAccounts(res.accounts);
      if (res.accounts.length > 0) {
        rememberAccounts(deviceId, res.accounts);
        setAccountsToRestore(res.accounts);
      }

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

  /**
   * Jump the phone straight to its Accounts screen. Saves the parent hunting through
   * Settings, and matters most on OEM skins where Accounts is buried. Best-effort: if it
   * fails they can still navigate there themselves, so it never blocks setup.
   */
  async function openAccountSettings() {
    setOpeningSettings(true);
    try {
      await invoke<string>("open_account_settings", { deviceId });
    } catch {
      // Non-fatal — the instructions above the button still stand on their own.
    } finally {
      setOpeningSettings(false);
    }
  }

  async function startInstallation() {
    if (isInstalling) return;
    setPhaseError(null);
    setStatusText("Verifying device connection…");
    pendingExpiry.current = null;

    if (!(await ensureConnected())) return;

    setIsInstalling(true);

    // Phase 1: Fetch the APK.
    //
    // Deliberately before touching the phone: a download failure at this point has changed
    // nothing on the device, so Retry is genuinely free. Doing it after provisioning began
    // would leave a half-set-up phone if the network dropped.
    setPhase("downloading");
    setDownloadProgress(null);
    setStatusText("Downloading Skyward…");
    await new Promise((resolve) => setTimeout(resolve, 50));

    let apkPath: string;
    try {
      const downloaded = await downloadCurrentRelease(setDownloadProgress);
      apkPath = downloaded.apkPath;
      // The download re-fetches the release, so this may be newer than what was shown on
      // mount. Reflect that rather than reporting a version we didn't install.
      setRelease(downloaded.release);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setIsInstalling(false);
        setStatusText("");
        signOut("Your session expired before setup began. Please sign in and start again — nothing on the phone was changed.");
        return;
      }
      setPhaseError({ ...ERROR_MAP.download, message: `${ERROR_MAP.download.message} ${errorMessage(err)}` });
      setPhase("error");
      setIsInstalling(false);
      setStatusText("");
      return;
    }

    setPhase("installing");
    setStatusText("Installing Skyward on your device…");
    try {
      await invoke<string>("install_apk", { deviceId, apkPath });
    } catch (err) {
      setPhaseError({ ...ERROR_MAP.apk_install, message: `${ERROR_MAP.apk_install.message} ${String(err)}` });
      setPhase("error");
      setIsInstalling(false);
      setStatusText("");
      return;
    }

    // Phase 3: Set Device Owner
    //
    // Android takes a while to stop reporting freshly-removed accounts to the device
    // policy service, and set_device_owner sits in a retry loop for up to ~90s waiting
    // that out. Say so, otherwise a parent who just signed out watches an unexplained
    // spinner and assumes it has hung.
    setPhase("activating");
    setStatusText(
      accountsToRestore.length > 0
        ? "Activating admin permissions… the phone can take up to a minute to let go of the accounts you just signed out of."
        : "Activating admin permissions…"
    );
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
    // app at all times, so a real failure here means activation genuinely didn't work —
    // not an expected disconnect to work around.
    setStatusText("Confirming admin activation…");
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

    // Phase 4: Push Configuration & Schedule
    setPhase("configuring");
    setStatusText("Configuring and launching Skyward…");
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
          `Use "Push Schedule" on the Home page afterwards.`
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

    // Phase 5: Verify installation succeeded
    setStatusText("Verifying installation…");
    try {
      const res = await invoke<VerificationResult>("verify_installation", { deviceId });

      if (res.success) {
        await recordEnrolment();
        setPhase("done");
        setStatusText("");
      } else {
        setPhase("error");
        setPhaseError(ERROR_MAP.verification);
        setStatusText("");
      }
    } catch {
      // If verification itself fails but previous steps passed, consider it done.
      // Device is provisioned either way — save it.
      await recordEnrolment();
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
    { key: "downloading", label: "Download Skyward" },
    { key: "installing", label: "Install on device" },
    { key: "activating", label: "Activate admin status" },
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
              <div className="step-title">Install Skyward</div>
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

          {/* Signing out is asked for here, immediately before Device Owner is claimed,
              rather than back in the prep step — it keeps the phone signed in for as much
              of setup as possible, so the window where the parent is locked out of their
              own accounts is measured in minutes. */}
          {phase === "prerequisites" && pendingAccounts.length > 0 && (
            <div style={{
              background: "oklch(0.6 0.22 27 / 0.05)",
              border: "1px solid oklch(0.6 0.22 27 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
            }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 14, color: "var(--destructive)" }}>
                Sign out of {pendingAccounts.length} account{pendingAccounts.length === 1 ? "" : "s"} on the phone
              </h4>
              <p style={{ fontSize: 13, color: "var(--foreground)", margin: "0 0 12px", lineHeight: 1.5 }}>
                Click the Manage Accounts button and remove the accounts. Click "Re-check" at the bottom of the page after removing the accounts.
              </p>
              <ul style={{
                margin: "0 0 14px",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--foreground)",
                lineHeight: 1.7,
              }}>
                {pendingAccounts.map((account) => (
                  <li key={account}>{account}</li>
                ))}
              </ul>
              <button className="btn btn-primary" onClick={openAccountSettings} disabled={openingSettings}>
                {openingSettings ? (
                  "Opening…"
                ) : (
                  <>
                    Manage Accounts
                  </>
                )}
              </button>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "12px 0 0", lineHeight: 1.5 }}>
                Some of the accounts do not appear in the Manage accounts page of the Settings app. For these accounts, you will need to open the app and log out.
              </p>
            </div>
          )}

          {/* Which build is about to be installed. Replaces the old "type an APK path"
              field — the app fetches its own copy, so the parent only needs to see what
              they're getting, not go and find it. */}
          {phase === "prerequisites" && (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Version to install</label>
              {release ? (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 16px",
                  borderRadius: "calc(var(--radius) - 2px)",
                  background: "oklch(0.71 0.08 247 / 0.06)",
                  border: "1px solid oklch(0.71 0.08 247 / 0.15)",
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--foreground)" }}>
                      Skyward {release.version_name}
                    </div>
                    {release.release_notes && (
                      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.5 }}>
                        {release.release_notes}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                    {formatBytes(release.size_bytes)}
                  </span>
                </div>
              ) : releaseError ? (
                <div className="alert alert-warning" style={{ marginTop: 0 }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.5 }}>
                    ⚠️ Couldn't check for the latest version ({releaseError}).
                  </p>
                  <button className="btn btn-outline" onClick={loadRelease}>
                    Try again
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted mt-2">Checking for the latest version…</p>
              )}
            </div>
          )}

          {/* Download progress. The slowest step on a poor connection, so it gets a real
              bar rather than the shared indeterminate spinner above. */}
          {phase === "downloading" && downloadProgress && downloadProgress.total > 0 && (
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
              }}>
                Skyward{release ? ` ${release.version_name}` : ""} has been installed and
                activated on your device. You can now proceed to the next step.
              </p>
            </div>
          )}

          {/* The other half of the promise made before sign-out: hand back the exact list,
              so the parent never has to remember what was on the phone. */}
          {phase === "done" && accountsToRestore.length > 0 && (
            <div style={{
              background: "oklch(0.71 0.08 247 / 0.06)",
              border: "1px solid oklch(0.71 0.08 247 / 0.18)",
              borderRadius: "var(--radius)",
              padding: "16px 20px",
              marginBottom: 16,
              animation: "fadeInUp 0.35s ease-out both",
            }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 14, color: "var(--foreground)" }}>
                Sign back into {accountsToRestore.length} account{accountsToRestore.length === 1 ? "" : "s"}
              </h4>
              <p style={{ fontSize: 13, color: "var(--foreground)", margin: "0 0 12px", lineHeight: 1.5 }}>
                The phone is protected now, so these can go straight back on. Add the Google
                account first — it restores the phone's saved passwords, which then fill in
                most of the rest for you.
              </p>
              <ul style={{
                margin: "0 0 14px",
                paddingLeft: 18,
                fontSize: 13,
                color: "var(--foreground)",
                lineHeight: 1.7,
              }}>
                {accountsToRestore.map((account) => (
                  <li key={account}>{account}</li>
                ))}
              </ul>
              <button className="btn btn-primary" onClick={openAccountSettings} disabled={openingSettings}>
                {openingSettings ? (
                  "Opening…"
                ) : (
                  <>
                    Manage Accounts
                  </>
                )}
              </button>
            </div>
          )}

          {/* Installation still succeeded, but the schedule push or the account record
              didn't land — both need saying rather than silently swallowing. */}
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
          Back
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
                disabled={!prereqOk || !release || isInstalling}
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
            <button
              className="btn btn-outline"
              onClick={() => {
                setPhase("prerequisites");
                setPhaseError(null);
                setIsInstalling(false);
                setDownloadProgress(null);
                // A download that failed on an expired signed URL only recovers with a
                // fresh release record, so Retry refetches rather than reusing the old one.
                loadRelease();
              }}
            >
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
