import { useState } from "react";

import ConnectStep from "../steps/ConnectStep";
import InstallStep from "../steps/InstallStep";
import UsbDebuggingStep from "../steps/UsbDebuggingStep";
import SuccessStep from "../steps/SuccessStep";
import UpdateStep from "../steps/UpdateStep";
import RemoveStep from "../steps/RemoveStep";
import { Me, unregisterDevice } from "../lib/api";

const SUPPORT_EMAIL = "support@skywardos.com";

/** Sub-views within Devices. The list is the resting state; everything else returns to it. */
type View = "list" | "instructions" | "scan" | "setup" | "enrolled" | "update" | "remove";

const ADD_STEPS = [
  { key: "instructions", label: "Prepare the phone", description: "Enable USB debugging" },
  { key: "scan", label: "Scan for the device", description: "Find it over USB" },
  { key: "setup", label: "Automatic setup", description: "Install and protect" },
];

interface DevicesPageProps {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export default function DevicesPage({ me, loading, refresh }: DevicesPageProps) {
  const [view, setView] = useState<View>("list");
  // Serial/model of the device being enrolled — only known mid-flow, before it is saved.
  const [pendingSerial, setPendingSerial] = useState("");
  const [pendingModel, setPendingModel] = useState("");

  const device = me?.device ?? null;
  const removeEnabled = me?.removeEnabled ?? false;

  const backToList = () => {
    setView("list");
    setPendingSerial("");
    setPendingModel("");
  };

  // ── Add-device sub-flow ───────────────────────────────────────────────────

  if (view === "instructions" || view === "scan" || view === "setup" || view === "enrolled") {
    const stepIndex = view === "instructions" ? 0 : view === "scan" ? 1 : 2;

    return (
      <div className="space-y-4">
        {view !== "enrolled" && (
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
          <ConnectStep
            onDeviceSelected={(serial, model) => {
              setPendingSerial(serial);
              setPendingModel(model);
              setView("setup");
            }}
            onBack={() => setView("instructions")}
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
      />
    );
  }

  if (view === "remove" && device) {
    return (
      <RemoveStep
        deviceId={device.serial}
        deviceModel={device.model || device.serial}
        onComplete={async () => {
          // Drop the record too, so Devices doesn't keep showing a phone that no longer
          // has Skyward on it. Gated server-side on remove_enabled as well.
          try {
            await unregisterDevice(device.serial);
          } catch {
            // The app is already off the phone; a stale record is recoverable by support.
          }
          await refresh();
          backToList();
        }}
        onCancel={backToList}
        onBackToDevices={backToList}
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
              <div className="step-title">Connected devices</div>
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
                <span className="badge badge-success">Protected</span>
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
                Add the phone you want Skyward to protect. We'll walk you through enabling USB
                debugging, then set it up automatically.
              </p>
              <button className="btn btn-primary" onClick={() => setView("instructions")}>
                Add Device
              </button>
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
                  Push a newer SkywardBlocker build over USB while protection stays on. Needs the
                  phone's 10-minute Developer Mode window.
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
                    ? "Release device administration and uninstall SkywardBlocker. Needs the phone's 10-minute Developer Mode window."
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
