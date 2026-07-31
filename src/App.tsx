import { useState } from "react";
import "./App.css";

import LoginStep from "./steps/LoginStep";
import ConnectStep from "./steps/ConnectStep";
import DashboardStep from "./steps/DashboardStep";
import ScheduleStep, { ScheduleConfig } from "./steps/ScheduleStep";
import InstallStep from "./steps/InstallStep";
import SuccessStep from "./steps/SuccessStep";
import UpdateStep from "./steps/UpdateStep";
import RemoveStep from "./steps/RemoveStep";

type WizardStep = "login" | "connect" | "dashboard" | "schedule" | "install" | "editSchedule" | "update" | "remove" | "done";

const STEPS = [
  { key: "connect", label: "Connect Device", description: "Plug in via USB" },
  { key: "dashboard", label: "Device Dashboard", description: "Select management action" },
  { key: "action", label: "Execute Action", description: "Install, Update, or Remove" },
];

function App() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("login");
  const [email, setEmail] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<ScheduleConfig | null>(null);

  // ── Login handler ───────────────────────────────────────
  const handleLogin = (userEmail: string) => {
    setEmail(userEmail);
    setCurrentStep("connect");
  };

  // ── Device selected handler ─────────────────────────────
  const handleDeviceSelected = (serial: string, model: string) => {
    setDeviceId(serial);
    setDeviceModel(model);
    setCurrentStep("dashboard");
  };

  // ── Install complete handler ────────────────────────────
  const handleInstallComplete = () => {
    setCurrentStep("done");
  };

  // ── Device lost handler — return to device search ───────
  const handleBackToDevices = () => {
    setDeviceId("");
    setDeviceModel("");
    setCurrentStep("connect");
  };

  // ── Sign out handler ────────────────────────────────────
  const handleSignOut = () => {
    setEmail("");
    setDeviceId("");
    setDeviceModel("");
    setCurrentStep("login");
  };

  // ── Login Screen (Full page, no sidebar) ────────────────
  if (currentStep === "login") {
    return <LoginStep onLogin={handleLogin} />;
  }

  // ── Dashboard Layout (Navbar + Sidebar + Content) ───────
  const stepIndex =
    currentStep === "connect"
      ? 0
      : currentStep === "dashboard"
      ? 1
      : currentStep === "done"
      ? 3
      : 2;

  return (
    <div className="app-shell">
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <svg className="navbar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 17l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Skyward Installer
        </div>
        <div className="navbar-right">
          <span className="navbar-email">{email}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </nav>

      {/* Dashboard Grid */}
      <div className="page-container wide">
        <div className="dashboard-grid">
          {/* Sidebar Stepper */}
          <aside className="sidebar">
            <p
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                color: "var(--muted-foreground)",
                marginBottom: 16,
              }}
            >
              Setup Steps
            </p>
            <div className="stepper">
              {STEPS.map((step, i) => {
                let bulletClass = "pending";
                if (i < stepIndex) bulletClass = "done";
                else if (i === stepIndex) bulletClass = "active";

                return (
                  <div className="stepper-item" key={step.key}>
                    <div className={`stepper-bullet ${bulletClass}`}>
                      {bulletClass === "done" ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <div className="stepper-content">
                      <div className={`stepper-label ${bulletClass === "pending" ? "muted" : ""}`}>
                        {step.label}
                      </div>
                      <div className="stepper-sublabel">{step.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Main Content */}
          <main className="main-content">
            <div className="page-header">
              <p className="label">
                {currentStep === "done"
                  ? "Finished"
                  : currentStep === "dashboard"
                  ? "Step 2 of 3"
                  : currentStep === "connect"
                  ? "Step 1 of 3"
                  : "Step 3 of 3"}
              </p>
              <h1>
                {currentStep === "connect" && "Connect Device"}
                {currentStep === "dashboard" && "Device Dashboard"}
                {currentStep === "schedule" && "Set Locked Hours"}
                {currentStep === "install" && "Initial Setup"}
                {currentStep === "editSchedule" && "Adjust Locked Hours"}
                {currentStep === "update" && "Update Application"}
                {currentStep === "remove" && "Remove Protection"}
                {currentStep === "done" && "Complete"}
              </h1>
              <p>
                {currentStep === "connect" &&
                  "Connect your Android device to get started."}
                {currentStep === "dashboard" &&
                  "Choose a setup or lifecycle management operation."}
                {currentStep === "schedule" &&
                  "Choose when the device should be locked down each day."}
                {currentStep === "install" &&
                  "Install the app and activate protection."}
                {currentStep === "editSchedule" &&
                  "Change the daily locked/unlocked time window."}
                {currentStep === "update" &&
                  "Push an updated APK over USB connection."}
                {currentStep === "remove" &&
                  "Relinquish Device Owner status and remove application."}
                {currentStep === "done" &&
                  "Your operation completed successfully."}
              </p>
            </div>

            {/* Step Content */}
            <div className="animate-in" key={currentStep}>
              {currentStep === "connect" && (
                <ConnectStep onDeviceSelected={handleDeviceSelected} />
              )}
              {currentStep === "dashboard" && (
                <DashboardStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  onSelectInstall={() => setCurrentStep("schedule")}
                  onSelectUpdate={() => setCurrentStep("update")}
                  onSelectRemove={() => setCurrentStep("remove")}
                  onSelectEditSchedule={() => setCurrentStep("editSchedule")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "schedule" && (
                <ScheduleStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  mode="initial"
                  onContinue={(config) => {
                    setPendingSchedule(config);
                    setCurrentStep("install");
                  }}
                  onCancel={() => setCurrentStep("dashboard")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "install" && pendingSchedule && (
                <InstallStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  scheduleConfig={pendingSchedule}
                  onComplete={handleInstallComplete}
                  onCancel={() => setCurrentStep("schedule")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "editSchedule" && (
                <ScheduleStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  mode="edit"
                  onContinue={() => setCurrentStep("dashboard")}
                  onCancel={() => setCurrentStep("dashboard")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "update" && (
                <UpdateStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  onComplete={() => setCurrentStep("dashboard")}
                  onCancel={() => setCurrentStep("dashboard")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "remove" && (
                <RemoveStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  onComplete={() => setCurrentStep("connect")}
                  onCancel={() => setCurrentStep("dashboard")}
                  onBackToDevices={handleBackToDevices}
                />
              )}
              {currentStep === "done" && (
                <SuccessStep
                  deviceModel={deviceModel}
                  email={email}
                  onDone={() => setCurrentStep("dashboard")}
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
