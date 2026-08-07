import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import ConnectStep from "../steps/ConnectStep";
import InstallStep from "../steps/InstallStep";
import LinkExistingStep from "../steps/LinkExistingStep";
import UsbDebuggingStep from "../steps/UsbDebuggingStep";
import SuccessStep from "../steps/SuccessStep";
import UpdateStep from "../steps/UpdateStep";
import RemoveStep from "../steps/RemoveStep";
import { Me } from "../lib/api";

const SUPPORT_EMAIL = "hello@skywardos.com";

/** Sub-views within Devices. The list is the resting state; everything else returns to it. */
type View = "list" | "instructions" | "scan" | "setup" | "link" | "enrolled" | "update" | "remove";

interface VerificationResult {
  is_installed: boolean;
  is_device_owner: boolean;
  success: boolean;
  message: string;
}

const ADD_STEPS = [
  { key: "instructions", label: "Prepare the phone", description: "Enable USB debugging" },
  { key: "scan", label: "Scan for the device", description: "Find it over USB" },
  { key: "setup", label: "Automatic setup", description: "Install and protect" },
];

interface DevicesPageProps {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: (reason?: string) => void;
}

export default function DevicesPage({ me, loading, refresh, signOut }: DevicesPageProps) {
  const [view, setView] = useState<View>("list");
  // Serial/model of the device being enrolled — only known mid-flow, before it is saved.
  const [pendingSerial, setPendingSerial] = useState("");
  const [pendingModel, setPendingModel] = useState("");
  const [checkingExisting, setCheckingExisting] = useState(false);

  const device = me?.device ?? null;
  const removeEnabled = me?.removeEnabled ?? false;

  const backToList = () => {
    setView("list");
    setPendingSerial("");
    setPendingModel("");
  };

  /**
   * Decide which path a freshly-scanned phone belongs in. A phone that is already installed
   * *and* already Device Owner can't go through setup — the prerequisite check refuses it —
   * so it's routed to the link screen instead, which attaches it to the account without
   * touching the phone. Anything else (including a failed check) falls through to the normal
   * install flow, which surfaces its own prerequisite errors properly.
   */
  async function routeSelectedDevice(serial: string, model: string) {
    setPendingSerial(serial);
    setPendingModel(model);
    setCheckingExisting(true);
    try {
      const res = await invoke<VerificationResult>("verify_installation", { deviceId: serial });
      setView(res.is_installed && res.is_device_owner ? "link" : "setup");
    } catch {
      setView("setup");
    } finally {
      setCheckingExisting(false);
    }
  }

  // ── Add-device sub-flow ───────────────────────────────────────────────────

  if (
    view === "instructions" ||
    view === "scan" ||
    view === "setup" ||
    view === "link" ||
    view === "enrolled"
  ) {
    const stepIndex = view === "instructions" ? 0 : view === "scan" ? 1 : 2;

    return (
      <div className="space-y-4">
        {/* Linking isn't part of the install sequence — showing "Automatic setup" as the
            active step there would misdescribe what's about to happen. */}
        {view !== "enrolled" && view !== "link" && (
          <div className="stepper card" style={{ padding: "20px 24px" }}>
            {ADD_STEPS.map((step, i) => {
              const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
              return (
                <div className="stepper-item" key={step.key}>
                  <div className={`stepper-bullet ${state}`}>
                    {state === "done" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <div className="stepper-content">
                    <div className={`stepper-label ${state === "pending" ? "muted" : ""}`}>{step.label}</div>
                    <div className="stepper-sublabel">{step.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "instructions" && (
          <UsbDebuggingStep onContinue={() => setView("scan")} onCancel={backToList} />
        )}

        {view === "scan" && (
          <>
            {checkingExisting && (
              <div className="alert alert-info" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Checking whether this phone is already set up…
              </div>
            )}
            <ConnectStep
              onDeviceSelected={routeSelectedDevice}
              onBack={() => setView("instructions")}
            />
          </>
        )}

        {view === "link" && (
          <LinkExistingStep
            deviceId={pendingSerial}
            deviceModel={pendingModel}
            onLinked={async () => {
              // Straight back to the list rather than the setup-complete screen — nothing
              // was installed here, and the device card appearing is the confirmation.
              await refresh();
              backToList();
            }}
            onCancel={() => setView("scan")}
            signOut={signOut}
          />
        )}

        {view === "setup" && (
          <InstallStep
            deviceId={pendingSerial}
            deviceModel={pendingModel}
            schedule={me?.schedule ?? null}
            onComplete={async () => {
              await refresh();
              setView("enrolled");
            }}
            onCancel={() => setView("scan")}
            onBackToDevices={() => setView("scan")}
            signOut={signOut}
          />
        )}

        {view === "enrolled" && (
          <SuccessStep
            deviceModel={pendingModel}
            email={me?.email ?? ""}
            onDone={backToList}
          />
        )}
      </div>
    );
  }

  // ── Single-device actions ─────────────────────────────────────────────────

  if (view === "update" && device) {
    return (
      <UpdateStep
        deviceId={device.serial}
        deviceModel={device.model || device.serial}
        onComplete={backToList}
        onCancel={backToList}
        onBackToDevices={backToList}
        signOut={signOut}
      />
    );
  }

  if (view === "remove" && device) {
    // RemoveStep drops the account record itself, before it touches the phone — so by the
    // time the user leaves this step the cached list may be stale whichever way they exit.
    // Re-read on every exit rather than only on success.
    const exitRemove = async () => {
      await refresh();
      backToList();
    };

    return (
      <RemoveStep
        deviceId={device.serial}
        deviceModel={device.model || device.serial}
        onComplete={exitRemove}
        onCancel={exitRemove}
        onBackToDevices={exitRemove}
        signOut={signOut}
      />
    );
  }

  // ── Device list ───────────────────────────────────────────────────────────

  if (loading && !me) {
    return (
      <div className="card">
        <div className="card-content" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="spinner" /> Loading your devices…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">📱</div>
            <div>
              <div className="step-title">My devices</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          {device ? (
            <>
              <div className="device-card" style={{ cursor: "default" }}>
                <div className="device-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                </div>
                <div className="device-info">
                  <div className="device-name">{device.model || "Android device"}</div>
                  <div className="device-serial">{device.serial}</div>
                </div>
                <span className="badge badge-success">Installed</span>
              </div>

              <p className="text-xs text-muted" style={{ marginTop: 12, marginBottom: 0 }}>
                Enrolled {new Date(device.enrolled_at).toLocaleDateString()}. One device per
                account — email {SUPPORT_EMAIL} if you need to switch to a different phone.
              </p>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "32px 24px" }}>
              <div style={{ fontSize: 34, marginBottom: 12 }}>📱</div>
              <div className="step-title" style={{ marginBottom: 8 }}>
                No device yet
              </div>
              <p className="text-sm text-muted" style={{ maxWidth: 400, margin: "0 auto 20px", lineHeight: 1.6 }}>
                Get your phone ready and we will guide you through the setup.
              </p>
              <button className="btn btn-primary" onClick={() => setView("instructions")}>
                Add Device
              </button>
              <p className="text-xs text-muted" style={{ marginTop: 20, marginBottom: 0, lineHeight: 1.6 }}>
                Already set this phone up but it isn't showing here?{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setView("scan")}
                >
                  Link an existing device
                </button>
                .
              </p>
            </div>
          )}
        </div>
      </div>

      {device && (
        <div className="card">
          <div className="card-header">
            <div className="step-title">Manage</div>
          </div>
          <div className="card-content">
            <div className="action-row">
              <div>
                <div className="action-title">Update the app</div>
                <p className="action-detail">
                  Install the newest version of Skyward
                </p>
              </div>
              <button className="btn btn-outline" onClick={() => setView("update")}>
                Update App
              </button>
            </div>

            <div className="action-row" style={{ opacity: removeEnabled ? 1 : 0.55 }}>
              <div>
                <div className="action-title">Remove the app</div>
                <p className="action-detail">
                  {removeEnabled
                    ? "Uninstall Skyward"
                    : `Removal is switched off for your account. That's intentional — it's what makes the block hold. Email ${SUPPORT_EMAIL} if you need it enabled.`}
                </p>
              </div>
              <button
                className="btn btn-outline"
                style={{ borderColor: "var(--destructive)", color: "var(--destructive)" }}
                disabled={!removeEnabled}
                onClick={() => setView("remove")}
                title={removeEnabled ? undefined : "Contact support to enable removal"}
              >
                Remove App
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
