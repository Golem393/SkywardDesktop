import { useState } from "react";
import "./App.css";

import LoginStep from "./steps/LoginStep";
import ConnectStep from "./steps/ConnectStep";
import InstallStep from "./steps/InstallStep";
import SuccessStep from "./steps/SuccessStep";

type WizardStep = "login" | "connect" | "install" | "done";

const STEPS: { key: WizardStep; label: string; description: string }[] = [
  { key: "connect", label: "Connect Device", description: "Plug in via USB" },
  { key: "install", label: "Install & Configure", description: "APK + Device Owner" },
  { key: "done", label: "Complete", description: "All set!" },
];

function App() {
  const [currentStep, setCurrentStep] = useState<WizardStep>("login");
  const [email, setEmail] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceModel, setDeviceModel] = useState("");

  // ── Login handler ───────────────────────────────────────
  const handleLogin = (userEmail: string) => {
    setEmail(userEmail);
    setCurrentStep("connect");
  };

  // ── Device selected handler ─────────────────────────────
  const handleDeviceSelected = (serial: string, model: string) => {
    setDeviceId(serial);
    setDeviceModel(model);
    setCurrentStep("install");
  };

  // ── Install complete handler ────────────────────────────
  const handleInstallComplete = () => {
    setCurrentStep("done");
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
  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);

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
                  : `Step ${stepIndex + 1} of ${STEPS.length}`}
              </p>
              <h1>{STEPS[stepIndex]?.label || "Setup"}</h1>
              <p>
                {currentStep === "connect" &&
                  "Connect your Android device to get started."}
                {currentStep === "install" &&
                  "Install the app and activate protection."}
                {currentStep === "done" &&
                  "Your device is now protected by Skyward."}
              </p>
            </div>

            {/* Step Content */}
            <div className="animate-in" key={currentStep}>
              {currentStep === "connect" && (
                <ConnectStep onDeviceSelected={handleDeviceSelected} />
              )}
              {currentStep === "install" && (
                <InstallStep
                  deviceId={deviceId}
                  deviceModel={deviceModel}
                  onComplete={handleInstallComplete}
                />
              )}
              {currentStep === "done" && (
                <SuccessStep deviceModel={deviceModel} email={email} />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
